// app/handheld/src/pages/home-page.js
//
// 主页：搜索 + 主入口。
//
// Validates: Requirements 2.4, 2.7, 3.1, 3.2, 3.3, 3.5, 11.1

import { mount, escapeHtml, bindClicks, formatTimeSince, toast } from "../ui.js";
import { getPref } from "../storage-prefs.js";
import { loadLocalMasterStore } from "../master-sync.js";
import { mergeIntoMaster } from "../pending-products.js";
import { searchProducts } from "../../shared/local-search.js";
import { loadQueue, subscribe, OP_STATES } from "../operation-queue.js";
import { navigate } from "../router.js";

export async function render() {
  const lastSync = await getPref("last_master_sync_at");
  const baseMaster = await loadLocalMasterStore();
  const master = await mergeIntoMaster(baseMaster);
  const masterEmpty =
    (!Array.isArray(master.products) || master.products.length === 0) &&
    (!Array.isArray(baseMaster.products) || baseMaster.products.length === 0);

  // 默认显示前 50 个 active 产品
  const initialResults = searchProducts(master, "").slice(0, 50);
  const queueItems = await loadQueue();
  const pendingCount = queueItems.filter(
    (it) =>
      it &&
      (it.upload_state === OP_STATES.PENDING ||
        it.upload_state === OP_STATES.ATTEMPTED ||
        it.upload_state === OP_STATES.FAILED ||
        it.upload_state === OP_STATES.EXPORTED),
  ).length;

  const lastSyncText = formatTimeSince(lastSync);

  const html = `
    <div class="page">
      <header class="page__header">
        <h1 class="page__title">仓储管理</h1>
      </header>

      <div class="page__section">
        <div class="kv-row">
          <span class="kv-row__key">上次同步</span>
          <span class="kv-row__val">${escapeHtml(lastSyncText)}</span>
        </div>
        <div class="btn-row" style="margin-top: 8px;">
          <button class="btn btn--small" data-action="goto-master-sync">同步主数据</button>
        </div>
      </div>

      ${masterEmpty
        ? '<div class="banner banner--warning">本地无主数据，部分功能不可用，请先同步主数据。</div>'
        : ""}

      <div class="page__section">
        <label class="field" style="margin-bottom: 8px;">
          <span class="field__label">搜索型号 / 自定义字段</span>
          <input
            id="home-search"
            class="field__input"
            type="search"
            placeholder="输入关键字"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
          />
        </label>
        <div id="home-search-results">
          ${renderResults(initialResults)}
        </div>
      </div>

      <div class="action-bar">
        <button class="btn btn--primary" data-action="goto-scan-put-in" ${
          masterEmpty ? 'aria-disabled="true"' : ""
        }>扫码入库</button>
        <button class="btn" data-action="goto-queue">
          待上传操作 <span class="badge badge--pending" id="home-pending-badge">${pendingCount}</span>
        </button>
        <button class="btn btn--ghost" data-action="goto-settings">设置</button>
      </div>
    </div>
  `;

  mount(html, (root) => {
    const searchInput = root.querySelector("#home-search");
    const resultsEl = root.querySelector("#home-search-results");
    const badge = root.querySelector("#home-pending-badge");

    let timer = 0;
    function performSearch(q) {
      const qStr = String(q || "").trim();
      const list = searchProducts(master, qStr).slice(0, 100);
      if (list.length === 0) {
        resultsEl.innerHTML = `
          <div class="empty-state">
            未找到结果。
            <div class="btn-row" style="justify-content: center; margin-top: 12px;">
              <button class="btn btn--small btn--primary" data-action="goto-new-product">
                新增产品
              </button>
            </div>
          </div>
        `;
      } else {
        resultsEl.innerHTML = renderResults(list);
      }
    }

    if (searchInput) {
      searchInput.addEventListener("input", (e) => {
        if (timer) {
          clearTimeout(timer);
          timer = 0;
        }
        const v = e.target.value;
        timer = setTimeout(() => performSearch(v), 120);
      });
    }

    bindClicks(root, {
      "goto-master-sync": () => navigate("master-sync"),
      "goto-scan-put-in": () => {
        if (masterEmpty) {
          toast("请先同步主数据", "warning");
          return;
        }
        navigate("scan-put-in");
      },
      "goto-queue": () => navigate("queue"),
      "goto-settings": () => navigate("settings"),
      "goto-new-product": () => {
        if (masterEmpty) {
          toast("请先同步主数据", "warning");
          return;
        }
        navigate("new-product");
      },
      "open-product": (event, el) => {
        const id = el.getAttribute("data-product-id");
        if (id) navigate("product", { id });
      },
    });

    // 订阅 queue 变化更新 badge
    const unsub = subscribe((c) => {
      if (!badge) return;
      const items = (c && c.items) || [];
      const n = items.filter(
        (it) =>
          it &&
          (it.upload_state === OP_STATES.PENDING ||
            it.upload_state === OP_STATES.ATTEMPTED ||
            it.upload_state === OP_STATES.FAILED ||
            it.upload_state === OP_STATES.EXPORTED),
      ).length;
      badge.textContent = String(n);
    });
    // 路由切换时取消订阅
    window.addEventListener("hashchange", () => unsub(), { once: true });
  });
}

function renderResults(list) {
  if (!Array.isArray(list) || list.length === 0) {
    return `<div class="empty-state">本地暂无产品。请先同步主数据。</div>`;
  }
  return `
    <div class="list">
      ${list
        .map(
          (p) => `
        <a class="list-row" data-action="open-product" data-product-id="${escapeHtml(p.id)}">
          <div class="list-row__main">
            <div class="list-row__title">${escapeHtml(p.model || "(无型号)")}</div>
            <div class="list-row__sub">总数：${escapeHtml(String(p.totalQty ?? 0))}</div>
          </div>
        </a>
      `,
        )
        .join("")}
    </div>
  `;
}
