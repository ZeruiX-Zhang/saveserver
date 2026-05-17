// app/handheld/src/pages/master-sync-page.js
//
// 主数据同步页：立即同步 + 状态显示。
//
// Validates: Requirements 2.1, 2.5, 2.6

import { mount, escapeHtml, bindClicks, formatTimeSince, toast, withButtonBusy } from "../ui.js";
import { getPref } from "../storage-prefs.js";
import { syncMasterData } from "../master-sync.js";
import { navigate } from "../router.js";
import { log } from "../logger.js";

export async function render() {
  const apiBase = (await getPref("apiBase")) || "";
  const lastSync = await getPref("last_master_sync_at");

  const html = `
    <div class="page">
      <header class="page__header">
        <h1 class="page__title">主数据同步</h1>
      </header>

      <div class="page__section">
        <div class="kv-row">
          <span class="kv-row__key">服务器</span>
          <span class="kv-row__val">${escapeHtml(apiBase || "(未配对)")}</span>
        </div>
        <div class="kv-row">
          <span class="kv-row__key">上次同步</span>
          <span class="kv-row__val">${escapeHtml(formatTimeSince(lastSync))}</span>
        </div>
      </div>

      <div id="sync-status" class="banner banner--info hidden"></div>

      <div class="page__section">
        <button class="btn btn--primary btn--block" data-action="sync-now">立即同步</button>
      </div>

      <div class="page__section">
        <button class="btn btn--ghost btn--block" data-action="back">返回</button>
      </div>
    </div>
  `;

  mount(html, (root) => {
    const statusEl = root.querySelector("#sync-status");

    function showStatus(msg, kind) {
      if (!statusEl) return;
      statusEl.textContent = msg;
      statusEl.className = `banner banner--${kind || "info"}`;
    }

    bindClicks(root, {
      "sync-now": async (event, btn) => {
        showStatus("正在同步…", "info");
        try {
          const r = await withButtonBusy(btn, () => syncMasterData());
          showStatus(
            `同步完成：${Object.entries(r.storeCounts)
              .map(([k, v]) => `${k} ${v}`)
              .join("，")}`,
            "success",
          );
          toast("同步成功", "success");
          // 自动跳转回主页（首次配对场景）
          setTimeout(() => navigate("home"), 600);
        } catch (err) {
          log("error", "master-sync-page", "failed", { message: String(err?.message || err) });
          showStatus(`同步失败：${err?.message || err}`, "error");
        }
      },
      back: () => navigate("home"),
    });
  });
}
