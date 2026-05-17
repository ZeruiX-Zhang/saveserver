// app/shared/package-builder.js
//
// `Operation_Package` 构造与 Pairing QR 校验。
//
// 该模块是纯 ES Module，不依赖 DOM / Capacitor / 文件系统，可同时在 Node.js
// （属性测试 / 服务端兼容测试）与 Android WebView（手持端 Bundle）下运行。
//
// 仅可从 `app/shared/*` 内部 import；不引入任何外部依赖。
//
// Validates: Requirements 1.3, 12.1, 13.2, 15.4, 18.2

// 默认 UUID v4 生成器：优先用平台 `crypto.randomUUID`（Node 18+/现代浏览器/
// Android WebView 均提供）。属性测试可以通过依赖注入传入确定性 idGen。
function defaultIdGen() {
  if (typeof globalThis !== "undefined" && globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  throw new Error("crypto.randomUUID is not available; please inject idGen explicitly");
}

/**
 * 构造一个 `Operation_Package`（design §Data Models）。
 *
 * @param {object} input
 * @param {string} input.deviceId            设备 UUID（非空字符串）
 * @param {string} input.deviceName          设备名称（非空字符串）
 * @param {Array}  input.operations          已构造好的 Operation 列表（非空数组）
 * @param {string|null|undefined} [input.baseMasterPackageId]
 *                                           对应 master 包 ID；缺省为 null
 * @param {object} [deps]
 * @param {() => number} [deps.now]          时钟（默认 Date.now）
 * @param {() => string} [deps.idGen]        UUID v4 生成器（默认 crypto.randomUUID）
 * @returns {object} Operation_Package 形状对象
 */
export function buildOperationPackage(
  { deviceId, deviceName, operations, baseMasterPackageId } = {},
  { now = Date.now, idGen = defaultIdGen } = {},
) {
  if (typeof deviceId !== "string" || deviceId.length === 0) {
    throw new Error("deviceId 必须是非空字符串");
  }
  if (typeof deviceName !== "string" || deviceName.length === 0) {
    throw new Error("deviceName 必须是非空字符串");
  }
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new Error("operations 必须是非空数组");
  }

  const exportedAt = new Date(now()).toISOString();
  const packageId = idGen();

  return {
    package_type: "operations",
    package_id: packageId,
    package_version: 1,
    device_id: deviceId,
    device_name: deviceName,
    exported_at: exportedAt,
    base_master_package_id: baseMasterPackageId ?? null,
    // 浅拷贝；调用方负责 operations 自身的不可变性。深拷贝由序列化阶段处理。
    operations: [...operations],
  };
}

/**
 * 校验配对二维码已经 JSON.parse 后的对象。
 *
 * 校验顺序（任一步骤失败立刻返回）：
 *   1. value 是普通对象（非 null / 非数组 / typeof === "object"）
 *   2. value.v === 1
 *   3. value.apiBase 是非空字符串且以 "http://" 或 "https://" 开头
 *   4. value.syncToken 是非空字符串（trim 后长度 > 0）
 *
 * @param {unknown} value JSON.parse 之后的任意输入
 * @returns {{ ok: true, value: { v: 1, apiBase: string, syncToken: string } }
 *         | { ok: false, reason: string }}
 */
export function validatePairingQr(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, reason: "配对内容必须是 JSON 对象" };
  }

  if (value.v !== 1) {
    return { ok: false, reason: "配对版本不支持" };
  }

  const apiBase = value.apiBase;
  if (
    typeof apiBase !== "string" ||
    apiBase.length === 0 ||
    !(apiBase.startsWith("http://") || apiBase.startsWith("https://"))
  ) {
    return { ok: false, reason: "apiBase 格式无效，必须以 http(s):// 开头" };
  }

  const syncToken = value.syncToken;
  if (typeof syncToken !== "string" || syncToken.trim().length === 0) {
    return { ok: false, reason: "syncToken 不能为空" };
  }

  return {
    ok: true,
    value: { v: 1, apiBase, syncToken },
  };
}
