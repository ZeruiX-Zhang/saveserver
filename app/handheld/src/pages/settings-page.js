// app/handheld/src/pages/settings-page.js
//
// 设置页：device_id / device_name / apiBase / 上次同步 + 重新配对 / 重置 / 导出日志。
//
// Validates: Requirements 1.8, 15.6, 16.3, 16.4

import {
  mount,
  escapeHtml,
  bindClicks,
  bindSubmit,
  formatTimeSince,
  toast,
} from "../ui.js";
import { getPref } from "../storage-prefs.js";
import {
  getOrCreateDeviceId,
  getDeviceName,
  setDeviceName,
  resetDeviceIdentity,
} from "../device-identity.js";
import { loadQueue } from "../operation-queue.js";
import { exportLogs } from "../logger.js";
import { navigate } from "../router.js";

export async function render() {
  const apiBase = (await getPref("apiBase")) || "";
  const lastSync = await getPref("last_master_sync_at");
  const deviceId = await getOrCreateDeviceId();
  const deviceName = (await getDeviceName()) || "";
  const queue = await loadQueue();
  const pendingCount = queue.length;

  const html = `
    <div class="page">
      <header class="page__header">
        <button class="btn btn--ghost btn--small" data-action="back" aria-label="返回">←</button>
        <h1 class="page__title">设置</h1>
      </header>

      <div class="page__section">
        <div class="kv-row"><span class="kv-row__key">服务器</span><span class="kv-row__val">${escapeHtml(apiBase || "(未配对)")}</span></div>
        <div class="kv-row"><span class="kv-row__key">设备 ID</span><span class="kv-row__val">${escapeHtml(deviceId)}</span></div>
        <div class="kv-row"><span class="kv-row__key">上次同步</span><span class="kv-row__val">${escapeHtml(formatTimeSince(lastSync))}</span></div>
        <div class="kv-row"><span class="kv-row__key">待上传</span><span class="kv-row__val">${escapeHtml(String(pendingCount))} 条</span></div>
      </div>

      <form id="rename-form" class="page__section">
        <label class="field">
          <span class="field__label">设备名称</span>
          <input class="field__input" name="deviceName" type="text" value="${escapeHtml(deviceName)}" autocomplete="off" />
        </label>
        <p class="muted" style="font-size:12px; margin-top:0;">修改设备名称不会重写历史操作的 operator_name。</p>
        <button type="submit" class="btn btn--block">保存名称</button>
      </form>

      <div class="page__section">
        <button class="btn btn--block" data-action="repair">重新配对</button>
        <button class="btn btn--block" data-action="export-logs" style="margin-top: 8px;">导出日志</button>
        <button class="btn btn--danger btn--block" data-action="reset" style="margin-top: 8px;">重置设备身份</button>
      </div>
    </div>
  `;

  mount(html, (root) => {
    bindClicks(root, {
      back: () => navigate("home"),
      repair: () => navigate("pairing"),
      "export-logs": async () => {
        try {
          const path = await exportLogs();
          toast(`日志已导出到 ${path}`, "success");
        } catch (err) {
          toast(`导出日志失败：${err?.message || err}`, "error");
        }
      },
      reset: async () => {
        const ok = await showResetDialog(pendingCount);
        if (!ok) return;
        await resetDeviceIdentity();
        toast("设备身份已重置", "success");
        navigate("pairing");
      },
    });

    bindSubmit(root, "#rename-form", async (event, formEl) => {
      const name = String(formEl.elements.deviceName.value || "").trim();
      if (!name) {
        toast("名称不能为空", "warning");
        return;
      }
      await setDeviceName(name);
      toast("已保存", "success");
    });
  });
}

function showResetDialog(pendingCount) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 3000;
      background: rgba(0,0,0,0.5);
      display: flex; align-items: center; justify-content: center;
      padding: 16px;
    `;
    const modal = document.createElement("div");
    modal.style.cssText = `
      background: var(--surface); color: var(--text);
      border-radius: 12px; padding: 16px; max-width: 420px; width: 100%;
      box-shadow: 0 4px 24px rgba(0,0,0,0.4);
    `;
    modal.innerHTML = `
      <h2 style="margin: 0 0 8px 0;">确认重置设备身份</h2>
      <p>该操作将清空 device_id、device_name 并丢弃 ${escapeHtml(String(pendingCount))} 条待上传操作。</p>
      <p>此操作不可撤销。</p>
      <label style="display:flex; align-items:center; gap:8px; margin: 12px 0;">
        <input type="checkbox" id="reset-confirm" />
        <span>我已知晓将丢弃 ${escapeHtml(String(pendingCount))} 条待上传操作</span>
      </label>
      <div class="btn-row" style="justify-content:flex-end;">
        <button type="button" class="btn" id="reset-cancel">取消</button>
        <button type="button" class="btn btn--danger" id="reset-ok" disabled>确认重置</button>
      </div>
    `;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const checkbox = modal.querySelector("#reset-confirm");
    const okBtn = modal.querySelector("#reset-ok");
    const cancelBtn = modal.querySelector("#reset-cancel");

    function close(result) {
      if (overlay.parentElement) overlay.parentElement.removeChild(overlay);
      resolve(result);
    }

    checkbox.addEventListener("change", () => {
      okBtn.disabled = !checkbox.checked;
    });
    cancelBtn.addEventListener("click", () => close(false));
    okBtn.addEventListener("click", () => close(true));
  });
}
