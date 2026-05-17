// app/shared/local-search.js
//
// 离线本地搜索：在 `Local_Master_Store` 上按型号 / 归一化型号 / 可搜索自定义字段
// 命中 `Product` 行，并附带通过 `inventoryBalances` 求和得到的总库存数量。
//
// 该模块为纯 ES Module，不依赖 DOM / Capacitor，可在 Node.js（属性测试）以及
// 浏览器 / Android WebView（手持端 Bundle）下运行。
//
// 字段命名兼容性：
//   服务端 seed / dbStore 使用 camelCase（modelNormalized / imagePath / isSearchable /
//   productId / fieldId / valueText）；设计文档与少数遗留代码使用 snake_case
//   （model_normalized / image_path / is_searchable / product_id / field_id /
//   value_text）。本模块对二者都做防御式读取，调用方无需关心源端格式。
//
// Validates: Requirements 3.2, 3.3, 10.5, 10.7

import { normalizeModel } from "./normalize-model.js";

// ---------- 字段访问辅助（兼容 camelCase 与 snake_case） ----------

function readField(obj, camelKey, snakeKey) {
  if (!obj || typeof obj !== "object") {
    return undefined;
  }
  const camel = obj[camelKey];
  if (camel !== undefined && camel !== null) {
    return camel;
  }
  return obj[snakeKey];
}

function getModel(product) {
  const v = product?.model;
  return typeof v === "string" ? v : "";
}

function getModelNormalized(product) {
  const v = readField(product, "modelNormalized", "model_normalized");
  if (typeof v === "string") return v;
  // 兜底：如果上游没归一化，本地按一致算法补算，保证 R3.6 在搜索路径上自洽
  return normalizeModel(getModel(product));
}

function getImagePath(product) {
  const v = readField(product, "imagePath", "image_path");
  return typeof v === "string" ? v : null;
}

function getStatus(product) {
  const v = product?.status;
  return typeof v === "string" ? v : undefined;
}

function getProductId(row) {
  return readField(row, "productId", "product_id");
}

function getFieldId(row) {
  return readField(row, "fieldId", "field_id");
}

function getValueText(row) {
  const v = readField(row, "valueText", "value_text");
  return typeof v === "string" ? v : "";
}

function getIsSearchable(definition) {
  const v = readField(definition, "isSearchable", "is_searchable");
  // 设计层面 is_searchable === 1 视为命中；同时兼容 boolean true
  return v === 1 || v === true;
}

