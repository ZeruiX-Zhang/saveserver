// test/property/ring-buffer.test.js
//
// 属性测试：通用循环缓冲区 `pushAll(buffer, items, capacity)` 的上界 +
// "保留最新" 不变量。对应 design.md §Correctness Properties Property 25，
// 覆盖 R14.4（最近 10 次上传摘要）与 R15.6（1 MB 循环日志按条目截断时同样
// 适用——按字节裁剪由 logger 自行处理）。
//
// 当前 upload-history / logger 模块尚未落地，这里在测试文件内联实现
// `pushAll`，作为属性的可执行规约。等任务 5.5 / 7.9 上线时再 DRY 到共享层。

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fc from "fast-check";

/**
 * 把 `items` 追加到 `buffer` 末尾后裁剪到 `capacity` 长度，保留最新 `capacity`
 * 个元素。`capacity ≥ 1`。
 *
 * @template T
 * @param {ReadonlyArray<T>} buffer
 * @param {ReadonlyArray<T>} items
 * @param {number} capacity
 * @returns {T[]}
 */
export function pushAll(buffer, items, capacity) {
  const out = [...buffer, ...items];
  if (out.length <= capacity) return out;
  return out.slice(out.length - capacity);
}

// fast-check `anything` 仅启用 string / number / boolean / null / object / array
// 等可被 `Object.is` 平等比较的形态，避免 Date / Map / Set / TypedArray /
// SparseArray 这类引用平等差异让 deepEqual 误报。
const elementArb = fc.anything({
  withDate: false,
  withMap: false,
  withSet: false,
  withTypedArray: false,
  withSparseArray: false,
});

const bufferArb = fc.array(elementArb, { minLength: 0, maxLength: 20 });
const itemsArb = fc.array(elementArb, { minLength: 0, maxLength: 20 });
const capacityArb = fc.integer({ min: 1, max: 32 });

test("Property 25: 循环缓冲区上界 — Validates: Requirements 14.4, 15.6", () => {
  fc.assert(
    fc.property(bufferArb, itemsArb, capacityArb, (buffer, items, capacity) => {
      const result = pushAll(buffer, items, capacity);

      // (1) 长度上界
      assert.ok(
        result.length <= capacity,
        `result length ${result.length} exceeded capacity ${capacity}`,
      );

      // (2) 当 [...buffer, ...items] 总长 ≥ capacity 时，result 等于该拼接的
      //     末尾 `capacity` 项（"keep latest"）。
      const merged = [...buffer, ...items];
      if (merged.length >= capacity) {
        const tail = merged.slice(merged.length - capacity);
        assert.deepEqual(result, tail);
      } else {
        // 否则没有发生截断，result 必须等于完整拼接
        assert.deepEqual(result, merged);
      }
    }),
  );
});
