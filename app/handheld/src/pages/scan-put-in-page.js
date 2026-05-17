// app/handheld/src/pages/scan-put-in-page.js
//
// 扫码入库：先扫码 → 找到 level → 跳到 op-form?type=put_in&targetLevelId=...
//
// Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6

import { mount, escapeHtml, bindClicks, toast } from "../ui.js";
import { scanOnce } from "../scanner-native.js";
import { parseLocationCode, formatLocationCode } from "../../shared/location-code.js";
import { loadLocalMasterStore } from "../master-sync.js";
import { navigate } from "../router.js";
import { log } from "../logger.js";

function findLevel(master, warehouse, shelf, levelNo, fallbackText) {
  const wh = (master.warehouses || []).find(
    (w) => w && (w.code || "").toUpperCase() === String(warehouse).toUpperCase(),
  );
  if (wh) {
    const sh = (master.shelves || []).find(
      (s) =>
        s &&
        s.warehouseId === wh.id &&
        (s.code || "").toUpperCase() === String(shelf).toUpperCase(),
    );
    if (sh) {
      const lvl = (master.shelfLevels || []).find(
        (l) =>
          l &&
          (l.shelfId || l.shelf_id) === sh.id &&
          Number(l.levelNo || l.level_no) === Number(levelNo),
      );
      if (lvl) return lvl;
    }
  }
  // fallback: 直接按 location_code 匹配
  if (fallbackText) {
    const want = String(fallbackText).toUpperCase();
    for (const l of master.shelfLevels || []) {
      const c = (l.locationCode || l.location_code || "").toUpperCase();
      if (c === want) return l;
    }
  }
  // fallback: 按格式化拼接
  const formatted = formatLocationCode(warehouse, shelf, levelNo).toUpperCase();
  if (formatted) {
    for (const l of master.shelfLevels || []) {
      const c = (l.locationCode || l.location_code || "").toUpperCase();
      if (c === formatted) return l;
    }
  }
  return null;
}

export async function render() {
  const html = `
    <div class="page">
      <header class="page__header">
        <button class="btn btn--ghost btn--small" data-action="back" aria-label="返回">←</button>
        <h1 class="page__title">扫码入库</h1>
      </header>

      <div id="scan-result" class="banner banner--info hidden"></div>

      <div class="page__section">
        <p class="muted">请扫描货架层数二维码（格式：仓库-货架-层数）。</p>
        <button class="btn btn--primary btn--block" data-action="scan">开始扫描</button>
      </div>

      <div class="page__section">
        <label class="field">
          <span class="field__label">手动输入位置码</span>
          <input
            id="manual-code"
            class="field__input"
            type="text"
            placeholder="如 A-01-L02"
            autocomplete="off"
            autocapitalize="characters"
            spellcheck="false"
          />
        </label>
        <button class="btn btn--block" data-action="manual-submit">使用手动输入</button>
      </div>
    </div>
  `;

  mount(html, (root) => {
    const banner = root.querySelector("#scan-result");
    function showBanner(msg, kind) {
      banner.textContent = msg;
      banner.className = `banner banner--${kind || "info"}`;
    }

    async function processCode(text) {
      const r = parseLocationCode(text);
      if (!r.ok) {
        showBanner(r.reason, "error");
        return;
      }
      const master = await loadLocalMasterStore();
      const level = findLevel(master, r.warehouse, r.shelf, r.levelNo, text);
      if (!level) {
        showBanner(
          "该位置未在主数据中，请先同步主数据后重试",
          "warning",
        );
        log("warn", "scan-put-in", "level not found", { code: text });
        return;
      }
      navigate("op", { type: "put_in" }, { targetLevelId: level.id });
    }

    bindClicks(root, {
      back: () => history.back(),
      scan: async () => {
        try {
          const text = await scanOnce({ hint: "请扫描位置二维码" });
          if (text === null) return;
          await processCode(text);
        } catch (err) {
          showBanner(`扫码失败：${err?.message || err}`, "error");
        }
      },
      "manual-submit": async () => {
        const v = root.querySelector("#manual-code")?.value;
        if (!v) {
          showBanner("请先输入位置码", "warning");
          return;
        }
        await processCode(v);
      },
    });
  });
}
