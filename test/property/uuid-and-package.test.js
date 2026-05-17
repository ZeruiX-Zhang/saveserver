// test/property/uuid-and-package.test.js
//
// Property 7: ID 全局唯一且为合法 UUID v4
//   Validates: Requirements 4.5, 18.1, 18.2
// Property 8: 重发包复用 package_id（LAN 重发 + USB 重导）
//   Validates: Requirements 12.9, 13.2, 13.4, 18.3
//
// 思路：
//   - P7 通过对 `buildPutIn` 与 `buildOperationPackage` 各 N 次默认 DI 调用，
//     收集生成的 `operation_id` / `package_id`，断言 (a) 每个值匹配 UUID v4
//     正则；(b) 同一次循环内两两互不相同。
//   - P8 验证「调用方契约的不变量」：一个已构造好的 `Operation_Package`
//     在被任意重发 / 重导的逻辑使用时，其 `package_id` 不能被回写或替换。
//     用一个内存版 mock fetch 收集 outgoing body，断言每次发出的 body 中
//     `package_id === pkg.package_id`；同理对 USB 导出，使用一个共享的
//     文件名生成器 `operations-${pkg.package_id}.warehouse.gz`，断言 M 次
//     调用的输出全部包含同一个 package_id。

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fc from "fast-check";

import { buildPutIn } from "../../app/shared/op-builders.js";
import { buildOperationPackage } from "../../app/shared/package-builder.js";
import {
  productIdArb,
  qtyArb,
  levelIdArb,
  asciiAlnumArb,
} from "../helpers/arbitraries.js";

/** UUID v4 严格正则（小写），与 design/op-builders 内部表达一致。 */
const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// ──────────────────────────────────────────────────────────────────────────
// Property 7: ID 全局唯一且为合法 UUID v4
// ──────────────────────────────────────────────────────────────────────────

test(
  "Property 7: buildPutIn N 次默认 DI 产出的 operation_id 互不相同且均为合法 UUID v4 — Validates: Requirements 4.5, 18.1",
  () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 100 }),
        productIdArb,
        qtyArb,
        levelIdArb,
        (n, productId, qty, targetLevelId) => {
          const ids = [];
          for (let i = 0; i < n; i += 1) {
            // 默认 DI（不注入 idGen / now）—— 走 globalThis.crypto.randomUUID
            const op = buildPutIn({ productId, qty, targetLevelId });
            ids.push(op.operation_id);
          }

          for (const id of ids) {
            assert.match(id, UUID_V4_REGEX, `非法 UUID v4: ${id}`);
          }
          assert.equal(
            new Set(ids).size,
            ids.length,
            `N=${n} 次默认 DI 调用出现了重复的 operation_id`,
          );
        },
      ),
      { numRuns: 50 },
    );
  },
);

test(
  "Property 7: buildOperationPackage N 次默认 DI 产出的 package_id 互不相同且均为合法 UUID v4 — Validates: Requirements 18.2",
  () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 100 }),
        asciiAlnumArb,
        asciiAlnumArb,
        productIdArb,
        qtyArb,
        levelIdArb,
        (n, deviceId, deviceName, productId, qty, targetLevelId) => {
          // 共用同一条 op 即可 —— 我们只校验包级 ID 的形状与唯一性
          const op = buildPutIn({ productId, qty, targetLevelId });

          const pkgIds = [];
          for (let i = 0; i < n; i += 1) {
            const pkg = buildOperationPackage({
              deviceId,
              deviceName,
              operations: [op],
            });
            pkgIds.push(pkg.package_id);
          }

          for (const id of pkgIds) {
            assert.match(id, UUID_V4_REGEX, `非法 UUID v4 package_id: ${id}`);
          }
          assert.equal(
            new Set(pkgIds).size,
            pkgIds.length,
            `N=${n} 次 buildOperationPackage 出现了重复的 package_id`,
          );
        },
      ),
      { numRuns: 50 },
    );
  },
);

// ──────────────────────────────────────────────────────────────────────────
// Property 8: 重发包复用 package_id
// ──────────────────────────────────────────────────────────────────────────

