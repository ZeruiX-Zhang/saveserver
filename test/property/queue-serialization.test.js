// test/property/queue-serialization.test.js
//
// 属性测试：操作队列的 JSON 序列化 round-trip 守恒。
// 对应 design.md §Testing Strategy "Property 13 — 队列 JSON 序列化 round-trip"。
//
// 主属性（Property 13 / Validates: Requirements 11.6, 15.1, 18.7）：
//   ∀ queue: Operation[]. JSON.parse(JSON.stringify(queue)) 深度等价于 queue。
//
// 该属性表面看是恒真的（opArb 生成的字段全部是 string / number / null，
// 都是 JSON 原生可序列化类型），但仍然显式落地为属性测试有两个目的：
//   1. 守门 R11.6 / R15.1 / R18.7：`Operation_Queue` 一旦持久化到本地存储后
//      重启读回必须语义等价，否则跨进程恢复会丢字段或降级类型；
//   2. 防御未来回归：若有人在 `Operation` 形状里加入 Date / Map / Set /
//      undefined / BigInt 之类不可 JSON 化的字段，测试会立即失败 ——
//      迫使代码同步引入 reviver / replacer 或换用其他序列化方案。
//
// 该测试只 import 共享层 fast-check arbitraries，不触碰 DOM / Capacitor。

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fc from "fast-check";

import { opArb } from "../helpers/arbitraries.js";

/**
 * 队列 arbitrary：长度 0..50 的 `Operation` 数组。
 * 上界 50 兼顾覆盖率与单次属性迭代的速度（fast-check 默认 100 次 runs）。
 */
const queueArb = fc.array(opArb, { minLength: 0, maxLength: 50 });

/** opArb 生成的每个 Operation 应当出现的字段集（按 design.md §Data Models）。 */
const EXPECTED_OP_KEYS = [
  "operation_id",
  "product_id",
  "qty",
  "source_location_type",
  "source_level_id",
  "source_external_location_id",
  "target_location_type",
  "target_level_id",
  "target_external_location_id",
];

test("Property 13: 队列 JSON 序列化 round-trip (Validates: Requirements 11.6, 15.1, 18.7)", () => {
  fc.assert(
    fc.property(queueArb, (queue) => {
      const roundTripped = JSON.parse(JSON.stringify(queue));
      // (a) 深度等价：值与类型完全一致
      assert.deepStrictEqual(roundTripped, queue);

      // (b) 字段名守恒：每个 op 的键集合与原 op 完全一致，无大小写改写、无缺字段
      assert.equal(roundTripped.length, queue.length);
      for (let i = 0; i < queue.length; i += 1) {
        const originalKeys = Object.keys(queue[i]).sort();
        const roundTrippedKeys = Object.keys(roundTripped[i]).sort();
        assert.deepStrictEqual(roundTrippedKeys, originalKeys);
        // 同时锚定到 design.md 表格期望的字段集，避免 opArb 演化时悄悄漏字段
        assert.deepStrictEqual(originalKeys, [...EXPECTED_OP_KEYS].sort());
      }
    }),
  );
});
