// app/handheld/src/pages/product-detail-page.js
//
// 产品详情页：型号 / 总数 / 各位置库存 + 入库 / 移库 / 出库 / 调整 入口。
//
// Validates: Requirements 3.4, 6.1, 6.2, 8.1

import { mount, escapeHtml, bindClicks, formatTimeSince } from "../ui.js";
import { loadLocalMasterStore } from "../master-sync.js";
import { mergeIntoMaster } from "../pending-products.js";
import {
  buildInitialPreview,
  applyOp,
  listLocationsWithQty,
} from "../../shared/inventory-preview.js";
import { loadQueue, OP_STATES } from "../operation-queue.js";
import { navigate } from "../router.js";

function findProduct(master, id) {
  for (const p of master.products || []) {
    if (p && p.id === id) return p;
  }
  return null;
}

function locationLabel(master, key) {
  if (!key) return "(未知位置)";
  if (key.startsWith("level:")) {
    const id = key.slice("level:".length);
    const lvl = (master.shelfLevels || []).find((l) => l && l.id === id);
    if (lvl) {
      const code =
        lvl.locationCode ||
        lvl.location_code ||
        `${lvl.shelfId || lvl.shelf_id || "?"}/L${lvl.levelNo || lvl.level_no || "?"}`;
      return code;
    }
    return `层数:${id}`;
  }
  if (key.startsWith("external:")) {
    const id = key.slice("external:".length);
    const ex = (master.externalLocations || []).find((l) => l && l.id === id);
    if (ex) return ex.code || ex.name || id;
    return `外部:${id}`;
  }
  return key;
}

export async function render({ params }) {
  const productId = params?.id;
  const baseMaster = await loadLocalMasterStore();
  const master = await mergeIntoMaster(baseMaster);
  const product = findProduct(master, productId);

  if (!product) {
    mount(`
      <div class="page">
        <header class="page__header">
          <h1 class="page__title">产品详情</h1>
        </header>
        <div class="banner banner--warning">未找到该产品。可能主数据已更新。</div>
        <button class="btn btn--block" data-action="back">返回</button>
      </div>
    `,
    (root) => bindClicks(root, { back: () => navigate("home") }));
    return;
  }

  // 计算 preview = master.inventoryBalances + 队列中已入队但未导入的 op
  let preview = buildInitialPreview(master.inventoryBalances || []);
  const queue = await loadQueue();
  for (const op of queue) {
    if (
      op &&
      (op.upload_state === OP_STATES.PENDING ||
        op.upload_state === OP_STATES.ATTEMPTED ||
        op.upload_state === OP_STATES.EXPORTED ||
        op.upload_state === OP_STATES.FAILED)
    ) {
      preview = applyOp(preview, op);
    }
  }

  const locations = listLocationsWithQty(preview, productId);
  const totalQty = locations.reduce((s, l) => s + l.qty, 0);
  const isPending = product._pending === true;

  const html = `
    <div class="page">
      <header class="page__header">
        <button class="btn btn--ghost btn--small" data-action="back" aria-label="返回">←</button>
        <h1 class="page__title">${escapeHtml(product.model || "(无型号)")}</h1>
      </header>

      ${isPending ? '<div class="banner banner--warning">该产品为本地新增，尚未上传到服务器。</div>' : ""}

      <div class="page__section">
        <div class="kv-row">
          <span class="kv-row__key">总数量</span>
          <span class="kv-row__val"><strong>${escapeHtml(String(totalQty))}</strong></span>
        </div>
        <div class="kv-row">
          <span class="kv-row__key">状态</span>
          <span class="kv-row__val">${escapeHtml(product.status || "active")}</span>
        </div>
      </div>

      <div class="page__section">
        <h2 class="page__title" style="font-size: 16px;">库存位置</h2>
        ${locations.length === 0
          ? '<div class="empty-state">暂无库存。可点击下方"入库"按钮入库。</div>'
          : `
          <div class="list">
            ${locations
              .map(
                (l) => `
              <div class="list-row">
                <div class="list-row__main">
                  <div class="list-row__title">${escapeHtml(locationLabel(master, l.locationKey))}</div>
                  <div class="list-row__sub">${escapeHtml(l.locationKey)}</div>
                </div>
                <div class="list-row__aside"><strong>${escapeHtml(String(l.qty))}</strong></div>
              </div>
            `,
              )
              .join("")}
          </div>
          `}
      </div>

      <div class="page__section">
        <div class="btn-row">
          <button class="btn btn--primary" data-action="op-put-in">入库</button>
          <button class="btn" data-action="op-move">移库</button>
          <button class="btn" data-action="op-ship-out">出库</button>
          <button class="btn" data-action="op-adjust">调整</button>
        </div>
      </div>
    </div>
  `;

  mount(html, (root) => {
    bindClicks(root, {
      back: () => navigate("home"),
      "op-put-in": () => navigate("op", { type: "put_in" }, { productId }),
      "op-move": () => navigate("op", { type: "move" }, { productId }),
      "op-ship-out": () => navigate("op", { type: "ship_out" }, { productId }),
      "op-adjust": () =>
        navigate("op", { type: "adjust_increase" }, { productId }),
    });
  });
}
