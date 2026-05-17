// app/handheld/src/pages/op-form-page.js
//
// 操作表单页：根据 :type 显示对应字段。
// 支持类型：put_in, move, move_to_external, move_from_external,
//          ship_out, adjust_increase, adjust_decrease
//
// Validates: Requirements 4.x, 6.x, 7.x, 8.x, 9.x

import { mount, escapeHtml, bindClicks, bindSubmit, toast } from "../ui.js";
import { loadLocalMasterStore } from "../master-sync.js";
import { mergeIntoMaster } from "../pending-products.js";
import { getDeviceName } from "../device-identity.js";
import {
  buildPutIn,
  buildMoveWarehouse,
  buildMoveToExternal,
  buildMoveFromExternal,
  buildShipOut,
  buildAdjustIncrease,
  buildAdjustDecrease,
} from "../../shared/op-builders.js";
import { appendOperation } from "../operation-queue.js";
import { navigate } from "../router.js";
import { scanOnce } from "../scanner-native.js";
import { parseLocationCode } from "../../shared/location-code.js";
import {
  buildInitialPreview,
  applyOp,
  getLocationQty,
} from "../../shared/inventory-preview.js";
import { loadQueue, OP_STATES } from "../operation-queue.js";
import { log } from "../logger.js";

const OP_TYPE_LABELS = {
  put_in: "入库",
  move: "仓库内移库",
  move_to_external: "移出到外部位置",
  move_from_external: "从外部位置入库",
  ship_out: "出库",
  adjust_increase: "调整 +",
  adjust_decrease: "调整 -",
};

function buildLevelOptions(master) {
  const levels = master.shelfLevels || [];
  return levels
    .filter((l) => l && (l.status || "active") === "active")
    .map((l) => ({
      id: l.id,
      label:
        l.locationCode ||
        l.location_code ||
        `${l.shelfId || l.shelf_id || "?"}/L${l.levelNo || l.level_no || "?"}`,
    }))
    .sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
}

function buildExternalOptions(master) {
  const list = master.externalLocations || [];
  return list
    .filter((e) => e && (e.status || "active") === "active")
    .map((e) => ({ id: e.id, label: e.code || e.name || e.id }))
    .sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
}

function buildProductOptions(master) {
  const list = master.products || [];
  return list
    .filter((p) => p && (p.status || "active") === "active")
    .map((p) => ({ id: p.id, label: p.model || "(无型号)" }))
    .sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
}

function findLevelByLocationCode(master, code) {
  const want = String(code || "").toUpperCase();
  if (!want) return null;
  for (const l of master.shelfLevels || []) {
    if (!l) continue;
    const c = (l.locationCode || l.location_code || "").toUpperCase();
    if (c === want) return l;
  }
  return null;
}

function findLevelByParts(master, warehouse, shelf, levelNo) {
  // 通过 warehouse/shelf/levelNo 查 level：
  // 1. 找 warehouse code 匹配
  const wh = (master.warehouses || []).find(
    (w) => w && (w.code || "").toUpperCase() === String(warehouse).toUpperCase(),
  );
  if (!wh) return null;
  const sh = (master.shelves || []).find(
    (s) =>
      s &&
      s.warehouseId === wh.id &&
      (s.code || "").toUpperCase() === String(shelf).toUpperCase(),
  );
  if (!sh) return null;
  const lvl = (master.shelfLevels || []).find(
    (l) =>
      l &&
      (l.shelfId || l.shelf_id) === sh.id &&
      Number(l.levelNo || l.level_no) === Number(levelNo),
  );
  return lvl || null;
}

