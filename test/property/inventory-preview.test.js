// test/property/inventory-preview.test.js
//
// 属性测试：本地库存预览（`app/shared/inventory-preview.js`）。
// 覆盖 design.md §Testing Strategy 中的 Property 9–12，对应 Requirements
// 4.6 / 6.8 / 11.4 / 18.5 / 18.6 / 18.9。
//
// 该测试只 import 共享层纯函数与 fast-check arbitraries，不触碰 DOM /
// Capacitor / 持久层。
//
// 关键实现细节：inventory-preview 的 applyDelta 在 (current + delta) <= 0
// 时直接 `inner.delete(key)`（drops the entry），而不是写入负数或 0；
// 因此 Property 9 中的 source 数量必须按 max(prev - qty, 0) 来断言（而非
// design.md 字面表述的 "source 数量 -= qty"）。

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fc from "fast-check";

import {
  applyOp,
  undoOp,
  getLocationQty,
  locationKey,
} from "../../app/shared/inventory-preview.js";
import {
  asciiAlnumArb,
  levelIdArb,
  opArb,
  previewArb,
  productIdArb,
} from "../helpers/arbitraries.js";

// ---------- 辅助：Map<string, Map<string, number>> 的深度相等比较 ----------

/**
 * 比较两个嵌套 Map（Map<string, Map<string, number>>）是否在 keys / values 上
 * 完全一致。`assert.deepStrictEqual` 对 Map 的比较只检查迭代顺序一致性；
 * 这里改成基于 key 集合的比较，避免 round-trip 测试因克隆顺序不同而误报。
 *
 * @param {Map<string, Map<string, number>>} a
 * @param {Map<string, Map<string, number>>} b
 * @returns {boolean}
 */
function mapsDeepEqual(a, b) {
  if (!(a instanceof Map) || !(b instanceof Map)) return false;
  if (a.size !== b.size) return false;
  for (const [productId, innerA] of a) {
    if (!b.has(productId)) return false;
    const innerB = b.get(productId);
    if (!(innerA instanceof Map) || !(innerB instanceof Map)) return false;
    if (innerA.size !== innerB.size) return false;
    for (const [locKey, qtyA] of innerA) {
      if (!innerB.has(locKey)) return false;
      if (innerB.get(locKey) !== qtyA) return false;
    }
  }
  return true;
}

/** 把 op 的 source/target 分别取出 locationKey（none → null）。 */
function keysOf(op) {
  return {
    sourceKey: locationKey(
      op.source_location_type,
      op.source_level_id,
      op.source_external_location_id,
    ),
    targetKey: locationKey(
      op.target_location_type,
      op.target_level_id,
      op.target_external_location_id,
    ),
  };
}

/**
 * 收集 preview 中所有 (productId, locationKey) 二元组，便于 Property 9 的
 * "其它格子未变化" 断言。
 *
 * @param {Map<string, Map<string, number>>} preview
 * @returns {Array<{ productId: string, locKey: string }>}
 */
function listAllCells(preview) {
  const out = [];
  for (const [productId, inner] of preview) {
    for (const locKey of inner.keys()) {
      out.push({ productId, locKey });
    }
  }
  return out;
}

// ---------- Property 9 -----------------------------------------------------

