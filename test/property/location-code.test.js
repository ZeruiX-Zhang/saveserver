// test/property/location-code.test.js
//
// 属性测试：`app/shared/location-code.js`。
// 对应 design.md §Correctness Properties 中 Property 1/2/3，覆盖位置码
// `formatLocationCode` ↔ `parseLocationCode` 的双向 round-trip，以及非法
// 输入时的错误原因约束。

import { test } from "node:test";
import * as fc from "fast-check";

import {
  LOCATION_CODE_PATTERN,
  parseLocationCode,
  formatLocationCode,
} from "../../app/shared/location-code.js";
import { asciiAlnumArb } from "../helpers/arbitraries.js";

// 层数 [1, 999]：与 design §Data Models 中的 `\d{1,3}` 取值域一致。
const levelNoArb = fc.integer({ min: 1, max: 999 });

test("Property 1: 位置码 format → parse round-trip — Validates: Requirements 17.2", () => {
  fc.assert(
    fc.property(asciiAlnumArb, asciiAlnumArb, levelNoArb, (w, s, lvl) => {
      const result = parseLocationCode(formatLocationCode(w, s, lvl));
      return (
        result.ok === true &&
        result.warehouse === w.toUpperCase() &&
        result.shelf === s.toUpperCase() &&
        result.levelNo === lvl
      );
    }),
  );
});

test("Property 2: 位置码 parse → format round-trip — Validates: Requirements 17.3", () => {
  fc.assert(
    fc.property(asciiAlnumArb, asciiAlnumArb, levelNoArb, (w, sh, lvl) => {
      const s = formatLocationCode(w, sh, lvl);
      const r = parseLocationCode(s);
      return (
        r.ok === true &&
        formatLocationCode(r.warehouse, r.shelf, r.levelNo) === s
      );
    }),
  );
});

test("Property 3: 非法位置码返回非空 reason — Validates: Requirements 17.4", () => {
  // 过滤条件与 parseLocationCode 内部一致：先 trim 再匹配 LOCATION_CODE_PATTERN。
  // 这样可以确保被采样的字符串一定走到 parseLocationCode 的 ok:false 分支
  // （空内容 / 格式不符 / 层数为 0），而不是因 trim 后再次合法导致漏过过滤。
  const invalidStringArb = fc
    .string()
    .filter((x) => !LOCATION_CODE_PATTERN.test(String(x).trim()));

  fc.assert(
    fc.property(invalidStringArb, (s) => {
      const r = parseLocationCode(s);
      return (
        r.ok === false &&
        typeof r.reason === "string" &&
        r.reason.length > 0
      );
    }),
  );
});
