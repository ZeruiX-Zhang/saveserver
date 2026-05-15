// Remote-mode configuration. Stored in localStorage so the PWA "install to
// home screen" preserves it across restarts. Empty base = "use this origin",
// which is how the desktop browser uses it.

const LS_KEY_BASE = "warehouse:apiBase";
const LS_KEY_TOKEN = "warehouse:syncToken";

function read(key) {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function write(key, value) {
  try {
    if (value) {
      localStorage.setItem(key, value);
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    // localStorage may be unavailable (private mode, embedded webview).
    // Silently no-op; remote mode just won't persist.
  }
}

function normalizeBase(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  // Strip trailing slashes so we can join with "/api/..." safely.
  return trimmed.replace(/\/+$/, "");
}

export function getApiBase() {
  return normalizeBase(read(LS_KEY_BASE));
}

export function setApiBase(value) {
  write(LS_KEY_BASE, normalizeBase(value));
}

export function getSyncToken() {
  return read(LS_KEY_TOKEN).trim();
}

export function setSyncToken(value) {
  write(LS_KEY_TOKEN, String(value || "").trim());
}

export function isRemoteMode() {
  return getApiBase().length > 0;
}

export function clearRemoteConfig() {
  setApiBase("");
  setSyncToken("");
}

export function buildAuthHeaders(extra = {}) {
  const headers = { ...extra };
  const token = getSyncToken();
  if (token) {
    headers["X-Sync-Token"] = token;
  }
  return headers;
}

export function apiUrl(pathSegment) {
  const base = getApiBase();
  if (!pathSegment.startsWith("/")) {
    pathSegment = `/${pathSegment}`;
  }
  return `${base}${pathSegment}`;
}

export async function pingRemote(baseRaw, tokenRaw) {
  const base = normalizeBase(baseRaw);
  const token = String(tokenRaw || "").trim();
  if (!base) {
    throw new Error("服务器地址不能为空");
  }
  const headers = {};
  if (token) {
    headers["X-Sync-Token"] = token;
  }
  let response;
  try {
    response = await fetch(`${base}/api/sync/ping`, { headers });
  } catch (error) {
    throw new Error(`无法连接服务器：${error.message || error}`);
  }
  if (response.status === 401) {
    throw new Error("令牌无效或缺失");
  }
  if (!response.ok) {
    throw new Error(`服务器返回 ${response.status}`);
  }
  return response.json();
}
