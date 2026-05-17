// test/property/local-search.test.js
//
// 属性测试：本地搜索 / 总库存求和 / 队列展示排序
// 对应 design.md §Testing Strategy 中的 Property 15 / 16 / 17。
//
//   Property 15: 搜索可靠性与完备性  (Validates: Requirements 3.2, 10.5, 10.7)
//   Property 16: 总库存数量等于位置数量之和  (Validates: Requirements 3.3)
//   Property 17: 队列展示按 operated_at 倒序  (Validates: Requirements 11.2)
//
// 该测试只 import 共享层纯函数与 helpers/arbitraries，不触碰 DOM / Capacitor。

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fc from "fast-check";

import {
  searchProducts,
  getTotalQty,
} from "../../app/shared/local-search.js";
import { normalizeModel } from "../../app/shared/normalize-model.js";
import { masterArb } from "../helpers/arbitraries.js";

// ---------- 公共辅助：与 local-search.js 对齐的"应当命中"判断 ----------

/**
 * 与 `searchProducts` 一致的"product p 是否被查询 q 命中"判定。
 *
 * 关键对齐：
 *   - q 在比较前 trim（与生产代码一致）；trim 后为空视为"匹配所有"
 *   - model_normalized 取 `product.model_normalized || normalizeModel(product.model)`
 *     兜底，与生产代码 `getModelNormalized` 完全一致
 *   - 自定义字段命中要求 fieldId 指向 `isSearchable === 1` 且 productId 匹配
 *
 * @param {object} product master.products 中的原始 row（snake_case 形态）
 * @param {string} q 查询串（未必已 trim）
 * @param {{
 *   customFieldDefinitions?: Array<{ id?: string, isSearchable?: number | boolean }>,
 *   productCustomFieldValues?: Array<{ product_id?: string, field_id?: string, value_text?: string }>,
 * }} master
 * @returns {boolean}
 */
function expectedMatch(product, q, master) {
  const trimmed = typeof q === "string" ? q.trim() : "";
  if (trimmed.length === 0) {
    return true;
  }
  const qLower = trimmed.toLowerCase();
  const qNormalized = normalizeModel(trimmed);

  // 1. model 子串
  const model = typeof product?.model === "string" ? product.model : "";
  if (model && model.toLowerCase().includes(qLower)) {
    return true;
  }

  // 2. model_normalized 子串（带 fallback，与 getModelNormalized 对齐）
  const expectedNormalized =
    (typeof product?.model_normalized === "string" && product.model_normalized) ||
    normalizeModel(model);
  if (qNormalized.length > 0 && expectedNormalized.includes(qNormalized)) {
    return true;
  }

  // 3. 自定义字段命中
  const searchableFieldIds = new Set();
  const defs = Array.isArray(master?.customFieldDefinitions)
    ? master.customFieldDefinitions
    : [];
  for (const def of defs) {
    if (!def || def.id == null) continue;
    if (def.isSearchable === 1 || def.isSearchable === true) {
      searchableFieldIds.add(def.id);
    }
  }
  if (searchableFieldIds.size === 0) {
    return false;
  }
  const values = Array.isArray(master?.productCustomFieldValues)
    ? master.productCustomFieldValues
    : [];
  for (const row of values) {
    if (!row) continue;
    if (row.product_id !== product.id) continue;
    if (!searchableFieldIds.has(row.field_id)) continue;
    const valueText = typeof row.value_text === "string" ? row.value_text : "";
    if (valueText && valueText.toLowerCase().includes(qLower)) {
      return true;
    }
  }
  return false;
}

function isActiveProduct(p) {
  return p && (p.status === undefined || p.status === "active");
}

// ---------- Property 15: 搜索可靠性与完备性 ----------

