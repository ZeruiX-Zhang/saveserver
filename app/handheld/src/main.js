// app/handheld/src/main.js
//
// 应用入口：
//   1. DOMContentLoaded → 注册全局错误监听 → 启动 router
//   2. 通过 hashchange 重新派发当前路由对应的 page.render(params)
//   3. 全局 toast 主机和后台日志刷写
//
// 不直接 import Capacitor；所有原生 API 都封装在 storage-prefs / storage-fs
// / scanner-native / permissions 中，缺失时优雅降级。

import { mount } from "./ui.js";
import {
  parseRoute,
  decideInitialRoute,
  navigate,
  guardRoute,
  buildHash,
} from "./router.js";
import { getPref } from "./storage-prefs.js";
import { hasLocalMasterStore } from "./master-sync.js";
import { log, startBackgroundFlush } from "./logger.js";

// Lazy-imported pages — keeps boot fast
const PAGE_LOADERS = {
  pairing: () => import("./pages/pairing-page.js"),
  home: () => import("./pages/home-page.js"),
  "master-sync": () => import("./pages/master-sync-page.js"),
  product: () => import("./pages/product-detail-page.js"),
  op: () => import("./pages/op-form-page.js"),
  "scan-put-in": () => import("./pages/scan-put-in-page.js"),
  "new-product": () => import("./pages/new-product-page.js"),
  queue: () => import("./pages/queue-page.js"),
  "upload-result": () => import("./pages/upload-result-page.js"),
  settings: () => import("./pages/settings-page.js"),
};

let currentRouteSerial = 0;

/**
 * 渲染当前 URL hash 对应的页面。
 *
 * @returns {Promise<void>}
 */
async function renderCurrentRoute() {
  if (typeof window === "undefined") return;
  const route = parseRoute(window.location.hash);
  const hasMaster = await hasLocalMasterStore().catch(() => false);
  const guarded = guardRoute(route.name, { hasMasterStore: hasMaster });
  if (guarded !== route.name) {
    log("warn", "router", "guard redirect", { from: route.name, to: guarded });
    if (window.location.hash !== buildHash(guarded)) {
      window.location.hash = buildHash(guarded);
      return; // hashchange will re-trigger
    }
  }

  const serial = ++currentRouteSerial;
  const loader = PAGE_LOADERS[guarded] || PAGE_LOADERS.home;

  let mod;
  try {
    mod = await loader();
  } catch (err) {
    log("error", "router", "load page failed", {
      route: guarded,
      message: String(err?.message || err),
    });
    mount(
      `<div class="page"><div class="banner banner--error">加载页面失败：${escapeHtmlSafe(String(err?.message || err))}</div></div>`,
    );
    return;
  }
  if (serial !== currentRouteSerial) return; // newer navigation already started

  const render = mod && typeof mod.render === "function" ? mod.render : null;
  if (!render) {
    mount(`<div class="page"><div class="banner banner--error">页面 ${escapeHtmlSafe(guarded)} 缺少 render 函数</div></div>`);
    return;
  }
  try {
    await render({ params: route.params, query: route.query });
  } catch (err) {
    log("error", "router", "render page failed", {
      route: guarded,
      message: String(err?.message || err),
    });
    mount(
      `<div class="page"><div class="banner banner--error">渲染页面失败：${escapeHtmlSafe(String(err?.message || err))}</div></div>`,
    );
  }
}

function escapeHtmlSafe(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function boot() {
  // 1. 全局错误监听 → 写日志
  if (typeof window !== "undefined") {
    window.addEventListener("error", (event) => {
      try {
        log("error", "global", String(event.message || ""), {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
        });
      } catch {
        // ignore
      }
    });
    window.addEventListener("unhandledrejection", (event) => {
      try {
        const reason = event.reason;
        const msg =
          reason && typeof reason === "object"
            ? reason.message || String(reason)
            : String(reason);
        log("error", "global", `unhandledrejection: ${msg}`);
      } catch {
        // ignore
      }
    });
  }

  // 2. 启动后台日志刷写
  startBackgroundFlush();

  // 3. 决定首屏路由
  const apiBase = await getPref("apiBase");
  const hasMaster = await hasLocalMasterStore().catch(() => false);
  const initial = decideInitialRoute({ apiBase, hasMasterStore: hasMaster });

  // 4. 监听 hashchange 重新渲染
  window.addEventListener("hashchange", () => {
    void renderCurrentRoute();
  });

  // 5. 跳到首屏（如果还没设置 hash）
  const currentHash = (window.location.hash || "").replace(/^#/, "");
  if (!currentHash || currentHash === "" || currentHash === "/") {
    navigate(initial);
    // navigate 会触发 hashchange；保险起见若 initial 已经是 home，直接渲染
    if (
      window.location.hash === "" ||
      window.location.hash === "#" ||
      window.location.hash === "#/"
    ) {
      await renderCurrentRoute();
    }
  } else {
    await renderCurrentRoute();
  }
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      void boot();
    });
  } else {
    void boot();
  }
}
