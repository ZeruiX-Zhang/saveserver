// app/handheld/src/operation-queue.js
//
// 操作队列：持久化在 `operation-queue.json`。
//
// 状态机：pending → attempted → imported / duplicate / failed / exported
//
// 每条 op 形状（除业务字段外）：
//   {
//     ...op (snake_case),
//     upload_state: "pending" | "attempted" | "imported" | "duplicate" | "failed" | "exported",
//     attempt_count: number,
//     last_attempt_at: string | null,
//     failure_reason: string | null,
//     stale: boolean,
//   }
//
// 内存维护一份 items 缓存，首次访问时从磁盘加载。subscribers 用于通知
// home-page 等组件更新 badge。
//
// 导出的 *纯函数*：
//   - applyNetworkError(op, err)             → R12.7 / Property 19
//   - markStaleReferences(queue, master)     → R15.2 / Property 20
//   - renameDeviceWithoutHistoryRewrite(queue, newName) → R16.3 / Property 21
//
// Validates: Requirements 4.6, 11.1, 11.4, 11.5, 11.6, 12.7, 15.1, 15.2, 16.3

import {
  readJsonFile,
  writeJsonFileAtomic,
} from "./storage-fs.js";

const QUEUE_FILE = "operation-queue.json";

/** Allowed states. */
export const OP_STATES = Object.freeze({
  PENDING: "pending",
  ATTEMPTED: "attempted",
  IMPORTED: "imported",
  DUPLICATE: "duplicate",
  FAILED: "failed",
  EXPORTED: "exported",
});

let cache = null;
let loaded = false;
let loadPromise = null;
const subscribers = new Set();

function notify() {
  for (const fn of subscribers) {
    try {
      fn(cache);
    } catch {
      // ignore subscriber errors
    }
  }
}

function ensureCacheShape() {
  if (!cache || typeof cache !== "object" || !Array.isArray(cache.items)) {
    cache = { items: [] };
  }
}

async function ensureLoaded() {
  if (loaded) return;
  if (loadPromise) {
    await loadPromise;
    return;
  }
  loadPromise = (async () => {
    const data = await readJsonFile(QUEUE_FILE);
    cache = data && Array.isArray(data.items) ? data : { items: [] };
    loaded = true;
  })();
  try {
    await loadPromise;
  } finally {
    loadPromise = null;
  }
}

async function persist() {
  ensureCacheShape();
  await writeJsonFileAtomic(QUEUE_FILE, cache);
}

/**
 * 加载队列副本（数组）。返回的是引用副本，调用方应视为只读。
 *
 * @returns {Promise<Array<object>>}
 */
export async function loadQueue() {
  await ensureLoaded();
  ensureCacheShape();
  return cache.items.slice();
}

/**
 * 直接覆盖队列；通常仅在测试或重置流程中使用。
 *
 * @param {Array<object>} items
 * @returns {Promise<void>}
 */
export async function setQueue(items) {
  cache = { items: Array.isArray(items) ? items.slice() : [] };
  loaded = true;
  await persist();
  notify();
}

/**
 * 清空队列（用于重置设备身份）。
 *
 * @returns {Promise<void>}
 */
export async function clearQueue() {
  cache = { items: [] };
  loaded = true;
  await persist();
  notify();
}

/**
 * 追加一个 op 到队列；自动注入 upload_state="pending" 等元字段。
 *
 * @param {object} op  来自 op-builders 的纯业务对象
 * @returns {Promise<object>} 含元字段的存储项
 */
export async function appendOperation(op) {
  await ensureLoaded();
  ensureCacheShape();
  const stored = {
    ...op,
    upload_state: OP_STATES.PENDING,
    attempt_count: 0,
    last_attempt_at: null,
    failure_reason: null,
    stale: false,
  };
  cache.items.push(stored);
  await persist();
  notify();
  return stored;
}

/**
 * 删除一个 pending 状态的 op。其它状态拒绝删除。
 *
 * @param {string} operationId
 * @returns {Promise<boolean>} true 表示已删除
 */
export async function removeOperation(operationId) {
  await ensureLoaded();
  ensureCacheShape();
  const idx = cache.items.findIndex((it) => it && it.operation_id === operationId);
  if (idx < 0) return false;
  if (cache.items[idx].upload_state !== OP_STATES.PENDING) return false;
  cache.items.splice(idx, 1);
  await persist();
  notify();
  return true;
}

/**
 * 批量更新若干 op 的状态 / failure_reason / attempt 元字段。
 *
 * @param {Array<{ operationId: string, state?: string, failureReason?: string | null,
 *                 attemptedAt?: string, incAttempt?: boolean }>} updates
 * @returns {Promise<void>}
 */
