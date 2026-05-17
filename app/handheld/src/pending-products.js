// app/handheld/src/pending-products.js
//
// `Pending_Product` 本地 CRUD：未同步到服务器的新增产品。
//
// 持久化：`pending-products.json`，形如 { items: [...] }
// 图片：`images/<product_id>.jpg`（base64 写盘）
//
// Validates: Requirements 10.1, 10.3, 10.4, 10.5, 10.6, 10.7

import {
  readJsonFile,
  writeJsonFileAtomic,
  writeBase64,
} from "./storage-fs.js";
import { normalizeModel } from "../shared/normalize-model.js";

const PENDING_FILE = "pending-products.json";

let cache = null;
let loaded = false;

function uuidV4() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  // Weak fallback
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = [...bytes].map((b) => b.toString(16).padStart(2, "0"));
  return `${h.slice(0, 4).join("")}-${h.slice(4, 6).join("")}-${h
    .slice(6, 8)
    .join("")}-${h.slice(8, 10).join("")}-${h.slice(10, 16).join("")}`;
}

async function ensureLoaded() {
  if (loaded) return;
  const data = await readJsonFile(PENDING_FILE);
  cache = data && Array.isArray(data.items) ? data : { items: [] };
  loaded = true;
}

async function persist() {
  await writeJsonFileAtomic(PENDING_FILE, cache);
}

/**
 * 加载本地 pending 产品列表。
 *
 * @returns {Promise<Array<object>>}
 */
export async function loadPendingProducts() {
  await ensureLoaded();
  return cache.items.slice();
}

/**
 * 检查同型号是否已存在于 master 或 pending 列表。
 *
 * @param {string} model
 * @param {{ products?: any[] }} master
 * @returns {Promise<{ duplicate: boolean, existing: object | null }>}
 */
export async function findDuplicateByModel(model, master) {
  await ensureLoaded();
  const norm = normalizeModel(model);
  if (!norm) return { duplicate: false, existing: null };
  const products = Array.isArray(master?.products) ? master.products : [];
  for (const p of products) {
    const pNorm =
      (typeof p?.modelNormalized === "string" && p.modelNormalized) ||
      (typeof p?.model_normalized === "string" && p.model_normalized) ||
      normalizeModel(p?.model);
    if (pNorm === norm) return { duplicate: true, existing: p };
  }
  for (const p of cache.items) {
    if (p?.model_normalized === norm) {
      return { duplicate: true, existing: p };
    }
  }
  return { duplicate: false, existing: null };
}

/**
 * 追加一个 pending 产品；图片以 base64 写入 images/<id>.jpg。
 *
 * @param {{ model: string, imageBase64?: string | null,
 *          customFieldValues?: Record<string, string> }} input
 * @returns {Promise<object>} 新创建的 pending 产品记录
 */
export async function appendPendingProduct(input) {
  await ensureLoaded();
  const model = String(input?.model ?? "").trim();
  if (!model) throw new Error("型号不能为空");
  const id = uuidV4();
  let imagePath = null;
  if (input?.imageBase64) {
    imagePath = `images/${id}.jpg`;
    try {
      await writeBase64(imagePath, input.imageBase64);
    } catch (err) {
      throw new Error(`保存图片失败：${err?.message || err}`);
    }
  }
  const record = {
    id,
    model,
    model_normalized: normalizeModel(model),
    image_path: imagePath,
    status: "active",
    created_at: new Date().toISOString(),
    custom_field_values: input?.customFieldValues || {},
    synced: false,
  };
  cache.items.push(record);
  await persist();
  return record;
}

/**
 * 标记某 pending 产品为已同步（成功上传后调用）。
 *
 * @param {string} productId
 * @returns {Promise<void>}
 */
export async function markPendingSynced(productId) {
  await ensureLoaded();
  for (const p of cache.items) {
    if (p && p.id === productId) {
      p.synced = true;
    }
  }
  await persist();
}

/**
 * 把 pending 产品合并到 master.products / master.productCustomFieldValues
 * 中，得到一个用于搜索的虚拟 master。返回值不会修改入参。
 *
 * @param {{ products?: any[], customFieldDefinitions?: any[],
 *          productCustomFieldValues?: any[], inventoryBalances?: any[] }} master
 * @returns {Promise<object>}
 */
export async function mergeIntoMaster(master) {
  await ensureLoaded();
  const merged = {
    ...master,
    products: Array.isArray(master?.products) ? master.products.slice() : [],
    productCustomFieldValues: Array.isArray(master?.productCustomFieldValues)
      ? master.productCustomFieldValues.slice()
      : [],
    inventoryBalances: Array.isArray(master?.inventoryBalances)
      ? master.inventoryBalances.slice()
      : [],
  };
  for (const p of cache.items) {
    if (!p || p.synced) continue;
    merged.products.push({
      id: p.id,
      model: p.model,
      model_normalized: p.model_normalized,
      image_path: p.image_path,
      status: p.status || "active",
      _pending: true,
    });
    if (p.custom_field_values && typeof p.custom_field_values === "object") {
      for (const fieldId of Object.keys(p.custom_field_values)) {
        merged.productCustomFieldValues.push({
          product_id: p.id,
          field_id: fieldId,
          value_text: String(p.custom_field_values[fieldId] ?? ""),
        });
      }
    }
  }
  return merged;
}

export const _internals = { PENDING_FILE };