test(
  "Property 9: applyOp 在目标位置加 qty、源位置减 qty (clamp 到 0)，其它格子不变 (Validates: Requirements 4.6, 6.8, 18.5)",
  () => {
    fc.assert(
      fc.property(previewArb, opArb, (p, op) => {
        const after = applyOp(p, op);
        const { sourceKey, targetKey } = keysOf(op);

        // (1) target 加 qty
        if (targetKey !== null) {
          const before = getLocationQty(p, op.product_id, targetKey);
          const expected = before + op.qty;
          // 当 source === target 时（同 productId + 同 locKey），加减相互抵消，
          // applyOp 等同 no-op；该格子的最终值仍是 before；不在本断言适用范围。
          if (sourceKey !== targetKey) {
            assert.equal(
              getLocationQty(after, op.product_id, targetKey),
              expected,
            );
          } else {
            // source===target 时，(prev - qty + qty) === prev，仍应等于 before
            assert.equal(
              getLocationQty(after, op.product_id, targetKey),
              before,
            );
          }
        }

        // (2) source 减 qty，clamp 到 0（实现：next<=0 时 drop entry）
        if (sourceKey !== null && sourceKey !== targetKey) {
          const before = getLocationQty(p, op.product_id, sourceKey);
          const expected = Math.max(before - op.qty, 0);
          assert.equal(
            getLocationQty(after, op.product_id, sourceKey),
            expected,
          );
        }

        // (3) 其它 (productId, locKey) 二元组数量不变
        const touchedKeys = new Set();
        if (sourceKey !== null) touchedKeys.add(sourceKey);
        if (targetKey !== null) touchedKeys.add(targetKey);

        const beforeCells = listAllCells(p);
        const afterCells = listAllCells(after);
        const allCells = new Set();
        for (const c of beforeCells) allCells.add(`${c.productId}|${c.locKey}`);
        for (const c of afterCells) allCells.add(`${c.productId}|${c.locKey}`);

        for (const composite of allCells) {
          const sep = composite.indexOf("|");
          const productId = composite.slice(0, sep);
          const locKey = composite.slice(sep + 1);

          // 若该 cell 是 op 触及的 (op.product_id, source/target key)，跳过
          if (productId === op.product_id && touchedKeys.has(locKey)) continue;

          assert.equal(
            getLocationQty(after, productId, locKey),
            getLocationQty(p, productId, locKey),
            `cell (${productId}, ${locKey}) 不应变化`,
          );
        }
      }),
    );
  },
);

// ---------- Property 10 ----------------------------------------------------

/**
 * 自定义 arbitrary：从给定 preview 中挑一个已存在的 (productId, sourceKey)，
 * 并把 op.qty 限制在该位置的现有库存内；若 preview 为空，回退到只有 target
 * 位置的 op（put_in / adjust_increase 形态），这些 op 不会触发 source clamp。
 *
 * 仅服务于 Property 10：保证 applyOp 不会发生"源数量截断到 0"的边界场景。
 *
 * @param {Map<string, Map<string, number>>} preview
 * @returns {fc.Arbitrary<object>}
 */
function safeOpForUndoArb(preview) {
  // 收集所有 (productId, locKey, qty) 三元组
  const cells = [];
  for (const [productId, inner] of preview) {
    for (const [locKey, qty] of inner) {
      cells.push({ productId, locKey, qty });
    }
  }

  // 形态 A：source 来自 preview 的现有 cell，qty <= 现有库存
  const sourceFromPreviewArb =
    cells.length === 0
      ? null
      : fc
          .integer({ min: 0, max: cells.length - 1 })
          .chain((idx) => {
            const c = cells[idx];
            const sep = c.locKey.indexOf(":");
            const kind = c.locKey.slice(0, sep);
            const id = c.locKey.slice(sep + 1);
            return fc.record({
              product_id: fc.constant(c.productId),
              qty: fc.integer({ min: 1, max: c.qty }),
              sourceKind: fc.constant(
                kind === "level" ? "warehouse" : "external",
              ),
              source_level_id: fc.constant(kind === "level" ? id : null),
              source_external_location_id: fc.constant(
                kind === "external" ? id : null,
              ),
              targetKind: fc.constantFrom("none", "warehouse", "external"),
              targetLevelId: levelIdArb,
              targetExternalId: asciiAlnumArb,
            });
          })
          .map((r) => ({
            operation_id: "00000000-0000-4000-8000-000000000010",
            product_id: r.product_id,
            qty: r.qty,
            source_location_type: r.sourceKind,
            source_level_id: r.source_level_id,
            source_external_location_id: r.source_external_location_id,
            target_location_type: r.targetKind,
            target_level_id:
              r.targetKind === "warehouse" ? r.targetLevelId : null,
            target_external_location_id:
              r.targetKind === "external" ? r.targetExternalId : null,
          }));

  // 形态 B：仅 target（put_in / adjust_increase 形态），不触发 source clamp
  const targetOnlyArb = fc
    .record({
      product_id: productIdArb,
      qty: fc.integer({ min: 1, max: 1_000_000 }),
      targetKind: fc.constantFrom("warehouse", "external"),
      targetLevelId: levelIdArb,
      targetExternalId: asciiAlnumArb,
    })
    .map((r) => ({
      operation_id: "00000000-0000-4000-8000-000000000011",
      product_id: r.product_id,
      qty: r.qty,
      source_location_type: "none",
      source_level_id: null,
      source_external_location_id: null,
      target_location_type: r.targetKind,
      target_level_id: r.targetKind === "warehouse" ? r.targetLevelId : null,
      target_external_location_id:
        r.targetKind === "external" ? r.targetExternalId : null,
    }));

  return sourceFromPreviewArb === null
    ? targetOnlyArb
    : fc.oneof(sourceFromPreviewArb, targetOnlyArb);
}

