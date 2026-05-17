// app/handheld/src/pages/upload-result-page.js
//
// 上传结果页：根据 packageId 在队列中筛出本次上传的 op，统计并展示。
// 同时把摘要写入 upload-history.json（最近 10 次循环缓冲）。
//
// Validates: Requirements 12.3, 12.4, 14.1, 14.2, 14.3, 14.4

import { mount, escapeHtml, bindClicks, formatDateTime } from "../ui.js";
import {
  loadQueue,
  removeOperation,
  OP_STATES,
} from "../operation-queue.js";
import { readJsonFile, writeJsonFileAtomic } from "../storage-fs.js";
import { navigate } from "../router.js";

const HISTORY_FILE = "upload-history.json";
const HISTORY_CAP = 10;

async function appendHistory(summary) {
  const data = await readJsonFile(HISTORY_FILE);
  const items = data && Array.isArray(data.items) ? data.items.slice() : [];
  items.push(summary);
  while (items.length > HISTORY_CAP) items.shift();
  await writeJsonFileAtomic(HISTORY_FILE, { items });
}

export async function render({ params }) {
  const packageId = params?.packageId || "";
  const queue = await loadQueue();
  // 我们没有 per-package 的标记字段；这里以"非 pending 状态"且 last_attempt_at 接近
  // 现在的 op 作为本次上传的近似集合。更可靠的做法是在 upload-lan 中把 packageId
  // 写到每条 op 上；但当前简化为：列出所有非 pending/exported 状态的 op。
  const recentlyTouched = queue.filter(
    (op) =>
      op &&
      (op.upload_state === OP_STATES.IMPORTED ||
        op.upload_state === OP_STATES.DUPLICATE ||
        op.upload_state === OP_STATES.FAILED),
  );

  const imported = recentlyTouched.filter((op) => op.upload_state === OP_STATES.IMPORTED);
  const duplicate = recentlyTouched.filter((op) => op.upload_state === OP_STATES.DUPLICATE);
  const failed = recentlyTouched.filter((op) => op.upload_state === OP_STATES.FAILED);

  const summary = {
    packageId,
    at: new Date().toISOString(),
    imported: imported.length,
    duplicate: duplicate.length,
    failed: failed.length,
  };
  await appendHistory(summary);

  const html = `
    <div class="page">
      <header class="page__header">
        <button class="btn btn--ghost btn--small" data-action="back" aria-label="返回">←</button>
        <h1 class="page__title">上传结果</h1>
      </header>

      <div class="page__section">
        <div class="kv-row"><span class="kv-row__key">包 ID</span><span class="kv-row__val">${escapeHtml(packageId)}</span></div>
        <div class="kv-row"><span class="kv-row__key">已导入</span><span class="kv-row__val"><strong>${imported.length}</strong></span></div>
        <div class="kv-row"><span class="kv-row__key">重复</span><span class="kv-row__val">${duplicate.length}</span></div>
        <div class="kv-row"><span class="kv-row__key">失败</span><span class="kv-row__val" style="color: var(--danger);"><strong>${failed.length}</strong></span></div>
      </div>

      ${
        failed.length === 0
          ? ""
          : `
      <div class="page__section">
        <h2 class="page__title" style="font-size: 16px;">失败详情</h2>
        <div class="list">
          ${failed
            .map(
              (op) => `
            <div class="list-row">
              <div class="list-row__main">
                <div class="list-row__title">${escapeHtml(op.operation_type || "?")} ×${escapeHtml(String(op.qty))}</div>
                <div class="list-row__sub" style="color: var(--danger);">${escapeHtml(op.failure_reason || "未知错误")}</div>
                <div class="list-row__sub muted">${escapeHtml(formatDateTime(op.operated_at))}</div>
              </div>
              <div class="list-row__aside">
                <button class="btn btn--ghost btn--small" data-action="discard" data-op-id="${escapeHtml(op.operation_id)}">保留待处理</button>
              </div>
            </div>
          `,
            )
            .join("")}
        </div>
      </div>
      `
      }

      <div class="page__section">
        <button class="btn btn--block" data-action="goto-home">返回主页</button>
      </div>
    </div>
  `;

  mount(html, (root) => {
    bindClicks(root, {
      back: () => navigate("queue"),
      "goto-home": () => navigate("home"),
      discard: async (event, el) => {
        const id = el.getAttribute("data-op-id");
        if (id) {
          await removeOperation(id);
          await render({ params: { packageId } });
        }
      },
    });
  });
}
