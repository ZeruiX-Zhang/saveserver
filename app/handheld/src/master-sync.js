// app/handheld/src/master-sync.js
//
// 主数据同步：
//   - GET ${apiBase}/api/sync/master-data 拉取并落盘 master.json
//   - importUsbMasterPackage：从 USB .warehouse-master.json.gz 文件导入
//   - loadLocalMasterStore：从磁盘读取本地主数据
//
// Validates: Requirements 2.1, 2.2, 2.3, 2.5, 2.6, 2.7

import { getPref, setPref } from "./storage-prefs.js";
import {
  readJsonFile,
  writeJsonFileAtomic,
  fileExists,
  readBase64,
} from "./storage-fs.js";
import { gunzipBytes, base64ToBytes } from "./gzip.js";
import { log } from "./logger.js";

const KEY_API_BASE = "apiBase";
const KEY_SYNC_TOKEN = "sync_token";
const KEY_LAST_SYNC = "last_master_sync_at";
const KEY_BASE_PACKAGE_ID = "base_master_package_id";
const MASTER_FILE = "master.json";

const MASTER_STORES = [
  "products",
  "customFieldDefinitions",
  "productCustomFieldValues",
  "warehouses",
  "shelves",
  "shelfLevels",
  "externalLocations",
  "inventoryBalances",
];

function emptyMasterStore() {
  const out = {};
  for (const s of MASTER_STORES) out[s] = [];
  return out;
}

/**
 * 同步主数据：HTTP GET → 落盘 → 写入元数据。
 *
 * @returns {Promise<{ generatedAt: string, packageId: string, storeCounts: Record<string, number> }>}
 * @throws {Error} 网络或 HTTP 错误
 */
export async function syncMasterData() {
  const apiBase = (await getPref(KEY_API_BASE)) || "";
  const syncToken = (await getPref(KEY_SYNC_TOKEN)) || "";
  if (!apiBase) {
    throw new Error("尚未配对：缺少服务器地址");
  }

  const url = `${apiBase.replace(/\/+$/, "")}/api/sync/master-data`;
  let response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        "X-Sync-Token": syncToken,
        Accept: "application/json",
      },
    });
  } catch (err) {
    log("error", "master-sync", "fetch failed", { message: String(err?.message || err) });
    throw new Error(`网络错误：${err?.message || err}`);
  }

  if (response.status === 401) {
    throw new Error("令牌无效，请重新配对");
  }
  if (!response.ok) {
    throw new Error(`服务端响应状态码：${response.status}`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("服务端响应无法解析");
  }

  if (!payload || typeof payload !== "object" || !payload.data) {
    throw new Error("服务端响应缺少 data 字段");
  }

  // 服务端 payload 形如 { type, version, generatedAt, data: { 8 stores } }
  const data = payload.data;
  const storeCounts = {};
  for (const s of MASTER_STORES) {
    if (!Array.isArray(data[s])) data[s] = [];
    storeCounts[s] = data[s].length;
  }

  await writeJsonFileAtomic(MASTER_FILE, data);

  const generatedAt =
    typeof payload.generatedAt === "string" && payload.generatedAt.length > 0
      ? payload.generatedAt
      : new Date().toISOString();
  await setPref(KEY_LAST_SYNC, generatedAt);
  // Server doesn't currently emit master-package id; use generatedAt as a
  // deterministic-per-sync stand-in (Requirement 2.6 traceability).
  await setPref(KEY_BASE_PACKAGE_ID, generatedAt);

  log("info", "master-sync", "synced", { storeCounts });
  return { generatedAt, packageId: generatedAt, storeCounts };
}

/**
 * 读取本地主数据；缺失时返回 8 store 全为 [] 的骨架。
 *
 * @returns {Promise<{ products: any[], customFieldDefinitions: any[],
 *   productCustomFieldValues: any[], warehouses: any[], shelves: any[],
 *   shelfLevels: any[], externalLocations: any[], inventoryBalances: any[] }>}
 */
export async function loadLocalMasterStore() {
  const data = await readJsonFile(MASTER_FILE);
  if (!data || typeof data !== "object") {
    return emptyMasterStore();
  }
  const out = emptyMasterStore();
  for (const s of MASTER_STORES) {
    if (Array.isArray(data[s])) out[s] = data[s];
  }
  return out;
}

/**
 * 检测本地是否已经有主数据（启动时用于 decideInitialRoute）。
 *
 * @returns {Promise<boolean>}
 */
export async function hasLocalMasterStore() {
  if (!(await fileExists(MASTER_FILE))) return false;
  const data = await readJsonFile(MASTER_FILE);
  if (!data || typeof data !== "object") return false;
  // 至少有一个 store 非空
  for (const s of MASTER_STORES) {
    if (Array.isArray(data[s]) && data[s].length > 0) return true;
  }
  // 文件存在且有合法骨架仍视为已同步
  return true;
}

/**
 * 从 USB .warehouse-master.json.gz 文件导入主数据。
 * filePath 是 `Documents/warehouse-handheld/` 下的相对路径。
 *
 * @param {string} relPath
 * @returns {Promise<{ generatedAt: string, packageId: string, storeCounts: Record<string, number> }>}
 */
export async function importUsbMasterPackage(relPath) {
  const b64 = await readBase64(relPath);
  if (!b64) {
    throw new Error(`找不到文件：${relPath}`);
  }
  let json;
  try {
    const bytes = base64ToBytes(b64);
    json = await gunzipBytes(bytes);
  } catch (err) {
    throw new Error(`无法解压主数据包：${err?.message || err}`);
  }
  let payload;
  try {
    payload = JSON.parse(json);
  } catch {
    throw new Error("主数据包格式无效");
  }
  const data =
    payload && typeof payload === "object" && payload.data ? payload.data : payload;
  if (!data || typeof data !== "object") {
    throw new Error("主数据包内容无效");
  }
  const storeCounts = {};
  const persisted = emptyMasterStore();
  for (const s of MASTER_STORES) {
    if (Array.isArray(data[s])) persisted[s] = data[s];
    storeCounts[s] = persisted[s].length;
  }
  await writeJsonFileAtomic(MASTER_FILE, persisted);
  const generatedAt =
    typeof payload?.generatedAt === "string" && payload.generatedAt.length > 0
      ? payload.generatedAt
      : new Date().toISOString();
  await setPref(KEY_LAST_SYNC, generatedAt);
  await setPref(KEY_BASE_PACKAGE_ID, generatedAt);
  log("info", "master-sync", "usb imported", { storeCounts });
  return { generatedAt, packageId: generatedAt, storeCounts };
}

export const _internals = { MASTER_STORES, MASTER_FILE };
