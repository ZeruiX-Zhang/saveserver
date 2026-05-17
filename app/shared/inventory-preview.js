// app/shared/inventory-preview.js
//
// 本地库存预览（Local Inventory Preview）的纯函数实现。
//
// Preview 形状:
//     Map<productId, Map<locationKey, qty>>
//
// 其中 locationKey 形如:
//     "level:<levelId>"        ← 仓库内层（warehouse）
//     "external:<externalId>"  ← 非仓库位置（external）
//
// 所有更新都是函数式：每次返回全新的外层 Map；被触及的产品的内层 Map 会被克隆，
// 未被触及的产品则按引用保留，以保证常数级开销。**绝不修改入参**。
//
// 调用方负责"应用一次 = 加一次"的非幂等语义（Property 11）：
// 对同一 op 调用两次 applyOp 必须产生两次效果，模块内部不做去重。
//
// 该模块是纯 ES Module，不依赖 DOM / Capacitor / 日志，可在 Node.js（属性测试）
// 与 Android WebView（手持端 Bundle）下统一运行。
//
// Validates: Requirements 4.6, 6.8, 11.4, 18.5, 18.6, 18.9

// ---------- 字段提取（兼容 camelCase / snake_case） ---------------------------

function pickField(obj, snake, camel) {
  if (obj == null) return null;
  const a = obj[snake];
  if (a !== undefined && a !== null) return a;
  const b = obj[camel];
  if (b !== undefined && b !== null) return b;
  return null;
}

function pickProductId(op) {
  return pickField(op, "product_id", "productId");
}

function decodeSource(op) {
  return {
    type: pickField(op, "source_location_type", "sourceLocationType"),
    levelId: pickField(op, "source_level_id", "sourceLevelId"),
    externalId: pickField(
      op,
      "source_external_location_id",
      "sourceExternalLocationId",
    ),
  };
}

function decodeTarget(op) {
  return {
    type: pickField(op, "target_location_type", "targetLocationType"),
    levelId: pickField(op, "target_level_id", "targetLevelId"),
    externalId: pickField(
      op,
      "target_external_location_id",
      "targetExternalLocationId",
    ),
  };
}

// ---------- 数量解析 ---------------------------------------------------------

function coerceQty(op) {
  const q = Number(op == null ? NaN : op.qty);
  if (Number.isNaN(q)) {
    throw new TypeError("op.qty 必须是数字");
  }
  return q;
}

// ---------- locationKey -----------------------------------------------------

/**
 * 把位置三元组（locationType, levelId, externalId）映射为统一的 locationKey
 * 字符串。若 locationType === "none"（或字段无意义），返回 null。
 *
 * @param {string|null|undefined} locationType
 * @param {string|number|null|undefined} levelId
 * @param {string|number|null|undefined} externalId
 * @returns {string|null}
 */
export function locationKey(locationType, levelId, externalId) {
  if (locationType === "warehouse") {
    if (levelId === null || levelId === undefined || levelId === "") return null;
    return `level:${levelId}`;
  }
  if (locationType === "external") {
    if (externalId === null || externalId === undefined || externalId === "") {
      return null;
    }
    return `external:${externalId}`;
  }
  // "none" 或其它一律视为无位置
  return null;
}

function sourceKeyOf(op) {
  const s = decodeSource(op);
  return locationKey(s.type, s.levelId, s.externalId);
}

function targetKeyOf(op) {
  const t = decodeTarget(op);
  return locationKey(t.type, t.levelId, t.externalId);
}

// ---------- buildInitialPreview ---------------------------------------------

/**
 * 用主数据中的 inventory_balances 行构造初始预览。
 *
 * 行字段同时支持 camelCase 与 snake_case：
 *   productId / product_id
 *   locationType / location_type
 *   levelId / level_id
 *   externalLocationId / external_location_id
 *   qty
 *
 * qty <= 0 或缺失关键字段的行会被跳过。
 *
 * @param {Array<Record<string, unknown>>} rows
 * @returns {Map<string, Map<string, number>>}
 */
export function buildInitialPreview(rows) {
  const out = new Map();
  if (!Array.isArray(rows)) return out;

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const productId = pickField(row, "product_id", "productId");
    if (productId === null) continue;

    const locationType = pickField(row, "location_type", "locationType");
    const levelId = pickField(row, "level_id", "levelId");
    const externalId = pickField(
      row,
      "external_location_id",
      "externalLocationId",
    );
    const key = locationKey(locationType, levelId, externalId);
    if (!key) continue;

    const qty = Number(row.qty);
    if (!Number.isFinite(qty) || qty <= 0) continue;

    let inner = out.get(productId);
    if (!inner) {
      inner = new Map();
      out.set(productId, inner);
    }
    inner.set(key, qty);
  }

  return out;
}

// ---------- 核心 delta 应用 --------------------------------------------------

/**
 * 在已经被克隆为安全可写的外层 `out` 上，对单个产品的内层 Map 应用一次 delta。
 *
 * 关键不变量：
 *   - `out` 一定是调用方刚 `new Map(preview)` 出来的可变副本。
 *   - 同一次 applyOp / undoOp 调用中，对同一 productId 只克隆一次内层。
 */
