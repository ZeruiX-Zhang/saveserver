// app/handheld/src/router.js
//
// 极简 hash 路由。所有路由：
//   #/pairing
//   #/home
//   #/master-sync
//   #/product/:id
//   #/op/:type
//   #/scan-put-in
//   #/new-product
//   #/queue
//   #/upload-result/:packageId
//   #/settings
//
// 不依赖 DOM；可在 Node 下纯函数测试 `parseRoute` / `decideInitialRoute`。

const ROUTES = [
  { name: "pairing", pattern: /^#\/pairing\/?$/, params: [] },
  { name: "home", pattern: /^#\/home\/?$/, params: [] },
  { name: "master-sync", pattern: /^#\/master-sync\/?$/, params: [] },
  { name: "product", pattern: /^#\/product\/([^/]+)\/?$/, params: ["id"] },
  { name: "op", pattern: /^#\/op\/([^/?]+)\/?(\?.*)?$/, params: ["type"] },
  { name: "scan-put-in", pattern: /^#\/scan-put-in\/?$/, params: [] },
  { name: "new-product", pattern: /^#\/new-product\/?$/, params: [] },
  { name: "queue", pattern: /^#\/queue\/?$/, params: [] },
  {
    name: "upload-result",
    pattern: /^#\/upload-result\/([^/]+)\/?$/,
    params: ["packageId"],
  },
  { name: "settings", pattern: /^#\/settings\/?$/, params: [] },
];

const PROTECTED_ROUTES = new Set([
  "product",
  "op",
  "scan-put-in",
  "new-product",
  "queue",
]);

/**
 * 解析一个 hash 字符串（含或不含 `#` 前缀）。
 *
 * @param {string} hash
 * @returns {{ name: string, params: Record<string, string>, query: Record<string, string> }}
 */
export function parseRoute(hash) {
  let h = String(hash || "");
  if (h.length > 0 && !h.startsWith("#")) {
    h = "#" + h;
  }
  if (h === "" || h === "#" || h === "#/" || h === "#") {
    return { name: "home", params: {}, query: {} };
  }
  // 分离 query
  let queryString = "";
  const qIdx = h.indexOf("?");
  if (qIdx >= 0) {
    queryString = h.slice(qIdx + 1);
    h = h.slice(0, qIdx);
  }
  const query = {};
  if (queryString) {
    for (const pair of queryString.split("&")) {
      if (!pair) continue;
      const eq = pair.indexOf("=");
      if (eq >= 0) {
        query[decodeURIComponent(pair.slice(0, eq))] = decodeURIComponent(
          pair.slice(eq + 1),
        );
      } else {
        query[decodeURIComponent(pair)] = "";
      }
    }
  }
  for (const route of ROUTES) {
    const m = h.match(route.pattern);
    if (m) {
      const params = {};
      route.params.forEach((p, i) => {
        params[p] = decodeURIComponent(m[i + 1] || "");
      });
      return { name: route.name, params, query };
    }
  }
  return { name: "home", params: {}, query };
}

/**
 * 构造一个 hash 字符串。
 *
 * @param {string} name
 * @param {Record<string, string>} [params]
 * @param {Record<string, string>} [query]
 * @returns {string}
 */
export function buildHash(name, params = {}, query = {}) {
  let path;
  switch (name) {
    case "pairing":
      path = "#/pairing";
      break;
    case "home":
      path = "#/home";
      break;
    case "master-sync":
      path = "#/master-sync";
      break;
    case "product":
      path = `#/product/${encodeURIComponent(params.id || "")}`;
      break;
    case "op":
      path = `#/op/${encodeURIComponent(params.type || "")}`;
      break;
    case "scan-put-in":
      path = "#/scan-put-in";
      break;
    case "new-product":
      path = "#/new-product";
      break;
    case "queue":
      path = "#/queue";
      break;
    case "upload-result":
      path = `#/upload-result/${encodeURIComponent(params.packageId || "")}`;
      break;
    case "settings":
      path = "#/settings";
      break;
    default:
      path = "#/home";
  }
  const qs = Object.keys(query || {})
    .map(
      (k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k] ?? "")}`,
    )
    .join("&");
  return qs ? `${path}?${qs}` : path;
}

/**
 * 设置 location.hash 跳转。
 *
 * @param {string} name
 * @param {Record<string, string>} [params]
 * @param {Record<string, string>} [query]
 */
export function navigate(name, params = {}, query = {}) {
  const hash = buildHash(name, params, query);
  if (typeof window === "undefined") return;
  if (window.location.hash === hash) {
    // 同 hash → 强制触发一次 hashchange
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else {
    window.location.hash = hash;
  }
}

/**
 * 决定首屏路由：
 *   - 无 apiBase → pairing
 *   - 有 apiBase 但 master 为空 → master-sync
 *   - 否则 → home
 *
 * @param {{ apiBase?: string | null, hasMasterStore?: boolean }} input
 * @returns {string}
 */
export function decideInitialRoute(input) {
  const apiBase =
    input && typeof input.apiBase === "string" ? input.apiBase.trim() : "";
  const hasMasterStore = Boolean(input && input.hasMasterStore);
  if (!apiBase) return "pairing";
  if (!hasMasterStore) return "master-sync";
  return "home";
}

/**
 * 守卫一个路由名：若该路由属于 PROTECTED_ROUTES 且 master 为空，
 * 返回应当被重定向到的路由名（"master-sync"）。否则返回原 name。
 *
 * @param {string} name
 * @param {{ hasMasterStore: boolean }} state
 * @returns {string}
 */
export function guardRoute(name, state) {
  if (PROTECTED_ROUTES.has(name) && !state.hasMasterStore) {
    return "master-sync";
  }
  return name;
}

export const _internals = { ROUTES, PROTECTED_ROUTES };