export async function markOperations(updates) {
  if (!Array.isArray(updates) || updates.length === 0) return;
  await ensureLoaded();
  ensureCacheShape();
  const byId = new Map();
  for (const u of updates) {
    if (u && typeof u.operationId === "string") byId.set(u.operationId, u);
  }
  for (const item of cache.items) {
    if (!item || typeof item.operation_id !== "string") continue;
    const u = byId.get(item.operation_id);
    if (!u) continue;
    if (u.state) item.upload_state = u.state;
    if (u.failureReason !== undefined) item.failure_reason = u.failureReason ?? null;
    if (u.attemptedAt) item.last_attempt_at = u.attemptedAt;
    if (u.incAttempt) item.attempt_count = (Number(item.attempt_count) || 0) + 1;
  }
  await persist();
  notify();
}

/**
 * 选出待上传的 op：包含 pending、attempted 与 exported（exported 也可走 LAN
 * 重发，server 端会按 package_id + operation_id 双层去重）。
 *
 * @returns {Promise<Array<object>>}
 */
export async function pickPendingForUpload() {
  await ensureLoaded();
  ensureCacheShape();
  return cache.items.filter(
    (it) =>
      it &&
      (it.upload_state === OP_STATES.PENDING ||
        it.upload_state === OP_STATES.ATTEMPTED ||
        it.upload_state === OP_STATES.EXPORTED ||
        it.upload_state === OP_STATES.FAILED),
  );
}

/**
 * 订阅队列变更。返回取消订阅函数。
 *
 * @param {(cache: { items: Array<object> }) => void} fn
 * @returns {() => void}
 */
export function subscribe(fn) {
  if (typeof fn !== "function") return () => {};
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

/**
 * 启动时强制重新加载（测试 / 设备身份重置后）。
 *
 * @returns {Promise<void>}
 */
export async function reload() {
  loaded = false;
  await ensureLoaded();
  notify();
}

// ──────────────────────────────────────────────────────────────────────────
// 纯函数（供属性测试与状态机分发使用）
// ──────────────────────────────────────────────────────────────────────────

/**
 * 在网络错误情境下保留业务字段，仅更新元字段。
 *
 * R12.7 / Property 19：业务字段（operation_id, product_id, qty,
 * operation_type, source_*, target_*, operated_at, note, operator_name）逐字段
 * 全等于入参；attempt_count + 1；upload_state = "attempted"。
 *
 * @param {object} op
 * @param {unknown} _err 仅保留接口对称，未使用
 * @returns {object}
 */
export function applyNetworkError(op, _err) {
  const next = { ...op };
  next.attempt_count = (Number(op.attempt_count) || 0) + 1;
  next.last_attempt_at = new Date().toISOString();
  next.upload_state = OP_STATES.ATTEMPTED;
  // failure_reason 保持原值不动
  return next;
}

function isWarehouseLevelMissing(levelId, levelIdSet) {
  if (levelId === null || levelId === undefined || levelId === "") return false;
  return !levelIdSet.has(levelId);
}

/**
 * 把队列项中产品或层数引用失效的标记为 stale=true（不删除，不修改业务字段）。
 *
 * @param {Array<object>} queue
 * @param {{ products?: any[], shelfLevels?: any[] }} master
 * @returns {Array<object>}
 */
export function markStaleReferences(queue, master) {
  if (!Array.isArray(queue)) return [];
  const products = Array.isArray(master?.products) ? master.products : [];
  const levels = Array.isArray(master?.shelfLevels) ? master.shelfLevels : [];
  const productIdSet = new Set(products.map((p) => p?.id).filter((v) => v != null));
  const levelIdSet = new Set(levels.map((l) => l?.id).filter((v) => v != null));

  return queue.map((op) => {
    const productMissing =
      op?.product_id && !productIdSet.has(op.product_id) ? true : false;
    const sourceLevelMissing = isWarehouseLevelMissing(op?.source_level_id, levelIdSet);
    const targetLevelMissing = isWarehouseLevelMissing(op?.target_level_id, levelIdSet);
    const stale = productMissing || sourceLevelMissing || targetLevelMissing;
    return { ...op, stale };
  });
}

/**
 * 显式的恒等转换：修改 device_name 时**不**回填到历史 op 的 operator_name。
 *
 * R16.3 / Property 21：返回的 queue 与入参在每条 op 的 operator_name 上等同。
 *
 * @param {Array<object>} queue
 * @param {string} _newDeviceName
 * @returns {Array<object>}
 */
export function renameDeviceWithoutHistoryRewrite(queue, _newDeviceName) {
  if (!Array.isArray(queue)) return [];
  return queue.map((op) => ({ ...op }));
}

/**
 * 用 operated_at 倒序展示队列（不修改入参）。
 *
 * @param {Array<object>} queue
 * @returns {Array<object>}
 */
export function sortQueueForDisplay(queue) {
  if (!Array.isArray(queue)) return [];
  return queue
    .slice()
    .sort((a, b) => {
      const ta = a?.operated_at || "";
      const tb = b?.operated_at || "";
      if (ta === tb) return 0;
      return ta < tb ? 1 : -1;
    });
}

export const _internals = { QUEUE_FILE };
