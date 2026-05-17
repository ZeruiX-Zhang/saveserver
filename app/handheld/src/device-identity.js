// app/handheld/src/device-identity.js
//
// 管理 device_id / device_name 的小模块。
// 不直接 import operation-queue，避免循环依赖；使用动态 import。
//
// Validates: Requirements 1.9, 16.1, 16.3, 16.4

import { getPref, setPref, removePref } from "./storage-prefs.js";

const KEY_DEVICE_ID = "device_id";
const KEY_DEVICE_NAME = "device_name";

/**
 * 生成一个 UUID v4。优先使用 globalThis.crypto.randomUUID，
 * 不可用时退回到弱实现（仅当 native 设备上无 crypto 时；几乎不会发生）。
 *
 * @returns {string}
 */
function generateUuidV4() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  // Weak fallback (RFC 4122 v4): only used when crypto is missing.
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
    .slice(6, 8)
    .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
}

/**
 * 读取或首次生成 device_id（UUID v4，持久化在 Preferences）。
 *
 * @returns {Promise<string>}
 */
export async function getOrCreateDeviceId() {
  const existing = await getPref(KEY_DEVICE_ID);
  if (existing && typeof existing === "string" && existing.length > 0) {
    return existing;
  }
  const fresh = generateUuidV4();
  await setPref(KEY_DEVICE_ID, fresh);
  return fresh;
}

/**
 * 读取 device_name；未设置返回 null。
 *
 * @returns {Promise<string | null>}
 */
export async function getDeviceName() {
  const v = await getPref(KEY_DEVICE_NAME);
  return v ?? null;
}

/**
 * 设置 device_name；空字符串等价于删除。
 *
 * R16.3: 修改 device_name 不会重写历史 op 的 operator_name。
 *
 * @param {string} name
 * @returns {Promise<void>}
 */
export async function setDeviceName(name) {
  if (name === null || name === undefined || String(name).length === 0) {
    await removePref(KEY_DEVICE_NAME);
    return;
  }
  await setPref(KEY_DEVICE_NAME, String(name));
}

/**
 * 重置设备身份：清空 device_id + device_name + operation queue。
 *
 * R16.4: 用户必须显式确认，调用方负责拦截。
 *
 * @returns {Promise<void>}
 */
export async function resetDeviceIdentity() {
  await removePref(KEY_DEVICE_ID);
  await removePref(KEY_DEVICE_NAME);
  // 动态 import 避免循环依赖
  try {
    const mod = await import("./operation-queue.js");
    if (typeof mod.clearQueue === "function") {
      await mod.clearQueue();
    }
  } catch {
    // 操作队列模块不存在时（测试环境）忽略
  }
}
