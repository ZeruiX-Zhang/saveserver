// test/helpers/arbitraries.js
//
// fast-check arbitraries shared across the spec's property tests.
//
// 这些 generator 仅服务于 `test/property/*` 中的属性测试，按 design.md
// §Testing Strategy "25 个属性 → fast-check arbitraries 概览"分组：
//
//   - asciiAlnumArb / qtyArb        ← Property 1, 2, 6, 12, 16
//   - opArb                          ← Property 9, 10, 11, 13, 17, 19, 20
//   - previewArb                     ← Property 9, 10, 11
//   - masterArb                      ← Property 15, 16, 18, 20
//
// 该模块为纯 ES Module，仅 import `fast-check`；不会触碰 DOM / Capacitor。
// 生产代码（`app/shared/` 与手持端 bundle）**禁止**反向 import 任何 `test/`
// 路径——参见 `test/helpers/README.md`。

import * as fc from "fast-check";

// ---------- 公共原子 arbitraries -------------------------------------------

/**
 * 1–8 长度的 ASCII 字母数字串。用 grapheme-ascii unit 生成 → 用正则过滤掉
 * `LOCATION_CODE_PATTERN` 的分隔字符（`-` `/` `_` `·` `:` 空格），避免它们
 * 在 Property 1/2 的 round-trip 中被误判为字段分隔符而触发解析失败。
 *
 * @type {fc.Arbitrary<string>}
 */
export const asciiAlnumArb = fc
  .string({ unit: "grapheme-ascii", minLength: 1, maxLength: 8 })
  .map((s) => s.replace(/[^A-Za-z0-9]/g, ""))
  .filter((s) => s.length >= 1 && s.length <= 8);

/**
 * 严格正的有限浮点数 qty，覆盖 op-builders 的 R18.4 数量正性约束。
 * 上界设 1e6 以贴近真实库存量级，下界设 1e-6 以避开 0。
 *
 * @type {fc.Arbitrary<number>}
 */
export const qtyArb = fc
  .float({ min: Math.fround(1e-6), max: 1e6, noNaN: true, noDefaultInfinity: true })
  .filter((n) => Number.isFinite(n) && n > 0);

/**
 * 6–12 字节的 ASCII hex-like 标识符；适合用作 `product_id` / `level_id` /
 * `external_id` 的占位值，足够区分但不至于让 fast-check 输出难以阅读。
 */
const idLikeArb = fc
  .string({ unit: "grapheme-ascii", minLength: 6, maxLength: 12 })
  .map((s) => s.replace(/[^A-Za-z0-9]/g, ""))
  .filter((s) => s.length >= 6 && s.length <= 12);

/** 产品 ID arbitrary。 */
export const productIdArb = idLikeArb;
/** 仓库层数（level）ID arbitrary。 */
export const levelIdArb = idLikeArb;
/** 非仓库位置（external）ID arbitrary。 */
export const externalIdArb = idLikeArb;

/**
 * 7 种 `Operation_Type` 之一，与 design.md §Data Models 表格对齐。
 *
 * @type {fc.Arbitrary<
 *   "put_in" | "move" | "move_to_external" | "move_from_external" |
 *   "ship_out" | "adjust_increase" | "adjust_decrease"
 * >}
 */
export const operationTypeArb = fc.constantFrom(
  "put_in",
  "move",
  "move_to_external",
  "move_from_external",
  "ship_out",
  "adjust_increase",
  "adjust_decrease",
);

// ---------- opArb ----------------------------------------------------------

const LOCATION_KIND = /** @type {const} */ ([
  "none",
  "warehouse",
  "external",
]);

/**
 * 通用 `Operation` 形状（非严格契约）。专门服务 inventory-preview 的属性
 * 测试：调用方关心的是 `applyOp` / `undoOp` 在任意 (source ∈ {none, warehouse,
 * external}) × (target ∈ {none, warehouse, external}) 组合下都行为一致，而
 * 不关心是否符合 op-builders 工厂的合法性。
 *
 * 字段：
 *   - operation_id：常量 UUID v4（preview 不关心唯一性，避免 fast-check 噪音）
 *   - product_id, qty
 *   - source_location_type / source_level_id / source_external_location_id
 *   - target_location_type / target_level_id / target_external_location_id
 *
 * @type {fc.Arbitrary<{
 *   operation_id: string,
 *   product_id: string,
 *   qty: number,
 *   source_location_type: "none" | "warehouse" | "external",
 *   source_level_id: string | null,
 *   source_external_location_id: string | null,
 *   target_location_type: "none" | "warehouse" | "external",
 *   target_level_id: string | null,
 *   target_external_location_id: string | null,
 * }>}
 */
export const opArb = fc
  .record({
    product_id: productIdArb,
    qty: qtyArb,
    sourceKind: fc.constantFrom(...LOCATION_KIND),
    targetKind: fc.constantFrom(...LOCATION_KIND),
    levelIdSrc: levelIdArb,
    externalIdSrc: externalIdArb,
    levelIdTgt: levelIdArb,
    externalIdTgt: externalIdArb,
  })
  .map((r) => ({
    operation_id: "00000000-0000-4000-8000-000000000001",
    product_id: r.product_id,
    qty: r.qty,
    source_location_type: r.sourceKind,
    source_level_id: r.sourceKind === "warehouse" ? r.levelIdSrc : null,
    source_external_location_id:
      r.sourceKind === "external" ? r.externalIdSrc : null,
    target_location_type: r.targetKind,
    target_level_id: r.targetKind === "warehouse" ? r.levelIdTgt : null,
    target_external_location_id:
      r.targetKind === "external" ? r.externalIdTgt : null,
  }));

