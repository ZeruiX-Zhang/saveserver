// app/handheld/src/permissions.js
//
// Camera + Filesystem 权限助手。
//
// Capacitor 8 在 WebView 中通过 `window.Capacitor.Plugins` 注入插件实例。
// 在桌面浏览器预览 / Node 测试环境下，这些插件不存在；helper 退化为
// `navigator.mediaDevices` 检测或直接放行（own-app storage 不需要运行时权限）。

/**
 * 摄像头权限：返回 `{ granted, reason }`。
 *
 * native：调用 `Camera.checkPermissions` → 如未授予 `requestPermissions`。
 * web：检测 navigator.mediaDevices；如存在视为 granted（运行时由浏览器提示）。
 *
 * @returns {Promise<{ granted: boolean, reason: string | null }>}
 */
export async function ensureCameraPermission() {
  const Camera = window?.Capacitor?.Plugins?.Camera ?? null;

  if (!Camera) {
    const hasMedia = Boolean(
      typeof navigator !== "undefined" &&
        navigator.mediaDevices &&
        typeof navigator.mediaDevices.getUserMedia === "function",
    );
    return {
      granted: hasMedia,
      reason: hasMedia ? null : "当前环境不支持摄像头",
    };
  }

  try {
    const status = await Camera.checkPermissions();
    if (status?.camera === "granted") {
      return { granted: true, reason: null };
    }
    if (status?.camera === "denied") {
      // 已经被永久拒绝，由 UI 引导用户去系统设置开启
      return { granted: false, reason: "摄像头权限已被拒绝，请到系统设置开启" };
    }
    // prompt / prompt-with-rationale → 显式申请
    const requested = await Camera.requestPermissions({
      permissions: ["camera"],
    });
    if (requested?.camera === "granted") {
      return { granted: true, reason: null };
    }
    return {
      granted: false,
      reason: "需要授予摄像头权限才能扫码",
    };
  } catch (err) {
    return {
      granted: false,
      reason: `检查摄像头权限失败：${err?.message || err}`,
    };
  }
}

/**
 * 存储权限。Capacitor Filesystem 写入应用自有 `Documents/` 目录在 Android
 * 上不需要运行时权限（API 33+ 也是如此），直接放行。
 *
 * 该函数留作未来 Android 33+ 媒体权限的扩展点。
 *
 * @returns {Promise<{ granted: boolean, reason: string | null }>}
 */
export async function ensureStoragePermission() {
  return { granted: true, reason: null };
}
