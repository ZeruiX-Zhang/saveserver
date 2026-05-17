// app/handheld/src/storage-prefs.js
//
// `@capacitor/preferences` 的轻量封装。
//
// Capacitor 8 在 WebView 中通过 `window.Capacitor.Plugins.Preferences` 注入
// 插件实例，所有方法返回 Promise。该模块对非原生环境（桌面浏览器预览 / Node
// 测试）有 localStorage 后备实现。
//
// 仅装小 KV：
//   apiBase, sync_token, device_id, device_name,
//   last_master_sync_at, base_master_package_id

const PREFS_FALLBACK_KEY_PREFIX = "handheld:";

/**
 * 检测当前是否运行在 Capacitor Native 平台（Android / iOS WebView）。
 *
 * @returns {boolean}
 */
function isNative() {
  try {
    return Boolean(
      typeof window !== "undefined" &&
        window.Capacitor &&
        typeof window.Capacitor.isNativePlatform === "function" &&
        window.Capacitor.isNativePlatform(),
    );
  } catch {
    return false;
  }
}

/**
 * 获取 Preferences 插件实例；如未注入返回 null。
 *
 * @returns {{ get: (...a: any[]) => Promise<any>, set: (...a: any[]) => Promise<any>, remove: (...a: any[]) => Promise<any>, clear?: (...a: any[]) => Promise<any>, keys?: (...a: any[]) => Promise<any> } | null}
 */
function pluginOrNull() {
  try {
    return window?.Capacitor?.Plugins?.Preferences ?? null;
  } catch {
    return null;
  }
}

function fallbackStorage() {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // ignore
  }
  // Node test fallback: in-memory map
  if (!globalThis.__handheldPrefsMem) {
    globalThis.__handheldPrefsMem = new Map();
  }
  const mem = globalThis.__handheldPrefsMem;
  return {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  };
}

function fallbackKey(key) {
  return PREFS_FALLBACK_KEY_PREFIX + String(key);
}

/**
 * 读取一个 string 值；缺失返回 null。
 *
 * @param {string} key
 * @returns {Promise<string | null>}
 */
export async function getPref(key) {
  if (!key) return null;
  const native = isNative();
  const plugin = pluginOrNull();
  if (native && plugin && typeof plugin.get === "function") {
    try {
      const result = await plugin.get({ key });
      const value = result?.value;
      return typeof value === "string" ? value : null;
    } catch {
      return null;
    }
  }
  const storage = fallbackStorage();
  const v = storage.getItem(fallbackKey(key));
  return v === null || v === undefined ? null : String(v);
}

/**
 * 写入一个 string 值。null/undefined 会触发 remove。
 *
 * @param {string} key
 * @param {string | null | undefined} value
 * @returns {Promise<void>}
 */
export async function setPref(key, value) {
  if (!key) return;
  if (value === null || value === undefined) {
    await removePref(key);
    return;
  }
  const v = String(value);
  const plugin = pluginOrNull();
  if (isNative() && plugin && typeof plugin.set === "function") {
    try {
      await plugin.set({ key, value: v });
      return;
    } catch {
      // fall through to fallback
    }
  }
  const storage = fallbackStorage();
  storage.setItem(fallbackKey(key), v);
}

/**
 * 删除某个 key。
 *
 * @param {string} key
 * @returns {Promise<void>}
 */
export async function removePref(key) {
  if (!key) return;
  const plugin = pluginOrNull();
  if (isNative() && plugin && typeof plugin.remove === "function") {
    try {
      await plugin.remove({ key });
      return;
    } catch {
      // fall through to fallback
    }
  }
  const storage = fallbackStorage();
  storage.removeItem(fallbackKey(key));
}

/**
 * 读取一个 JSON 值；解析失败或缺失返回 null。
 *
 * @param {string} key
 * @returns {Promise<any | null>}
 */
export async function getJsonPref(key) {
  const raw = await getPref(key);
  if (raw === null || raw === undefined) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * 写入一个 JSON 值。
 *
 * @param {string} key
 * @param {any} obj
 * @returns {Promise<void>}
 */
export async function setJsonPref(key, obj) {
  if (obj === null || obj === undefined) {
    await removePref(key);
    return;
  }
  await setPref(key, JSON.stringify(obj));
}
