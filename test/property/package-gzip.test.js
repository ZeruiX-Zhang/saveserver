// test/property/package-gzip.test.js
//
// 属性测试：`Operation_Package` 的 gzip 传输 round-trip。
// 对应 design.md §Testing Strategy "Property 14 — Operation_Package gzip round-trip"。
//
// 主属性（Property 14 / Validates: Requirements 18.8）：
//   ∀ 合法 Operation_Package pkg, 记 s = JSON.stringify(pkg)，则
//     JSON.parse(gunzipSync(gzipSync(Buffer.from(s, "utf-8"))).toString("utf-8"))
//   应当与 pkg 深度相等（结构与字段值完全一致）。
//
// 该属性覆盖手持端 → 电脑端的 LAN/USB 同步通路：上传时以 gzip 压缩后的
// JSON 包形式跨进程/跨 USB 传输，解压后必须能完整还原 wire 对象。任何
// 编码/解码层引入的字符截断、换行规整、UTF-8 → latin1 误用都会被这条
// round-trip 当场捕获。
//
// 该测试只 import 共享层纯函数（`buildPutIn` / `buildOperationPackage`）与
// Node 内建 `node:zlib` / `node:assert/strict`，不触碰 DOM / Capacitor。

import { test } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import * as fc from "fast-check";

import { buildPutIn } from "../../app/shared/op-builders.js";
import { buildOperationPackage } from "../../app/shared/package-builder.js";
import { productIdArb, levelIdArb } from "../helpers/arbitraries.js";

// 整数 qty：避免浮点序列化的尾数差异（如 0.1 + 0.2）影响 round-trip 比较。
const qtyArb = fc.integer({ min: 1, max: 1000 });

// 单条 put_in op 的输入 record：用 deterministic idGen 让 operation_id 可复现。
const putInInputArb = fc.record({
  productId: productIdArb,
  qty: qtyArb,
  targetLevelId: levelIdArb,
});

test(
  "Property 14: Operation_Package gzip round-trip (Validates: Requirements 18.8)",
  () => {
    fc.assert(
      fc.property(
        fc.array(putInInputArb, { minLength: 1, maxLength: 20 }),
        (inputs) => {
          // 确定性 DI：用计数器生成 UUID v4 形状的 id，让每次迭代输出可复现，
          // 且整段流程不依赖 globalThis.crypto。
          let counter = 0;
          const nextId = () => {
            counter += 1;
            const hex = counter.toString(16).padStart(12, "0");
            // UUID v4 形状：xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx
            return `00000000-0000-4000-8000-${hex}`;
          };
          // 固定时钟，使 exported_at / operated_at 完全可复现。
          const fixedNow = () => Date.UTC(2025, 0, 1, 0, 0, 0);

          const operations = inputs.map((input) =>
            buildPutIn(input, { now: fixedNow, idGen: nextId }),
          );
          const pkg = buildOperationPackage(
            {
              deviceId: "device-uuid-stub",
              deviceName: "test-device",
              operations,
              baseMasterPackageId: null,
            },
            { now: fixedNow, idGen: nextId },
          );

          const json = JSON.stringify(pkg);
          const compressed = zlib.gzipSync(Buffer.from(json, "utf-8"));
          const decompressed = zlib.gunzipSync(compressed).toString("utf-8");
          const restored = JSON.parse(decompressed);

          assert.deepStrictEqual(restored, pkg);
        },
      ),
    );
  },
);
