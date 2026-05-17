// app/handheld/src/upload-lan.js
//
// LAN HTTP 上传：POST {apiBase}/api/sync/upload。
//
// 单例上传锁防止并发：模块级 `uploading` 标志位。
//
// 状态分发：
//   - 200 + 可解析响应 → operationsFailed[].operationId 优先，剩余的按
//     operationsSkippedDuplicate 数量从前往后标记 duplicate，再剩余的标 imported
//   - 200 但无法解析 → 同网络错误（保留业务字段，attempt_count++、attempted）
//   - 401 → 抛 PairingError
//   - 其它非 200 → 抛 NetworkError
//   - fetch 失败 → 抛 NetworkError
//
// Validates: Requirements 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8, 12.9

import { getPref } from "./storage-prefs.js";
import { OP_STATES, markOperations } from "./operation-queue.js";
import { log } from "./logger.js";

let uploading = false;

export class PairingError extends Error {
  constructor(message) {
    super(message);
    this.name = "PairingError";
  }
}

export class NetworkError extends Error {
  constructor(message) {
    super(message);
    this.name = "NetworkError";
  }
}

/**
 * 是否正在上传。
 *
 * @returns {boolean}
 */
export function isUploading() {
  return uploading;
}

/**
 * 上传一个 Operation_Package 到服务端。
 *
 * @param {object} pkg
 * @returns {Promise<{
 *   ok: true,
 *   packageId: string,
 *   imported: string[],
 *   duplicate: string[],
 *   failed: Array<{ operationId: string, reason: string }>,
 *   appliedStores: Record<string, number>,
 * }>}
 */
export async function uploadOperationPackage(pkg) {
  if (!pkg || typeof pkg !== "object" || !Array.isArray(pkg.operations)) {
    throw new TypeError("无效的 Operation_Package");
  }
  if (uploading) {
    throw new Error("已有上传任务正在进行中");
  }
  uploading = true;
  const attemptedAt = new Date().toISOString();
  // 先把所有 op 标记为 attempted + attempt_count++
  await markOperations(
    pkg.operations.map((op) => ({
      operationId: op.operation_id,
      state: OP_STATES.ATTEMPTED,
      attemptedAt,
      incAttempt: true,
    })),
  );

  try {
    const apiBase = (await getPref("apiBase")) || "";
    const syncToken = (await getPref("sync_token")) || "";
    if (!apiBase) {
      throw new NetworkError("尚未配对：缺少服务器地址");
    }
    const url = `${apiBase.replace(/\/+$/, "")}/api/sync/upload`;

    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Sync-Token": syncToken,
        },
        body: JSON.stringify(pkg),
      });
    } catch (err) {
      log("error", "upload-lan", "fetch failed", { message: String(err?.message || err) });
      throw new NetworkError(String(err?.message || err));
    }

    if (response.status === 401) {
      throw new PairingError("令牌无效，请重新配对");
    }
    if (!response.ok) {
      throw new NetworkError(`服务端响应状态码：${response.status}`);
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new NetworkError("服务端响应无法解析");
    }

    if (!payload || typeof payload !== "object") {
      throw new NetworkError("服务端响应无法解析");
    }

    const operationsFailed = Array.isArray(payload.operationsFailed)
      ? payload.operationsFailed
      : [];
    const operationsSkippedDuplicate =
      Number(payload.operationsSkippedDuplicate) || 0;
    const failedSet = new Set(
      operationsFailed
        .map((f) => (f && typeof f.operationId === "string" ? f.operationId : null))
        .filter(Boolean),
    );

    const imported = [];
    const duplicate = [];
    const failed = [];
    let dupRemaining = operationsSkippedDuplicate;

    const updates = [];
    for (const op of pkg.operations) {
      const id = op.operation_id;
      if (failedSet.has(id)) {
        const fr = operationsFailed.find((f) => f && f.operationId === id);
        const reason = (fr && fr.reason) || "未知错误";
        failed.push({ operationId: id, reason });
        updates.push({
          operationId: id,
          state: OP_STATES.FAILED,
          failureReason: reason,
        });
      } else if (dupRemaining > 0) {
        dupRemaining -= 1;
        duplicate.push(id);
        updates.push({
          operationId: id,
          state: OP_STATES.DUPLICATE,
          failureReason: null,
        });
      } else {
        imported.push(id);
        updates.push({
          operationId: id,
          state: OP_STATES.IMPORTED,
          failureReason: null,
        });
      }
    }
    await markOperations(updates);

    log("info", "upload-lan", "uploaded", {
      packageId: pkg.package_id,
      imported: imported.length,
      duplicate: duplicate.length,
      failed: failed.length,
    });

    return {
      ok: true,
      packageId: pkg.package_id,
      imported,
      duplicate,
      failed,
      appliedStores: payload.applied || {},
    };
  } finally {
    uploading = false;
  }
}
