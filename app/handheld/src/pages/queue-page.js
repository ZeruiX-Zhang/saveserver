// app/handheld/src/pages/queue-page.js
//
// 队列页：列出 Operation_Queue（按 operated_at 倒序）；
// 提供 LAN 上传 / USB 导出 / 删除 pending 操作。
//
// Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.5, 12.1, 12.5, 12.8, 13.1

import { mount, escapeHtml, bindClicks, formatDateTime, toast, withButtonBusy } from "../ui.js";
import {
  loadQueue,
  removeOperation,
  pickPendingForUpload,
  sortQueueForDisplay,
  OP_STATES,
} from "../operation-queue.js";
import { getPref } from "../storage-prefs.js";
import { getOrCreateDeviceId, getDeviceName } from "../device-identity.js";
import { buildOperationPackage } from "../../shared/package-builder.js";
import {
  uploadOperationPackage,
  PairingError,
  NetworkError,
} from "../upload-lan.js";
import { exportPackageToUsb } from "../upload-usb.js";
import { navigate } from "../router.js";
import { log } from "../logger.js";

const STATE_LABELS = {
  pending: "待上传",
  attempted: "已尝试",
  imported: "已导入",
  duplicate: "重复",
  failed: "失败",
  exported: "已导出",
};

export async function render() {
  const queue = sortQueueForDisplay(await loadQueue());
  const totalPending = queue.filter(
    (it) =>
      it.upload_state === OP_STATES.PENDING ||
      it.upload_state === OP_STATES.ATTEMPTED ||
      it.upload_state === OP_STATES.FAILED ||
      it.upload_state === OP_STATES.EXPORTED,
  ).length;

  const html = `
    <div class="page">
      <header class="page__header">
        <button class="btn btn--ghost btn--small" data-action="back" aria-label="返回">←</button>
        <h1 class="page__title">待上传操作</h1>
      </header>

      <div id="q-error" class="banner banner--error hidden"></div>

      <div class="page__section">
        <div class="kv-row">
          <span class="kv-row__key">待上传</span>
          <span class="kv-row__val"><strong>${escapeHtml(String(totalPending))}</strong></span>
        </div>
        <div class="btn-row" style="margin-top: 8px;">
          <button class="btn btn--primary" data-action="upload-lan" ${
            totalPending === 0 ? 'aria-disabled="true"' : ""
          }>通过 LAN 上传</button>
          <button class="btn" data-action="export-usb" ${
            totalPending === 0 ? 'aria-disabled="true"' : ""
          }>导出 USB 包</button>
        </div>
      </div>

      <div class="page__section">
        <h2 class="page__title" style="font-size: 16px;">操作列表</h2>
        ${queue.length === 0
          ? '<div class="empty-state">队列为空。</div>'
          : `
          <div class="list">
            ${queue.map((op) => renderRow(op)).join("")}
          </div>
        `}
      </div>
    </div>
  `;

  mount(html, (root) => {
    const errEl = root.querySelector("#q-error");
    function showErr(msg) {
      errEl.textContent = msg;
      errEl.classList.remove("hidden");
    }
    function clearErr() {
      errEl.textContent = "";
      errEl.classList.add("hidden");
    }

    bindClicks(root, {
      back: () => navigate("home"),
      "delete-op": async (event, el) => {
        const id = el.getAttribute("data-op-id");
        if (!id) return;
        const ok = await removeOperation(id);
        if (ok) {
          toast("已删除", "success");
          await render();
        } else {
          toast("仅可删除待上传状态", "warning");
        }
      },
      "upload-lan": async (event, btn) => {
        clearErr();
        try {
          await withButtonBusy(btn, async () => {
            const pending = await pickPendingForUpload();
            if (pending.length === 0) {
              toast("没有待上传操作", "info");
              return;
            }
            const deviceId = await getOrCreateDeviceId();
            const deviceName = (await getDeviceName()) || "未命名设备";
            const baseId = await getPref("base_master_package_id");
            const pkg = buildOperationPackage({
              deviceId,
              deviceName,
              operations: pending,
              baseMasterPackageId: baseId,
            });
            const result = await uploadOperationPackage(pkg);
            log("info", "queue-page", "uploaded", {
              packageId: pkg.package_id,
              imported: result.imported.length,
              failed: result.failed.length,
            });
            navigate("upload-result", { packageId: pkg.package_id });
          });
        } catch (err) {
          if (err instanceof PairingError) {
            showErr(err.message);
            toast("令牌无效，请重新配对", "error");
            navigate("settings");
            return;
          }
          if (err instanceof NetworkError) {
            showErr(`网络异常：${err.message}`);
            return;
          }
          showErr(String(err?.message || err));
        }
      },
      "export-usb": async (event, btn) => {
        clearErr();
        try {
          await withButtonBusy(btn, async () => {
            const pending = await pickPendingForUpload();
            if (pending.length === 0) {
              toast("没有可导出的操作", "info");
              return;
            }
            const deviceId = await getOrCreateDeviceId();
            const deviceName = (await getDeviceName()) || "未命名设备";
            const baseId = await getPref("base_master_package_id");
            const pkg = buildOperationPackage({
              deviceId,
              deviceName,
              operations: pending,
              baseMasterPackageId: baseId,
            });
            const r = await exportPackageToUsb(pkg);
            toast(`已导出：${r.filePath}`, "success");
            await render();
          });
        } catch (err) {
          showErr(`导出失败：${err?.message || err}`);
        }
      },
    });
  });
}

function renderRow(op) {
  const state = op.upload_state || "pending";
  const badgeKind = ["pending", "attempted", "imported", "duplicate", "failed", "exported"].includes(state)
    ? state
    : "pending";
  const stale = op.stale ? `<span class="badge badge--stale">引用失效</span>` : "";
  const reason = op.failure_reason
    ? `<div class="list-row__sub" style="color: var(--danger);">${escapeHtml(op.failure_reason)}</div>`
    : "";

  const opType = op.operation_type || "?";
  const qty = op.qty;
  const time = formatDateTime(op.operated_at);
  const summary = `${opType} ×${qty}`;
  const sub = describeRoute(op);

  const canDelete = state === "pending";

  return `
    <div class="list-row">
      <div class="list-row__main">
        <div class="list-row__title">${escapeHtml(summary)}</div>
        <div class="list-row__sub">${escapeHtml(sub)}</div>
        ${reason}
      </div>
      <div class="list-row__aside" style="display:flex; flex-direction:column; align-items:flex-end; gap:4px;">
        <span class="badge badge--${badgeKind}">${escapeHtml(STATE_LABELS[state] || state)}</span>
        ${stale}
        <span class="muted" style="font-size: 12px;">${escapeHtml(time)}</span>
        ${canDelete
          ? `<button class="btn btn--ghost btn--small" data-action="delete-op" data-op-id="${escapeHtml(op.operation_id)}">删除</button>`
          : ""}
      </div>
    </div>
  `;
}

function describeRoute(op) {
  const src = op.source_location_type;
  const tgt = op.target_location_type;
  const parts = [];
  if (src && src !== "none") {
    parts.push(
      src === "warehouse"
        ? `源:层${op.source_level_id || "?"}`
        : `源:外部${op.source_external_location_id || "?"}`,
    );
  }
  if (tgt && tgt !== "none") {
    parts.push(
      tgt === "warehouse"
        ? `目标:层${op.target_level_id || "?"}`
        : `目标:外部${op.target_external_location_id || "?"}`,
    );
  }
  return parts.join("  →  ") || "(无位置)";
}
