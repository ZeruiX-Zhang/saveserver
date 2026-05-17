// app/shared/op-builders.js
//
// 7 个 `Operation` 工厂，纯函数；不写盘、不更新预览、不发请求。
// 每个工厂返回符合 `inventory_operations` 表（design.md §Data Models
// "Operation_Type → 字段形状表"）契约的 wire 对象，使用 snake_case 键。
//
// 工厂签名：
//   buildXxx(input, { now = Date.now, idGen = defaultIdGen } = {})
//
//   - input：camelCase 形参对象，描述一次操作的业务输入
//   - now / idGen：依赖注入入口，便于属性测试注入确定性时钟与 UUID
//
// 校验：
//   - qty 必须严格 > 0（R18.4）
//   - move 类型要求 source_level_id !== target_level_id（R6.5）
//   - adjust_* 类型要求 note 长度 ≥ 1（R9.5）
//   - 未使用的 source_*/target_* 字段显式置为 null（不是 undefined）
//
// 该模块是纯 ES Module，不依赖 DOM / Capacitor，可同时在 Node.js（属性测试）
// 与 Android WebView（手持端 Bundle）下运行。
//
// Validates: Requirements 4.4, 4.5, 6.5, 6.6, 6.7, 7.1, 8.3, 9.2, 9.3, 9.5,
//            16.2, 18.4

/** 合法 UUID v4 形如 8-4-4-4-12，第三段首字 4，第四段首字 8/9/a/b。 */
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * 默认 UUID v4 生成器：优先使用 `globalThis.crypto.randomUUID`
 * （Node 18+ / 现代浏览器 / Android WebView），不可用时显式抛错而不是
 * 退化到弱随机源 —— 让调用方在测试里注入 `idGen` 是更安全的做法。
 *
 * @returns {string}
 */
function defaultIdGen() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  throw new Error("crypto.randomUUID unavailable; inject idGen explicitly");
}

/**
 * 校验数量严格 > 0 且为有限数。失败抛 TypeError。
 *
 * @param {unknown} qty
 * @returns {number}
 */
function validateQtyPositive(qty) {
  if (typeof qty !== "number" || !Number.isFinite(qty) || qty <= 0) {
    throw new TypeError(`qty must be a positive finite number, got: ${String(qty)}`);
  }
  return qty;
}

/**
 * 校验必填字段非空（null / undefined / 空字符串均视为缺失）。失败抛 TypeError。
 *
 * @template T
 * @param {T} value
 * @param {string} fieldName
 * @returns {T}
 */
function validateRequired(value, fieldName) {
  if (value === null || value === undefined || value === "") {
    throw new TypeError(`${fieldName} is required`);
  }
  return value;
}

/**
 * adjust_* 类型要求 note 长度 ≥ 1（R9.5）。失败抛 TypeError。
 *
 * @param {unknown} note
 * @returns {string}
 */
function validateNoteRequired(note) {
  if (note === null || note === undefined) {
    throw new TypeError("note is required for adjust_* (>= 1 char)");
  }
  const text = String(note);
  if (text.length < 1) {
    throw new TypeError("note must be at least 1 character for adjust_*");
  }
  return text;
}

/**
 * 在 adjust_* 工厂中根据 levelId / externalId 选择唯一的位置类型。
 * 必须恰好提供一个，否则抛 TypeError。
 *
 * @param {{ levelId: unknown, externalId: unknown }} args
 * @param {string} prefix  "source" / "target"，仅用于错误消息
 * @returns {{ locationType: "warehouse" | "external", levelId: string | null, externalId: string | null }}
 */
function pickAdjustLocation({ levelId, externalId }, prefix) {
  const hasLevel = levelId !== null && levelId !== undefined && levelId !== "";
  const hasExternal = externalId !== null && externalId !== undefined && externalId !== "";
  if (hasLevel && hasExternal) {
    throw new TypeError(
      `adjust requires exactly one of ${prefix}LevelId or ${prefix}ExternalId, got both`
    );
  }
  if (!hasLevel && !hasExternal) {
    throw new TypeError(
      `adjust requires exactly one of ${prefix}LevelId or ${prefix}ExternalId, got neither`
    );
  }
  return hasLevel
    ? { locationType: "warehouse", levelId, externalId: null }
    : { locationType: "external", levelId: null, externalId };
}

/**
 * 公共字段：operation_id / operation_type / product_id / qty / operated_at /
 * operator_name / note。`operator_name` / `note` 缺省回退为 ""。
 *
 * @param {{ operationType: string, productId: unknown, qty: unknown, operatorName?: unknown, note?: unknown }} args
 * @param {{ now: () => number, idGen: () => string }} deps
 */
