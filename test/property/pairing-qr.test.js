// test/property/pairing-qr.test.js
//
// 属性测试：`validatePairingQr` 的输入校验契约。
// 对应 design.md §Testing Strategy "Property 24 — PairingQR 校验"。
//
// 主属性（Property 24 / Validates: Requirements 15.4）：
//   - For all 合法 `{ v: 1, apiBase, syncToken }`（apiBase 非空且以 http(s)://
//     开头，syncToken trim 后非空），`validatePairingQr(value)` 返回
//     `{ ok: true, value: { v: 1, apiBase, syncToken } }`。
//   - For all 不合法输入（非对象 / 缺字段 / 字段类型错 / 字段空白等），
//     `validatePairingQr(value)` 返回 `{ ok: false, reason }`，
//     且 `typeof reason === "string"` && `reason.length > 0`。
//
// 配套小测试：硬编码列举每个已知非法分支，断言 `reason` 与 package-builder.js
// 中的中文文案保持一致，防止文案被悄悄改动。
//
// 该测试只 import 共享层纯函数，不触碰 DOM / Capacitor。

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fc from "fast-check";

import { validatePairingQr } from "../../app/shared/package-builder.js";

// ---------- 合法 / 非法 arbitraries ----------------------------------------

/** 合法 apiBase：以 http:// 或 https:// 开头，整体非空。 */
const validApiBaseArb = fc
  .tuple(
    fc.constantFrom("http://", "https://"),
    // 用 grapheme-ascii 避免代理对噪音；后缀允许空（仅 scheme 也合法）。
    fc.string({ unit: "grapheme-ascii", minLength: 0, maxLength: 32 }),
  )
  .map(([scheme, rest]) => scheme + rest);

/** 合法 syncToken：trim 后长度 > 0。 */
const validSyncTokenArb = fc
  .string({ unit: "grapheme-ascii", minLength: 1, maxLength: 64 })
  .filter((s) => s.trim().length > 0);

/** 合法 PairingQR 对象。 */
const validQrArb = fc.record({
  v: fc.constant(1),
  apiBase: validApiBaseArb,
  syncToken: validSyncTokenArb,
});

/**
 * 非法输入 arbitrary：通过 `fc.oneof` 混合各类反例分支。
 * 每个分支内部都构造为"必然不合法"，避免与合法输入相交。
 */
const invalidQrArb = fc.oneof(
  // 1. 非对象类型：null / undefined / 字符串 / 数字 / 布尔
  fc.constant(null),
  fc.constant(undefined),
  fc.string(),
  fc.integer(),
  fc.float({ noNaN: true }),
  fc.boolean(),
  // 2. 数组（typeof === "object" 但 Array.isArray 为 true）
  fc.array(fc.anything(), { minLength: 0, maxLength: 4 }),
  // 3. 缺 v 字段
  fc.record({
    apiBase: validApiBaseArb,
    syncToken: validSyncTokenArb,
  }),
  // 4. v !== 1（用 anything 过滤掉数值 1）
  fc.record({
    v: fc.anything().filter((x) => x !== 1),
    apiBase: validApiBaseArb,
    syncToken: validSyncTokenArb,
  }),
  // 5. apiBase 不是字符串
  fc.record({
    v: fc.constant(1),
    apiBase: fc.oneof(fc.constant(null), fc.integer(), fc.boolean(), fc.array(fc.anything())),
    syncToken: validSyncTokenArb,
  }),
  // 6. apiBase 空字符串
  fc.record({
    v: fc.constant(1),
    apiBase: fc.constant(""),
    syncToken: validSyncTokenArb,
  }),
  // 7. apiBase 非空但不以 http(s):// 开头
  fc.record({
    v: fc.constant(1),
    apiBase: fc
      .string({ minLength: 1, maxLength: 32 })
      .filter((s) => !s.startsWith("http://") && !s.startsWith("https://")),
    syncToken: validSyncTokenArb,
  }),
  // 8. syncToken 不是字符串
  fc.record({
    v: fc.constant(1),
    apiBase: validApiBaseArb,
    syncToken: fc.oneof(fc.constant(null), fc.integer(), fc.boolean(), fc.array(fc.anything())),
  }),
  // 9. syncToken 空字符串
  fc.record({
    v: fc.constant(1),
    apiBase: validApiBaseArb,
    syncToken: fc.constant(""),
  }),
  // 10. syncToken 仅含空白字符
  fc.record({
    v: fc.constant(1),
    apiBase: validApiBaseArb,
    syncToken: fc.stringOf(fc.constantFrom(" ", "\t", "\n", "\r"), {
      minLength: 1,
      maxLength: 8,
    }),
  }),
);

