// app/handheld/src/storage-fs.js
//
// `@capacitor/filesystem` 的轻量封装，用于读写大于 Preferences 限额的文件
// （主数据 / 操作队列 / 待同步产品 / 图片 / 日志）。
//
// 基础路径：`Documents/warehouse-handheld/`，所有 `relPath` 都是相对该目录。
//
// 在非原生环境（桌面浏览器预览 / Node 测试）下，回退到 `localStorage` 模拟
// 一个退化的 FS（key 形如 `fs:<relPath>`）。回退实现**不是原子的**，仅供
// 测试与预览，绝不应在生产 APK 中走到。

const BASE_DIR = "warehouse-handheld";
const DIRECTORY = "DOCUMENTS";
const ENCODING_UTF8 = "utf8";

const FS_FALLBACK_KEY_PREFIX = "fs:";

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

function pluginOrNull() {
  try {
    return window?.Capacitor?.Plugins?.Filesystem ?? null;
  } catch {
    return null;
  }
}

function joinPath(relPath) {
  const clean = String(relPath || "").replace(/^\/+/, "");
  return `${BASE_DIR}/${clean}`;
}

function fallbackStorage() {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // ignore
  }
  if (!globalThis.__handheldFsMem) {
    globalThis.__handheldFsMem = new Map();
  }
  const mem = globalThis.__handheldFsMem;
  return {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
    keyExists: (k) => mem.has(k),
  };
}

function fbKey(relPath) {
  return FS_FALLBACK_KEY_PREFIX + joinPath(relPath);
}

/**
 * 读 JSON 文件；缺失或解析失败返回 null。
 *
 * @param {string} relPath
 * @returns {Promise<any | null>}
 */
