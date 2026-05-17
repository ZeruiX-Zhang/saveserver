// app/handheld/src/pages/new-product-page.js
//
// 新增产品（pending）：型号 + 拍照 + 自定义字段。
//
// Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7

import { mount, escapeHtml, bindClicks, bindSubmit, toast } from "../ui.js";
import { loadLocalMasterStore } from "../master-sync.js";
import {
  appendPendingProduct,
  findDuplicateByModel,
} from "../pending-products.js";
import { ensureCameraPermission } from "../permissions.js";
import { navigate } from "../router.js";
import { log } from "../logger.js";

async function takePhotoBase64() {
  const Camera = window?.Capacitor?.Plugins?.Camera ?? null;
  if (Camera && typeof Camera.getPhoto === "function") {
    const perm = await ensureCameraPermission();
    if (!perm.granted) throw new Error(perm.reason || "无法访问摄像头");
    try {
      const photo = await Camera.getPhoto({
        quality: 70,
        allowEditing: false,
        resultType: "base64",
        source: "PROMPT",
        saveToGallery: false,
      });
      return photo?.base64String || null;
    } catch (err) {
      const msg = err?.message || String(err);
      if (/cancel|canceled|cancelled/i.test(msg)) return null;
      throw new Error(`拍照失败：${msg}`);
    }
  }
  // Web fallback：使用 input[type=file]
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.capture = "environment";
    input.style.display = "none";
    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      if (!file) {
        document.body.removeChild(input);
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || "");
        const idx = result.indexOf(",");
        document.body.removeChild(input);
        resolve(idx >= 0 ? result.slice(idx + 1) : null);
      };
      reader.onerror = () => {
        document.body.removeChild(input);
        reject(new Error("读取图片失败"));
      };
      reader.readAsDataURL(file);
    });
    document.body.appendChild(input);
    input.click();
  });
}

export async function render() {
  const master = await loadLocalMasterStore();
  const fields = (master.customFieldDefinitions || [])
    .filter((d) => d && (d.status || "active") === "active")
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

  const fieldsHtml = fields
    .map((d) => {
      const label = `${escapeHtml(d.name || d.id)}${
        d.isRequired || d.is_required === 1 ? " *" : ""
      }`;
      const fieldType = d.fieldType || d.field_type;
      let optsJson = d.optionsJson || d.options_json;
      let opts = [];
      if (typeof optsJson === "string" && optsJson) {
        try {
          opts = JSON.parse(optsJson);
        } catch {
          opts = [];
        }
      } else if (Array.isArray(optsJson)) {
        opts = optsJson;
      }
      const required = d.isRequired || d.is_required === 1 ? "required" : "";
      if (fieldType === "select" && Array.isArray(opts) && opts.length > 0) {
        return `
          <label class="field">
            <span class="field__label">${label}</span>
            <select class="field__select" name="cf_${escapeHtml(d.id)}" ${required}>
              <option value="">请选择…</option>
              ${opts
                .map((o) => {
                  const v = typeof o === "string" ? o : o.value || o.label || "";
                  const t = typeof o === "string" ? o : o.label || o.value || "";
                  return `<option value="${escapeHtml(v)}">${escapeHtml(t)}</option>`;
                })
                .join("")}
            </select>
          </label>
        `;
      }
      const inputType = fieldType === "number" ? "number" : "text";
      return `
        <label class="field">
          <span class="field__label">${label}</span>
          <input class="field__input" type="${inputType}" name="cf_${escapeHtml(d.id)}" ${required} />
        </label>
      `;
    })
    .join("");

  const html = `
    <div class="page">
      <header class="page__header">
        <button class="btn btn--ghost btn--small" data-action="back" aria-label="返回">←</button>
        <h1 class="page__title">新增产品</h1>
      </header>

      <div id="np-error" class="banner banner--error hidden"></div>
      <div id="np-warn" class="banner banner--warning hidden"></div>

      <form id="np-form" class="page__section" novalidate>
        <label class="field">
          <span class="field__label">型号 *</span>
          <input class="field__input" type="text" name="model" required autocomplete="off" />
        </label>

        <div class="field">
          <span class="field__label">主图（可选）</span>
          <div class="btn-row">
            <button type="button" class="btn" data-action="capture">拍照 / 选图</button>
            <span id="np-photo-status" class="muted">未选择</span>
          </div>
        </div>

        ${fieldsHtml}

        <button type="submit" class="btn btn--primary btn--block">保存为待上传产品</button>
      </form>
    </div>
  `;

  let imageBase64 = null;

  mount(html, (root) => {
    const errEl = root.querySelector("#np-error");
    const warnEl = root.querySelector("#np-warn");
    const photoStatus = root.querySelector("#np-photo-status");

    function clearAlerts() {
      errEl.textContent = "";
      errEl.classList.add("hidden");
      warnEl.textContent = "";
      warnEl.classList.add("hidden");
    }
    function showErr(msg) {
      errEl.textContent = msg;
      errEl.classList.remove("hidden");
    }
    function showWarn(msg) {
      warnEl.textContent = msg;
      warnEl.classList.remove("hidden");
    }

    bindClicks(root, {
      back: () => history.back(),
      capture: async () => {
        try {
          const b64 = await takePhotoBase64();
          if (b64) {
            imageBase64 = b64;
            photoStatus.textContent = "已选择图片";
          }
        } catch (err) {
          showErr(String(err?.message || err));
        }
      },
    });

    bindSubmit(root, "#np-form", async (event, formEl) => {
      clearAlerts();
      const model = formEl.elements.model.value.trim();
      if (!model) {
        showErr("型号不能为空");
        return;
      }
      // duplicate check
      const dup = await findDuplicateByModel(model, master);
      if (dup.duplicate) {
        showWarn("该型号已存在，请确认是否重复添加");
      }
      // 收集自定义字段
      const customFieldValues = {};
      for (const d of fields) {
        const val = formEl.elements[`cf_${d.id}`]?.value ?? "";
        const required = d.isRequired || d.is_required === 1;
        if (required && !val) {
          showErr(`字段 "${d.name || d.id}" 不能为空`);
          return;
        }
        if (val) customFieldValues[d.id] = val;
      }
      try {
        const record = await appendPendingProduct({
          model,
          imageBase64,
          customFieldValues,
        });
        log("info", "new-product", "saved", { id: record.id, model: record.model });
        toast("已保存（待上传）", "success");
        navigate("home");
      } catch (err) {
        showErr(`保存失败：${err?.message || err}`);
      }
    });
  });
}