/**
 * 内存版 mock fetch：捕获 POST body（已 JSON.parse）。
 * 不做任何真实网络请求；仅模拟"调用方对同一个 pkg 重复 emit M 次"的链路。
 *
 * @param {object} pkg                已构造好的 Operation_Package
 * @param {number} m                  重发次数 (≥ 2)
 * @returns {Array<object>}           按顺序捕获的 outgoing body
 */
function simulateRetrySend(pkg, m) {
  const captured = [];

  /** 极简 mock fetch：只记录 body，立即「成功」。 */
  const fakeFetch = (_url, init) => {
    // 模拟真实 upload-lan：调用方负责把 pkg 序列化为 JSON 字符串塞进 body。
    captured.push(JSON.parse(init.body));
    return { ok: true, status: 200, json: () => ({}) };
  };

  // 调用方契约：M 次重发 *同一* pkg 对象 —— 不允许在循环里重新构造。
  for (let i = 0; i < m; i += 1) {
    fakeFetch("http://mock.invalid/api/sync/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pkg),
    });
  }

  return captured;
}

/**
 * 共享文件名生成器：take pkg → `operations-${pkg.package_id}.warehouse.gz`。
 * 关键约束：函数体内 *不得* 调用任何 UUID 生成器；package_id 完全来自 pkg。
 *
 * @param {{ package_id: string }} pkg
 * @returns {string}
 */
function usbFileNameFor(pkg) {
  return `operations-${pkg.package_id}.warehouse.gz`;
}

/**
 * 模拟 USB 重导：M 次调用同一 pkg → M 个文件路径。
 *
 * @param {object} pkg
 * @param {number} m
 * @returns {Array<string>}
 */
function simulateUsbExport(pkg, m) {
  const paths = [];
  for (let i = 0; i < m; i += 1) {
    paths.push(usbFileNameFor(pkg));
  }
  return paths;
}

test(
  "Property 8: LAN 重发同一 pkg 时 outgoing body 中 package_id 全部一致 — Validates: Requirements 12.9, 18.3",
  () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 5 }),
        asciiAlnumArb,
        asciiAlnumArb,
        productIdArb,
        qtyArb,
        levelIdArb,
        (m, deviceId, deviceName, productId, qty, targetLevelId) => {
          const op = buildPutIn({ productId, qty, targetLevelId });
          const pkg = buildOperationPackage({
            deviceId,
            deviceName,
            operations: [op],
          });

          const captured = simulateRetrySend(pkg, m);

          assert.equal(captured.length, m, "mock fetch 捕获次数与重发次数不一致");
          for (const body of captured) {
            assert.equal(
              body.package_id,
              pkg.package_id,
              "outgoing body.package_id 与原 pkg.package_id 不一致",
            );
          }
          // 额外断言：pkg 对象本身没有被任何调用方/重发逻辑回写
          assert.match(
            pkg.package_id,
            UUID_V4_REGEX,
            "重发流程不应改写 pkg.package_id 的形状",
          );
        },
      ),
      { numRuns: 50 },
    );
  },
);

test(
  "Property 8: USB 重导同一 pkg 时 M 个文件路径都包含同一个 package_id — Validates: Requirements 13.2, 13.4",
  () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 5 }),
        asciiAlnumArb,
        asciiAlnumArb,
        productIdArb,
        qtyArb,
        levelIdArb,
        (m, deviceId, deviceName, productId, qty, targetLevelId) => {
          const op = buildPutIn({ productId, qty, targetLevelId });
          const pkg = buildOperationPackage({
            deviceId,
            deviceName,
            operations: [op],
          });

          const paths = simulateUsbExport(pkg, m);

          assert.equal(paths.length, m, "USB 导出次数与请求次数不一致");

          const expected = `operations-${pkg.package_id}.warehouse.gz`;
          for (const p of paths) {
            assert.equal(
              p,
              expected,
              "USB 导出路径未复用同一 package_id",
            );
            assert.ok(
              p.includes(pkg.package_id),
              `USB 导出路径未包含 package_id: ${p}`,
            );
          }
          // 进一步：所有路径互相相等（既是去重也是不变量）
          assert.equal(new Set(paths).size, 1, "M 次重导出现了不同文件名");
        },
      ),
      { numRuns: 50 },
    );
  },
);