function buildBaseFields({ operationType, productId, qty, operatorName, note }, { now, idGen }) {
  validateRequired(productId, "productId");
  validateQtyPositive(qty);
  return {
    operation_id: idGen(),
    operation_type: operationType,
    product_id: productId,
    qty,
    operated_at: new Date(now()).toISOString(),
    operator_name: operatorName === null || operatorName === undefined ? "" : String(operatorName),
    note: note === null || note === undefined ? "" : String(note),
  };
}

// ──────────────────────────────────────────────────────────────────────────
// 7 个工厂
// ──────────────────────────────────────────────────────────────────────────

/**
 * put_in：新增入库到指定层数（仓库内）。
 *
 * 形状：source=none，target=warehouse + target_level_id。
 *
 * @param {{ productId: string, qty: number, targetLevelId: string,
 *          operatorName?: string, note?: string }} input
 * @param {{ now?: () => number, idGen?: () => string }} [deps]
 */
export function buildPutIn(input, { now = Date.now, idGen = defaultIdGen } = {}) {
  const { productId, qty, targetLevelId, operatorName, note } = input;
  validateRequired(targetLevelId, "targetLevelId");
  return {
    ...buildBaseFields(
      { operationType: "put_in", productId, qty, operatorName, note },
      { now, idGen }
    ),
    source_location_type: "none",
    source_level_id: null,
    source_external_location_id: null,
    target_location_type: "warehouse",
    target_level_id: targetLevelId,
    target_external_location_id: null,
  };
}

/**
 * move：仓库内位置变更（warehouse → warehouse）。
 *
 * 约束：source_level_id !== target_level_id（R6.5）。
 *
 * @param {{ productId: string, qty: number, sourceLevelId: string, targetLevelId: string,
 *          operatorName?: string, note?: string }} input
 * @param {{ now?: () => number, idGen?: () => string }} [deps]
 */
export function buildMoveWarehouse(input, { now = Date.now, idGen = defaultIdGen } = {}) {
  const { productId, qty, sourceLevelId, targetLevelId, operatorName, note } = input;
  validateRequired(sourceLevelId, "sourceLevelId");
  validateRequired(targetLevelId, "targetLevelId");
  if (sourceLevelId === targetLevelId) {
    throw new TypeError("move requires source_level_id !== target_level_id");
  }
  return {
    ...buildBaseFields(
      { operationType: "move", productId, qty, operatorName, note },
      { now, idGen }
    ),
    source_location_type: "warehouse",
    source_level_id: sourceLevelId,
    source_external_location_id: null,
    target_location_type: "warehouse",
    target_level_id: targetLevelId,
    target_external_location_id: null,
  };
}

/**
 * move_to_external：从仓库层数移出到非仓库位置。
 *
 * 形状：source=warehouse + source_level_id，target=external + target_external_location_id。
 *
 * @param {{ productId: string, qty: number, sourceLevelId: string, targetExternalId: string,
 *          operatorName?: string, note?: string }} input
 * @param {{ now?: () => number, idGen?: () => string }} [deps]
 */
export function buildMoveToExternal(input, { now = Date.now, idGen = defaultIdGen } = {}) {
  const { productId, qty, sourceLevelId, targetExternalId, operatorName, note } = input;
  validateRequired(sourceLevelId, "sourceLevelId");
  validateRequired(targetExternalId, "targetExternalId");
  return {
    ...buildBaseFields(
      { operationType: "move_to_external", productId, qty, operatorName, note },
      { now, idGen }
    ),
    source_location_type: "warehouse",
    source_level_id: sourceLevelId,
    source_external_location_id: null,
    target_location_type: "external",
    target_level_id: null,
    target_external_location_id: targetExternalId,
  };
}

/**
 * move_from_external：从非仓库位置移回仓库层数。
 *
 * 形状：source=external + source_external_location_id，target=warehouse + target_level_id。
 *
 * @param {{ productId: string, qty: number, sourceExternalId: string, targetLevelId: string,
 *          operatorName?: string, note?: string }} input
 * @param {{ now?: () => number, idGen?: () => string }} [deps]
 */
export function buildMoveFromExternal(input, { now = Date.now, idGen = defaultIdGen } = {}) {
  const { productId, qty, sourceExternalId, targetLevelId, operatorName, note } = input;
  validateRequired(sourceExternalId, "sourceExternalId");
  validateRequired(targetLevelId, "targetLevelId");
  return {
    ...buildBaseFields(
      { operationType: "move_from_external", productId, qty, operatorName, note },
      { now, idGen }
    ),
    source_location_type: "external",
    source_level_id: null,
    source_external_location_id: sourceExternalId,
    target_location_type: "warehouse",
    target_level_id: targetLevelId,
    target_external_location_id: null,
  };
}

