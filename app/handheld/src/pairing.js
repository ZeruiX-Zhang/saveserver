// app/handheld/src/pairing.js
//
// 配对：表单提交 + 二维码扫描。
//
// 流程：
//   1. 校验 apiBase / syncToken / deviceName
//   2. fetch GET ${apiBase}/api/sync/ping with X-Sync-Token
//   3. 200 → 持久化 prefs；ensureDeviceId
//   4. 401 → 抛 PairingError("令牌无效")
//   5. 网络错误 → 抛 PairingError(原因)
//
// Validates: Requirements 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9

import { setPref } from "./storage-prefs.js";
import { getOrCreateDeviceId, setDeviceName } from "./device-identity.js";
import { scanOnce } from "./scanner-native.js";
import { validatePairingQr } from "../shared/package-builder.js";
import { log } from "./logger.js";

export class PairingError extends Error {
  constructor(message) {
    super(message);
    this.name = "PairingError";
  }
}

function normalizeApiBase(raw) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return "";
  if (!/^https?:\/\//i.test(trimmed)) return "";
  return trimmed.replace(/\/+$/, "");
}

/**
 * 启动配对流程。
 *
 * @param {{ apiBaseRaw: string, syncTokenRaw: string, deviceName: string }} input
 * @returns {Promise<{ ok: true, apiBase: string, deviceId: string }>}
 * @throws {PairingError}
 */
export async function startPairing(input) {
  const apiBase = normalizeApiBase(input?.apiBaseRaw);
  const syncToken = String(input?.syncTokenRaw ?? "").trim();
  const deviceName = String(input?.deviceName ?? "").trim();

  if (!apiBase) {
    throw new PairingError("服务器地址必须以 http:// 或 https:// 开头");
  }
  if (!syncToken) {
    throw new PairingError("Sync Token 不能为空");
  }
  if (!deviceName) {
    throw new PairingError("设备名称不能为空");
  }

  let response;
  try {
    response = await fetch(`${apiBase}/api/sync/ping`, {
      method: "GET",
      headers: { "X-Sync-Token": syncToken },
      redirect: "manual",
    });
  } catch (err) {
    throw new PairingError(`无法连接服务器：${err?.message || err}`);
  }

  if (response.status === 401) {
    throw new PairingError("令牌无效");
  }
  if (!response.ok) {
    throw new PairingError(`配对失败：状态码 ${response.status}`);
  }

  await setPref("apiBase", apiBase);
  await setPref("sync_token", syncToken);
  await setDeviceName(deviceName);
  const deviceId = await getOrCreateDeviceId();
  log("info", "pairing", "ok", { apiBase, deviceId });
  return { ok: true, apiBase, deviceId };
}

/**
 * 扫描配对二维码，解析后返回 `{ apiBase, syncToken }`。
 * 用户取消返回 null。
 *
 * @returns {Promise<{ apiBase: string, syncToken: string } | null>}
 */
export async function scanPairingQr() {
  const text = await scanOnce({ hint: "请将配对二维码对准取景框" });
  if (text === null) return null;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("二维码内容不是 JSON");
  }
  const r = validatePairingQr(parsed);
  if (!r.ok) {
    throw new Error(r.reason || "二维码格式无效");
  }
  return { apiBase: r.value.apiBase, syncToken: r.value.syncToken };
}