// ---------- Property 24 主测试 ---------------------------------------------

test("Property 24: validatePairingQr 接受合法对象 (Validates: Requirements 15.4)", () => {
  fc.assert(
    fc.property(validQrArb, (qr) => {
      const result = validatePairingQr(qr);
      assert.deepEqual(result, {
        ok: true,
        value: { v: 1, apiBase: qr.apiBase, syncToken: qr.syncToken },
      });
    }),
  );
});

test("Property 24: validatePairingQr 拒绝非法输入并给出非空 reason (Validates: Requirements 15.4)", () => {
  fc.assert(
    fc.property(invalidQrArb, (bad) => {
      const result = validatePairingQr(bad);
      assert.equal(result.ok, false);
      assert.equal(typeof result.reason, "string");
      assert.ok(result.reason.length > 0, "reason 必须是非空字符串");
    }),
  );
});

// ---------- Property 24 配套：硬编码反例验证具体 reason 文案 -----------------

test("Property 24 companion: 已知非法分支的 reason 文案锁定 (Validates: Requirements 15.4)", () => {
  const REASON_NOT_OBJECT = "配对内容必须是 JSON 对象";
  const REASON_BAD_VERSION = "配对版本不支持";
  const REASON_BAD_API_BASE = "apiBase 格式无效，必须以 http(s):// 开头";
  const REASON_EMPTY_TOKEN = "syncToken 不能为空";

  /** @type {Array<[unknown, string]>} */
  const cases = [
    // 非对象类型
    [null, REASON_NOT_OBJECT],
    [undefined, REASON_NOT_OBJECT],
    ["hello", REASON_NOT_OBJECT],
    [42, REASON_NOT_OBJECT],
    [true, REASON_NOT_OBJECT],
    [[1, 2, 3], REASON_NOT_OBJECT],
    // v 字段非法
    [{ apiBase: "http://x", syncToken: "t" }, REASON_BAD_VERSION],
    [{ v: 0, apiBase: "http://x", syncToken: "t" }, REASON_BAD_VERSION],
    [{ v: 2, apiBase: "http://x", syncToken: "t" }, REASON_BAD_VERSION],
    [{ v: "1", apiBase: "http://x", syncToken: "t" }, REASON_BAD_VERSION],
    // apiBase 字段非法
    [{ v: 1, apiBase: "", syncToken: "t" }, REASON_BAD_API_BASE],
    [{ v: 1, apiBase: "ftp://x", syncToken: "t" }, REASON_BAD_API_BASE],
    [{ v: 1, apiBase: "x.example.com", syncToken: "t" }, REASON_BAD_API_BASE],
    [{ v: 1, apiBase: 123, syncToken: "t" }, REASON_BAD_API_BASE],
    [{ v: 1, apiBase: null, syncToken: "t" }, REASON_BAD_API_BASE],
    // syncToken 字段非法
    [{ v: 1, apiBase: "http://x", syncToken: "" }, REASON_EMPTY_TOKEN],
    [{ v: 1, apiBase: "http://x", syncToken: "   " }, REASON_EMPTY_TOKEN],
    [{ v: 1, apiBase: "http://x", syncToken: "\t\n" }, REASON_EMPTY_TOKEN],
    [{ v: 1, apiBase: "http://x", syncToken: 123 }, REASON_EMPTY_TOKEN],
    [{ v: 1, apiBase: "http://x", syncToken: null }, REASON_EMPTY_TOKEN],
  ];

  for (const [input, expectedReason] of cases) {
    const result = validatePairingQr(input);
    assert.deepEqual(
      result,
      { ok: false, reason: expectedReason },
      `期望对 ${JSON.stringify(input) ?? String(input)} 返回 reason="${expectedReason}"`,
    );
  }
});

test("Property 24 companion: 合法对象的若干边界例 (Validates: Requirements 15.4)", () => {
  const cases = [
    { v: 1, apiBase: "http://", syncToken: "t" },
    { v: 1, apiBase: "https://", syncToken: "t" },
    { v: 1, apiBase: "http://192.168.1.10:4173", syncToken: "abc-def" },
    { v: 1, apiBase: "https://example.com/api", syncToken: " t " }, // 两侧空白但 trim 后非空
  ];
  for (const qr of cases) {
    const result = validatePairingQr(qr);
    assert.deepEqual(result, {
      ok: true,
      value: { v: 1, apiBase: qr.apiBase, syncToken: qr.syncToken },
    });
  }
});