/**
 * ship_out：真正出库。来源可以是仓库层数或非仓库位置，目标为 none。
 *
 * 约束：sourceLocationType ∈ {"warehouse","external"}；warehouse 要求 sourceLevelId，
 * external 要求 sourceExternalId；另一字段必须缺省或 null（不允许同时提供）。
 *
 * @param {{ productId: string, qty: number,
 *          sourceLocationType: "warehouse" | "external",
 *          sourceLevelId?: string | null, sourceExternalId?: string | null,
 *          operatorName?: string, note?: string }} input
 * @param {{ now?: () => number, idGen?: () => string }} [deps]
 */
export function buildShipOut(input, { now = Date.now, idGen = defaultIdGen } = {}) {
  const {
    productId,
    qty,
    sourceLocationType,
    sourceLevelId,
    sourceExternalId,
    operatorName,
    note,
  } = input;

  if (sourceLocationType !== "warehouse" && sourceLocationType !== "external") {
    throw new TypeError(
      `ship_out sourceLocationType must be "warehouse" or "external", got: ${String(sourceLocationType)}`
    );
  }

  const hasLevel = sourceLevelId !== null && sourceLevelId !== undefined && sourceLevelId !== "";
  const hasExternal =
    sourceExternalId !== null && sourceExternalId !== undefined && sourceExternalId !== "";

  if (sourceLocationType === "warehouse") {
    if (!hasLevel) {
      throw new TypeError('ship_out from "warehouse" requires sourceLevelId');
    }
    if (hasExternal) {
      throw new TypeError('ship_out from "warehouse" must not provide sourceExternalId');
    }
  } else {
    // external
    if (!hasExternal) {
      throw new TypeError('ship_out from "external" requires sourceExternalId');
    }
    if (hasLevel) {
      throw new TypeError('ship_out from "external" must not provide sourceLevelId');
    }
  }

  return {
    ...buildBaseFields(
      { operationType: "ship_out", productId, qty, operatorName, note },
      { now, idGen }
    ),
    source_location_type: sourceLocationType,
    source_level_id: sourceLocationType === "warehouse" ? sourceLevelId : null,
    source_external_location_id: sourceLocationType === "external" ? sourceExternalId : null,
    target_location_type: "none",
    target_level_id: null,
    target_external_location_id: null,
  };
}

/**
 * adjust_increase：盘点加数。来源 none，目标在仓库层数或非仓库位置中二选一。
 *
 * 约束：targetLevelId / targetExternalId 必须恰好提供一个；note 长度 ≥ 1（R9.5）。
 *
 * @param {{ productId: string, qty: number,
 *          targetLevelId?: string | null, targetExternalId?: string | null,
 *          operatorName?: string, note: string }} input
 * @param {{ now?: () => number, idGen?: () => string }} [deps]
 */
export function buildAdjustIncrease(input, { now = Date.now, idGen = defaultIdGen } = {}) {
  const { productId, qty, targetLevelId, targetExternalId, operatorName, note } = input;
  const noteText = validateNoteRequired(note);
  const target = pickAdjustLocation(
    { levelId: targetLevelId, externalId: targetExternalId },
    "target"
  );
  return {
    ...buildBaseFields(
      { operationType: "adjust_increase", productId, qty, operatorName, note: noteText },
      { now, idGen }
    ),
    source_location_type: "none",
    source_level_id: null,
    source_external_location_id: null,
    target_location_type: target.locationType,
    target_level_id: target.levelId,
    target_external_location_id: target.externalId,
  };
}

/**
 * adjust_decrease：盘点减数。来源在仓库层数或非仓库位置中二选一，目标 none。
 *
 * 约束：sourceLevelId / sourceExternalId 必须恰好提供一个；note 长度 ≥ 1（R9.5）。
 *
 * @param {{ productId: string, qty: number,
 *          sourceLevelId?: string | null, sourceExternalId?: string | null,
 *          operatorName?: string, note: string }} input
 * @param {{ now?: () => number, idGen?: () => string }} [deps]
 */
export function buildAdjustDecrease(input, { now = Date.now, idGen = defaultIdGen } = {}) {
  const { productId, qty, sourceLevelId, sourceExternalId, operatorName, note } = input;
  const noteText = validateNoteRequired(note);
  const source = pickAdjustLocation(
    { levelId: sourceLevelId, externalId: sourceExternalId },
    "source"
  );
  return {
    ...buildBaseFields(
      { operationType: "adjust_decrease", productId, qty, operatorName, note: noteText },
      { now, idGen }
    ),
    source_location_type: source.locationType,
    source_level_id: source.levelId,
    source_external_location_id: source.externalId,
    target_location_type: "none",
    target_level_id: null,
    target_external_location_id: null,
  };
}

/**
 * 内部校验器导出，仅供属性测试 / 单元测试使用。运行时业务代码不应依赖。
 */
export const _validators = {
  validateQtyPositive,
  validateRequired,
  validateNoteRequired,
  pickAdjustLocation,
  defaultIdGen,
  UUID_V4_REGEX,
};
