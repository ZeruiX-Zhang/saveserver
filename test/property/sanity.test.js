// test/property/sanity.test.js
//
// 占位属性测试：验证 `node --test` + `fast-check` 工具链已正确接入。
// 不绑定任何具体 Requirement / Property —— 真正的属性测试在 1.8 之后逐项落地。

import { test } from "node:test";
import * as fc from "fast-check";

test("fast-check toolchain wired", () => {
  fc.assert(fc.property(fc.integer(), (n) => n === n));
});