// ---------- previewArb -----------------------------------------------------

/**
 * 本地库存预览 arbitrary：Map<productId, Map<locationKey, qty>>。
 *
 * qty 用整数 [1, 1e6]，避免 apply/undo round-trip 中浮点比较噪音。
 * 整体规模封顶（外层 ≤ 4，内层 ≤ 4），保证 fast-check 单次迭代成本可控。
 *
 * locationKey 形如 `level:<id>` 或 `external:<id>`，对齐 inventory-preview 的契约。
 *
 * @type {fc.Arbitrary<Map<string, Map<string, number>>>}
 */
export const previewArb = fc
  .array(
    fc.tuple(
      productIdArb,
      fc.array(
        fc.tuple(
          fc.oneof(
            fc.tuple(fc.constant("level"), levelIdArb),
            fc.tuple(fc.constant("external"), externalIdArb),
          ),
          fc.integer({ min: 1, max: 1_000_000 }),
        ),
        { minLength: 0, maxLength: 4 },
      ),
    ),
    { minLength: 0, maxLength: 4 },
  )
  .map((entries) => {
    const outer = new Map();
    for (const [productId, locs] of entries) {
      const inner = new Map();
      for (const [[kind, id], qty] of locs) {
        inner.set(`${kind}:${id}`, qty);
      }
      // 外层去重：同 productId 后写覆盖前写
      outer.set(productId, inner);
    }
    return outer;
  });

// ---------- masterArb ------------------------------------------------------

/**
 * 一个小规模 `Local_Master_Store` arbitrary，用于 Property 15/16/18/20。
 *
 * 关键约束：
 *   - 每个 product 的 id 唯一（去重时按后写覆盖前写）
 *   - customFieldDefinitions 的 isSearchable 取 0/1，符合设计契约
 *   - productCustomFieldValues 的 product_id / field_id 不强制 referential
 *     integrity，由各属性测试自行决定是否过滤
 *   - 各 store 长度 ≤ 5，保证 fast-check 单次迭代成本可控
 *
 * 字段命名采用 design.md 表格的 snake_case；同时 `customFieldDefinitions`
 * 的 `isSearchable` 沿用 dbStore camelCase（local-search.js 同时支持两者）。
 *
 * @type {fc.Arbitrary<{
 *   products: Array<{ id: string, model: string, model_normalized: string,
 *                     image_path: string | null, status: "active" | "archived" }>,
 *   customFieldDefinitions: Array<{ id: string, name: string,
 *                                   isSearchable: 0 | 1 }>,
 *   productCustomFieldValues: Array<{ product_id: string, field_id: string,
 *                                     value_text: string }>,
 *   inventoryBalances: Array<{ product_id: string,
 *                              location_type: "warehouse" | "external",
 *                              level_id: string | null,
 *                              external_location_id: string | null,
 *                              qty: number }>,
 * }>}
 */
export const masterArb = fc.gen().map((g) => {
  const productCount = g(fc.integer, { min: 0, max: 5 });
  const products = [];
  const seenProductIds = new Set();
  for (let i = 0; i < productCount; i += 1) {
    let id;
    do {
      id = g(() => productIdArb);
    } while (seenProductIds.has(id));
    seenProductIds.add(id);
    const model = g(() => asciiAlnumArb);
    products.push({
      id,
      model,
      model_normalized: model.toUpperCase(),
      image_path: g(fc.boolean) ? `images/${id}.jpg` : null,
      status: g(fc.constantFrom, "active", "archived"),
    });
  }

  const fieldCount = g(fc.integer, { min: 0, max: 5 });
  const customFieldDefinitions = [];
  const seenFieldIds = new Set();
  for (let i = 0; i < fieldCount; i += 1) {
    let id;
    do {
      id = g(() => productIdArb);
    } while (seenFieldIds.has(id));
    seenFieldIds.add(id);
    customFieldDefinitions.push({
      id,
      name: g(() => asciiAlnumArb),
      isSearchable: g(fc.constantFrom, 0, 1),
    });
  }

  const valueCount = g(fc.integer, { min: 0, max: 5 });
  const productCustomFieldValues = [];
  for (let i = 0; i < valueCount; i += 1) {
    productCustomFieldValues.push({
      product_id: g(() => productIdArb),
      field_id: g(() => productIdArb),
      value_text: g(() => asciiAlnumArb),
    });
  }

  const balanceCount = g(fc.integer, { min: 0, max: 5 });
  const inventoryBalances = [];
  for (let i = 0; i < balanceCount; i += 1) {
    const isWarehouse = g(fc.boolean);
    const productId =
      products.length > 0 && g(fc.boolean)
        ? products[g(fc.integer, { min: 0, max: products.length - 1 })].id
        : g(() => productIdArb);
    inventoryBalances.push({
      product_id: productId,
      location_type: isWarehouse ? "warehouse" : "external",
      level_id: isWarehouse ? g(() => levelIdArb) : null,
      external_location_id: isWarehouse ? null : g(() => externalIdArb),
      qty: g(fc.integer, { min: 1, max: 1_000_000 }),
    });
  }

  return {
    products,
    customFieldDefinitions,
    productCustomFieldValues,
    inventoryBalances,
  };
});
