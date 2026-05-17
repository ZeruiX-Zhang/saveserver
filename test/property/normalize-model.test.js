// test/property/normalize-model.test.js
//
// 属性测试：型号归一化函数 `normalizeModel` 的字符集封闭性与幂等性。
// 对应 design.md §Testing Strategy "Property 4 — 型号归一化幂等且字符集封闭"。
//
// 主属性（Property 4 / Validates: Requirements 3.6）：
//   ∀ s ∈ string. let n = normalizeModel(s). Then
//     (a) n 中每个字符都属于 [A-Z0-9\u4e00-\u9fff]
//     (b) normalizeModel(n) === n            （幂等）
//
// 配套小属性：nullish 输入（null / undefined）一律返回空串 ""。
//
// 该测试只 import 共享层纯函数，不触碰 DOM / Capacitor。

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fc from "fast-check";

import { normalizeModel } from "../../app/shared/normalize-model.js";

const ALLOWED_CHARSET = /^[A-Z0-9\u4e00-\u9fff]*$/;

test("Property 4: normalizeModel 字符集封闭且幂等 (Validates: Requirements 3.6)", () => {
  fc.assert(
    fc.property(fc.string(), (s) => {
      const n = normalizeModel(s);
      // (a) 字符集封闭
      assert.match(n, ALLOWED_CHARSET);
      // (b) 幂等
      assert.equal(normalizeModel(n), n);
    }),
  );
});

test("Property 4 companion: normalizeModel(nullish) === \"\" (Validates: Requirements 3.6)", () => {
  fc.assert(
    fc.property(fc.constantFrom(null, undefined), (v) => {
      assert.equal(normalizeModel(v), "");
    }),
  );
});