test("Property 15: 搜索可靠性与完备性 (Validates: Requirements 3.2, 10.5, 10.7)", () => {
  fc.assert(
    fc.property(masterArb, fc.string(), (master, q) => {
      const R = searchProducts(master, q);

      // 结果中产品都应位于 master.products 中（按 id 索引）
      const productById = new Map();
      for (const p of master.products) {
        if (p && p.id != null) productById.set(p.id, p);
      }

      // ---------- (1) Soundness：R 中每个 p 都满足命中条件 ----------
      for (const r of R) {
        const original = productById.get(r.id);
        assert.ok(
          original,
          `R 中的 id=${r.id} 必须能在 master.products 中找到`,
        );
        assert.ok(
          isActiveProduct(original),
          `R 中的 id=${r.id} 必须是 active 或 undefined-status`,
        );
        assert.ok(
          expectedMatch(original, q, master),
          `R 中的 id=${r.id} 应当满足命中条件 (q=${JSON.stringify(q)})`,
        );
      }

      // ---------- (2) Completeness：所有 active 且命中的 product 都在 R 中 ----------
      const idsInR = new Set(R.map((r) => r.id));
      for (const p of master.products) {
        if (!isActiveProduct(p)) continue;
        if (p.id == null) continue;
        if (!expectedMatch(p, q, master)) continue;
        assert.ok(
          idsInR.has(p.id),
          `命中的 active 产品 id=${p.id} 应当出现在 R 中 (q=${JSON.stringify(q)})`,
        );
      }

      // ---------- (3) 空 q 边界：R 恰为所有 active 产品 ----------
      if ((q || "").trim().length === 0) {
        const activeIds = new Set(
          master.products
            .filter((p) => p && p.id != null && isActiveProduct(p))
            .map((p) => p.id),
        );
        assert.deepStrictEqual(
          new Set(idsInR),
          activeIds,
          "空查询时 R 应当恰好等于所有 active 产品集合",
        );
      }
    }),
  );
});

// ---------- Property 16: 总库存数量等于位置数量之和 ----------

const balanceArb = fc.record({
  product_id: fc.constantFrom("p1", "p2", "p3", "p4"),
  qty: fc.integer({ min: 0, max: 100_000 }),
});

test("Property 16: 总库存数量等于位置数量之和 (Validates: Requirements 3.3)", () => {
  fc.assert(
    fc.property(
      fc.constantFrom("p1", "p2", "p3", "p4", "p-not-present"),
      fc.array(balanceArb, { minLength: 0, maxLength: 20 }),
      (productId, balances) => {
        const expected = balances
          .filter((b) => b.product_id === productId)
          .reduce((acc, b) => acc + b.qty, 0);
        assert.deepStrictEqual(getTotalQty(productId, balances), expected);
      },
    ),
  );
});

// ---------- Property 17: 队列展示按 operated_at 倒序 ----------

// 内联实现：operation-queue.js 是更后面的任务，本属性只验证排序契约本身。
const sortQueueForDisplay = (q) =>
  [...q].sort((a, b) =>
    (b.operated_at || "").localeCompare(a.operated_at || ""),
  );

const operatedAtArb = fc
  .date({ noInvalidDate: true })
  .map((d) => d.toISOString());

const queueItemArb = fc.record({
  operated_at: operatedAtArb,
});

test("Property 17: 队列展示按 operated_at 倒序 (Validates: Requirements 11.2)", () => {
  fc.assert(
    fc.property(
      fc.array(queueItemArb, { minLength: 0, maxLength: 20 }),
      (queue) => {
        const sorted = sortQueueForDisplay(queue);
        // 输出长度不变
        assert.deepStrictEqual(sorted.length, queue.length);
        // 单调非增：sorted[i].operated_at >= sorted[i+1].operated_at
        for (let i = 0; i + 1 < sorted.length; i += 1) {
          const a = sorted[i].operated_at || "";
          const b = sorted[i + 1].operated_at || "";
          assert.ok(
            a.localeCompare(b) >= 0,
            `位置 ${i}/${i + 1} 的 operated_at 应当非增：${a} >= ${b}`,
          );
        }
      },
    ),
  );
});