function applyDeltaInPlace(out, productId, key, delta, innerCache) {
  let inner = innerCache.get(productId);
  if (inner === undefined) {
    const original = out.get(productId);
    inner = original ? new Map(original) : new Map();
    innerCache.set(productId, inner);
  }
  const current = inner.get(key) ?? 0;
  const next = current + delta;
  if (next > 0) {
    inner.set(key, next);
  } else {
    // 数量降到 0 或更低 → 移除该位置条目
    inner.delete(key);
  }
}

function commitInner(out, productId, innerCache) {
  const inner = innerCache.get(productId);
  if (inner === undefined) return;
  if (inner.size === 0) {
    out.delete(productId);
  } else {
    out.set(productId, inner);
  }
}

// ---------- applyOp ----------------------------------------------------------

/**
 * 把一条 Operation 应用到预览上，返回新的预览。
 *
 * 规则（与 design.md §Data Models "Operation_Type → 字段形状表" 一致）：
 *   - 当 source_location_type !== "none" 时，源位置 qty -= op.qty
 *   - 当 target_location_type !== "none" 时，目标位置 qty += op.qty
 *   - 任一位置 qty <= 0 时，从内层 Map 中移除；内层为空时，从外层移除该产品
 *
 * 不会修改入参 preview；返回的外层 Map 与未触及产品的内层 Map 共享引用。
 *
 * @param {Map<string, Map<string, number>>} preview
 * @param {Record<string, unknown>} op
 * @returns {Map<string, Map<string, number>>}
 * @throws {TypeError} 若 op.qty 不是数字
 */
export function applyOp(preview, op) {
  if (!(preview instanceof Map)) {
    throw new TypeError("preview 必须是 Map");
  }
  if (op === null || typeof op !== "object") {
    throw new TypeError("op 必须是对象");
  }
  // 必须先做 qty 校验：op.qty=NaN 时，无论 productId 是否存在都应抛错
  const qty = coerceQty(op);

  const out = new Map(preview);

  const productId = pickProductId(op);
  if (productId === null) return out;

  const sourceKey = sourceKeyOf(op);
  const targetKey = targetKeyOf(op);
  if (sourceKey === null && targetKey === null) return out;

  const innerCache = new Map();
  if (sourceKey !== null) {
    applyDeltaInPlace(out, productId, sourceKey, -qty, innerCache);
  }
  if (targetKey !== null) {
    applyDeltaInPlace(out, productId, targetKey, qty, innerCache);
  }
  commitInner(out, productId, innerCache);

  return out;
}

// ---------- undoOp -----------------------------------------------------------

/**
 * applyOp 的反向：源 +qty、目标 -qty。
 *
 * 数学性质（Property 10）：
 *     undoOp(applyOp(p, op), op)  深度等于  p
 *
 * 该等式在 source 位置数量充分的前提下成立；当 applyOp 触发了"源数量降到负值
 * 被截断为 0"的边界情形时，等式不再成立，调用方需保证不会在数量不足时录入操作
 * （由 op-form-page 的预览校验承担）。
 *
 * @param {Map<string, Map<string, number>>} preview
 * @param {Record<string, unknown>} op
 * @returns {Map<string, Map<string, number>>}
 * @throws {TypeError} 若 op.qty 不是数字
 */
export function undoOp(preview, op) {
  if (!(preview instanceof Map)) {
    throw new TypeError("preview 必须是 Map");
  }
  if (op === null || typeof op !== "object") {
    throw new TypeError("op 必须是对象");
  }
  const qty = coerceQty(op);

  const out = new Map(preview);

  const productId = pickProductId(op);
  if (productId === null) return out;

  const sourceKey = sourceKeyOf(op);
  const targetKey = targetKeyOf(op);
  if (sourceKey === null && targetKey === null) return out;

  const innerCache = new Map();
  // 反向：先撤销目标的增加，再撤销源的减少。两次 delta 顺序对终态无影响，
  // 但显式写成 applyOp 的镜像有助于阅读。
  if (targetKey !== null) {
    applyDeltaInPlace(out, productId, targetKey, -qty, innerCache);
  }
  if (sourceKey !== null) {
    applyDeltaInPlace(out, productId, sourceKey, qty, innerCache);
  }
  commitInner(out, productId, innerCache);

  return out;
}

// ---------- 查询 -------------------------------------------------------------

/**
 * 读取某产品在某位置的当前预览数量。缺失返回 0（而非 undefined）。
 *
 * @param {Map<string, Map<string, number>>} preview
 * @param {string} productId
 * @param {string} key
 * @returns {number}
 */
export function getLocationQty(preview, productId, key) {
  if (!(preview instanceof Map)) return 0;
  const inner = preview.get(productId);
  if (!inner) return 0;
  const v = inner.get(key);
  return v === undefined ? 0 : v;
}

/**
 * 列出某产品所有有库存的位置，按 locationKey 升序稳定排序。
 *
 * @param {Map<string, Map<string, number>>} preview
 * @param {string} productId
 * @returns {Array<{ locationKey: string, qty: number }>}
 */
export function listLocationsWithQty(preview, productId) {
  if (!(preview instanceof Map)) return [];
  const inner = preview.get(productId);
  if (!inner) return [];

  const out = [];
  for (const [k, qty] of inner) {
    out.push({ locationKey: k, qty });
  }
  out.sort((a, b) => {
    if (a.locationKey < b.locationKey) return -1;
    if (a.locationKey > b.locationKey) return 1;
    return 0;
  });
  return out;
}