test(
  "Property 10: undoOp(applyOp(p, op), op) deeply equals p (Validates: Requirements 11.4)",
  () => {
    fc.assert(
      fc.property(
        previewArb.chain((p) =>
          fc.tuple(fc.constant(p), safeOpForUndoArb(p)),
        ),
        ([p, op]) => {
          const after = applyOp(p, op);
          const restored = undoOp(after, op);
          assert.ok(
            mapsDeepEqual(restored, p),
            `round-trip 失败: op=${JSON.stringify(op)}`,
          );
        },
      ),
    );
  },
);

// ---------- Property 11 ----------------------------------------------------

test(
  "Property 11: 应用同一 op 两次的结果 ≠ 应用一次 (Validates: Requirements 18.6)",
  () => {
    // 仅取 target_location_type !== "none" 的 op，且 qty > 0：
    //   - target 在 once 后 +qty、在 twice 后 +2qty，两者必定不同
    //   - 这避开了"source-only 且源被一次性耗尽，二次应用为 no-op"的退化情形
    const opWithTargetArb = opArb.filter(
      (op) => op.target_location_type !== "none" && op.qty > 0,
    );

    fc.assert(
      fc.property(previewArb, opWithTargetArb, (p, op) => {
        const once = applyOp(p, op);
        const twice = applyOp(once, op);
        assert.ok(
          !mapsDeepEqual(twice, once),
          "applyOp 必须是非幂等的（连续应用两次效果应翻倍）",
        );
      }),
    );
  },
);

// ---------- Property 12 ----------------------------------------------------

test(
  "Property 12: 连续 put_in 线性累加 (Validates: Requirements 18.9)",
  () => {
    // 固定 productId / levelId，避免 fast-check 输出噪音。
    const FIXED_PRODUCT = "P_FIXED_001";
    const FIXED_LEVEL = "L_FIXED_001";
    const FIXED_KEY = `level:${FIXED_LEVEL}`;

    fc.assert(
      fc.property(
        // initialQty ∈ [0, 1e6]，N ∈ [1,50] 个整数 qty ∈ [1, 1e4]
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.array(fc.integer({ min: 1, max: 10_000 }), {
          minLength: 1,
          maxLength: 50,
        }),
        (initialQty, qtys) => {
          // 构造初始 preview：仅在 (FIXED_PRODUCT, FIXED_KEY) 上有 initialQty
          const initial = new Map();
          if (initialQty > 0) {
            initial.set(
              FIXED_PRODUCT,
              new Map([[FIXED_KEY, initialQty]]),
            );
          }

          let preview = initial;
          for (const qty of qtys) {
            preview = applyOp(preview, {
              operation_id: "00000000-0000-4000-8000-000000000012",
              product_id: FIXED_PRODUCT,
              qty,
              source_location_type: "none",
              source_level_id: null,
              source_external_location_id: null,
              target_location_type: "warehouse",
              target_level_id: FIXED_LEVEL,
              target_external_location_id: null,
            });
          }

          const expected = initialQty + qtys.reduce((a, b) => a + b, 0);
          assert.equal(
            getLocationQty(preview, FIXED_PRODUCT, FIXED_KEY),
            expected,
          );
        },
      ),
    );
  },
);