export async function render({ params, query }) {
  const type = params?.type || "put_in";
  if (!OP_TYPE_LABELS[type]) {
    mount(`<div class="page"><div class="banner banner--error">未知操作类型：${escapeHtml(type)}</div><button class="btn btn--block" data-action="back">返回</button></div>`,
      (root) => bindClicks(root, { back: () => navigate("home") })
    );
    return;
  }
  const baseMaster = await loadLocalMasterStore();
  const master = await mergeIntoMaster(baseMaster);
  const deviceName = (await getDeviceName()) || "未命名设备";
  const products = buildProductOptions(master);
  const levels = buildLevelOptions(master);
  const externals = buildExternalOptions(master);

  const presetProductId = query?.productId || "";
  const presetTargetLevelId = query?.targetLevelId || "";

  // 组装预览（含队列中未导入的 op）
  let preview = buildInitialPreview(master.inventoryBalances || []);
  for (const op of await loadQueue()) {
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

  const fields = renderFields(type, {
    products,
    levels,
    externals,
    presetProductId,
    presetTargetLevelId,
  });

  const html = `
    <div class="page">
      <header class="page__header">
        <button class="btn btn--ghost btn--small" data-action="back" aria-label="返回">←</button>
        <h1 class="page__title">${escapeHtml(OP_TYPE_LABELS[type])}</h1>
      </header>

      <div id="op-error" class="banner banner--error hidden"></div>

      <form id="op-form" class="page__section" novalidate>
        ${fields}
        <label class="field">
          <span class="field__label">数量</span>
          <input class="field__input" name="qty" type="number" inputmode="decimal" step="any" min="0.0001" required />
        </label>
        <label class="field">
          <span class="field__label">备注${type.startsWith("adjust_") ? "（必填）" : "（可选）"}</span>
          <textarea class="field__textarea" name="note" placeholder=""></textarea>
        </label>
        <input type="hidden" name="operatorName" value="${escapeHtml(deviceName)}" />
        <button type="submit" class="btn btn--primary btn--block">提交</button>
      </form>
    </div>
  `;

  mount(html, (root) => {
    const errEl = root.querySelector("#op-error");
    function showError(msg) {
      errEl.textContent = msg;
      errEl.classList.remove("hidden");
    }
    function clearError() {
      errEl.textContent = "";
      errEl.classList.add("hidden");
    }

    bindClicks(root, {
      back: () => history.back(),
      "scan-source-level": async (e, btn) => {
        await scanIntoSelect(root, "sourceLevelId", master, "level");
      },
      "scan-target-level": async (e, btn) => {
        await scanIntoSelect(root, "targetLevelId", master, "level");
      },
    });

    bindSubmit(root, "#op-form", async (event, formEl) => {
      clearError();
      try {
        const op = buildOpFromForm(type, formEl);
        // 可达性校验：来源数量是否充足
        const checkErr = checkSourceAvailable(op, preview);
        if (checkErr) {
          showError(checkErr);
          return;
        }
        await appendOperation(op);
        log("info", "op-form", "appended", {
          type,
          operationId: op.operation_id,
          qty: op.qty,
        });
        toast(`${OP_TYPE_LABELS[type]} 已加入待上传队列`, "success");
        navigate("home");
      } catch (err) {
        showError(String(err?.message || err));
      }
    });
  });
}

function renderFields(type, ctx) {
  const { products, levels, externals, presetProductId, presetTargetLevelId } = ctx;
  const productSelect = `
    <label class="field">
      <span class="field__label">产品</span>
      <select class="field__select" name="productId" required>
        <option value="">请选择…</option>
        ${products
          .map(
            (p) =>
              `<option value="${escapeHtml(p.id)}" ${
                p.id === presetProductId ? "selected" : ""
              }>${escapeHtml(p.label)}</option>`,
          )
          .join("")}
      </select>
    </label>
  `;
  const levelSelect = (name, presetId) => `
    <label class="field">
      <span class="field__label">${name === "sourceLevelId" ? "来源" : "目标"}层数</span>
      <div style="display:flex; gap:8px;">
        <select class="field__select" name="${name}" style="flex: 1;">
          <option value="">请选择…</option>
          ${levels
            .map(
              (l) =>
                `<option value="${escapeHtml(l.id)}" ${
                  l.id === presetId ? "selected" : ""
                }>${escapeHtml(l.label)}</option>`,
            )
            .join("")}
        </select>
        <button type="button" class="btn btn--small" data-action="${
          name === "sourceLevelId" ? "scan-source-level" : "scan-target-level"
        }">扫描</button>
      </div>
    </label>
  `;
  const externalSelect = (name) => `
    <label class="field">
      <span class="field__label">${name.startsWith("source") ? "来源" : "目标"}外部位置</span>
      <select class="field__select" name="${name}">
        <option value="">请选择…</option>
        ${externals
          .map(
            (e) =>
              `<option value="${escapeHtml(e.id)}">${escapeHtml(e.label)}</option>`,
          )
          .join("")}
      </select>
    </label>
  `;

  switch (type) {
    case "put_in":
      return `${productSelect}${levelSelect("targetLevelId", presetTargetLevelId)}`;
    case "move":
      return `${productSelect}${levelSelect("sourceLevelId", "")}${levelSelect(
        "targetLevelId",
        "",
      )}`;
    case "move_to_external":
      return `${productSelect}${levelSelect("sourceLevelId", "")}${externalSelect(
        "targetExternalId",
      )}`;
    case "move_from_external":
      return `${productSelect}${externalSelect("sourceExternalId")}${levelSelect(
        "targetLevelId",
        "",
      )}`;
    case "ship_out":
      return `${productSelect}
        <label class="field">
          <span class="field__label">来源类型</span>
          <select class="field__select" name="sourceLocationType" required>
            <option value="warehouse">仓库内层数</option>
            <option value="external">外部位置</option>
          </select>
        </label>
        ${levelSelect("sourceLevelId", "")}
        ${externalSelect("sourceExternalId")}`;
    case "adjust_increase":
      return `${productSelect}
        <label class="field">
          <span class="field__label">目标类型</span>
          <select class="field__select" name="targetLocationType" required>
            <option value="warehouse">仓库内层数</option>
            <option value="external">外部位置</option>
          </select>
        </label>
        ${levelSelect("targetLevelId", presetTargetLevelId)}
        ${externalSelect("targetExternalId")}`;
    case "adjust_decrease":
      return `${productSelect}
        <label class="field">
          <span class="field__label">来源类型</span>
          <select class="field__select" name="sourceLocationType" required>
            <option value="warehouse">仓库内层数</option>
            <option value="external">外部位置</option>
          </select>
        </label>
        ${levelSelect("sourceLevelId", "")}
        ${externalSelect("sourceExternalId")}`;
    default:
      return "";
  }
}

function buildOpFromForm(type, formEl) {
  const f = formEl.elements;
  const qty = Number(f.qty?.value);
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new Error("数量必须大于 0");
  }
  const productId = f.productId?.value || "";
  if (!productId) throw new Error("请选择产品");
  const operatorName = f.operatorName?.value || "";
  const note = f.note?.value || "";

  switch (type) {
    case "put_in":
      return buildPutIn({
        productId,
        qty,
        targetLevelId: f.targetLevelId?.value,
        operatorName,
        note,
      });
    case "move":
      return buildMoveWarehouse({
        productId,
        qty,
        sourceLevelId: f.sourceLevelId?.value,
        targetLevelId: f.targetLevelId?.value,
        operatorName,
        note,
      });
    case "move_to_external":
      return buildMoveToExternal({
        productId,
        qty,
        sourceLevelId: f.sourceLevelId?.value,
        targetExternalId: f.targetExternalId?.value,
        operatorName,
        note,
      });
    case "move_from_external":
      return buildMoveFromExternal({
        productId,
        qty,
        sourceExternalId: f.sourceExternalId?.value,
        targetLevelId: f.targetLevelId?.value,
        operatorName,
        note,
      });
    case "ship_out": {
      const sourceLocationType = f.sourceLocationType?.value || "warehouse";
      return buildShipOut({
        productId,
        qty,
        sourceLocationType,
        sourceLevelId:
          sourceLocationType === "warehouse" ? f.sourceLevelId?.value : null,
        sourceExternalId:
          sourceLocationType === "external" ? f.sourceExternalId?.value : null,
        operatorName,
        note,
      });
    }
    case "adjust_increase": {
      const targetLocationType = f.targetLocationType?.value || "warehouse";
      return buildAdjustIncrease({
        productId,
        qty,
        targetLevelId:
          targetLocationType === "warehouse" ? f.targetLevelId?.value : null,
        targetExternalId:
          targetLocationType === "external" ? f.targetExternalId?.value : null,
        operatorName,
        note,
      });
    }
    case "adjust_decrease": {
      const sourceLocationType = f.sourceLocationType?.value || "warehouse";
      return buildAdjustDecrease({
        productId,
        qty,
        sourceLevelId:
          sourceLocationType === "warehouse" ? f.sourceLevelId?.value : null,
        sourceExternalId:
          sourceLocationType === "external" ? f.sourceExternalId?.value : null,
        operatorName,
        note,
      });
    }
    default:
      throw new Error(`未知操作类型：${type}`);
  }
}

function checkSourceAvailable(op, preview) {
  const srcType = op.source_location_type;
  if (!srcType || srcType === "none") return null;
  const key =
    srcType === "warehouse"
      ? `level:${op.source_level_id}`
      : `external:${op.source_external_location_id}`;
  const avail = getLocationQty(preview, op.product_id, key);
  if (avail < op.qty) {
    return `来源位置库存不足（当前 ${avail}）`;
  }
  return null;
}

async function scanIntoSelect(root, name, master, kind) {
  try {
    const text = await scanOnce({ hint: "请扫描位置二维码" });
    if (text === null) return; // 用户取消
    const r = parseLocationCode(text);
    if (!r.ok) {
      toast(r.reason, "warning");
      return;
    }
    let level = findLevelByParts(master, r.warehouse, r.shelf, r.levelNo);
    if (!level) level = findLevelByLocationCode(master, text);
    if (!level) {
      toast("该位置未在主数据中", "warning");
      return;
    }
    const select = root.querySelector(`select[name="${name}"]`);
    if (select) select.value = level.id;
    toast("已选择位置", "success");
  } catch (err) {
    toast(`扫码失败：${err?.message || err}`, "error");
  }
}
