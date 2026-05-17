// app/handheld/src/pages/pairing-page.js
//
// 配对页：服务器地址 / Sync Token / 设备名 + 扫码导入。
//
// Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.6, 1.7, 1.8

import { mount, escapeHtml, bindClicks, bindSubmit, toast } from "../ui.js";
import { startPairing, scanPairingQr, PairingError } from "../pairing.js";
import { getPref } from "../storage-prefs.js";
import { getDeviceName } from "../device-identity.js";
import { navigate } from "../router.js";
import { log } from "../logger.js";

export async function render() {
  const apiBase = (await getPref("apiBase")) || "";
  const syncToken = (await getPref("sync_token")) || "";
  const deviceName = (await getDeviceName()) || "";

  const html = `
    <div class="page">
      <header class="page__header">
        <h1 class="page__title">配对</h1>
      </header>
      <p class="page__subtitle">配对手持端到电脑端服务器；首次启动时必填。</p>

      <div id="pairing-error" class="banner banner--error hidden"></div>

      <form id="pairing-form" class="page__section" novalidate>
        <label class="field">
          <span class="field__label">服务器地址</span>
          <input
            class="field__input"
            name="apiBase"
            type="url"
            inputmode="url"
            placeholder="http://192.168.1.10:4173"
            value="${escapeHtml(apiBase)}"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            required
          />
        </label>

        <label class="field">
          <span class="field__label">Sync Token</span>
          <input
            class="field__input"
            name="syncToken"
            type="text"
            placeholder="64 位令牌"
            value="${escapeHtml(syncToken)}"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            required
          />
        </label>

        <label class="field">
          <span class="field__label">设备名称</span>
          <input
            class="field__input"
            name="deviceName"
            type="text"
            placeholder="如：仓管 1 号机"
            value="${escapeHtml(deviceName)}"
            autocomplete="off"
            required
          />
        </label>

        <div class="btn-row">
          <button type="button" class="btn" data-action="scan">扫描二维码</button>
          <span class="spacer"></span>
          <button type="submit" class="btn btn--primary">提交</button>
        </div>
      </form>
    </div>
  `;

  mount(html, (root) => {
    const errorBanner = root.querySelector("#pairing-error");
    const form = root.querySelector("#pairing-form");

    function showError(msg) {
      if (!errorBanner) return;
      errorBanner.textContent = msg;
      errorBanner.classList.remove("hidden");
    }
    function clearError() {
      if (!errorBanner) return;
      errorBanner.textContent = "";
      errorBanner.classList.add("hidden");
    }

    bindClicks(root, {
      scan: async () => {
        clearError();
        try {
          const result = await scanPairingQr();
          if (!result) return; // 用户取消
          form.querySelector('input[name="apiBase"]').value = result.apiBase;
          form.querySelector('input[name="syncToken"]').value = result.syncToken;
          toast("已读取二维码，请确认设备名称后提交", "info");
        } catch (err) {
          showError(`扫码失败：${err?.message || err}`);
        }
      },
    });

    bindSubmit(root, "#pairing-form", async (event, formEl) => {
      clearError();
      const apiBaseRaw = formEl.elements.apiBase.value;
      const syncTokenRaw = formEl.elements.syncToken.value;
      const deviceNameRaw = formEl.elements.deviceName.value;
      const submitBtn = formEl.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;
      try {
        await startPairing({
          apiBaseRaw,
          syncTokenRaw,
          deviceName: deviceNameRaw,
        });
        toast("配对成功", "success");
        navigate("master-sync");
      } catch (err) {
        log("warn", "pairing-page", "failed", { message: String(err?.message || err) });
        showError(err instanceof PairingError ? err.message : `配对失败：${err?.message || err}`);
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  });
}