export async function readJsonFile(relPath) {
  const text = await readTextFile(relPath);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * 原子写 JSON 文件：先写 `<path>.tmp`，再 rename 到目标。
 * rename 失败时尝试删除 .tmp 并重抛错误。
 *
 * @param {string} relPath
 * @param {any} obj
 * @returns {Promise<void>}
 */
export async function writeJsonFileAtomic(relPath, obj) {
  const data = JSON.stringify(obj);
  const target = joinPath(relPath);
  const tmp = `${target}.tmp`;

  if (isNative()) {
    const plugin = pluginOrNull();
    if (plugin && typeof plugin.writeFile === "function") {
      try {
        await plugin.writeFile({
          path: tmp,
          data,
          directory: DIRECTORY,
          encoding: ENCODING_UTF8,
          recursive: true,
        });
      } catch (err) {
        throw new Error(`写入临时文件失败: ${err?.message || err}`);
      }
      try {
        if (typeof plugin.rename === "function") {
          await plugin.rename({
            from: tmp,
            to: target,
            directory: DIRECTORY,
            toDirectory: DIRECTORY,
          });
        } else {
          // 不支持 rename：直接覆盖写入目标，删除临时
          await plugin.writeFile({
            path: target,
            data,
            directory: DIRECTORY,
            encoding: ENCODING_UTF8,
            recursive: true,
          });
          await plugin.deleteFile({ path: tmp, directory: DIRECTORY }).catch(() => {});
        }
      } catch (err) {
        // 尝试清理 .tmp
        try {
          await plugin.deleteFile({ path: tmp, directory: DIRECTORY });
        } catch {
          // ignore
        }
        throw new Error(`写入文件失败: ${err?.message || err}`);
      }
      return;
    }
  }

  const storage = fallbackStorage();
  storage.setItem(fbKey(relPath), data);
}

/**
 * 读取一个 UTF-8 文本文件；缺失返回 null。
 *
 * @param {string} relPath
 * @returns {Promise<string | null>}
 */
export async function readTextFile(relPath) {
  const target = joinPath(relPath);
  if (isNative()) {
    const plugin = pluginOrNull();
    if (plugin && typeof plugin.readFile === "function") {
      try {
        const result = await plugin.readFile({
          path: target,
          directory: DIRECTORY,
          encoding: ENCODING_UTF8,
        });
        const data = result?.data;
        if (typeof data === "string") return data;
        return data == null ? null : String(data);
      } catch {
        return null;
      }
    }
  }
  const storage = fallbackStorage();
  const v = storage.getItem(fbKey(relPath));
  return v === null || v === undefined ? null : String(v);
}

/**
 * 追加 UTF-8 文本到文件末尾。
 *
 * @param {string} relPath
 * @param {string} text
 * @returns {Promise<void>}
 */
export async function appendTextFile(relPath, text) {
  const target = joinPath(relPath);
  if (isNative()) {
    const plugin = pluginOrNull();
    if (plugin && typeof plugin.appendFile === "function") {
      try {
        await plugin.appendFile({
          path: target,
          data: String(text ?? ""),
          directory: DIRECTORY,
          encoding: ENCODING_UTF8,
          recursive: true,
        });
        return;
      } catch {
        // fall through to fallback
      }
    }
  }
  const storage = fallbackStorage();
  const prev = storage.getItem(fbKey(relPath)) ?? "";
  storage.setItem(fbKey(relPath), prev + String(text ?? ""));
}

/**
 * 文件是否存在。
 *
 * @param {string} relPath
 * @returns {Promise<boolean>}
 */
export async function fileExists(relPath) {
  const target = joinPath(relPath);
  if (isNative()) {
    const plugin = pluginOrNull();
    if (plugin && typeof plugin.stat === "function") {
      try {
        await plugin.stat({ path: target, directory: DIRECTORY });
        return true;
      } catch {
        return false;
      }
    }
  }
  const storage = fallbackStorage();
  // localStorage doesn't have hasOwnProperty cleanly, use getItem !== null
  return storage.getItem(fbKey(relPath)) !== null;
}

/**
 * 获取文件大小（字节）；缺失或失败返回 0。
 *
 * @param {string} relPath
 * @returns {Promise<number>}
 */
export async function fileSize(relPath) {
  const target = joinPath(relPath);
  if (isNative()) {
    const plugin = pluginOrNull();
    if (plugin && typeof plugin.stat === "function") {
      try {
        const r = await plugin.stat({ path: target, directory: DIRECTORY });
        const sz = Number(r?.size);
        return Number.isFinite(sz) ? sz : 0;
      } catch {
        return 0;
      }
    }
  }
  const storage = fallbackStorage();
  const v = storage.getItem(fbKey(relPath));
  return v === null || v === undefined ? 0 : new TextEncoder().encode(String(v)).length;
}

/**
 * 删除文件；不存在不报错。
 *
 * @param {string} relPath
 * @returns {Promise<void>}
 */
export async function removeFile(relPath) {
  const target = joinPath(relPath);
  if (isNative()) {
    const plugin = pluginOrNull();
    if (plugin && typeof plugin.deleteFile === "function") {
      try {
        await plugin.deleteFile({ path: target, directory: DIRECTORY });
      } catch {
        // ignore — treat as already-missing
      }
      return;
    }
  }
  const storage = fallbackStorage();
  storage.removeItem(fbKey(relPath));
}

/**
 * 重命名文件（覆盖式）。
 *
 * @param {string} fromRel
 * @param {string} toRel
 * @returns {Promise<void>}
 */
export async function renameFile(fromRel, toRel) {
  if (isNative()) {
    const plugin = pluginOrNull();
    if (plugin && typeof plugin.rename === "function") {
      await plugin.rename({
        from: joinPath(fromRel),
        to: joinPath(toRel),
        directory: DIRECTORY,
        toDirectory: DIRECTORY,
      });
      return;
    }
  }
  const storage = fallbackStorage();
  const v = storage.getItem(fbKey(fromRel));
  if (v !== null && v !== undefined) {
    storage.setItem(fbKey(toRel), v);
    storage.removeItem(fbKey(fromRel));
  }
}

/**
 * 写入 base64 二进制文件（不做任何 base64 处理，写原值）。
 *
 * @param {string} relPath
 * @param {string} base64
 * @returns {Promise<void>}
 */
export async function writeBase64(relPath, base64) {
  const target = joinPath(relPath);
  if (isNative()) {
    const plugin = pluginOrNull();
    if (plugin && typeof plugin.writeFile === "function") {
      await plugin.writeFile({
        path: target,
        data: String(base64 ?? ""),
        directory: DIRECTORY,
        recursive: true,
      });
      return;
    }
  }
  const storage = fallbackStorage();
  storage.setItem(fbKey(relPath), `data:base64,${String(base64 ?? "")}`);
}

/**
 * 读取 base64 二进制文件，返回 base64 字符串；缺失返回 null。
 *
 * @param {string} relPath
 * @returns {Promise<string | null>}
 */
export async function readBase64(relPath) {
  const target = joinPath(relPath);
  if (isNative()) {
    const plugin = pluginOrNull();
    if (plugin && typeof plugin.readFile === "function") {
      try {
        const r = await plugin.readFile({ path: target, directory: DIRECTORY });
        return typeof r?.data === "string" ? r.data : null;
      } catch {
        return null;
      }
    }
  }
  const storage = fallbackStorage();
  const v = storage.getItem(fbKey(relPath));
  if (typeof v === "string" && v.startsWith("data:base64,")) {
    return v.slice("data:base64,".length);
  }
  return null;
}

export const _internals = {
  BASE_DIR,
  DIRECTORY,
  joinPath,
};
