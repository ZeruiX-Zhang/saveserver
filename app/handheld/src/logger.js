// app/handheld/src/logger.js
//
// 1MB 循环日志：写到 `Documents/warehouse-handheld/log.txt`。
// 当文件 ≥ 1 MB，rename 为 `log.txt.1`（覆盖旧 .1）后重置；丢失最旧 1 MB 数据。
//
// 内存队列：避免每次 log 都触发文件 IO；按 1 秒周期或 buffer ≥ 64KB 触发刷写。
// 错误级别立即刷写。
//
// Validates: Requirement 15.6

import {
  appendTextFile,
  fileSize,
  fileExists,
  removeFile,
  renameFile,
  readTextFile,
  writeJsonFileAtomic,
} from "./storage-fs.js";

const LOG_FILE = "log.txt";
const LOG_FILE_1 = "log.txt.1";
const MAX_BYTES = 1_000_000; // 1 MB
const FLUSH_INTERVAL_MS = 1000;
const FLUSH_BYTES = 64 * 1024;

const queue = [];
let queueBytes = 0;
let flushing = false;
let flushTimer = null;

/**
 * 单行 JSON 日志记录。
 *
 * @param {"info" | "warn" | "error"} level
 * @param {string} module
 * @param {string} message
 * @param {object} [context]
 */
export function log(level, module, message, context) {
  let line;
  try {
    line =
      JSON.stringify({
        ts: new Date().toISOString(),
        level: String(level || "info"),
        module: String(module || ""),
        message: String(message ?? ""),
        context: context ?? null,
      }) + "\n";
  } catch {
    line =
      JSON.stringify({
        ts: new Date().toISOString(),
        level: String(level || "info"),
        module: String(module || ""),
        message: String(message ?? ""),
        context: "[unserializable]",
      }) + "\n";
  }
  queue.push(line);
  queueBytes += line.length;

  if (level === "error" || queueBytes >= FLUSH_BYTES) {
    // 立即尝试刷写（不等待计时器）
    void flush();
  } else {
    scheduleFlush();
  }
}

function scheduleFlush() {
  if (flushTimer) return;
  if (typeof setTimeout !== "function") return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, FLUSH_INTERVAL_MS);
}

/**
 * 把内存队列写到磁盘并执行 1 MB rotate。
 *
 * @returns {Promise<void>}
 */
export async function flush() {
  if (flushing) return;
  if (queue.length === 0) return;
  flushing = true;
  const batch = queue.splice(0, queue.length);
  queueBytes = 0;
  const text = batch.join("");
  try {
    await appendTextFile(LOG_FILE, text);
    const size = await fileSize(LOG_FILE);
    if (size >= MAX_BYTES) {
      await rotate();
    }
  } catch {
    // 写盘失败：日志数据丢失。这里不重新塞回 queue，以避免无限堆积。
    // 调用方仍可通过 console 看到原始错误。
  } finally {
    flushing = false;
  }
}

async function rotate() {
  try {
    if (await fileExists(LOG_FILE_1)) {
      await removeFile(LOG_FILE_1);
    }
  } catch {
    // ignore
  }
  try {
    await renameFile(LOG_FILE, LOG_FILE_1);
  } catch {
    // 退化路径：尝试直接清空当前 log.txt
    try {
      await removeFile(LOG_FILE);
    } catch {
      // ignore
    }
  }
}

/**
 * 注册定时刷写。在 main.js 启动时调用一次。
 *
 * @returns {() => void} 取消注册函数
 */
export function startBackgroundFlush() {
  if (typeof setInterval !== "function") return () => {};
  const id = setInterval(() => {
    void flush();
  }, FLUSH_INTERVAL_MS);
  return () => {
    if (typeof clearInterval === "function") clearInterval(id);
  };
}

/**
 * 把 log.txt + log.txt.1 合并写到 log-export-<ts>.txt，返回新文件相对路径。
 *
 * @returns {Promise<string>}
 */
export async function exportLogs() {
  await flush();
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const out = `log-export-${ts}.txt`;
  const older = (await readTextFile(LOG_FILE_1)) ?? "";
  const newer = (await readTextFile(LOG_FILE)) ?? "";
  await writeJsonFileAtomicAsText(out, older + newer);
  return out;
}

// 用于把纯文本写入文件（沿用 writeJsonFileAtomic 的原子语义）
async function writeJsonFileAtomicAsText(relPath, text) {
  // writeJsonFileAtomic 期望 obj，先转纯字符串包装：调用者将其作为 string 直接 stringify
  // 这里改为：直接调用 storage-fs 的 native writeFile 路径——但为了简单性，
  // 用一次 JSON.stringify 加一次 JSON.parse 不可行（会包引号）。所以直接调用底层。
  const { _internals } = await import("./storage-fs.js");
  // 我们没有直接暴露 raw write，因此走 appendTextFile 到一个新文件路径
  // 但 appendTextFile 是追加模式；先 remove 再 append 实现 overwrite
  await removeFile(relPath);
  await appendTextFile(relPath, text);
  void _internals; // suppress unused
}

export const _internals = {
  LOG_FILE,
  LOG_FILE_1,
  MAX_BYTES,
};