function getQty(row) {
  const v = row?.qty;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

// ---------- 公共辅助：总库存求和 ----------

/**
 * 把指定产品在 `inventoryBalances` 中的所有 `qty` 求和。
 *
 * 缺失记录视为 0；非数值的 `qty` 字段也视为 0，以避免单条脏数据破坏总数。
 * 与 Property 16 的"总库存数量等于位置数量之和"对齐。
 *
 * @param {string} productId 产品 ID
 * @param {Array<object>} inventoryBalances `Local_Master_Store.inventoryBalances`
 * @returns {number} 该产品在所有位置上的数量之和
 */
export function getTotalQty(productId, inventoryBalances) {
  if (!Array.isArray(inventoryBalances) || !productId) {
    return 0;
  }
  let sum = 0;
  for (const row of inventoryBalances) {
    if (getProductId(row) === productId) {
      sum += getQty(row);
    }
  }
  return sum;
}

// ---------- 内部：自定义字段索引 ----------

function buildSearchableFieldIdSet(customFieldDefinitions) {
  const set = new Set();
  if (!Array.isArray(customFieldDefinitions)) {
    return set;
  }
  for (const def of customFieldDefinitions) {
    if (def && getIsSearchable(def) && def.id != null) {
      set.add(def.id);
    }
  }
  return set;
}

function buildSearchableValuesByProduct(productCustomFieldValues, searchableFieldIds) {
  // productId -> string[]（仅 is_searchable=1 字段对应的 value_text）
  const map = new Map();
  if (!Array.isArray(productCustomFieldValues) || searchableFieldIds.size === 0) {
    return map;
  }
  for (const row of productCustomFieldValues) {
    if (!row) continue;
    const fieldId = getFieldId(row);
    if (!searchableFieldIds.has(fieldId)) continue;
    const productId = getProductId(row);
    if (productId == null) continue;
    const valueText = getValueText(row);
    if (!valueText) continue;
    let bucket = map.get(productId);
    if (!bucket) {
      bucket = [];
      map.set(productId, bucket);
    }
    bucket.push(valueText);
  }
  return map;
}

// ---------- 状态过滤 ----------

function isActive(product) {
  // 把 undefined 视为 active，提升对历史数据 / 简化测试夹具的容错性
  const status = getStatus(product);
  return status === undefined || status === "active";
}

// ---------- 命中判断 ----------

function matchesProduct(product, query, searchableValuesByProduct) {
  // 空查询：调用方已在 searchProducts 顶层短路；这里只处理非空 query
  const qLower = query.toLowerCase();
  const qNormalized = normalizeModel(query);

  // 1. model 子串（不区分大小写）
  const model = getModel(product);
  if (model && model.toLowerCase().includes(qLower)) {
    return true;
  }

  // 2. model_normalized 子串（normalizeModel 已转大写，结果天然不区分大小写）
  if (qNormalized.length > 0) {
    const modelNormalized = getModelNormalized(product);
    if (modelNormalized && modelNormalized.includes(qNormalized)) {
      return true;
    }
  }

  // 3. 自定义字段命中（仅 is_searchable=1 字段，case-insensitive 子串）
  const values = searchableValuesByProduct.get(product.id);
  if (values && values.length > 0) {
    for (const v of values) {
      if (v.toLowerCase().includes(qLower)) {
        return true;
      }
    }
  }

  return false;
}

// ---------- 公共入口：搜索产品 ----------

/**
 * 在本地主数据上搜索产品。
 *
 * @param {object} master 8 个 store 的 `Local_Master_Store`，至少包含
 *   `products`、`customFieldDefinitions`、`productCustomFieldValues`、
 *   `inventoryBalances` 四个数组；其它 store 不强制。
 * @param {string} query 用户输入的关键字；空串 / nullish 表示返回全部 active 产品
 * @returns {Array<{
 *   id: string,
 *   model: string,
 *   modelNormalized: string,
 *   imagePath: string | null,
 *   status: string | undefined,
 *   totalQty: number,
 * }>} 按 `model` 升序排列的命中结果
 */
export function searchProducts(master, query) {
  const products = Array.isArray(master?.products) ? master.products : [];
  const inventoryBalances = Array.isArray(master?.inventoryBalances)
    ? master.inventoryBalances
    : [];

  const q = typeof query === "string" ? query.trim() : "";

  // 自定义字段命中索引：只在有 query 时构建（空 query 不需要）
  let searchableValuesByProduct = new Map();
  if (q.length > 0) {
    const searchableFieldIds = buildSearchableFieldIdSet(master?.customFieldDefinitions);
    searchableValuesByProduct = buildSearchableValuesByProduct(
      master?.productCustomFieldValues,
      searchableFieldIds
    );
  }

  const hits = [];
  for (const product of products) {
    if (!product || product.id == null) continue;
    if (!isActive(product)) continue;
    if (q.length > 0 && !matchesProduct(product, q, searchableValuesByProduct)) {
      continue;
    }
    hits.push({
      id: product.id,
      model: getModel(product),
      modelNormalized: getModelNormalized(product),
      imagePath: getImagePath(product),
      status: getStatus(product),
      totalQty: getTotalQty(product.id, inventoryBalances),
    });
  }

  // 稳定排序：按 model ASC（locale-aware 比较，落地中文/英文混排时更直观）
  hits.sort((a, b) => {
    const am = a.model || "";
    const bm = b.model || "";
    if (am === bm) return 0;
    return am < bm ? -1 : 1;
  });

  return hits;
}
