import { db } from "./storage.js";
import {
  getApiBase,
  setApiBase,
  getSyncToken,
  setSyncToken,
  isRemoteMode,
  clearRemoteConfig,
  pingRemote,
  apiUrl,
  buildAuthHeaders,
} from "./api-config.js";
import { createDemoData, defaultDeviceProfile } from "./seed.js";
import {
  bySortOrder,
  escapeHtml,
  formatQty,
  normalizeText,
  readFileAsDataUrl,
  uuid,
} from "./utils.js";
import { searchProducts } from "./search.js";
import {
  THEMES,
  DEFAULT_THEME_ID,
  applyTheme,
  isValidThemeId,
} from "./themes.js";
import {
  parseLocationCode,
  formatLocationCode,
  startCameraScanner,
  hasMediaDevices,
} from "./scanner.js";

const appRoot = document.getElementById("app");
const dialog = document.getElementById("app-dialog");
const hiddenFileInput = document.getElementById("hidden-file-input");

const APP_VERSION = "20260429-move-01";
const OVERVIEW_PAGE_SIZE = 80;
const DESKTOP_TABS = [
  { id: "overview", label: "主页" },
  { id: "positions", label: "位置" },
  { id: "layout", label: "库位" },
  { id: "fields", label: "自定义信息" },
];

const MOBILE_TABS = [
  { id: "overview", label: "产品", icon: "grid" },
  { id: "positions", label: "位置", icon: "location" },
  { id: "entry", label: "录入", icon: "plus" },
  { id: "layout", label: "库位", icon: "warehouse" },
];

const WAREHOUSE_TONES = ["warehouse-1", "warehouse-2", "warehouse-3", "warehouse-4"];
const THEME_STORAGE_KEY = "appMeta:themeId";

const state = {
  mode: "desktop",
  desktopTab: "overview",
  query: "",
  searchDraft: "",
  overviewPage: 1,
  selectedProductId: null,
  selectedWarehouseId: null,
  selectedShelfId: null,
  positionWarehouseId: null,
  positionShelfId: null,
  positionView: "visual",
  layoutLevel: "warehouses",
  notice: null,
  pendingFileAction: null,
  context: null,
  themeId: DEFAULT_THEME_ID,
  toasts: [],
  scanner: null,
  syncTokenVisible: false,
};

let toastSeq = 0;

function nowIso() {
  return new Date().toISOString();
}

function text(value) {
  return String(value ?? "").trim();
}

const LEGACY_TONE_MAP = {
  blue: "warehouse-1",
  sage: "warehouse-2",
  green: "warehouse-2",
  purple: "warehouse-3",
  sand: "warehouse-4",
  amber: "warehouse-4",
};

function mapTone(token, fallbackIndex = 0) {
  if (token && WAREHOUSE_TONES.includes(token)) {
    return token;
  }
  if (token && LEGACY_TONE_MAP[token]) {
    return LEGACY_TONE_MAP[token];
  }
  return WAREHOUSE_TONES[fallbackIndex % WAREHOUSE_TONES.length];
}

function getDesktopTabLabel(tabId) {
  switch (tabId) {
    case "overview":
      return "主页";
    case "products":
      return "产品";
    case "layout":
      return "库位";
    case "positions":
      return "位置";
    case "fields":
      return "自定义信息";
    default:
      return tabId;
  }
}

function makePlaceholderImage(model, subtitle = "仓位产品") {
  const normalized = normalizeText(model || "NEW");
  const palettes = [
    ["#dce9dd", "#8da98e"],
    ["#e5dfd8", "#cfb18c"],
    ["#dbe6ea", "#8eaab8"],
    ["#e2eef6", "#7d9ec6"],
  ];
  const score = normalized.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const palette = palettes[score % palettes.length];
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600">
      <defs>
        <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${palette[0]}"/>
          <stop offset="100%" stop-color="${palette[1]}"/>
        </linearGradient>
      </defs>
      <rect width="600" height="600" rx="72" fill="url(#g)"/>
      <rect x="58" y="58" width="484" height="484" rx="50" fill="rgba(255,255,255,0.88)"/>
      <rect x="94" y="96" width="412" height="252" rx="34" fill="rgba(255,255,255,0.94)"/>
      <rect x="94" y="370" width="126" height="84" rx="22" fill="rgba(0,0,0,0.08)"/>
      <rect x="238" y="370" width="126" height="84" rx="22" fill="rgba(0,0,0,0.08)"/>
      <rect x="382" y="370" width="126" height="84" rx="22" fill="rgba(0,0,0,0.08)"/>
      <text x="300" y="210" text-anchor="middle" fill="#334038" font-size="52" font-family="Segoe UI, Arial, sans-serif" font-weight="700">${escapeXml(
        model || "新产品",
      )}</text>
      <text x="300" y="286" text-anchor="middle" fill="#687268" font-size="28" font-family="Segoe UI, Arial, sans-serif">${escapeXml(
        subtitle,
      )}</text>
      <text x="157" y="423" text-anchor="middle" fill="#334038" font-size="26" font-family="Segoe UI, Arial, sans-serif">仓位</text>
      <text x="301" y="423" text-anchor="middle" fill="#334038" font-size="26" font-family="Segoe UI, Arial, sans-serif">数量</text>
      <text x="445" y="423" text-anchor="middle" fill="#334038" font-size="26" font-family="Segoe UI, Arial, sans-serif">状态</text>
    </svg>
  `;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function createMetaEntry(key, value) {
  return { key, value };
}

async function ensureSeedData() {
  const initialized = await db.get(db.storeNames.appMeta, "initialized");
  if (!initialized) {
    await db.replaceStores(createDemoData());
  }

  const devices = await db.getAll(db.storeNames.devices);
  if (!devices.length) {
    await db.put(db.storeNames.devices, defaultDeviceProfile());
  }

  await db.put(db.storeNames.appMeta, createMetaEntry("initialized", true));
  await db.put(db.storeNames.appMeta, createMetaEntry("uiVersion", APP_VERSION));
}

async function loadStoredTheme() {
  let storedId = null;
  try {
    storedId = window.localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    storedId = null;
  }
  if (!storedId) {
    const meta = await db.get(db.storeNames.appMeta, "themeId");
    storedId = meta?.value || null;
  }
  const themeId = isValidThemeId(storedId) ? storedId : DEFAULT_THEME_ID;
  state.themeId = applyTheme(themeId);
}

async function selectTheme(themeId) {
  const id = isValidThemeId(themeId) ? themeId : DEFAULT_THEME_ID;
  state.themeId = applyTheme(id);
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, id);
  } catch {
    // ignore storage errors (e.g. private mode)
  }
  try {
    await db.put(db.storeNames.appMeta, createMetaEntry("themeId", id));
  } catch {
    // ignore — theme already applied to DOM
  }
  render();
}

function sortProducts(items) {
  return [...items].sort((left, right) => String(left.model || "").localeCompare(String(right.model || ""), "zh-CN"));
}

function buildContext(snapshot) {
  const ctx = {
    appMeta: snapshot.appMeta || [],
    products: sortProducts((snapshot.products || []).filter((item) => item.status !== "deleted")),
    customFieldDefinitions: bySortOrder((snapshot.customFieldDefinitions || []).filter((item) => item.status !== "deleted")),
    productCustomFieldValues: (snapshot.productCustomFieldValues || []).filter((item) => item.status !== "deleted"),
    warehouses: bySortOrder((snapshot.warehouses || []).filter((item) => item.status !== "deleted")),
    shelves: bySortOrder((snapshot.shelves || []).filter((item) => item.status !== "deleted")),
    shelfLevels: bySortOrder((snapshot.shelfLevels || []).filter((item) => item.status !== "deleted")),
    externalLocations: bySortOrder((snapshot.externalLocations || []).filter((item) => item.status !== "deleted")),
    inventoryBalances: (snapshot.inventoryBalances || [])
      .filter((item) => item.status !== "deleted")
      .filter((item) => Number(item.qty || 0) > 0),
    inventoryOperations: snapshot.inventoryOperations || [],
    devices: snapshot.devices || [],
    masterExports: snapshot.masterExports || [],
    importBatches: snapshot.importBatches || [],
  };

  ctx.metaByKey = new Map(ctx.appMeta.map((item) => [item.key, item.value]));
  ctx.productsById = new Map(ctx.products.map((item) => [item.id, item]));
  ctx.customFieldDefinitionsById = new Map(ctx.customFieldDefinitions.map((item) => [item.id, item]));
  ctx.warehousesById = new Map(ctx.warehouses.map((item) => [item.id, item]));
  ctx.shelvesById = new Map(ctx.shelves.map((item) => [item.id, item]));
  ctx.shelfLevelsById = new Map(ctx.shelfLevels.map((item) => [item.id, item]));
  ctx.externalLocationsById = new Map(ctx.externalLocations.map((item) => [item.id, item]));
  ctx.valuesByProductId = new Map();
  ctx.valuesByFieldId = new Map();
  ctx.balancesByProductId = new Map();

  for (const value of ctx.productCustomFieldValues) {
    const productValues = ctx.valuesByProductId.get(value.productId) || [];
    productValues.push(value);
    ctx.valuesByProductId.set(value.productId, productValues);

    const fieldValues = ctx.valuesByFieldId.get(value.fieldId) || [];
    fieldValues.push(value);
    ctx.valuesByFieldId.set(value.fieldId, fieldValues);
  }

  for (const balance of ctx.inventoryBalances) {
    const rows = ctx.balancesByProductId.get(balance.productId) || [];
    rows.push(balance);
    ctx.balancesByProductId.set(balance.productId, rows);
  }

  return ctx;
}

function getMetaValue(key, fallback = "") {
  return state.context?.metaByKey?.get(key) ?? fallback;
}

function isPendingOperation(operation) {
  return (
    operation?.deviceStatus === "pending" ||
    operation?.importStatus === "pending" ||
    (!operation?.importedAt && !operation?.exportedAt)
  );
}

function getPendingOperationCount(ctx = state.context) {
  return (ctx?.inventoryOperations || []).filter(isPendingOperation).length;
}

async function refreshContext(options = {}) {
  const snapshot = await db.exportAll();
  state.context = buildContext(snapshot);
  syncSelection(options);
  render();
}

function getSearchResults(ctx = state.context) {
  if (!ctx) {
    return [];
  }
  return searchProducts(ctx.products, state.query, ctx);
}

function getFieldValueMap(productId, ctx = state.context) {
  const map = new Map();
  if (!ctx || !productId) {
    return map;
  }
  for (const item of ctx.valuesByProductId.get(productId) || []) {
    map.set(item.fieldId, item.valueText || "");
  }
  return map;
}

function getFieldDisplayText(productId, ctx = state.context) {
  const map = getFieldValueMap(productId, ctx);
  const parts = ctx.customFieldDefinitions
    .map((field) => map.get(field.id))
    .filter(Boolean);
  return parts.join(" / ");
}

function getProductBalances(productId, ctx = state.context) {
  return [...(ctx?.balancesByProductId.get(productId) || [])];
}

function resolveBalanceLocation(balance, ctx = state.context) {
  if (!ctx) {
    return null;
  }
  if (balance.locationType === "external") {
    const external = ctx.externalLocationsById.get(balance.externalLocationId);
    if (!external) {
      return null;
    }
    return {
      kind: "external",
      external,
      label: external.name,
      code: external.code,
    };
  }

  const level = ctx.shelfLevelsById.get(balance.levelId);
  if (!level) {
    return null;
  }
  const shelf = ctx.shelvesById.get(level.shelfId);
  const warehouse = shelf ? ctx.warehousesById.get(shelf.warehouseId) : null;
  if (!warehouse || !shelf) {
    return null;
  }
  return {
    kind: "warehouse",
    warehouse,
    shelf,
    level,
    label: `${warehouse.name} / ${shelf.code} / ${level.levelNo} 层`,
    code: level.locationCode,
  };
}

function getProductPositionData(productId, ctx = state.context) {
  const balances = getProductBalances(productId, ctx);
  const warehouseQtyById = new Map();
  const shelfQtyById = new Map();
  const levelQtyById = new Map();
  const externalRows = [];
  let totalQty = 0;

  for (const balance of balances) {
    const qty = Number(balance.qty || 0);
    totalQty += qty;
    const location = resolveBalanceLocation(balance, ctx);
    if (!location) {
      continue;
    }
    if (location.kind === "external") {
      externalRows.push({
        balance,
        external: location.external,
        qty,
      });
      continue;
    }
    warehouseQtyById.set(location.warehouse.id, (warehouseQtyById.get(location.warehouse.id) || 0) + qty);
    shelfQtyById.set(location.shelf.id, (shelfQtyById.get(location.shelf.id) || 0) + qty);
    levelQtyById.set(location.level.id, (levelQtyById.get(location.level.id) || 0) + qty);
  }

  return {
    balances,
    warehouseQtyById,
    shelfQtyById,
    levelQtyById,
    externalRows,
    totalQty,
  };
}

function getLayoutInventory(ctx = state.context) {
  const levelMap = new Map();
  const shelfMap = new Map();
  const warehouseMap = new Map();
  if (!ctx) {
    return { levelMap, shelfMap, warehouseMap };
  }
  for (const balance of ctx.inventoryBalances || []) {
    if (balance.locationType !== "warehouse" || !balance.levelId) continue;
    const qty = Number(balance.qty || 0);
    if (qty <= 0) continue;
    const level = ctx.shelfLevelsById.get(balance.levelId);
    if (!level) continue;
    const shelf = ctx.shelvesById.get(level.shelfId);
    if (!shelf) continue;
    const product = ctx.productsById.get(balance.productId);
    if (!product) continue;

    if (!levelMap.has(level.id)) {
      levelMap.set(level.id, { totalQty: 0, items: [] });
    }
    const entry = levelMap.get(level.id);
    entry.totalQty += qty;
    entry.items.push({ productId: product.id, model: product.model, qty });

    shelfMap.set(shelf.id, (shelfMap.get(shelf.id) || 0) + qty);
    warehouseMap.set(shelf.warehouseId, (warehouseMap.get(shelf.warehouseId) || 0) + qty);
  }
  return { levelMap, shelfMap, warehouseMap };
}

function productPaletteIndex(productId) {
  const id = String(productId || "");
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 5;
}

function syncSelection(options = {}) {
  const ctx = state.context;
  if (!ctx) {
    return;
  }

  const results = getSearchResults(ctx);
  const availableProductIds = results.map((item) => item.id);
  if (options.preferProductId && ctx.productsById.has(options.preferProductId)) {
    state.selectedProductId = options.preferProductId;
  } else if (!state.selectedProductId || !ctx.productsById.has(state.selectedProductId)) {
    state.selectedProductId = availableProductIds[0] || ctx.products[0]?.id || null;
  } else if (state.query && availableProductIds.length && !availableProductIds.includes(state.selectedProductId)) {
    state.selectedProductId = availableProductIds[0];
  }

  const selectedProduct = ctx.productsById.get(state.selectedProductId);
  const positionData = selectedProduct ? getProductPositionData(selectedProduct.id, ctx) : null;
  const recommendedWarehouseId =
    options.preferWarehouseId ||
    (positionData ? [...positionData.warehouseQtyById.keys()][0] : null) ||
    ctx.warehouses[0]?.id ||
    null;

  if (!state.selectedWarehouseId || !ctx.warehousesById.has(state.selectedWarehouseId)) {
    state.selectedWarehouseId = recommendedWarehouseId;
  }

  const shelves = ctx.shelves.filter((item) => item.warehouseId === state.selectedWarehouseId);
  const recommendedShelfId =
    options.preferShelfId ||
    shelves.find((item) => positionData?.shelfQtyById.has(item.id))?.id ||
    shelves[0]?.id ||
    null;

  if (!state.selectedShelfId || !ctx.shelvesById.has(state.selectedShelfId) || !shelves.some((item) => item.id === state.selectedShelfId)) {
    state.selectedShelfId = recommendedShelfId;
  }

  if (state.positionWarehouseId && !ctx.warehousesById.has(state.positionWarehouseId)) {
    state.positionWarehouseId = null;
  }
  if (state.positionShelfId && !ctx.shelvesById.has(state.positionShelfId)) {
    state.positionShelfId = null;
  }
  if (state.positionShelfId) {
    const focusedShelf = ctx.shelvesById.get(state.positionShelfId);
    if (!focusedShelf || (state.positionWarehouseId && focusedShelf.warehouseId !== state.positionWarehouseId)) {
      state.positionShelfId = null;
    }
  }
}

function setNotice(textValue, type = "ready") {
  state.notice = {
    text: textValue,
    type,
  };
  pushToast(textValue, type);
  render();
  window.clearTimeout(setNotice.timer);
  setNotice.timer = window.setTimeout(() => {
    state.notice = null;
    render();
  }, 2600);
}

function pushToast(message, type = "ready") {
  if (!message) {
    return;
  }
  toastSeq += 1;
  const id = toastSeq;
  state.toasts = [...state.toasts, { id, message, type }];
  renderToasts();
  window.setTimeout(() => {
    state.toasts = state.toasts.filter((toast) => toast.id !== id);
    renderToasts();
  }, 2400);
}

function getToastStack() {
  let stack = document.getElementById("toast-stack");
  if (!stack) {
    stack = document.createElement("div");
    stack.id = "toast-stack";
    stack.className = "toast-stack";
    document.body.appendChild(stack);
  }
  return stack;
}

function renderToasts() {
  const stack = getToastStack();
  stack.innerHTML = state.toasts
    .map(
      (toast) => `
        <div class="toast ${escapeHtml(toast.type === "ready" ? "success" : toast.type)}">
          <span>${escapeHtml(toast.message)}</span>
        </div>
      `,
    )
    .join("");
}

function render() {
  const ctx = state.context;
  if (!ctx) {
    appRoot.innerHTML = `<div class="app-frame"><section class="panel"><div class="panel-body empty-state">正在加载...</div></section></div>`;
    renderMobileTabbar();
    return;
  }

  appRoot.innerHTML = `
    <div class="app-frame">
      ${renderHeaderCompact()}
      ${renderCurrentTab(ctx)}
    </div>
  `;
  renderMobileTabbar();

  if (state.pendingMoveAnimation) {
    const anim = state.pendingMoveAnimation;
    state.pendingMoveAnimation = null;
    requestAnimationFrame(() => playMoveAnimation(anim));
  }
}

function playMoveAnimation({ sourceLevelId, targetLevelId, qty }) {
  const sourceEl = document.querySelector(`[data-position-level-id="${sourceLevelId}"]`);
  const targetEl = document.querySelector(`[data-position-level-id="${targetLevelId}"]`);

  if (targetEl) {
    targetEl.classList.add("move-flash-in");
    const badge = document.createElement("span");
    badge.className = "move-flash-badge";
    badge.textContent = `+${formatQty(qty)}`;
    targetEl.appendChild(badge);
    window.setTimeout(() => {
      targetEl.classList.remove("move-flash-in");
      badge.remove();
    }, 1400);
  }
  if (sourceEl && sourceEl !== targetEl) {
    sourceEl.classList.add("move-flash-out");
    window.setTimeout(() => {
      sourceEl.classList.remove("move-flash-out");
    }, 1000);
  }
  if (sourceEl && targetEl && sourceEl !== targetEl) {
    flyMoveGhost(sourceEl, targetEl, qty);
  } else if (!sourceEl && targetEl) {
    flyMoveGhostInto(targetEl, qty);
  }
}

function flyMoveGhost(sourceEl, targetEl, qty) {
  const sourceRect = sourceEl.getBoundingClientRect();
  const targetRect = targetEl.getBoundingClientRect();
  const ghost = document.createElement("div");
  ghost.className = "move-fly-ghost";
  ghost.textContent = `+${formatQty(qty)}`;
  const startX = sourceRect.left + sourceRect.width / 2;
  const startY = sourceRect.top + sourceRect.height / 2;
  const endX = targetRect.left + targetRect.width / 2;
  const endY = targetRect.top + targetRect.height / 2;
  ghost.style.left = `${startX}px`;
  ghost.style.top = `${startY}px`;
  document.body.appendChild(ghost);

  requestAnimationFrame(() => {
    ghost.style.transform = `translate(calc(-50% + ${endX - startX}px), calc(-50% + ${endY - startY}px)) scale(0.7)`;
    ghost.style.opacity = "0";
  });
  window.setTimeout(() => ghost.remove(), 800);
}

function flyMoveGhostInto(targetEl, qty) {
  const targetRect = targetEl.getBoundingClientRect();
  const ghost = document.createElement("div");
  ghost.className = "move-fly-ghost";
  ghost.textContent = `+${formatQty(qty)}`;
  const endX = targetRect.left + targetRect.width / 2;
  const endY = targetRect.top + targetRect.height / 2;
  ghost.style.left = `${endX}px`;
  ghost.style.top = `${endY - 60}px`;
  document.body.appendChild(ghost);
  requestAnimationFrame(() => {
    ghost.style.transform = `translate(-50%, -50%) scale(1)`;
    ghost.style.opacity = "1";
  });
  window.setTimeout(() => {
    ghost.style.transform = `translate(-50%, calc(-50% + 60px)) scale(0.7)`;
    ghost.style.opacity = "0";
  }, 250);
  window.setTimeout(() => ghost.remove(), 900);
}

function renderHeader() {
  return renderHeaderCompact();
}

function renderCurrentTab(ctx) {
  switch (state.desktopTab) {
    case "products":
      return renderProductsPage(ctx);
    case "layout":
      return renderLayoutPage(ctx);
    case "positions":
      return renderPositionsStageV2(ctx);
    case "entry":
      return renderEntryPage(ctx);
    case "fields":
      return renderFieldsPage(ctx);
    case "overview":
    default:
      return renderOverviewPageV2(ctx);
  }
}

function renderThemePicker() {
  return `
    <div class="theme-picker" role="radiogroup" aria-label="主题">
      ${THEMES.map((theme) => `
        <button
          class="swatch ${state.themeId === theme.id ? "active" : ""}"
          type="button"
          role="radio"
          aria-checked="${state.themeId === theme.id}"
          aria-label="${escapeHtml(theme.name)}"
          title="${escapeHtml(theme.name)} · ${escapeHtml(theme.description)}"
          data-action="select-theme"
          data-theme-id="${theme.id}"
        ></button>
      `).join("")}
    </div>
  `;
}

function renderMobileTabbar() {
  let bar = document.getElementById("mobile-tabbar");
  if (!bar) {
    bar = document.createElement("nav");
    bar.id = "mobile-tabbar";
    bar.className = "mobile-tabbar";
    document.body.appendChild(bar);
    bar.addEventListener("click", handleRootClick);
  }
  bar.innerHTML = `
    <div class="mobile-tabbar-inner">
      ${MOBILE_TABS.map((tab) => `
        <button
          class="mobile-tab ${state.desktopTab === tab.id ? "active" : ""}"
          type="button"
          data-action="switch-tab"
          data-tab="${tab.id}"
        >
          ${renderMobileTabIcon(tab.icon)}
          <span>${escapeHtml(tab.label)}</span>
        </button>
      `).join("")}
    </div>
  `;
}

function renderMobileTabIcon(name) {
  const common = `class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"`;
  switch (name) {
    case "grid":
      return `<svg ${common}><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>`;
    case "location":
      return `<svg ${common}><path d="M12 22s7-7.58 7-13a7 7 0 0 0-14 0c0 5.42 7 13 7 13z"/><circle cx="12" cy="9" r="2.5"/></svg>`;
    case "plus":
      return `<svg ${common}><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>`;
    case "warehouse":
      return `<svg ${common}><path d="M3 21V9l9-5 9 5v12"/><path d="M9 21v-7h6v7"/></svg>`;
    default:
      return "";
  }
}

function renderGlobalSearchForm() {
  return `
    <form class="search-form" data-form="global-search" role="search">
      <div class="search-bar">
        <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3-3"/></svg>
        <input
          type="text"
          value="${escapeHtml(state.searchDraft)}"
          data-role="global-search-draft"
          aria-label="搜索产品型号或关键词"
          autocomplete="off"
          inputmode="search"
        >
        <button class="button tone-search" type="submit">搜索</button>
        <button class="button ghost" type="button" data-action="search-by-image" title="上传图片，按相似度查找产品">按图搜索</button>
      </div>
    </form>
  `;
}

function renderOverviewActionCluster() {
  return `
    <div class="header-action-cluster overview-cluster">
      <button class="button tone-mist" type="button" data-action="import-excel">导入 Excel</button>
      <button class="button tone-olive" type="button" data-action="open-product-dialog">新增产品</button>
    </div>
  `;
}

function getOverviewPageData(results) {
  const totalPages = Math.max(1, Math.ceil(results.length / OVERVIEW_PAGE_SIZE));
  const currentPage = Math.min(Math.max(1, state.overviewPage || 1), totalPages);
  if (currentPage !== state.overviewPage) {
    state.overviewPage = currentPage;
  }
  const start = (currentPage - 1) * OVERVIEW_PAGE_SIZE;
  return {
    currentPage,
    totalPages,
    items: results.slice(start, start + OVERVIEW_PAGE_SIZE),
  };
}

function renderOverviewPagination(currentPage, totalPages) {
  if (totalPages <= 1) {
    return "";
  }
  return `
    <div class="home-pagination">
      <button class="button secondary" type="button" data-action="overview-page-prev" ${currentPage <= 1 ? "disabled" : ""}>上一页</button>
      <span class="page-indicator">${currentPage} / ${totalPages}</span>
      <button class="button secondary" type="button" data-action="overview-page-next" ${currentPage >= totalPages ? "disabled" : ""}>下一页</button>
    </div>
  `;
}

function renderOverviewPageV2(ctx) {
  const results = getSearchResults(ctx);
  const pageData = getOverviewPageData(results);
  const totalProducts = ctx.products.length;

  return `
    <div class="single-column">
      <section class="panel home-panel">
        <div class="home-search-shell">
          ${renderGlobalSearchForm()}
        </div>
        <div class="home-grid-body">
          ${results.length
            ? `
              <div class="product-grid">
                ${pageData.items.map((product) => renderProductCard(product, product.id === state.selectedProductId, true)).join("")}
              </div>
              ${renderOverviewPagination(pageData.currentPage, pageData.totalPages)}
            `
            : renderEmptyResults(state.query, totalProducts)}
        </div>
      </section>
    </div>
  `;
}

function renderEmptyResults(query, totalProducts) {
  if (!totalProducts) {
    return `
      <div class="empty-state">
        <span class="empty-title">还没有产品</span>
        <span>点击右上角“+ 录入”开始添加你的第一个产品。</span>
      </div>
    `;
  }
  if (query) {
    return `
      <div class="empty-state">
        <span class="empty-title">没有匹配的产品</span>
        <span>试试更短的关键词，或检查型号大小写。</span>
        <button class="button secondary" type="button" data-action="clear-search">清空搜索</button>
      </div>
    `;
  }
  return `<div class="empty-state">还没有产品</div>`;
}

function renderOverviewPage(ctx) {
  return renderOverviewPageV2(ctx);
}

function renderHandheldOverviewPage(ctx) {
  return renderOverviewPageV2(ctx);
}

function renderProductsPage(ctx) {
  return `
    <div class="single-column">
      <section class="panel">
        <div class="panel-header">
          <h3 class="panel-title">产品</h3>
          <button class="button primary" type="button" data-action="open-product-dialog">新增产品</button>
        </div>
        <div class="panel-body card-list">
          ${ctx.products.length
            ? ctx.products.map((product) => renderProductListCard(product, ctx)).join("")
            : `<div class="empty-state">还没有产品</div>`}
        </div>
      </section>
    </div>
  `;
}

function externalIconSvg() {
  const stroke = "#ff9f0a";
  const fill = "rgba(255, 159, 10, 0.12)";
  return `
    <svg class="icon-svg" viewBox="0 0 100 100" aria-hidden="true">
      <rect x="18" y="34" width="64" height="48" rx="6" fill="${fill}"/>
      <rect x="18" y="34" width="64" height="48" rx="6" fill="none" stroke="${stroke}" stroke-width="2.4"/>
      <line x1="18" y1="50" x2="82" y2="50" stroke="${stroke}" stroke-width="2" stroke-linecap="round"/>
      <rect x="42" y="34" width="16" height="16" fill="${fill}" stroke="${stroke}" stroke-width="2" stroke-linejoin="round"/>
    </svg>
  `;
}

function renderLayoutBreadcrumbs(ctx) {
  const wh = state.layoutLevel !== "warehouses" ? ctx.warehousesById.get(state.selectedWarehouseId) : null;
  const sh = state.layoutLevel === "levels" ? ctx.shelvesById.get(state.selectedShelfId) : null;

  const crumbs = [];
  if (state.layoutLevel === "warehouses") {
    crumbs.push(`<span class="crumb-current">所有仓库</span>`);
  } else {
    crumbs.push(`<button type="button" data-action="back-to-warehouses">所有仓库</button>`);
    crumbs.push(`<span class="crumb-sep">›</span>`);
    if (state.layoutLevel === "shelves") {
      crumbs.push(`<span class="crumb-current">${escapeHtml(wh?.name || "")}</span>`);
    } else {
      crumbs.push(`<button type="button" data-action="back-to-shelves">${escapeHtml(wh?.name || "")}</button>`);
      crumbs.push(`<span class="crumb-sep">›</span>`);
      crumbs.push(`<span class="crumb-current">${escapeHtml(sh?.code || "")}</span>`);
    }
  }
  return `<div class="layout-breadcrumbs">${crumbs.join("")}</div>`;
}

function renderLayoutPage(ctx) {
  if (state.layoutLevel === "shelves" && !ctx.warehousesById.has(state.selectedWarehouseId)) {
    state.layoutLevel = "warehouses";
  }
  if (state.layoutLevel === "levels" && !ctx.shelvesById.has(state.selectedShelfId)) {
    state.layoutLevel = "shelves";
  }

  const inventory = getLayoutInventory(ctx);
  let main = "";
  if (state.layoutLevel === "warehouses") {
    main = renderWarehouseGrid(ctx, inventory);
  } else if (state.layoutLevel === "shelves") {
    main = renderShelfGrid(ctx, inventory);
  } else {
    main = renderLevelGrid(ctx, inventory);
  }

  return `
    <div class="single-column layout-shell">
      <section class="panel">
        <div class="panel-header">
          ${renderLayoutBreadcrumbs(ctx)}
        </div>
        <div class="panel-body">
          ${main}
        </div>
      </section>
      ${state.layoutLevel === "warehouses" ? renderExternalSection(ctx) : ""}
    </div>
  `;
}

function renderWarehouseGrid(ctx, inventory) {
  const tiles = ctx.warehouses
    .map((warehouse, index) => {
      const shelfCount = ctx.shelves.filter((s) => s.warehouseId === warehouse.id).length;
      const totalQty = inventory.warehouseMap.get(warehouse.id) || 0;
      const isActive = warehouse.id === state.selectedWarehouseId;
      return `
        <button
          type="button"
          class="warehouse-node tone-${mapTone(warehouse.colorToken, index)} ${isActive ? "stocked-pulse" : ""}"
          data-action="drill-warehouse"
          data-warehouse-id="${warehouse.id}"
          data-longpress="warehouse"
        >
          <div class="warehouse-body">
            <span class="warehouse-code">${escapeHtml(warehouse.name)}</span>
            <span class="warehouse-label">${shelfCount} 个货架${totalQty ? ` · ${formatQty(totalQty)} 件` : ""}</span>
          </div>
        </button>
      `;
    })
    .join("");
  const empty = `
    <button type="button" class="warehouse-node warehouse-add-tile" data-action="open-warehouse-dialog">
      <div class="warehouse-body">
        <span class="tile-add-glyph">+</span>
        <span class="warehouse-label">新增仓库</span>
      </div>
    </button>
  `;
  return `<div class="warehouse-grid warehouse-overview-grid">${tiles}${empty}</div>`;
}

function renderShelfGrid(ctx, inventory) {
  const warehouse = ctx.warehousesById.get(state.selectedWarehouseId);
  const shelves = warehouse ? ctx.shelves.filter((s) => s.warehouseId === warehouse.id) : [];
  const tiles = shelves
    .map((shelf) => {
      const realLevels = ctx.shelfLevels.filter((l) => l.shelfId === shelf.id);
      const displayLevels = buildShelfLevelsForDisplay(warehouse, shelf, realLevels);
      const stockedSet = new Set(realLevels.filter((l) => inventory.levelMap.has(l.id)).map((l) => l.id));
      const totalQty = inventory.shelfMap.get(shelf.id) || 0;
      const isActive = shelf.id === state.selectedShelfId;
      return `
        <button
          type="button"
          class="shelf-overview-card layout-shelf-card ${stockedSet.size ? "stocked" : ""} ${isActive ? "stocked-pulse" : ""}"
          data-action="drill-shelf"
          data-shelf-id="${shelf.id}"
          data-longpress="shelf"
        >
          <div class="shelf-overview-head">
            <span class="shelf-overview-code">${escapeHtml(shelf.code)}</span>
            <div class="shelf-overview-badges">
              <span class="shelf-overview-meta">${realLevels.length} 层</span>
              ${totalQty ? `<span class="shelf-overview-count">${formatQty(totalQty)} 件</span>` : ""}
            </div>
          </div>
          <div class="shelf-overview-face">
            ${displayLevels.length
              ? displayLevels.map((level) => `
                <div class="shelf-overview-tier ${stockedSet.has(level.id) ? "stocked" : ""}">
                  <span class="tier-line"></span>
                </div>
              `).join("")
              : `<div class="shelf-overview-tier"></div>`}
          </div>
          ${shelf.name ? `<div class="shelf-overview-foot">${escapeHtml(shelf.name)}</div>` : ""}
        </button>
      `;
    })
    .join("");
  const empty = `
    <button type="button" class="shelf-overview-card shelf-add-tile" data-action="open-shelf-dialog">
      <span class="tile-add-glyph">+</span>
      <span class="shelf-overview-meta">新增货架</span>
    </button>
  `;
  return `<div class="shelf-overview-grid">${tiles || ""}${empty}</div>`;
}

function renderLevelGrid(ctx, inventory) {
  const shelf = ctx.shelvesById.get(state.selectedShelfId);
  if (!shelf) {
    return `<div class="empty-state">还没有货架</div>`;
  }
  const warehouse = ctx.warehousesById.get(shelf.warehouseId);
  const realLevels = ctx.shelfLevels.filter((l) => l.shelfId === shelf.id);
  const displayLevels = buildShelfLevelsForDisplay(warehouse, shelf, realLevels);

  const rack = displayLevels.length
    ? displayLevels.map((level) => renderLayoutLevelRow(level, inventory)).join("")
    : `<div class="empty-state">这个货架还没有层数</div>`;

  return `
    <div class="layout-level-shell">
      <div class="shelf-detail-rack layout-level-rack">
        ${rack}
      </div>
      <div class="layout-level-actions">
        <button class="button secondary" type="button" data-action="open-level-dialog">+ 新增层数</button>
      </div>
    </div>
  `;
}

function renderLayoutLevelRow(level, inventory) {
  const data = !level.isVirtual ? inventory.levelMap.get(level.id) : null;
  const items = data?.items || [];
  const totalQty = data?.totalQty || 0;
  const longpressAttr = level.isVirtual ? "" : `data-longpress="level" data-level-id="${level.id}"`;
  const stateClass = level.isVirtual ? "virtual" : (totalQty ? "stocked" : "empty");

  const grouped = new Map();
  for (const item of items) {
    if (!grouped.has(item.productId)) {
      grouped.set(item.productId, { model: item.model, qty: 0 });
    }
    grouped.get(item.productId).qty += item.qty;
  }
  const productPills = Array.from(grouped.entries())
    .sort((a, b) => b[1].qty - a[1].qty)
    .map(([productId, info]) => {
      const tone = productPaletteIndex(productId);
      return `
        <span class="layout-level-pill tone-${tone}" title="${escapeHtml(info.model)} · ${formatQty(info.qty)} 件">
          <span class="layout-level-pill-dot"></span>
          <span class="layout-level-pill-label">${escapeHtml(info.model)}</span>
          <span class="layout-level-pill-qty">${formatQty(info.qty)}</span>
        </span>
      `;
    })
    .join("");

  const blocks = items
    .flatMap((item) => Array.from({ length: Math.min(20, Math.max(1, Math.round(item.qty))) }, () => productPaletteIndex(item.productId)))
    .slice(0, 24)
    .map((tone) => `<span class="layout-level-block tone-${tone}"></span>`)
    .join("");

  return `
    <div class="layout-level-row ${stateClass}" ${longpressAttr}>
      <div class="layout-level-side">
        <div class="layout-level-no">${escapeHtml(`${level.levelNo}`)}<span class="layout-level-no-suffix"> 层</span></div>
        ${level.isVirtual
          ? `<div class="layout-level-status">未创建</div>`
          : `<div class="layout-level-code">${escapeHtml(level.locationCode || "")}</div>`}
      </div>
      <div class="layout-level-body">
        <div class="layout-level-blocks" aria-hidden="true">
          ${blocks || `<span class="layout-level-empty-hint">${level.isVirtual ? "暂未创建" : "暂无库存"}</span>`}
        </div>
        ${productPills ? `<div class="layout-level-pills">${productPills}</div>` : ""}
      </div>
      <div class="layout-level-meta">
        ${totalQty ? `<div class="layout-level-qty">${formatQty(totalQty)}<span class="layout-level-qty-suffix">件</span></div>` : `<div class="layout-level-qty muted">0<span class="layout-level-qty-suffix">件</span></div>`}
      </div>
    </div>
  `;
}

function renderExternalSection(ctx) {
  const tiles = ctx.externalLocations
    .map((item) => `
      <div class="iconographic-tile" data-longpress="external" data-external-id="${item.id}">
        ${externalIconSvg()}
        <div class="icon-label">${escapeHtml(item.name)}</div>
        <div class="icon-meta">${escapeHtml(item.code || "")}</div>
      </div>
    `)
    .join("");
  const empty = `
    <div class="iconographic-tile empty-tile" data-action="open-external-dialog">
      <span class="tile-add-glyph">+</span>
      <span class="icon-meta">新增非仓库位置</span>
    </div>
  `;
  return `
    <section class="panel layout-section">
      <div class="panel-header">
        <h3 class="panel-title">非仓库位置</h3>
      </div>
      <div class="panel-body">
        <div class="iconographic-grid">${tiles}${empty}</div>
      </div>
    </section>
  `;
}

function renderPositionsPage(ctx) {
  if (state.mode === "handheld") {
    return renderHandheldPositionsPage(ctx);
  }
  const results = getSearchResults(ctx);
  const selectedProduct = ctx.productsById.get(state.selectedProductId) || results[0] || ctx.products[0] || null;
  if (!selectedProduct) {
    return `
      <section class="panel">
        <div class="panel-body empty-state">还没有产品，先新增一个产品。</div>
      </section>
    `;
  }

  const positionData = getProductPositionData(selectedProduct.id, ctx);

  return `
    <div class="main-grid position-page">
      <div class="single-column">
        <section class="panel">
          <div class="panel-header">
            <h3 class="panel-title">位置</h3>
          </div>
          <div class="panel-body search-shell">
            <div class="search-bar">
              <span>搜索</span>
              <input type="text" value="${escapeHtml(state.query)}" placeholder="搜索型号或自定义信息" data-role="global-search">
            </div>
          </div>
          <div class="product-grid compact-product-grid">
            ${results.length
              ? results.map((product) => renderProductCard(product, product.id === selectedProduct.id, false)).join("")
              : `<div class="empty-state">没有匹配的产品</div>`}
          </div>
        </section>
      </div>
      <div class="single-column">
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">${escapeHtml(selectedProduct.model)}</h3>
            </div>
            <div class="detail-tabs">
              <button class="detail-tab ${state.positionView === "visual" ? "active" : ""}" type="button" data-action="switch-position-view" data-view="visual">图形</button>
              <button class="detail-tab ${state.positionView === "table" ? "active" : ""}" type="button" data-action="switch-position-view" data-view="table">文字</button>
            </div>
          </div>
          <div class="panel-body">
            <div class="split-view">
              <div class="detail-media">
                <img class="detail-image" src="${escapeHtml(selectedProduct.image || makePlaceholderImage(selectedProduct.model))}" alt="${escapeHtml(selectedProduct.model)}">
              </div>
              <div class="meta-grid">
                <div class="meta-card">
                  <div class="meta-label">总数</div>
                  <div class="meta-value">${formatQty(positionData.totalQty)}</div>
                </div>
                <div class="meta-card">
                  <div class="meta-label">仓库位置</div>
                  <div class="meta-value">${positionData.warehouseQtyById.size}</div>
                </div>
                <div class="meta-card">
                  <div class="meta-label">非仓库位置</div>
                  <div class="meta-value">${positionData.externalRows.length}</div>
                </div>
                <div class="meta-card">
                  <div class="meta-label">型号</div>
                  <div class="meta-value">${escapeHtml(selectedProduct.model)}</div>
                </div>
              </div>
            </div>
            <div style="margin-top: 18px;">
              ${state.positionView === "visual" ? renderPositionVisual(selectedProduct, ctx, positionData) : renderPositionTable(selectedProduct, ctx, positionData)}
            </div>
          </div>
        </section>
      </div>
    </div>
  `;
}

function renderHandheldPositionsPage(ctx) {
  const results = getSearchResults(ctx);
  const selectedProduct = ctx.productsById.get(state.selectedProductId) || results[0] || ctx.products[0] || null;
  if (!selectedProduct) {
    return `
      <section class="panel">
        <div class="panel-body empty-state">还没有产品，先新增一个产品。</div>
      </section>
    `;
  }

  const positionData = getProductPositionData(selectedProduct.id, ctx);

  return `
    <div class="single-column">
      <section class="panel">
        <div class="panel-header">
          <h3 class="panel-title">位置</h3>
          <div class="detail-tabs">
            <button class="detail-tab ${state.positionView === "visual" ? "active" : ""}" type="button" data-action="switch-position-view" data-view="visual">图形</button>
            <button class="detail-tab ${state.positionView === "table" ? "active" : ""}" type="button" data-action="switch-position-view" data-view="table">文字</button>
          </div>
        </div>
        <div class="panel-body search-shell">
          <div class="search-bar">
            <span>搜索</span>
            <input type="text" value="${escapeHtml(state.query)}" placeholder="搜索型号或自定义信息" data-role="global-search">
          </div>
        </div>
        <div class="product-grid compact-product-grid">
          ${results.length
            ? results.map((product) => renderProductCard(product, product.id === selectedProduct.id, false)).join("")
            : `<div class="empty-state">没有匹配的产品</div>`}
        </div>
      </section>
      <section class="panel">
        <div class="panel-body">
          <div class="split-view visual-hero">
            <div class="detail-media">
              <img class="detail-image" src="${escapeHtml(selectedProduct.image || makePlaceholderImage(selectedProduct.model))}" alt="${escapeHtml(selectedProduct.model)}">
            </div>
            <div class="meta-grid handheld-grid">
              <div class="meta-card hero-metric">
                <div class="meta-label">型号</div>
                <div class="meta-value">${escapeHtml(selectedProduct.model)}</div>
              </div>
              <div class="meta-card hero-metric">
                <div class="meta-label">总数</div>
                <div class="meta-value">${formatQty(positionData.totalQty)}</div>
              </div>
              <div class="meta-card hero-metric">
                <div class="meta-label">仓库</div>
                <div class="meta-value">${positionData.warehouseQtyById.size}</div>
              </div>
            </div>
          </div>
          <div style="margin-top: 18px;">
            ${state.positionView === "visual" ? renderPositionVisual(selectedProduct, ctx, positionData) : renderPositionTable(selectedProduct, ctx, positionData)}
          </div>
        </div>
      </section>
    </div>
  `;
}

function renderEntryPage(ctx) {
  const recentOps = (ctx.inventoryOperations || [])
    .filter((op) => op.operationType === "put_in")
    .sort((a, b) => String(b.operatedAt || "").localeCompare(String(a.operatedAt || "")))
    .slice(0, 5);

  return `
    <div class="single-column">
      <section class="panel">
        <div class="panel-header">
          <div>
            <h3 class="panel-title">快速录入</h3>
            <p class="panel-note">录入产品到对应仓库 / 货架 / 层数。</p>
          </div>
        </div>
        <div class="panel-body">
          <div class="form-grid">
            <div class="action-row">
              <button class="button primary" type="button" data-action="open-entry-dialog">手动录入</button>
            </div>
          </div>
        </div>
      </section>
      ${recentOps.length
        ? `
          <section class="panel">
            <div class="panel-header">
              <h3 class="panel-title">最近入库</h3>
            </div>
            <div class="panel-body">
              <div class="card-list">
                ${recentOps.map((op) => renderEntryHistoryCard(op, ctx)).join("")}
              </div>
            </div>
          </section>
        `
        : ""}
    </div>
  `;
}

function renderEntryHistoryCard(op, ctx) {
  const product = ctx.productsById.get(op.productId);
  const level = ctx.shelfLevelsById.get(op.targetLevelId);
  const shelf = level ? ctx.shelvesById.get(level.shelfId) : null;
  const warehouse = shelf ? ctx.warehousesById.get(shelf.warehouseId) : null;
  return `
    <div class="list-card">
      <div class="list-card-head">
        <div>
          <h4 class="list-card-title">${escapeHtml(product?.model || "未知型号")}</h4>
          <p class="list-card-subtitle">${escapeHtml(warehouse?.name || "?")} / ${escapeHtml(shelf?.code || "?")} / ${escapeHtml(level ? `${level.levelNo} 层` : "?")} · ${formatQty(op.qty)} 件</p>
        </div>
      </div>
    </div>
  `;
}

function renderFieldsPage(ctx) {
  return `
    <div class="single-column">
      <section class="panel">
        <div class="panel-header">
          <h3 class="panel-title">自定义信息</h3>
          <button class="button primary" type="button" data-action="open-field-dialog">新增字段</button>
        </div>
        <div class="panel-body card-list">
          ${ctx.customFieldDefinitions.length
            ? ctx.customFieldDefinitions.map((field) => renderFieldCard(field, ctx)).join("")
            : `<div class="empty-state">还没有自定义字段</div>`}
        </div>
      </section>
    </div>
  `;
}

function renderProductCard(product, isActive, openPositions) {
  return `
    <div class="product-card-shell ${isActive ? "active" : ""}" data-product-id="${product.id}" data-longpress="product">
      <button class="product-card" type="button" data-action="${openPositions ? "open-product-positions" : "select-product"}" data-product-id="${product.id}">
        <div class="product-image-wrap">
          <img src="${escapeHtml(product.image || makePlaceholderImage(product.model))}" alt="${escapeHtml(product.model)}" loading="lazy" decoding="async">
        </div>
        <div class="product-model">${escapeHtml(product.model)}</div>
      </button>
      <button class="card-more-btn" type="button" data-action="open-product-menu" data-product-id="${product.id}" aria-label="更多操作">
        <span class="dot"></span><span class="dot"></span><span class="dot"></span>
      </button>
    </div>
  `;
}

function renderProductListCard(product, ctx) {
  const fieldMap = getFieldValueMap(product.id, ctx);
  const balances = getProductBalances(product.id, ctx);
  const totalQty = balances.reduce((sum, item) => sum + Number(item.qty || 0), 0);
  const fieldText = getFieldDisplayText(product.id, ctx);

  return `
    <div class="list-card">
      <div class="list-card-head">
        <div>
          <h4 class="list-card-title">${escapeHtml(product.model)}</h4>
          ${fieldText ? `<p class="list-card-subtitle">${escapeHtml(fieldText)}</p>` : ""}
        </div>
        <div class="inline-actions">
          <button class="button secondary" type="button" data-action="open-product-positions" data-product-id="${product.id}">位置</button>
          <button class="button secondary" type="button" data-action="open-product-dialog" data-product-id="${product.id}">编辑</button>
          <button class="button danger" type="button" data-action="delete-product" data-product-id="${product.id}">删除</button>
        </div>
      </div>
      <div class="split-view">
        <div class="detail-media">
          <img class="detail-image catalog-image" src="${escapeHtml(product.image || makePlaceholderImage(product.model))}" alt="${escapeHtml(product.model)}">
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>字段</th>
                <th>值</th>
              </tr>
            </thead>
            <tbody>
              ${ctx.customFieldDefinitions.length
                ? ctx.customFieldDefinitions.map((field) => `
                  <tr>
                    <td>${escapeHtml(field.name)}</td>
                    <td>${escapeHtml(fieldMap.get(field.id) || "-")}</td>
                  </tr>
                `).join("")
                : `<tr><td colspan="2">暂无自定义字段</td></tr>`}
              <tr>
                <td>库存数量</td>
                <td>${formatQty(totalQty)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

function collectFieldValueRows(fieldId, ctx) {
  const counts = new Map();
  for (const item of ctx.valuesByFieldId.get(fieldId) || []) {
    if (item.valueText) {
      counts.set(item.valueText, (counts.get(item.valueText) || 0) + 1);
    }
  }
  const field = ctx.customFieldDefinitionsById.get(fieldId);
  for (const opt of field?.options || []) {
    if (!counts.has(opt)) {
      counts.set(opt, 0);
    }
  }
  return Array.from(counts.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, "zh-CN"));
}

function renderFieldCard(field, ctx) {
  const rows = collectFieldValueRows(field.id, ctx);
  return `
    <div class="list-card">
      <div class="list-card-head">
        <div>
          <h4 class="list-card-title">${escapeHtml(field.name)}</h4>
          <p class="list-card-subtitle">${field.isSearchable ? "参与搜索" : "不参与搜索"}</p>
        </div>
        <div class="inline-actions">
          <button class="button secondary" type="button" data-action="open-field-dialog" data-field-id="${field.id}">编辑</button>
          <button class="button danger" type="button" data-action="delete-field" data-field-id="${field.id}">删除</button>
        </div>
      </div>
      ${rows.length
        ? `
          <table class="field-values-table">
            <thead>
              <tr>
                <th>已收集的值</th>
                <th>使用次数</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${rows.map((row) => `
                <tr>
                  <td>${escapeHtml(row.value)}</td>
                  <td>${row.count}</td>
                  <td>
                    <button class="button danger" type="button" data-action="delete-field-value" data-field-id="${field.id}" data-value-text="${escapeHtml(row.value)}">删除</button>
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        `
        : `<div class="field-values-empty">还没有产品使用此字段。在录入产品时，填入的内容会自动出现在这里。</div>`}
    </div>
  `;
}

function renderWarehouseScene(product, ctx, positionData) {
  const warehouses = ctx.warehouses;
  const activeWarehouseId = state.selectedWarehouseId || warehouses[0]?.id || null;
  const shelves = ctx.shelves.filter((item) => item.warehouseId === activeWarehouseId);
  const activeShelfId = state.selectedShelfId || shelves[0]?.id || null;
  const levels = ctx.shelfLevels.filter((item) => item.shelfId === activeShelfId);

  return `
    <div class="position-visual-shell">
      <div class="step-shell">
        <div class="step-labels position-steps">
          <span class="step-pill active">1. 仓库</span>
          <span class="step-pill ${activeWarehouseId ? "active" : ""}">2. 货架</span>
          <span class="step-pill ${activeShelfId ? "active" : ""}">3. 层数</span>
        </div>
      </div>
      <section class="plane-section">
        <div class="plane-section-head">
          <h4 class="plane-title">仓库</h4>
        </div>
        <div class="warehouse-grid">
          ${warehouses.map((warehouse, index) => {
            const stocked = positionData.warehouseQtyById.has(warehouse.id);
            const active = warehouse.id === activeWarehouseId;
            return `
              <button
                class="warehouse-node tone-${mapTone(warehouse.colorToken, index)} ${active ? "active" : ""} ${stocked ? "stocked-pulse" : ""} ${positionData.warehouseQtyById.size && !stocked ? "dimmed" : ""}"
                type="button"
                data-action="select-warehouse"
                data-warehouse-id="${warehouse.id}"
              >
                <div class="warehouse-body">
                  <span class="warehouse-code">${escapeHtml(warehouse.name)}</span>
                  <span class="warehouse-label">${stocked ? `${formatQty(positionData.warehouseQtyById.get(warehouse.id))} 件` : "无库存"}</span>
                </div>
              </button>
            `;
          }).join("")}
        </div>
      </section>
      <section class="plane-section">
        <div class="plane-section-head">
          <h4 class="plane-title">货架</h4>
        </div>
        <div class="shelf-grid">
          ${shelves.length
            ? shelves.map((shelf) => {
              const stocked = positionData.shelfQtyById.has(shelf.id);
              const active = shelf.id === activeShelfId;
              return `
                <button
                  class="shelf-node ${active ? "active" : ""} ${stocked ? "stocked stocked-pulse" : ""} ${positionData.shelfQtyById.size && !stocked ? "dimmed" : ""}"
                  type="button"
                  data-action="select-shelf"
                  data-shelf-id="${shelf.id}"
                >
                  <div class="shelf-code">${escapeHtml(shelf.code)}</div>
                  <div class="shelf-frame">
                    <span class="shelf-beam"></span>
                    <span class="shelf-beam"></span>
                    <span class="shelf-beam"></span>
                  </div>
                  <div class="warehouse-label">${stocked ? `${formatQty(positionData.shelfQtyById.get(shelf.id))} 件` : "无库存"}</div>
                </button>
              `;
            }).join("")
            : `<div class="empty-state">这个仓库还没有货架</div>`}
        </div>
      </section>
      <section class="plane-section">
        <div class="plane-section-head">
          <h4 class="plane-title">层数</h4>
        </div>
        <div class="level-grid">
          ${levels.length
            ? levels.map((level) => {
              const stocked = positionData.levelQtyById.has(level.id);
              const active = stocked;
              return `
                <div class="level-node ${active ? "active" : ""} ${stocked ? "stocked stocked-pulse" : ""} ${positionData.levelQtyById.size && !stocked ? "dimmed" : ""}">
                  <div class="level-no">${escapeHtml(`${level.levelNo} 层`)}</div>
                  <div class="level-code">${escapeHtml(level.locationCode)}</div>
                  <div class="warehouse-label">${stocked ? `${formatQty(positionData.levelQtyById.get(level.id))} 件` : "无库存"}</div>
                </div>
              `;
            }).join("")
            : `<div class="empty-state">这个货架还没有层数</div>`}
        </div>
      </section>
      ${positionData.externalRows.length
        ? `
          <section class="plane-section">
            <div class="plane-section-head">
              <h4 class="plane-title">非仓库位置</h4>
            </div>
            <div class="hint-row">
              ${positionData.externalRows.map((row) => `<span class="hint-pill">${escapeHtml(row.external.name)} · ${formatQty(row.qty)} 件</span>`).join("")}
            </div>
          </section>
        `
        : ""}
    </div>
  `;
}

function renderPositionTable(product, ctx, positionData) {
  const rows = positionData.balances
    .map((balance) => {
      const location = resolveBalanceLocation(balance, ctx);
      if (!location) {
        return null;
      }
      if (location.kind === "external") {
        return {
          warehouse: "—",
          shelf: "—",
          level: location.external.name,
          qty: balance.qty,
          code: location.external.code,
          isExternal: true,
        };
      }
      return {
        warehouse: location.warehouse.name,
        shelf: location.shelf.code,
        level: `${location.level.levelNo} 层`,
        qty: balance.qty,
        code: location.level.locationCode,
        warehouseId: location.warehouse.id,
      };
    })
    .filter(Boolean);

  if (!rows.length) {
    return `<div class="empty-state">还没有库存位置</div>`;
  }

  // group by warehouse for better readability when one product spans multiple
  const byWarehouse = new Map();
  for (const row of rows) {
    const key = row.warehouseId || "__external__";
    if (!byWarehouse.has(key)) {
      byWarehouse.set(key, []);
    }
    byWarehouse.get(key).push(row);
  }

  return `
    <div class="table-wrap desktop-only-block">
      <table>
        <thead>
          <tr>
            <th>仓库</th>
            <th>货架</th>
            <th>层数</th>
            <th>库位编码</th>
            <th>数量</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td>${escapeHtml(row.warehouse)}</td>
              <td>${escapeHtml(row.shelf)}</td>
              <td>${escapeHtml(row.level)}</td>
              <td>${escapeHtml(row.code)}</td>
              <td>${formatQty(row.qty)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
    <div class="location-card-list mobile-only-block">
      ${rows.map((row) => `
        <div class="location-card">
          <div class="location-card-row"><span class="label">仓库</span><span class="value"><strong>${escapeHtml(row.warehouse)}</strong></span></div>
          <div class="location-card-row"><span class="label">货架</span><span class="value">${escapeHtml(row.shelf)}</span></div>
          <div class="location-card-row"><span class="label">层数</span><span class="value">${escapeHtml(row.level)}</span></div>
          <div class="location-card-row"><span class="label">库位</span><span class="value">${escapeHtml(row.code)}</span></div>
          <div class="location-card-row"><span class="label">数量</span><span class="value"><strong>${formatQty(row.qty)} 件</strong></span></div>
        </div>
      `).join("")}
    </div>
  `;
}

function getFieldSuggestions(fieldId, ctx = state.context) {
  const field = ctx.customFieldDefinitionsById.get(fieldId);
  const optionValues = field?.options || [];
  const historicalValues = (ctx.valuesByFieldId.get(fieldId) || []).map((item) => item.valueText).filter(Boolean);
  return [...new Set([...optionValues, ...historicalValues])];
}

function renderDialog(content) {
  dialog.innerHTML = content;
  dialog.showModal();
}

function closeDialog() {
  stopActiveScanner();
  if (dialog.open) {
    dialog.close();
  }
}

function renderProductDialog(productId = "") {
  const ctx = state.context;
  const product = productId ? ctx.productsById.get(productId) : null;
  const valueMap = product ? getFieldValueMap(product.id, ctx) : new Map();

  renderDialog(`
    <form class="dialog-panel" data-form="product">
      <div class="dialog-header">
        <h3 class="panel-title">${product ? "编辑产品" : "新增产品"}</h3>
        <button class="button secondary" type="button" data-action="close-dialog">关闭</button>
      </div>
      <div class="dialog-body">
        <input type="hidden" name="productId" value="${escapeHtml(product?.id || "")}">
        <div class="form-grid">
          <div class="field">
            <label>产品型号</label>
            <input name="model" required value="${escapeHtml(product?.model || "")}">
          </div>
          <div class="field">
            <label>产品图片</label>
            <input name="imageFile" type="file" accept="image/*">
          </div>
          ${ctx.customFieldDefinitions.length
            ? `
              <div class="form-grid cols-2">
                ${ctx.customFieldDefinitions.map((field) => `
                  <div class="field">
                    <label>${escapeHtml(field.name)}</label>
                    <input
                      name="field:${field.id}"
                      value="${escapeHtml(valueMap.get(field.id) || "")}"
                      list="list-${field.id}"
                    >
                    <datalist id="list-${field.id}">
                      ${getFieldSuggestions(field.id, ctx).map((value) => `<option value="${escapeHtml(value)}"></option>`).join("")}
                    </datalist>
                  </div>
                `).join("")}
              </div>
            `
            : ""}
        </div>
      </div>
      <div class="dialog-footer">
        <button class="button secondary" type="button" data-action="close-dialog">取消</button>
        <button class="button primary" type="submit">保存</button>
      </div>
    </form>
  `);
}

function renderStockDialog() {
  const ctx = state.context;
  const selectedProduct = ctx.productsById.get(state.selectedProductId);
  const selectedWarehouse = ctx.warehousesById.get(state.selectedWarehouseId);
  const selectedShelf = ctx.shelvesById.get(state.selectedShelfId);
  const shelfLevels = selectedShelf ? ctx.shelfLevels.filter((item) => item.shelfId === selectedShelf.id) : [];
  const externalOptions = ctx.externalLocations.map((item) => `<option value="${escapeHtml(item.name)}"></option>`).join("");
  const operationField = `
    <div class="field">
      <label>操作</label>
      <select name="operationType" data-role="stock-operation-type">
        <option value="put_in">入库</option>
        <option value="move">移库</option>
        <option value="move_to_external">移出/出库</option>
      </select>
    </div>
  `;
  const productField = `
    <div class="field">
      <label>产品型号</label>
      <input name="model" required value="${escapeHtml(selectedProduct?.model || "")}" list="product-model-list">
      <datalist id="product-model-list">
        ${ctx.products.map((item) => `<option value="${escapeHtml(item.model)}"></option>`).join("")}
      </datalist>
    </div>
  `;
  const sourceLocationFields = `
    <div class="stock-section" data-stock-section="source" hidden>
      <div class="form-grid cols-3">
        <div class="field">
          <label>来源仓库</label>
          <input name="sourceWarehouse" value="${escapeHtml(selectedWarehouse?.name || "")}" list="source-warehouse-list">
          <datalist id="source-warehouse-list">
            ${ctx.warehouses.map((item) => `<option value="${escapeHtml(item.name)}"></option>`).join("")}
          </datalist>
        </div>
        <div class="field">
          <label>来源货架</label>
          <input name="sourceShelf" value="${escapeHtml(selectedShelf?.code || "")}" list="source-shelf-list">
          <datalist id="source-shelf-list">
            ${ctx.shelves.map((item) => `<option value="${escapeHtml(item.code)}"></option>`).join("")}
          </datalist>
        </div>
        <div class="field">
          <label>来源层数</label>
          <input name="sourceLevel" value="${escapeHtml(shelfLevels[0]?.levelNo ? `${shelfLevels[0].levelNo}` : "")}" list="source-level-list">
          <datalist id="source-level-list">
            ${ctx.shelfLevels.map((item) => `<option value="${escapeHtml(String(item.levelNo))}"></option>`).join("")}
          </datalist>
        </div>
      </div>
    </div>
  `;
  const targetLocationFields = `
    <div class="stock-section" data-stock-section="target">
    <div class="form-grid cols-3">
      <div class="field">
        <label>目标仓库</label>
        <input name="warehouse" value="${escapeHtml(selectedWarehouse?.name || "")}" list="warehouse-list">
        <datalist id="warehouse-list">
          ${ctx.warehouses.map((item) => `<option value="${escapeHtml(item.name)}"></option>`).join("")}
        </datalist>
      </div>
      <div class="field">
        <label>目标货架</label>
        <input name="shelf" value="${escapeHtml(selectedShelf?.code || "")}" list="shelf-list">
        <datalist id="shelf-list">
          ${ctx.shelves.map((item) => `<option value="${escapeHtml(item.code)}"></option>`).join("")}
        </datalist>
      </div>
      <div class="field">
        <label>目标层数</label>
        <input name="level" value="${escapeHtml(shelfLevels[0]?.levelNo ? `${shelfLevels[0].levelNo}` : "")}" list="level-list">
        <datalist id="level-list">
          ${ctx.shelfLevels.map((item) => `<option value="${escapeHtml(String(item.levelNo))}"></option>`).join("")}
        </datalist>
      </div>
    </div>
    </div>
  `;
  const externalTargetField = `
    <div class="stock-section" data-stock-section="external" hidden>
      <div class="field">
        <label>非仓库位置</label>
        <input name="externalLocation" value="${escapeHtml(ctx.externalLocations[0]?.name || "")}" list="external-location-list">
        <datalist id="external-location-list">
          ${externalOptions}
        </datalist>
      </div>
    </div>
  `;
  const qtyField = `
    <div class="field">
      <label>数量</label>
      <input name="qty" type="number" min="0.01" step="1" value="1" required>
    </div>
  `;
  const body = state.mode === "handheld"
    ? `
      <div class="stock-step-list">
        <section class="stock-step-card">
          <div class="stock-step-index">1</div>
          <div class="form-grid">
            ${operationField}
            ${productField}
          </div>
        </section>
        <section class="stock-step-card" data-stock-section="source" hidden>
          <div class="stock-step-index">2</div>
          ${sourceLocationFields}
        </section>
        <section class="stock-step-card">
          <div class="stock-step-index">3</div>
          <div class="form-grid">
            ${targetLocationFields}
            ${externalTargetField}
          </div>
        </section>
        <section class="stock-step-card">
          <div class="stock-step-index">4</div>
          ${qtyField}
        </section>
      </div>
    `
    : `
      <div class="form-grid">
        ${operationField}
        ${productField}
        ${sourceLocationFields}
        ${targetLocationFields}
        ${externalTargetField}
        ${qtyField}
      </div>
    `;

  renderDialog(`
    <form class="dialog-panel ${state.mode === "handheld" ? "stock-step-form" : ""}" data-form="stock">
      <div class="dialog-header">
        <h3 class="panel-title">库存操作</h3>
        <button class="button secondary" type="button" data-action="close-dialog">关闭</button>
      </div>
      <div class="dialog-body">
        ${body}
      </div>
      <div class="dialog-footer">
        <button class="button secondary" type="button" data-action="close-dialog">取消</button>
        <button class="button primary" type="submit">保存</button>
      </div>
    </form>
  `);
  syncStockDialogSections(dialog.querySelector("[data-form='stock']"));
}

function renderMoveProductDialog(productId, sourceLevelId) {
  const ctx = state.context;
  const product = ctx.productsById.get(productId);
  if (!product) {
    pushToast("产品不存在", "failed");
    return;
  }
  const sourceLevel = ctx.shelfLevelsById.get(sourceLevelId);
  if (!sourceLevel) {
    pushToast("来源位置不存在", "failed");
    return;
  }
  const sourceShelf = ctx.shelvesById.get(sourceLevel.shelfId);
  const sourceWarehouse = sourceShelf ? ctx.warehousesById.get(sourceShelf.warehouseId) : null;
  const sourceBalance = findWarehouseBalance(productId, sourceLevelId);
  const sourceQty = Math.max(0, Number(sourceBalance?.qty || 0));
  if (sourceQty <= 0) {
    pushToast("来源位置无库存", "failed");
    return;
  }

  const defaultWarehouseId = sourceWarehouse?.id || ctx.warehouses[0]?.id || "";
  const shelvesInDefault = ctx.shelves.filter((s) => s.warehouseId === defaultWarehouseId);
  const defaultShelf = shelvesInDefault.find((s) => s.id !== sourceShelf?.id) || shelvesInDefault[0];
  const defaultShelfId = defaultShelf?.id || "";
  const levelsInDefault = ctx.shelfLevels.filter((l) => l.shelfId === defaultShelfId);
  const defaultLevel = levelsInDefault.find((l) => l.id !== sourceLevelId) || levelsInDefault[0];
  const defaultLevelId = defaultLevel?.id || "";

  const halfQty = Math.max(1, Math.floor(sourceQty / 2));

  renderDialog(`
    <form class="dialog-panel move-product-dialog" data-form="move-product">
      <input type="hidden" name="productId" value="${escapeHtml(productId)}">
      <input type="hidden" name="sourceLevelId" value="${escapeHtml(sourceLevelId)}">
      <div class="dialog-header">
        <h3 class="panel-title">移动 · ${escapeHtml(product.model)}</h3>
        <button class="button ghost icon-only" type="button" data-action="close-dialog" aria-label="关闭">✕</button>
      </div>
      <div class="dialog-body">
        <div class="move-flow">
          <div class="move-flow-card move-source">
            <span class="move-flow-kicker">来自</span>
            <div class="move-flow-title">${escapeHtml(`${sourceWarehouse?.name || "?"} / ${sourceShelf?.code || "?"}`)}</div>
            <div class="move-flow-sub">${escapeHtml(`${sourceLevel.levelNo} 层`)} · ${formatQty(sourceQty)} 件</div>
          </div>
          <div class="move-flow-arrow" aria-hidden="true">
            <svg viewBox="0 0 32 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <path d="M2 8h26"/>
              <path d="M22 2l6 6-6 6"/>
            </svg>
          </div>
          <div class="move-flow-card move-target">
            <span class="move-flow-kicker">移到</span>
            <div class="move-target-selects">
              <label class="move-target-field">
                <span>仓库</span>
                <select name="targetWarehouseId" data-role="move-target-warehouse">
                  ${ctx.warehouses.map((w) => `<option value="${w.id}" ${w.id === defaultWarehouseId ? "selected" : ""}>${escapeHtml(w.name)}</option>`).join("")}
                </select>
              </label>
              <label class="move-target-field">
                <span>货架</span>
                <select name="targetShelfId" data-role="move-target-shelf">
                  ${shelvesInDefault.map((s) => `<option value="${s.id}" ${s.id === defaultShelfId ? "selected" : ""}>${escapeHtml(s.code)}</option>`).join("")}
                </select>
              </label>
              <label class="move-target-field">
                <span>层数</span>
                <select name="targetLevelId" data-role="move-target-level">
                  ${levelsInDefault.length
                    ? levelsInDefault.map((l) => `<option value="${l.id}" ${l.id === defaultLevelId ? "selected" : ""}>${l.levelNo} 层</option>`).join("")
                    : `<option value="">该货架暂无层数</option>`}
                </select>
              </label>
            </div>
          </div>
        </div>
        <div class="move-qty-block">
          <div class="field">
            <label>移动数量</label>
            <input name="qty" data-role="move-qty-input" type="number" min="1" max="${sourceQty}" value="${sourceQty}" required inputmode="numeric">
            <p class="field-hint">最多可移动 ${formatQty(sourceQty)} 件</p>
          </div>
          <div class="move-qty-shortcuts">
            <button type="button" class="button ghost" data-action="set-move-qty" data-qty="1">1 件</button>
            ${sourceQty > 2 ? `<button type="button" class="button ghost" data-action="set-move-qty" data-qty="${halfQty}">一半 (${halfQty})</button>` : ""}
            <button type="button" class="button ghost" data-action="set-move-qty" data-qty="${sourceQty}">全部 (${sourceQty})</button>
          </div>
        </div>
      </div>
      <div class="dialog-footer">
        <button class="button ghost" type="button" data-action="close-dialog">取消</button>
        <button class="button primary" type="submit">确认移动</button>
      </div>
    </form>
  `);
}

function syncMoveDialogTargets(form, changedField) {
  if (!form) return;
  const ctx = state.context;
  const warehouseSelect = form.querySelector("[data-role='move-target-warehouse']");
  const shelfSelect = form.querySelector("[data-role='move-target-shelf']");
  const levelSelect = form.querySelector("[data-role='move-target-level']");
  if (!warehouseSelect || !shelfSelect || !levelSelect) return;

  if (changedField === "warehouse") {
    const warehouseId = warehouseSelect.value;
    const shelves = ctx.shelves.filter((s) => s.warehouseId === warehouseId);
    shelfSelect.innerHTML = shelves.length
      ? shelves.map((s) => `<option value="${s.id}">${escapeHtml(s.code)}</option>`).join("")
      : `<option value="">该仓库暂无货架</option>`;
  }

  if (changedField === "warehouse" || changedField === "shelf") {
    const shelfId = shelfSelect.value;
    const levels = ctx.shelfLevels.filter((l) => l.shelfId === shelfId);
    levelSelect.innerHTML = levels.length
      ? levels.map((l) => `<option value="${l.id}">${l.levelNo} 层</option>`).join("")
      : `<option value="">该货架暂无层数</option>`;
  }
}

function renderEntryDialog(prefill = {}) {
  const ctx = state.context;
  const productListId = "entry-product-list";
  const warehouseListId = "entry-warehouse-list";
  const shelfListId = "entry-shelf-list";
  const levelListId = "entry-level-list";

  renderDialog(`
    <form class="dialog-panel" data-form="entry" enctype="multipart/form-data">
      <div class="dialog-header">
        <h3 class="panel-title">录入产品</h3>
        <button class="button ghost icon-only" type="button" data-action="close-dialog" aria-label="关闭">✕</button>
      </div>
      <div class="dialog-body">
        <div class="form-grid">
          <div class="field">
            <label>产品型号<span class="required">*</span></label>
            <input
              name="model"
              required
              autocomplete="off"
              list="${productListId}"
              value="${escapeHtml(prefill.model || "")}"
              placeholder="例如 ABC-1001"
            >
            <datalist id="${productListId}">
              ${ctx.products.map((p) => `<option value="${escapeHtml(p.model)}"></option>`).join("")}
            </datalist>
            <p class="field-hint">仅型号必填，其余均可后续补全或通过 APP / Excel 导入。</p>
          </div>
          <div class="field">
            <label>产品图片</label>
            <div class="image-picker" data-role="image-picker">
              <div class="image-picker-preview" data-role="image-preview">
                ${prefill.image
                  ? `<img src="${escapeHtml(prefill.image)}" alt="预览">`
                  : `<span class="image-picker-placeholder">未选择图片</span>`}
              </div>
              <div class="image-picker-actions">
                <label class="button secondary" data-role="image-pick-label">
                  选择图片
                  <input type="file" name="imageFile" accept="image/*" data-role="image-input" hidden>
                </label>
                <button class="button ghost" type="button" data-action="clear-entry-image">清除</button>
              </div>
            </div>
          </div>
          <details class="entry-advanced">
            <summary>填写位置（可选 · 也可稍后再补）</summary>
            <div class="form-grid">
              <div class="field">
                <label>仓库</label>
                <input
                  name="warehouse"
                  autocomplete="off"
                  list="${warehouseListId}"
                  value="${escapeHtml(prefill.warehouse || "")}"
                  placeholder="A01"
                >
                <datalist id="${warehouseListId}">
                  ${ctx.warehouses.map((w) => `<option value="${escapeHtml(w.code)}">${escapeHtml(w.name)}</option>`).join("")}
                </datalist>
              </div>
              <div class="form-grid cols-2">
                <div class="field">
                  <label>货架</label>
                  <input
                    name="shelf"
                    autocomplete="off"
                    list="${shelfListId}"
                    value="${escapeHtml(prefill.shelf || "")}"
                    placeholder="S01"
                  >
                  <datalist id="${shelfListId}">
                    ${ctx.shelves.map((s) => `<option value="${escapeHtml(s.code)}"></option>`).join("")}
                  </datalist>
                </div>
                <div class="field">
                  <label>层数</label>
                  <input
                    name="level"
                    autocomplete="off"
                    inputmode="numeric"
                    list="${levelListId}"
                    value="${escapeHtml(prefill.level || "")}"
                    placeholder="1"
                  >
                  <datalist id="${levelListId}">
                    ${[...new Set(ctx.shelfLevels.map((l) => String(l.levelNo)))].map((v) => `<option value="${escapeHtml(v)}"></option>`).join("")}
                  </datalist>
                </div>
              </div>
              <div class="form-grid cols-2">
                <div class="field">
                  <label>数量</label>
                  <input name="qty" type="number" min="1" step="1" value="${escapeHtml(String(prefill.qty || ""))}" placeholder="1">
                </div>
                <div class="field">
                  <label>备注</label>
                  <input name="note" autocomplete="off" placeholder="可选" value="${escapeHtml(prefill.note || "")}">
                </div>
              </div>
              <p class="field-hint">填了仓库/货架/层数才会生成库存记录；只填型号将仅创建产品。同一位置已存在时数量自动合并。</p>
            </div>
          </details>
        </div>
      </div>
      <div class="dialog-footer">
        <button class="button ghost" type="button" data-action="close-dialog">取消</button>
        <button class="button secondary" type="submit" data-action="submit-entry-continue">保存并继续</button>
        <button class="button primary" type="submit">保存</button>
      </div>
    </form>
  `);

  bindImagePicker();
}

function bindImagePicker() {
  const input = dialog.querySelector("[data-role='image-input']");
  const preview = dialog.querySelector("[data-role='image-preview']");
  if (!input || !preview) {
    return;
  }
  input.addEventListener("change", async () => {
    const [file] = input.files || [];
    if (!file) {
      return;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      preview.innerHTML = `<img src="${escapeHtml(dataUrl)}" alt="预览">`;
    } catch {
      preview.innerHTML = `<span class="image-picker-placeholder">读取失败</span>`;
    }
  });
}

function renderScannerDialog(state2 = {}) {
  const supportsCamera = hasMediaDevices();
  renderDialog(`
    <div class="dialog-panel" data-dialog="scanner">
      <div class="dialog-header">
        <h3 class="panel-title">扫码录入</h3>
        <button class="button ghost icon-only" type="button" data-action="close-scanner" aria-label="关闭">✕</button>
      </div>
      <div class="dialog-body">
        <div class="scanner-shell">
          ${supportsCamera
            ? `
              <div class="scanner-frame">
                <video data-role="scanner-video" playsinline muted></video>
                <div class="scanner-mask"></div>
              </div>
              <p class="scanner-status" data-role="scanner-status">${escapeHtml(state2.status || "请将货架二维码对准取景框")}</p>
            `
            : `<p class="scanner-status error">当前设备不支持摄像头，请直接输入二维码内容。</p>`}
          <div class="form-grid">
            <div class="field">
              <label>或手动输入二维码内容</label>
              <input
                data-role="scanner-manual"
                autocomplete="off"
                placeholder="例如 A01-S03-L02"
                value="${escapeHtml(state2.manual || "")}"
              >
              <p class="field-hint">格式：仓库-货架-层数。例 <code>A01-S03-L02</code></p>
            </div>
          </div>
        </div>
      </div>
      <div class="dialog-footer">
        <button class="button ghost" type="button" data-action="close-scanner">取消</button>
        <button class="button primary" type="button" data-action="submit-scanner-manual">使用此位置</button>
      </div>
    </div>
  `);

  if (supportsCamera) {
    void initScannerView();
  }
}

async function initScannerView() {
  const video = dialog.querySelector("[data-role='scanner-video']");
  const statusEl = dialog.querySelector("[data-role='scanner-status']");
  if (!video) {
    return;
  }
  stopActiveScanner();
  const controller = new AbortController();
  state.scanner = controller;
  const handle = await startCameraScanner({
    video,
    signal: controller.signal,
    onResult: (value) => {
      if (statusEl) {
        statusEl.textContent = `已识别：${value}`;
      }
      handleScannerValue(value);
    },
    onError: (error) => {
      if (statusEl) {
        statusEl.textContent = error?.message || "扫码失败";
        statusEl.classList.add("error");
      }
    },
  });
  if (handle && !handle.supportsAutoDetect && statusEl) {
    statusEl.textContent = "当前浏览器无法自动识别二维码，请手动输入。";
  }
}

function stopActiveScanner() {
  if (state.scanner) {
    try {
      state.scanner.abort();
    } catch {
      // ignore
    }
    state.scanner = null;
  }
}

function handleScannerValue(value) {
  const parsed = parseLocationCode(value);
  if (!parsed.ok) {
    pushToast(parsed.reason || "二维码格式无效", "failed");
    return;
  }
  stopActiveScanner();
  closeDialog();
  renderEntryDialog({
    warehouse: parsed.warehouse,
    shelf: parsed.shelf,
    level: String(parsed.levelNo),
  });
  pushToast(`已识别 ${formatLocationCode(parsed.warehouse, parsed.shelf, parsed.levelNo)}`, "ready");
}

function syncStockDialogSections(form) {
  if (!form) {
    return;
  }
  const operationType = form.querySelector("[data-role='stock-operation-type']")?.value || "put_in";
  const visibility = {
    source: operationType === "move" || operationType === "move_to_external",
    target: operationType === "put_in" || operationType === "move",
    external: operationType === "move_to_external",
  };
  form.querySelectorAll("[data-stock-section]").forEach((section) => {
    section.hidden = !visibility[section.dataset.stockSection];
  });
  form.querySelectorAll(".stock-step-card:not([hidden]) .stock-step-index").forEach((item, index) => {
    item.textContent = String(index + 1);
  });
}

function renderActionSheet({ title, subtitle = "", actions }) {
  const items = actions
    .map(
      (action) => `
        <button class="action-sheet-item ${action.tone || ""}" type="button" data-action="${action.action}" ${action.dataset || ""}>
          ${escapeHtml(action.label)}
        </button>
      `,
    )
    .join("");
  renderDialog(`
    <div class="action-sheet" data-dialog="action-sheet">
      <div class="action-sheet-head">
        <h3 class="action-sheet-title">${escapeHtml(title)}</h3>
        ${subtitle ? `<p class="action-sheet-sub">${escapeHtml(subtitle)}</p>` : ""}
      </div>
      <div class="action-sheet-body">
        ${items}
      </div>
      <button class="action-sheet-cancel" type="button" data-action="close-dialog">取消</button>
    </div>
  `);
}

function renderProductMenu(productId) {
  const product = state.context.productsById.get(productId);
  if (!product) {
    return;
  }
  renderActionSheet({
    title: product.model,
    subtitle: "选择要进行的操作",
    actions: [
      { label: "查看位置", action: "open-product-positions", dataset: `data-product-id="${productId}"` },
      { label: "编辑产品", action: "open-product-dialog", dataset: `data-product-id="${productId}"` },
      { label: "删除产品", tone: "danger", action: "delete-product", dataset: `data-product-id="${productId}"` },
    ],
  });
}

function renderWarehouseMenu(warehouseId) {
  const warehouse = state.context.warehousesById.get(warehouseId);
  if (!warehouse) {
    return;
  }
  renderActionSheet({
    title: warehouse.name,
    subtitle: "选择要进行的操作",
    actions: [
      { label: "删除仓库", tone: "danger", action: "delete-warehouse", dataset: `data-warehouse-id="${warehouseId}"` },
    ],
  });
}

function renderShelfMenu(shelfId) {
  const shelf = state.context.shelvesById.get(shelfId);
  if (!shelf) {
    return;
  }
  renderActionSheet({
    title: shelf.code,
    subtitle: "选择要进行的操作",
    actions: [
      { label: "删除货架", tone: "danger", action: "delete-shelf", dataset: `data-shelf-id="${shelfId}"` },
    ],
  });
}

function renderLevelMenu(levelId) {
  const level = state.context.shelfLevelsById.get(levelId);
  if (!level) {
    return;
  }
  renderActionSheet({
    title: `${level.levelNo} 层`,
    subtitle: level.locationCode,
    actions: [
      { label: "删除层数", tone: "danger", action: "delete-level", dataset: `data-level-id="${levelId}"` },
    ],
  });
}

function renderExternalMenu(externalId) {
  const item = state.context.externalLocations.find((x) => x.id === externalId);
  if (!item) {
    return;
  }
  renderActionSheet({
    title: item.name,
    subtitle: "选择要进行的操作",
    actions: [
      { label: "删除位置", tone: "danger", action: "delete-external", dataset: `data-external-id="${externalId}"` },
    ],
  });
}

function renderFieldDialog(fieldId = "") {
  const ctx = state.context;
  const field = fieldId ? ctx.customFieldDefinitionsById.get(fieldId) : null;
  const isSearchable = field ? field.isSearchable : true;

  renderDialog(`
    <form class="dialog-panel" data-form="field">
      <div class="dialog-header">
        <h3 class="panel-title">${field ? "编辑字段" : "新增字段"}</h3>
        <button class="button secondary" type="button" data-action="close-dialog">关闭</button>
      </div>
      <div class="dialog-body">
        <input type="hidden" name="fieldId" value="${escapeHtml(field?.id || "")}">
        <div class="form-grid">
          <div class="field">
            <label>字段名称</label>
            <input name="name" required value="${escapeHtml(field?.name || "")}">
          </div>
          <label class="checkbox-row">
            <span>参与搜索</span>
            <input type="checkbox" name="isSearchable" ${isSearchable ? "checked" : ""}>
          </label>
        </div>
      </div>
      <div class="dialog-footer">
        <button class="button secondary" type="button" data-action="close-dialog">取消</button>
        <button class="button primary" type="submit">保存</button>
      </div>
    </form>
  `);
}

function renderWarehouseDialog() {
  renderDialog(`
    <form class="dialog-panel" data-form="warehouse">
      <div class="dialog-header">
        <h3 class="panel-title">新增仓库</h3>
        <button class="button secondary" type="button" data-action="close-dialog">关闭</button>
      </div>
      <div class="dialog-body">
        <div class="form-grid">
          <div class="field">
            <label>仓库名称</label>
            <input name="name" required>
          </div>
          <div class="field">
            <label>仓库编码</label>
            <input name="code">
          </div>
          <div class="field">
            <label>配色</label>
            <select name="colorToken">
              <option value="blue">blue</option>
              <option value="green">green</option>
              <option value="sand">sand</option>
            </select>
          </div>
        </div>
      </div>
      <div class="dialog-footer">
        <button class="button secondary" type="button" data-action="close-dialog">取消</button>
        <button class="button primary" type="submit">保存</button>
      </div>
    </form>
  `);
}

function renderShelfDialog() {
  const ctx = state.context;
  renderDialog(`
    <form class="dialog-panel" data-form="shelf">
      <div class="dialog-header">
        <h3 class="panel-title">新增货架</h3>
        <button class="button secondary" type="button" data-action="close-dialog">关闭</button>
      </div>
      <div class="dialog-body">
        <div class="form-grid">
          <div class="field">
            <label>仓库</label>
            <select name="warehouseId">
              ${ctx.warehouses.map((item) => `<option value="${item.id}" ${item.id === state.selectedWarehouseId ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label>货架编码</label>
            <input name="code" required>
          </div>
          <div class="field">
            <label>货架名称</label>
            <input name="name">
          </div>
        </div>
      </div>
      <div class="dialog-footer">
        <button class="button secondary" type="button" data-action="close-dialog">取消</button>
        <button class="button primary" type="submit">保存</button>
      </div>
    </form>
  `);
}

function renderLevelDialog() {
  const ctx = state.context;
  renderDialog(`
    <form class="dialog-panel" data-form="level">
      <div class="dialog-header">
        <h3 class="panel-title">新增层数</h3>
        <button class="button secondary" type="button" data-action="close-dialog">关闭</button>
      </div>
      <div class="dialog-body">
        <div class="form-grid">
          <div class="field">
            <label>货架</label>
            <select name="shelfId">
              ${ctx.shelves.map((item) => {
                const warehouse = ctx.warehousesById.get(item.warehouseId);
                return `<option value="${item.id}" ${item.id === state.selectedShelfId ? "selected" : ""}>${escapeHtml(`${warehouse?.name || ""} / ${item.code}`)}</option>`;
              }).join("")}
            </select>
          </div>
          <div class="field">
            <label>层数</label>
            <input name="levelNo" required>
          </div>
        </div>
      </div>
      <div class="dialog-footer">
        <button class="button secondary" type="button" data-action="close-dialog">取消</button>
        <button class="button primary" type="submit">保存</button>
      </div>
    </form>
  `);
}

function renderExternalDialog() {
  renderDialog(`
    <form class="dialog-panel" data-form="external">
      <div class="dialog-header">
        <h3 class="panel-title">新增非仓库位置</h3>
        <button class="button secondary" type="button" data-action="close-dialog">关闭</button>
      </div>
      <div class="dialog-body">
        <div class="form-grid">
          <div class="field">
            <label>名称</label>
            <input name="name" required>
          </div>
          <div class="field">
            <label>编码</label>
            <input name="code">
          </div>
        </div>
      </div>
      <div class="dialog-footer">
        <button class="button secondary" type="button" data-action="close-dialog">取消</button>
        <button class="button primary" type="submit">保存</button>
      </div>
    </form>
  `);
}

function getProductByModel(model, ctx = state.context) {
  return ctx.products.find((item) => normalizeText(item.model) === normalizeText(model)) || null;
}

async function saveProduct(form) {
  const ctx = state.context;
  const formData = new FormData(form);
  const productId = text(formData.get("productId"));
  const model = text(formData.get("model"));
  if (!model) {
    throw new Error("请填写产品型号");
  }

  const existing = productId ? ctx.productsById.get(productId) : getProductByModel(model, ctx);
  const imageFile = formData.get("imageFile");
  let image = existing?.image || makePlaceholderImage(model);
  let userUploadedNewImage = false;
  if (imageFile instanceof File && imageFile.size > 0) {
    image = await readFileAsDataUrl(imageFile);
    userUploadedNewImage = true;
  }

  const record = {
    id: existing?.id || productId || uuid("product"),
    model,
    modelNormalized: normalizeText(model),
    image,
    status: "active",
    createdAt: existing?.createdAt || nowIso(),
    updatedAt: nowIso(),
  };
  await db.put(db.storeNames.products, record);
  if (userUploadedNewImage) {
    void indexProductImage(record.id, image, 0);
  }

  const existingValues = new Map((ctx.valuesByProductId.get(record.id) || []).map((item) => [item.fieldId, item]));
  for (const field of ctx.customFieldDefinitions) {
    const valueText = text(formData.get(`field:${field.id}`));
    const existingValue = existingValues.get(field.id);
    if (valueText) {
      await db.put(db.storeNames.productCustomFieldValues, {
        id: existingValue?.id || uuid("pcfv"),
        productId: record.id,
        fieldId: field.id,
        valueText,
        createdAt: existingValue?.createdAt || nowIso(),
        updatedAt: nowIso(),
      });
      if (!field.options.includes(valueText)) {
        await db.put(db.storeNames.customFieldDefinitions, {
          ...field,
          options: field.fieldType === "select" ? [...field.options, valueText] : field.options,
          updatedAt: nowIso(),
        });
      }
    } else if (existingValue) {
      await db.remove(db.storeNames.productCustomFieldValues, existingValue.id);
    }
  }

  closeDialog();
  await refreshContext({ preferProductId: record.id });
  setNotice(existing ? "产品已更" : "产品已创");
}

async function createOrUpdateProductByModel(model) {
  const ctx = state.context;
  const existing = getProductByModel(model, ctx);
  if (existing) {
    return existing;
  }
  const product = {
    id: uuid("product"),
    model,
    modelNormalized: normalizeText(model),
    image: makePlaceholderImage(model),
    status: "active",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await db.put(db.storeNames.products, product);
  return product;
}

function nextWarehouseTone(ctx = state.context) {
  return WAREHOUSE_TONES[ctx.warehouses.length % WAREHOUSE_TONES.length];
}

async function ensureWarehouse(inputValue) {
  const ctx = state.context;
  const raw = text(inputValue);
  const found = ctx.warehouses.find((item) => normalizeText(item.name) === normalizeText(raw) || normalizeText(item.code) === normalizeText(raw));
  if (found) {
    return found;
  }
  const warehouse = {
    id: uuid("warehouse"),
    code: raw || `W${ctx.warehouses.length + 1}`,
    name: raw || `仓库 ${ctx.warehouses.length + 1}`,
    colorToken: nextWarehouseTone(ctx),
    sortOrder: ctx.warehouses.length + 1,
    status: "active",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await db.put(db.storeNames.warehouses, warehouse);
  return warehouse;
}

async function ensureShelf(warehouseId, inputValue) {
  const ctx = state.context;
  const raw = text(inputValue);
  const found = ctx.shelves.find(
    (item) =>
      item.warehouseId === warehouseId &&
      (normalizeText(item.code) === normalizeText(raw) || normalizeText(item.name) === normalizeText(raw)),
  );
  if (found) {
    return found;
  }
  const sortOrder = ctx.shelves.filter((item) => item.warehouseId === warehouseId).length + 1;
  const shelf = {
    id: uuid("shelf"),
    warehouseId,
    code: raw || `S${String(sortOrder).padStart(2, "0")}`,
    name: raw || `${raw} 货架`,
    sortOrder,
    status: "active",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await db.put(db.storeNames.shelves, shelf);
  return shelf;
}

function buildLocationCode(warehouse, shelf, levelNo) {
  return `${warehouse.code}-${shelf.code}-L${String(levelNo).padStart(2, "0")}`;
}

function parseLevelNo(value, fallback = 1) {
  const matched = String(value || "").match(/\d+/);
  return matched ? Number(matched[0]) : fallback;
}

async function ensureLevel(shelfId, inputValue) {
  const ctx = state.context;
  const raw = text(inputValue);
  const parsedNo = parseLevelNo(raw, ctx.shelfLevels.filter((item) => item.shelfId === shelfId).length + 1);
  const found = ctx.shelfLevels.find(
    (item) =>
      item.shelfId === shelfId &&
      (Number(item.levelNo) === parsedNo || normalizeText(item.locationCode) === normalizeText(raw)),
  );
  if (found) {
    return found;
  }

  const shelf = ctx.shelvesById.get(shelfId);
  const warehouse = shelf ? ctx.warehousesById.get(shelf.warehouseId) : null;
  const level = {
    id: uuid("level"),
    shelfId,
    levelNo: parsedNo,
    locationCode: warehouse && shelf ? buildLocationCode(warehouse, shelf, parsedNo) : `L${String(parsedNo).padStart(2, "0")}`,
    qrText: warehouse && shelf ? buildLocationCode(warehouse, shelf, parsedNo) : `L${String(parsedNo).padStart(2, "0")}`,
    sortOrder: parsedNo,
    status: "active",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await db.put(db.storeNames.shelfLevels, level);
  return level;
}

async function ensureExternalLocation(inputValue) {
  const ctx = state.context;
  const raw = text(inputValue);
  const found = ctx.externalLocations.find((item) => normalizeText(item.name) === normalizeText(raw) || normalizeText(item.code) === normalizeText(raw));
  if (found) {
    return found;
  }
  const sortOrder = ctx.externalLocations.length + 1;
  const external = {
    id: uuid("external"),
    code: raw ? raw.toUpperCase() : `EXT${sortOrder}`,
    name: raw || `非仓库位"${sortOrder}`,
    sortOrder,
    status: "active",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await db.put(db.storeNames.externalLocations, external);
  return external;
}

async function ensureWarehouseLevel(warehouseText, shelfText, levelText, productId) {
  const warehouse = await ensureWarehouse(warehouseText);
  await refreshContext({ preferProductId: productId, preferWarehouseId: warehouse.id });
  const shelf = await ensureShelf(warehouse.id, shelfText);
  await refreshContext({ preferProductId: productId, preferWarehouseId: warehouse.id, preferShelfId: shelf.id });
  const level = await ensureLevel(shelf.id, levelText);
  await refreshContext({ preferProductId: productId, preferWarehouseId: warehouse.id, preferShelfId: shelf.id });
  return { warehouse, shelf, level };
}

function findWarehouseBalance(productId, levelId, ctx = state.context) {
  return ctx.inventoryBalances.find(
    (item) =>
      item.productId === productId &&
      item.locationType === "warehouse" &&
      item.levelId === levelId &&
      !item.externalLocationId,
  );
}

function findExternalBalance(productId, externalLocationId, ctx = state.context) {
  return ctx.inventoryBalances.find(
    (item) =>
      item.productId === productId &&
      item.locationType === "external" &&
      item.externalLocationId === externalLocationId,
  );
}

async function addWarehouseQty(productId, levelId, qty) {
  const existing = findWarehouseBalance(productId, levelId);
  await db.put(db.storeNames.inventoryBalances, {
    id: existing?.id || uuid("balance"),
    productId,
    locationType: "warehouse",
    levelId,
    externalLocationId: null,
    qty: Number(existing?.qty || 0) + qty,
    updatedAt: nowIso(),
  });
}

async function addExternalQty(productId, externalLocationId, qty) {
  const existing = findExternalBalance(productId, externalLocationId);
  await db.put(db.storeNames.inventoryBalances, {
    id: existing?.id || uuid("balance"),
    productId,
    locationType: "external",
    levelId: null,
    externalLocationId,
    qty: Number(existing?.qty || 0) + qty,
    updatedAt: nowIso(),
  });
}

async function subtractWarehouseQty(productId, levelId, qty) {
  const existing = findWarehouseBalance(productId, levelId);
  const currentQty = Number(existing?.qty || 0);
  if (!existing || currentQty < qty) {
    throw new Error("来源位置库存不足");
  }
  const nextQty = currentQty - qty;
  if (nextQty > 0) {
    await db.put(db.storeNames.inventoryBalances, {
      ...existing,
      qty: nextQty,
      updatedAt: nowIso(),
    });
  } else {
    await db.remove(db.storeNames.inventoryBalances, existing.id);
  }
}

function buildOperationSyncFields() {
  if (state.mode === "handheld") {
    return {
      importedAt: null,
      importStatus: "pending",
      deviceStatus: "pending",
    };
  }

  return {
    importedAt: nowIso(),
    importStatus: "imported",
    deviceStatus: "imported",
  };
}

async function saveStock(form) {
  const formData = new FormData(form);
  const operationType = text(formData.get("operationType")) || "put_in";
  const model = text(formData.get("model"));
  const qty = Number(formData.get("qty") || 0);
  if (!model || qty <= 0) {
    throw new Error("请填写型号和数量");
  }

  const product = await createOrUpdateProductByModel(model);
  await refreshContext({ preferProductId: product.id });

  let source = null;
  let target = null;
  let externalTarget = null;

  if (operationType === "move" || operationType === "move_to_external") {
    const sourceWarehouse = text(formData.get("sourceWarehouse"));
    const sourceShelf = text(formData.get("sourceShelf"));
    const sourceLevel = text(formData.get("sourceLevel"));
    if (!sourceWarehouse || !sourceShelf || !sourceLevel) {
      throw new Error("请填写来源仓库、货架和层数");
    }
    source = await ensureWarehouseLevel(sourceWarehouse, sourceShelf, sourceLevel, product.id);
  }

  if (operationType === "put_in" || operationType === "move") {
    const warehouseText = text(formData.get("warehouse"));
    const shelfText = text(formData.get("shelf"));
    const levelText = text(formData.get("level"));
    if (!warehouseText || !shelfText || !levelText) {
      throw new Error("请填写目标仓库、货架和层数");
    }
    target = await ensureWarehouseLevel(warehouseText, shelfText, levelText, product.id);
  }

  if (operationType === "move_to_external") {
    const externalText = text(formData.get("externalLocation"));
    if (!externalText) {
      throw new Error("请填写非仓库位置");
    }
    externalTarget = await ensureExternalLocation(externalText);
    await refreshContext({ preferProductId: product.id, preferWarehouseId: source?.warehouse.id, preferShelfId: source?.shelf.id });
  }

  if (operationType === "put_in") {
    await addWarehouseQty(product.id, target.level.id, qty);
  } else if (operationType === "move") {
    if (source.level.id === target.level.id) {
      throw new Error("来源位置和目标位置不能相同");
    }
    await subtractWarehouseQty(product.id, source.level.id, qty);
    await addWarehouseQty(product.id, target.level.id, qty);
  } else if (operationType === "move_to_external") {
    await subtractWarehouseQty(product.id, source.level.id, qty);
    await addExternalQty(product.id, externalTarget.id, qty);
  } else {
    throw new Error("不支持的库存操作");
  }

  await db.put(db.storeNames.inventoryOperations, {
    id: uuid("operation"),
    batchId: "desktop-manual",
    deviceId: getMetaValue("currentDeviceId", "device-desktop"),
    operationType,
    productId: product.id,
    qty,
    sourceLocationType: source ? "warehouse" : "none",
    sourceLevelId: source?.level.id || null,
    sourceExternalLocationId: null,
    targetLocationType: externalTarget ? "external" : "warehouse",
    targetLevelId: target?.level.id || null,
    targetExternalLocationId: externalTarget?.id || null,
    note: operationType === "put_in" ? "手工入库" : operationType === "move" ? "手工移库" : "手工移出",
    operatorName: state.mode === "handheld" ? "手持" : "电脑",
    operatedAt: nowIso(),
    ...buildOperationSyncFields(),
  });

  state.desktopTab = "positions";
  closeDialog();
  await refreshContext({
    preferProductId: product.id,
    preferWarehouseId: target?.warehouse.id || source?.warehouse.id,
    preferShelfId: target?.shelf.id || source?.shelf.id,
  });
  setNotice(operationType === "put_in" ? "库存已录" : operationType === "move" ? "移库已完" : "移出已完");
}

async function saveMoveProduct(form) {
  const formData = new FormData(form);
  const productId = text(formData.get("productId"));
  const sourceLevelId = text(formData.get("sourceLevelId"));
  const targetLevelId = text(formData.get("targetLevelId"));
  const qty = Number(formData.get("qty") || 0);

  if (!productId || !sourceLevelId) {
    throw new Error("缺少必要信息");
  }
  if (!targetLevelId) {
    throw new Error("请选择目标层数");
  }
  if (sourceLevelId === targetLevelId) {
    throw new Error("来源位置和目标位置不能相同");
  }
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new Error("移动数量必须为正整数");
  }

  const ctx = state.context;
  const sourceBalance = findWarehouseBalance(productId, sourceLevelId);
  const sourceQty = Number(sourceBalance?.qty || 0);
  if (sourceQty < qty) {
    throw new Error("来源位置库存不足");
  }

  const targetLevel = ctx.shelfLevelsById.get(targetLevelId);
  const targetShelf = targetLevel ? ctx.shelvesById.get(targetLevel.shelfId) : null;
  if (!targetLevel || !targetShelf) {
    throw new Error("目标层数无效");
  }

  await subtractWarehouseQty(productId, sourceLevelId, qty);
  await addWarehouseQty(productId, targetLevelId, qty);

  await db.put(db.storeNames.inventoryOperations, {
    id: uuid("operation"),
    batchId: "position-move",
    deviceId: getMetaValue("currentDeviceId", "device-desktop"),
    operationType: "move",
    productId,
    qty,
    sourceLocationType: "warehouse",
    sourceLevelId,
    sourceExternalLocationId: null,
    targetLocationType: "warehouse",
    targetLevelId,
    targetExternalLocationId: null,
    note: "位置页移库",
    operatorName: state.mode === "handheld" ? "手持" : "电脑",
    operatedAt: nowIso(),
    ...buildOperationSyncFields(),
  });

  closeDialog();

  state.pendingMoveAnimation = {
    sourceLevelId,
    targetLevelId,
    qty,
    productId,
  };
  state.positionWarehouseId = targetShelf.warehouseId;
  state.positionShelfId = targetShelf.id;

  await refreshContext({
    preferProductId: productId,
    preferWarehouseId: targetShelf.warehouseId,
    preferShelfId: targetShelf.id,
  });
  pushToast(`已移动 ${formatQty(qty)} 件到 ${targetShelf.code} · ${targetLevel.levelNo} 层`);
}

async function saveEntry(form, options = {}) {
  const formData = new FormData(form);
  const model = text(formData.get("model"));
  const warehouseText = text(formData.get("warehouse"));
  const shelfText = text(formData.get("shelf"));
  const levelText = text(formData.get("level"));
  const qtyRaw = formData.get("qty");
  const qty = Number(qtyRaw || 0);
  const note = text(formData.get("note"));
  const imageFile = formData.get("imageFile");

  if (!model) {
    throw new Error("请填写产品型号");
  }

  // optional image — preserve existing if user didn't upload a new one
  let image = null;
  if (imageFile instanceof File && imageFile.size > 0) {
    image = await readFileAsDataUrl(imageFile);
  }

  const product = await createOrUpdateProductByModel(model, { image });
  await refreshContext({ preferProductId: product.id });

  // location is fully optional — skip stock op when not specified
  const wantsLocation = warehouseText || shelfText || levelText;
  if (wantsLocation && !(warehouseText && shelfText && levelText)) {
    throw new Error("仓库 / 货架 / 层数需同时填写，或全部留空");
  }

  let target = null;
  if (wantsLocation) {
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new Error("填写位置时数量必须为正整数");
    }
    target = await ensureWarehouseLevel(warehouseText, shelfText, levelText, product.id);
    await addWarehouseQty(product.id, target.level.id, qty);

    await db.put(db.storeNames.inventoryOperations, {
      id: uuid("operation"),
      batchId: "manual-entry",
      deviceId: getMetaValue("currentDeviceId", "device-desktop"),
      operationType: "put_in",
      productId: product.id,
      qty,
      sourceLocationType: "none",
      sourceLevelId: null,
      sourceExternalLocationId: null,
      targetLocationType: "warehouse",
      targetLevelId: target.level.id,
      targetExternalLocationId: null,
      note: note || "手工录入",
      operatorName: state.mode === "handheld" ? "手持" : "电脑",
      operatedAt: nowIso(),
      ...buildOperationSyncFields(),
    });
  }

  const successMsg = wantsLocation
    ? `${product.model} · ${formatQty(qty)} 件已录入`
    : `${product.model} 已创建（未指定位置）`;

  if (options.continueAdding) {
    await refreshContext({
      preferProductId: product.id,
      preferWarehouseId: target?.warehouse.id,
      preferShelfId: target?.shelf.id,
    });
    closeDialog();
    renderEntryDialog(wantsLocation ? { warehouse: warehouseText, shelf: shelfText, level: levelText } : {});
    pushToast(successMsg, "ready");
    return;
  }

  closeDialog();
  await refreshContext({
    preferProductId: product.id,
    preferWarehouseId: target?.warehouse.id,
    preferShelfId: target?.shelf.id,
  });
  if (target) {
    state.desktopTab = "positions";
    state.positionWarehouseId = target.warehouse.id;
    state.positionShelfId = target.shelf.id;
  } else {
    state.desktopTab = "overview";
  }
  setNotice(successMsg);
  render();
}

async function saveField(form) {
  const ctx = state.context;
  const formData = new FormData(form);
  const fieldId = text(formData.get("fieldId"));
  const existing = fieldId ? ctx.customFieldDefinitionsById.get(fieldId) : null;
  const name = text(formData.get("name"));
  if (!name) {
    throw new Error("请填写字段名称");
  }
  const record = {
    id: existing?.id || uuid("field"),
    name,
    fieldType: existing?.fieldType || "text",
    options: existing?.options || [],
    isRequired: existing?.isRequired || false,
    isSearchable: formData.get("isSearchable") === "on",
    sortOrder: existing?.sortOrder || ctx.customFieldDefinitions.length + 1,
    status: "active",
    createdAt: existing?.createdAt || nowIso(),
    updatedAt: nowIso(),
  };
  await db.put(db.storeNames.customFieldDefinitions, record);
  closeDialog();
  await refreshContext();
  setNotice(existing ? "字段已更" : "字段已创");
}

async function deleteFieldValue(fieldId, valueText) {
  const ctx = state.context;
  const field = ctx.customFieldDefinitionsById.get(fieldId);
  if (!field || !valueText) {
    return;
  }
  const matches = (ctx.valuesByFieldId.get(fieldId) || []).filter((item) => item.valueText === valueText);
  const productCount = matches.length;
  const inOptions = (field.options || []).includes(valueText);
  if (!productCount && !inOptions) {
    return;
  }
  const message = productCount
    ? `确认删除值 "${valueText}"？将清除 ${productCount} 个产品在字段 "${field.name}" 中的此值。`
    : `确认删除值 "${valueText}"？`;
  if (!window.confirm(message)) {
    return;
  }
  for (const item of matches) {
    await db.remove(db.storeNames.productCustomFieldValues, item.id);
  }
  if (inOptions) {
    const updated = {
      ...field,
      options: (field.options || []).filter((value) => value !== valueText),
      updatedAt: nowIso(),
    };
    await db.put(db.storeNames.customFieldDefinitions, updated);
  }
  await refreshContext();
  setNotice(`已删除 "${valueText}"`);
}

async function saveWarehouse(form) {
  const formData = new FormData(form);
  const name = text(formData.get("name"));
  const code = text(formData.get("code")) || name;
  if (!name) {
    throw new Error("请填写仓库名称");
  }
  const warehouse = {
    id: uuid("warehouse"),
    code,
    name,
    colorToken: text(formData.get("colorToken")) || "blue",
    sortOrder: state.context.warehouses.length + 1,
    status: "active",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await db.put(db.storeNames.warehouses, warehouse);
  closeDialog();
  await refreshContext({ preferWarehouseId: warehouse.id });
  setNotice("仓库已创");
}

async function saveShelf(form) {
  const formData = new FormData(form);
  const warehouseId = text(formData.get("warehouseId"));
  const code = text(formData.get("code"));
  const name = text(formData.get("name")) || code;
  if (!warehouseId || !code) {
    throw new Error("请填写货架信息");
  }
  const sortOrder = state.context.shelves.filter((item) => item.warehouseId === warehouseId).length + 1;
  const shelf = {
    id: uuid("shelf"),
    warehouseId,
    code,
    name,
    sortOrder,
    status: "active",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await db.put(db.storeNames.shelves, shelf);
  closeDialog();
  await refreshContext({ preferWarehouseId: warehouseId, preferShelfId: shelf.id });
  setNotice("货架已创");
}

async function saveLevel(form) {
  const formData = new FormData(form);
  const shelfId = text(formData.get("shelfId"));
  const levelNo = parseLevelNo(formData.get("levelNo"));
  if (!shelfId || !levelNo) {
    throw new Error("请填写层数");
  }
  const shelf = state.context.shelvesById.get(shelfId);
  const warehouse = shelf ? state.context.warehousesById.get(shelf.warehouseId) : null;
  const level = {
    id: uuid("level"),
    shelfId,
    levelNo,
    locationCode: warehouse && shelf ? buildLocationCode(warehouse, shelf, levelNo) : `L${String(levelNo).padStart(2, "0")}`,
    qrText: warehouse && shelf ? buildLocationCode(warehouse, shelf, levelNo) : `L${String(levelNo).padStart(2, "0")}`,
    sortOrder: levelNo,
    status: "active",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await db.put(db.storeNames.shelfLevels, level);
  closeDialog();
  await refreshContext({ preferWarehouseId: shelf?.warehouseId, preferShelfId: shelfId });
  setNotice("层数已创");
}

async function saveExternal(form) {
  const formData = new FormData(form);
  const name = text(formData.get("name"));
  const code = text(formData.get("code")) || name;
  if (!name) {
    throw new Error("请填写名称");
  }
  await db.put(db.storeNames.externalLocations, {
    id: uuid("external"),
    name,
    code,
    sortOrder: state.context.externalLocations.length + 1,
    status: "active",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
  closeDialog();
  await refreshContext();
  setNotice("非仓库位置已创建");
}

function blockDelete(message) {
  window.alert(message);
  setNotice(message, "failed");
}

function getOperationsForLevelIds(levelIds, ctx = state.context) {
  return ctx.inventoryOperations.filter(
    (operation) =>
      (operation.sourceLevelId && levelIds.has(operation.sourceLevelId)) ||
      (operation.targetLevelId && levelIds.has(operation.targetLevelId)),
  );
}

function getOperationsForExternalId(externalId, ctx = state.context) {
  return ctx.inventoryOperations.filter(
    (operation) =>
      operation.sourceExternalLocationId === externalId ||
      operation.targetExternalLocationId === externalId,
  );
}

async function deleteProduct(productId) {
  const ctx = state.context;
  const product = ctx.productsById.get(productId);
  if (!product) {
    return;
  }

  const values = ctx.valuesByProductId.get(productId) || [];
  const balances = getProductBalances(productId, ctx);
  const operations = ctx.inventoryOperations.filter((item) => item.productId === productId);
  if (balances.length) {
    blockDelete("该产品仍有库存，请先移走再删除");
    return;
  }
  if (operations.length) {
    blockDelete("该产品已有操作记录，不能删除");
    return;
  }
  if (!window.confirm(`确认删除 ${product.model} 吗？`)) {
    return;
  }

  for (const item of values) {
    await db.remove(db.storeNames.productCustomFieldValues, item.id);
  }
  await db.remove(db.storeNames.products, productId);

  const remaining = ctx.products.filter((item) => item.id !== productId);
  const nextProductId = remaining[0]?.id || null;
  await refreshContext({ preferProductId: nextProductId });
  setNotice("产品已删");
}

async function deleteField(fieldId) {
  const ctx = state.context;
  const field = ctx.customFieldDefinitionsById.get(fieldId);
  if (!field || !window.confirm(`确认删除字段 ${field.name} 吗？`)) {
    return;
  }
  for (const value of ctx.valuesByFieldId.get(fieldId) || []) {
    await db.remove(db.storeNames.productCustomFieldValues, value.id);
  }
  await db.remove(db.storeNames.customFieldDefinitions, fieldId);
  await refreshContext();
  setNotice("字段已删");
}

async function deleteWarehouse(warehouseId) {
  const ctx = state.context;
  const warehouse = ctx.warehousesById.get(warehouseId);
  if (!warehouse) {
    return;
  }
  const shelves = ctx.shelves.filter((item) => item.warehouseId === warehouseId);
  const shelfIds = new Set(shelves.map((item) => item.id));
  const levels = ctx.shelfLevels.filter((item) => shelfIds.has(item.shelfId));
  const levelIds = new Set(levels.map((item) => item.id));
  const balances = ctx.inventoryBalances.filter((item) => item.levelId && levelIds.has(item.levelId));
  const operations = getOperationsForLevelIds(levelIds, ctx);
  if (balances.length) {
    blockDelete("该仓库下仍有库存，请先移走再删除");
    return;
  }
  if (operations.length) {
    blockDelete("该仓库下已有操作记录，不能删除");
    return;
  }
  if (!window.confirm(`确认删除仓库 ${warehouse.name} 吗？`)) {
    return;
  }

  for (const level of levels) {
    await db.remove(db.storeNames.shelfLevels, level.id);
  }
  for (const shelf of shelves) {
    await db.remove(db.storeNames.shelves, shelf.id);
  }
  await db.remove(db.storeNames.warehouses, warehouseId);

  const nextWarehouseId = ctx.warehouses.filter((item) => item.id !== warehouseId)[0]?.id || null;
  await refreshContext({ preferWarehouseId: nextWarehouseId });
  setNotice("仓库已删");
}

async function deleteShelf(shelfId) {
  const ctx = state.context;
  const shelf = ctx.shelvesById.get(shelfId);
  if (!shelf) {
    return;
  }
  const levels = ctx.shelfLevels.filter((item) => item.shelfId === shelfId);
  const levelIds = new Set(levels.map((item) => item.id));
  const balances = ctx.inventoryBalances.filter((item) => item.levelId && levelIds.has(item.levelId));
  const operations = getOperationsForLevelIds(levelIds, ctx);
  if (balances.length) {
    blockDelete("该货架下仍有库存，请先移走再删除");
    return;
  }
  if (operations.length) {
    blockDelete("该货架下已有操作记录，不能删除");
    return;
  }
  if (!window.confirm(`确认删除货架 ${shelf.code} 吗？`)) {
    return;
  }

  for (const level of levels) {
    await db.remove(db.storeNames.shelfLevels, level.id);
  }
  await db.remove(db.storeNames.shelves, shelfId);

  const nextShelfId = ctx.shelves.filter((item) => item.id !== shelfId && item.warehouseId === shelf.warehouseId)[0]?.id || null;
  await refreshContext({ preferWarehouseId: shelf.warehouseId, preferShelfId: nextShelfId });
  setNotice("货架已删");
}

async function deleteLevel(levelId) {
  const ctx = state.context;
  const level = ctx.shelfLevelsById.get(levelId);
  if (!level) {
    return;
  }
  const balances = ctx.inventoryBalances.filter((item) => item.levelId === levelId);
  const operations = getOperationsForLevelIds(new Set([levelId]), ctx);
  if (balances.length) {
    blockDelete("该层数下仍有库存，请先移走再删除");
    return;
  }
  if (operations.length) {
    blockDelete("该层数已有操作记录，不能删除");
    return;
  }
  if (!window.confirm(`确认删除 ${level.levelNo} 层吗？`)) {
    return;
  }
  await db.remove(db.storeNames.shelfLevels, levelId);
  await refreshContext({ preferShelfId: level.shelfId });
  setNotice("层数已删");
}

async function deleteExternal(externalId) {
  const ctx = state.context;
  const external = ctx.externalLocationsById.get(externalId);
  if (!external) {
    return;
  }
  const balances = ctx.inventoryBalances.filter((item) => item.externalLocationId === externalId);
  const operations = getOperationsForExternalId(externalId, ctx);
  if (balances.length) {
    blockDelete("该非仓库位置仍有库存，请先移走再删除");
    return;
  }
  if (operations.length) {
    blockDelete("该非仓库位置已有操作记录，不能删除");
    return;
  }
  if (!window.confirm(`确认删除 ${external.name} 吗？`)) {
    return;
  }
  await db.remove(db.storeNames.externalLocations, externalId);
  await refreshContext();
  setNotice("非仓库位置已删除");
}

function ensureXLSX() {
  if (typeof window === "undefined" || !window.XLSX) {
    throw new Error("Excel 模块未加载，请刷新页面重试");
  }
  return window.XLSX;
}

function appendSheet(workbook, title, headers, rows) {
  const XLSX = ensureXLSX();
  const aoa = [headers, ...rows.map((row) => headers.map((header) => row[header] ?? ""))];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  sheet["!freeze"] = { xSplit: 0, ySplit: 1 };
  const widths = headers.map((header) => {
    const headerWidth = String(header || "").length;
    const sample = rows.slice(0, 24);
    const dataMax = sample.reduce((max, row) => Math.max(max, String(row[header] ?? "").length), 0);
    return { wch: Math.min(Math.max(headerWidth + 2, dataMax + 2, 12), 32) };
  });
  sheet["!cols"] = widths;
  XLSX.utils.book_append_sheet(workbook, sheet, title);
}

function downloadXLSX(workbook, filename) {
  const XLSX = ensureXLSX();
  const wbout = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  const blob = new Blob([wbout], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  downloadBlob(blob, filename);
}

function exportSnapshotToWorkbook(snapshot) {
  const XLSX = ensureXLSX();
  const workbook = XLSX.utils.book_new();

  appendSheet(workbook, "说明", ["说明", "值"], [
    { "说明": "用途", "值": "编辑后可直接导入回系统（手机或电脑都可）" },
    { "说明": "建议", "值": "优先修改中文列；ID 列可留空，新行会自动创建" },
    { "说明": "导入方式", "值": "在“互传”页面点击“导入 Excel”" },
  ]);

  appendSheet(workbook, "产品", ["产品ID", "产品型号", "产品图片"],
    (snapshot.products || []).filter((item) => item.status !== "deleted").map((item) => ({
      "产品ID": item.id || "",
      "产品型号": item.model || "",
      "产品图片": String(item.image || "").startsWith("data:image/") && String(item.image || "").length > 3000
        ? ""
        : (item.image || ""),
    })));

  const fields = (snapshot.customFieldDefinitions || []).filter((item) => item.status !== "deleted");
  appendSheet(workbook, "自定义字段", ["字段ID", "字段名", "字段类型", "可选值", "参与搜索", "排序"],
    fields.map((item) => ({
      "字段ID": item.id || "",
      "字段名": item.name || "",
      "字段类型": item.fieldType || "text",
      "可选值": (item.options || []).join(", "),
      "参与搜索": item.isSearchable ? "是" : "否",
      "排序": item.sortOrder || 0,
    })));

  const productsById = new Map((snapshot.products || []).map((item) => [item.id, item]));
  const fieldsById = new Map(fields.map((item) => [item.id, item]));
  appendSheet(workbook, "产品自定义信息", ["记录ID", "产品ID", "产品型号", "字段ID", "字段名", "值"],
    (snapshot.productCustomFieldValues || []).filter((item) => item.status !== "deleted").map((item) => ({
      "记录ID": item.id || "",
      "产品ID": item.productId || "",
      "产品型号": productsById.get(item.productId)?.model || "",
      "字段ID": item.fieldId || "",
      "字段名": fieldsById.get(item.fieldId)?.name || "",
      "值": item.valueText || "",
    })));

  appendSheet(workbook, "仓库", ["仓库ID", "仓库编码", "仓库名称", "颜色", "排序"],
    (snapshot.warehouses || []).filter((item) => item.status !== "deleted").map((item) => ({
      "仓库ID": item.id || "",
      "仓库编码": item.code || "",
      "仓库名称": item.name || "",
      "颜色": item.colorToken || "",
      "排序": item.sortOrder || 0,
    })));

  const warehousesById = new Map((snapshot.warehouses || []).map((item) => [item.id, item]));
  appendSheet(workbook, "货架", ["货架ID", "仓库ID", "仓库编码", "货架编码", "货架名称", "排序"],
    (snapshot.shelves || []).filter((item) => item.status !== "deleted").map((item) => ({
      "货架ID": item.id || "",
      "仓库ID": item.warehouseId || "",
      "仓库编码": warehousesById.get(item.warehouseId)?.code || "",
      "货架编码": item.code || "",
      "货架名称": item.name || "",
      "排序": item.sortOrder || 0,
    })));

  const shelvesById = new Map((snapshot.shelves || []).map((item) => [item.id, item]));
  appendSheet(workbook, "层数", ["层数ID", "货架ID", "仓库编码", "货架编码", "层数", "库位编码", "二维码内容", "排序"],
    (snapshot.shelfLevels || []).filter((item) => item.status !== "deleted").map((item) => {
      const shelf = shelvesById.get(item.shelfId);
      const warehouse = shelf ? warehousesById.get(shelf.warehouseId) : null;
      return {
        "层数ID": item.id || "",
        "货架ID": item.shelfId || "",
        "仓库编码": warehouse?.code || "",
        "货架编码": shelf?.code || "",
        "层数": item.levelNo || 0,
        "库位编码": item.locationCode || "",
        "二维码内容": item.qrText || "",
        "排序": item.sortOrder || 0,
      };
    }));

  appendSheet(workbook, "非仓库位置", ["位置ID", "位置编码", "位置名称", "排序"],
    (snapshot.externalLocations || []).filter((item) => item.status !== "deleted").map((item) => ({
      "位置ID": item.id || "",
      "位置编码": item.code || "",
      "位置名称": item.name || "",
      "排序": item.sortOrder || 0,
    })));

  const levelsById = new Map((snapshot.shelfLevels || []).map((item) => [item.id, item]));
  const externalById = new Map((snapshot.externalLocations || []).map((item) => [item.id, item]));
  appendSheet(workbook, "库存", ["库存ID", "产品ID", "产品型号", "位置类型", "层数ID", "库位编码", "非仓库位置ID", "非仓库位置编码", "数量"],
    (snapshot.inventoryBalances || []).map((item) => ({
      "库存ID": item.id || "",
      "产品ID": item.productId || "",
      "产品型号": productsById.get(item.productId)?.model || "",
      "位置类型": item.locationType || "",
      "层数ID": item.levelId || "",
      "库位编码": levelsById.get(item.levelId)?.locationCode || "",
      "非仓库位置ID": item.externalLocationId || "",
      "非仓库位置编码": externalById.get(item.externalLocationId)?.code || "",
      "数量": item.qty || 0,
    })));

  appendSheet(workbook, "操作", [
    "操作ID", "批次ID", "设备ID", "操作类型", "产品ID", "产品型号", "数量",
    "来源类型", "来源层数ID", "来源库位编码", "来源非仓库位置ID", "来源非仓库位置编码",
    "目标类型", "目标层数ID", "目标库位编码", "目标非仓库位置ID", "目标非仓库位置编码",
    "备注", "操作人", "操作时间", "导入时间", "导入状态", "设备状态",
  ], (snapshot.inventoryOperations || []).map((item) => ({
    "操作ID": item.id || "",
    "批次ID": item.batchId || "",
    "设备ID": item.deviceId || "",
    "操作类型": item.operationType || "",
    "产品ID": item.productId || "",
    "产品型号": productsById.get(item.productId)?.model || "",
    "数量": item.qty || 0,
    "来源类型": item.sourceLocationType || "",
    "来源层数ID": item.sourceLevelId || "",
    "来源库位编码": levelsById.get(item.sourceLevelId)?.locationCode || "",
    "来源非仓库位置ID": item.sourceExternalLocationId || "",
    "来源非仓库位置编码": externalById.get(item.sourceExternalLocationId)?.code || "",
    "目标类型": item.targetLocationType || "",
    "目标层数ID": item.targetLevelId || "",
    "目标库位编码": levelsById.get(item.targetLevelId)?.locationCode || "",
    "目标非仓库位置ID": item.targetExternalLocationId || "",
    "目标非仓库位置编码": externalById.get(item.targetExternalLocationId)?.code || "",
    "备注": item.note || "",
    "操作人": item.operatorName || "",
    "操作时间": item.operatedAt || "",
    "导入时间": item.importedAt || "",
    "导入状态": item.importStatus || "",
    "设备状态": item.deviceStatus || "",
  })));

  return workbook;
}

async function exportExcel() {
  const snapshot = await db.exportAll();
  const pendingOperations = (snapshot.inventoryOperations || []).filter(isPendingOperation);
  const workbook = exportSnapshotToWorkbook(snapshot);
  downloadXLSX(workbook, `warehouse-export-${new Date().toISOString().slice(0, 10)}.xlsx`);

  if (pendingOperations.length) {
    const exportedAt = nowIso();
    for (const operation of pendingOperations) {
      await db.put(db.storeNames.inventoryOperations, {
        ...operation,
        exportedAt,
        deviceStatus: "exported",
      });
    }
    await refreshContext();
  }
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function downloadImportTemplate() {
  const XLSX = ensureXLSX();
  const snapshot = await db.exportAll();
  const fields = (snapshot.customFieldDefinitions || [])
    .filter((item) => item.status !== "deleted")
    .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
  const fieldHeaders = fields.map((f) => f.name).filter(Boolean);
  const headers = ["型号", "图片", "位置", ...fieldHeaders];
  const noteRow = ["", "", "按 仓库-货架-层数 填写，如 A仓-S01-1", ...fieldHeaders.map(() => "")];
  const aoa = [headers, noteRow];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  sheet["!cols"] = [{ wch: 22 }, { wch: 34 }, { wch: 36 }, ...fieldHeaders.map(() => ({ wch: 16 }))];
  sheet["!freeze"] = { xSplit: 0, ySplit: 2 };
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "导入模板");
  downloadXLSX(workbook, `warehouse-import-template-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function promptImportExcel() {
  state.pendingFileAction = "import-excel";
  hiddenFileInput.accept = ".xlsx,.xlsm,.xltx,.xltm";
  hiddenFileInput.value = "";
  hiddenFileInput.click();
}

function maskToken(token) {
  if (!token) return "";
  if (token.length <= 12) return "•".repeat(token.length);
  return `${token.slice(0, 6)}${"•".repeat(token.length - 12)}${token.slice(-6)}`;
}

async function copyText(textValue, successMessage = "已复制") {
  if (!textValue) {
    return;
  }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(textValue);
    } else {
      const ta = document.createElement("textarea");
      ta.value = textValue;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setNotice(successMessage);
  } catch (error) {
    console.error(error);
    setNotice("复制失败，请手动选择复制", "failed");
  }
}

async function renderSyncInfoDialog() {
  // server-info is local-only; in remote-client mode the request will hit
  // the remote PC and may fail (returns 403 since not from localhost).
  // We treat this as "running as a client", which is what we want to show.
  let info = { token: "", port: 4173, addresses: [], hostname: "" };
  let serverInfoOk = false;
  try {
    const response = await fetch("/api/sync/server-info");
    if (response.ok) {
      info = await response.json();
      serverInfoOk = true;
    }
  } catch (error) {
    console.error(error);
  }

  const visible = state.syncTokenVisible;
  const tokenDisplay = visible ? info.token : maskToken(info.token);

  const addressItems = (info.addresses || []).map((entry) => {
    const url = `http://${entry.address}:${info.port}/`;
    return `
      <li class="sync-url-row">
        <code class="sync-url">${escapeHtml(url)}</code>
        <span class="sync-url-iface">${escapeHtml(entry.iface)}</span>
        <button class="button ghost" type="button" data-action="copy-text" data-text="${escapeHtml(url)}" data-success="地址已复制">复制</button>
      </li>
    `;
  }).join("");

  const remote = isRemoteMode();
  const remoteBase = getApiBase();
  const remoteToken = getSyncToken();
  const remoteSection = remote
    ? `
      <section class="sync-section sync-remote-active">
        <h4 class="sync-section-title">远程客户端模式（已启用）</h4>
        <p class="sync-hint">本设备当前作为客户端连接到远程服务器，所有数据读写都走远程。</p>
        <div class="sync-url-row">
          <code class="sync-url">${escapeHtml(remoteBase)}</code>
        </div>
        <div class="sync-token-row">
          <code class="sync-token">${escapeHtml(remoteToken ? maskToken(remoteToken) : "未设置令牌")}</code>
        </div>
        <div class="action-row">
          <button class="button secondary" type="button" data-action="open-remote-config">修改</button>
          <button class="button ghost" type="button" data-action="clear-remote-config">改回本机模式</button>
        </div>
      </section>
    `
    : `
      <section class="sync-section">
        <h4 class="sync-section-title">作为远程客户端</h4>
        <p class="sync-hint">如果本设备（如安卓手机）需要连接到另一台 PC 上的仓库系统，点下方按钮配置远程服务器地址 + 令牌。配置后所有数据读写都走那台远程服务器。</p>
        <div class="action-row">
          <button class="button secondary" type="button" data-action="open-remote-config">配置远程服务器</button>
        </div>
      </section>
    `;

  const localServerSection = serverInfoOk
    ? `
      <section class="sync-section">
        <h4 class="sync-section-title">本机服务器地址</h4>
        <p class="sync-hint">同一局域网下其他电脑/手机使用以下任一地址，即可共用同一份数据。${info.hostname ? `主机名：<code>${escapeHtml(info.hostname)}</code>` : ""}</p>
        <ul class="sync-url-list">
          ${addressItems || `<li class="sync-empty">未检测到局域网地址（可能未连入网络）</li>`}
        </ul>
      </section>
      <section class="sync-section">
        <h4 class="sync-section-title">安卓 App 同步令牌</h4>
        <p class="sync-hint">仅安卓 App / 远程客户端首次配置时填入，普通浏览器访问无需此令牌。</p>
        <div class="sync-token-row">
          <code class="sync-token">${escapeHtml(tokenDisplay || "—")}</code>
          <button class="button ghost" type="button" data-action="toggle-sync-token">${visible ? "隐藏" : "显示"}</button>
          <button class="button ghost" type="button" data-action="copy-text" data-text="${escapeHtml(info.token)}" data-success="令牌已复制" ${info.token ? "" : "disabled"}>复制</button>
        </div>
      </section>
    `
    : `
      <section class="sync-section">
        <h4 class="sync-section-title">本机服务器信息</h4>
        <p class="sync-hint">当前未连接到本机服务器（可能正运行在远程客户端模式）。</p>
      </section>
    `;

  renderDialog(`
    <div class="dialog-panel">
      <div class="dialog-header">
        <h3 class="panel-title">同步与共享</h3>
        <button class="button secondary" type="button" data-action="close-dialog">关闭</button>
      </div>
      <div class="dialog-body">
        ${remoteSection}
        ${localServerSection}
      </div>
    </div>
  `);
}

function renderRemoteConfigDialog(prefill = null) {
  const base = prefill?.base ?? getApiBase();
  const token = prefill?.token ?? getSyncToken();
  const status = prefill?.status || "";
  const statusType = prefill?.statusType || "";

  renderDialog(`
    <form class="dialog-panel" data-form="remote-config">
      <div class="dialog-header">
        <h3 class="panel-title">配置远程服务器</h3>
        <button class="button secondary" type="button" data-action="close-dialog">关闭</button>
      </div>
      <div class="dialog-body">
        <p class="sync-hint">填入要连接的服务器电脑上"同步与共享"面板里显示的局域网地址和令牌。</p>
        <div class="field">
          <label>服务器地址</label>
          <input name="base" placeholder="http://192.168.1.10:4173" value="${escapeHtml(base)}" autocomplete="off" inputmode="url">
        </div>
        <div class="field">
          <label>同步令牌</label>
          <input name="token" placeholder="服务器同步面板里复制的 48 位字符" value="${escapeHtml(token)}" autocomplete="off">
        </div>
        ${status ? `<div class="sync-status ${statusType ? `sync-status-${statusType}` : ""}">${escapeHtml(status)}</div>` : ""}
      </div>
      <div class="dialog-footer">
        <button class="button ghost" type="button" data-action="test-remote-config">测试连接</button>
        <button class="button primary" type="submit">保存并使用</button>
      </div>
    </form>
  `);
}

function readRemoteConfigForm() {
  const form = dialog.querySelector("form[data-form='remote-config']");
  if (!form) return null;
  const data = new FormData(form);
  return {
    base: String(data.get("base") || "").trim(),
    token: String(data.get("token") || "").trim(),
  };
}

function renderImportDialog() {
  renderDialog(`
    <div class="dialog-panel">
      <div class="dialog-header">
        <h3 class="panel-title">导入 Excel</h3>
        <button class="button secondary" type="button" data-action="close-dialog">关闭</button>
      </div>
      <div class="dialog-body">
        <div class="import-dialog-actions">
          <button class="button tone-mist" type="button" data-action="download-import-template">下载模板</button>
          <button class="button primary" type="button" data-action="choose-import-excel">选择文件导入</button>
        </div>
      </div>
    </div>
  `);
}

function activeRows(rows = []) {
  return (rows || []).filter((item) => item?.status !== "deleted").map((item) => ({ ...item }));
}

function mergeMetaRows(currentRows, extraRows) {
  const map = new Map();
  for (const row of currentRows || []) {
    if (row?.key) {
      map.set(row.key, { ...row });
    }
  }
  for (const row of extraRows || []) {
    if (row?.key) {
      map.set(row.key, { ...row });
    }
  }
  return [...map.values()];
}

function nextSortOrder(rows) {
  return rows.reduce((max, row) => Math.max(max, Number(row.sortOrder || 0)), 0) + 1;
}

function balanceKey(balance) {
  return [
    balance.productId,
    balance.locationType,
    balance.levelId || "",
    balance.externalLocationId || "",
  ].join("::");
}

function mapLocationId(sourceId, idMap, currentMap) {
  if (!sourceId) {
    return null;
  }
  return idMap.get(sourceId) || (currentMap.has(sourceId) ? sourceId : null);
}

function mergeImportedPayload(current, payload, fileName) {
  const importedAt = nowIso();
  const products = activeRows(current.products);
  const customFieldDefinitions = activeRows(current.customFieldDefinitions);
  const productCustomFieldValues = activeRows(current.productCustomFieldValues);
  const warehouses = activeRows(current.warehouses);
  const shelves = activeRows(current.shelves);
  const shelfLevels = activeRows(current.shelfLevels);
  const externalLocations = activeRows(current.externalLocations);
  const inventoryBalances = activeRows(current.inventoryBalances);
  const inventoryOperations = activeRows(current.inventoryOperations);

  const productsById = new Map(products.map((item) => [item.id, item]));
  const productsByModel = new Map(products.map((item) => [normalizeText(item.model), item]));
  const productIdMap = new Map();

  for (const imported of payload.products || []) {
    const model = text(imported.model);
    if (!model) {
      continue;
    }
    let product = (imported.id && productsById.get(imported.id)) || productsByModel.get(normalizeText(model));
    if (!product) {
      product = {
        ...imported,
        id: imported.id && !productsById.has(imported.id) ? imported.id : uuid("product"),
        model,
        modelNormalized: normalizeText(model),
        image: imported.image || makePlaceholderImage(model),
        status: "active",
        createdAt: imported.createdAt || importedAt,
        updatedAt: importedAt,
      };
      products.push(product);
      productsById.set(product.id, product);
      productsByModel.set(normalizeText(model), product);
    } else {
      const oldModelKey = normalizeText(product.model);
      const newModelKey = normalizeText(model);
      const owner = productsByModel.get(newModelKey);
      if (!owner || owner.id === product.id) {
        productsByModel.delete(oldModelKey);
        product.model = model;
        product.modelNormalized = newModelKey;
        productsByModel.set(newModelKey, product);
      }
      if (text(imported.image)) {
        product.image = text(imported.image);
      }
      product.status = "active";
      product.updatedAt = importedAt;
    }
    if (imported.id) {
      productIdMap.set(imported.id, product.id);
    }
  }

  const fieldsById = new Map(customFieldDefinitions.map((item) => [item.id, item]));
  const fieldsByName = new Map(customFieldDefinitions.map((item) => [normalizeText(item.name), item]));
  const fieldIdMap = new Map();

  for (const imported of payload.customFieldDefinitions || []) {
    const name = text(imported.name);
    if (!name) {
      continue;
    }
    let field = (imported.id && fieldsById.get(imported.id)) || fieldsByName.get(normalizeText(name));
    if (!field) {
      field = {
        ...imported,
        id: imported.id && !fieldsById.has(imported.id) ? imported.id : uuid("field"),
        name,
        fieldType: imported.fieldType || "text",
        options: imported.options || [],
        isRequired: Boolean(imported.isRequired),
        isSearchable: Boolean(imported.isSearchable),
        sortOrder: Number(imported.sortOrder || nextSortOrder(customFieldDefinitions)),
        status: "active",
        createdAt: imported.createdAt || importedAt,
        updatedAt: importedAt,
      };
      customFieldDefinitions.push(field);
      fieldsById.set(field.id, field);
      fieldsByName.set(normalizeText(name), field);
    } else if (Array.isArray(imported.options) && imported.options.length) {
      field.options = [...new Set([...(field.options || []), ...imported.options])];
      field.updatedAt = importedAt;
    }
    if (imported.id) {
      fieldIdMap.set(imported.id, field.id);
    }
  }

  const valuesByProductField = new Map(productCustomFieldValues.map((item) => [`${item.productId}::${item.fieldId}`, item]));
  for (const imported of payload.productCustomFieldValues || []) {
    const productId = productIdMap.get(imported.productId) || (productsById.has(imported.productId) ? imported.productId : null);
    const fieldId = fieldIdMap.get(imported.fieldId) || (fieldsById.has(imported.fieldId) ? imported.fieldId : null);
    const valueText = text(imported.valueText);
    if (!productId || !fieldId) {
      continue;
    }
    const key = `${productId}::${fieldId}`;
    const existing = valuesByProductField.get(key);
    if (!valueText) {
      if (payload.replaceProductLocations && existing) {
        const index = productCustomFieldValues.findIndex((item) => item.id === existing.id);
        if (index >= 0) {
          productCustomFieldValues.splice(index, 1);
        }
        valuesByProductField.delete(key);
      }
      continue;
    }
    if (existing) {
      existing.valueText = valueText;
      existing.updatedAt = importedAt;
    } else {
      const value = {
        id: imported.id || uuid("pcfv"),
        productId,
        fieldId,
        valueText,
        createdAt: imported.createdAt || importedAt,
        updatedAt: importedAt,
      };
      productCustomFieldValues.push(value);
      valuesByProductField.set(key, value);
    }
  }

  const warehousesById = new Map(warehouses.map((item) => [item.id, item]));
  const warehousesByCode = new Map();
  for (const item of warehouses) {
    if (text(item.code)) {
      warehousesByCode.set(normalizeText(item.code), item);
    }
    if (text(item.name)) {
      warehousesByCode.set(normalizeText(item.name), item);
    }
  }
  const warehouseIdMap = new Map();

  for (const imported of payload.warehouses || []) {
    const code = text(imported.code || imported.name).toUpperCase();
    const name = text(imported.name || code);
    if (!code && !name) {
      continue;
    }
    let warehouse = (imported.id && warehousesById.get(imported.id)) || warehousesByCode.get(normalizeText(code || name));
    if (!warehouse) {
      warehouse = {
        ...imported,
        id: imported.id && !warehousesById.has(imported.id) ? imported.id : uuid("warehouse"),
        code: code || normalizeText(name),
        name: name || code,
        colorToken: imported.colorToken || WAREHOUSE_TONES[warehouses.length % WAREHOUSE_TONES.length],
        sortOrder: Number(imported.sortOrder || nextSortOrder(warehouses)),
        status: "active",
        createdAt: imported.createdAt || importedAt,
        updatedAt: importedAt,
      };
      warehouses.push(warehouse);
      warehousesById.set(warehouse.id, warehouse);
      warehousesByCode.set(normalizeText(warehouse.code || warehouse.name), warehouse);
      warehousesByCode.set(normalizeText(warehouse.name || warehouse.code), warehouse);
    }
    if (imported.id) {
      warehouseIdMap.set(imported.id, warehouse.id);
    }
  }

  const shelvesById = new Map(shelves.map((item) => [item.id, item]));
  const shelvesByKey = new Map();
  for (const item of shelves) {
    if (text(item.code)) {
      shelvesByKey.set(`${item.warehouseId}::${normalizeText(item.code)}`, item);
    }
    if (text(item.name)) {
      shelvesByKey.set(`${item.warehouseId}::${normalizeText(item.name)}`, item);
    }
  }
  const shelfIdMap = new Map();

  for (const imported of payload.shelves || []) {
    const warehouseId = warehouseIdMap.get(imported.warehouseId) || (warehousesById.has(imported.warehouseId) ? imported.warehouseId : null);
    const code = text(imported.code || imported.name).toUpperCase();
    if (!warehouseId || !code) {
      continue;
    }
    const key = `${warehouseId}::${normalizeText(code)}`;
    let shelf = (imported.id && shelvesById.get(imported.id)) || shelvesByKey.get(key);
    if (!shelf) {
      shelf = {
        ...imported,
        id: imported.id && !shelvesById.has(imported.id) ? imported.id : uuid("shelf"),
        warehouseId,
        code,
        name: text(imported.name) || code,
        sortOrder: Number(imported.sortOrder || nextSortOrder(shelves.filter((item) => item.warehouseId === warehouseId))),
        status: "active",
        createdAt: imported.createdAt || importedAt,
        updatedAt: importedAt,
      };
      shelves.push(shelf);
      shelvesById.set(shelf.id, shelf);
      shelvesByKey.set(key, shelf);
      shelvesByKey.set(`${warehouseId}::${normalizeText(shelf.name || shelf.code)}`, shelf);
    }
    if (imported.id) {
      shelfIdMap.set(imported.id, shelf.id);
    }
  }

  const levelsById = new Map(shelfLevels.map((item) => [item.id, item]));
  const levelsByCode = new Map(shelfLevels.map((item) => [normalizeText(item.locationCode), item]));
  const levelsByShelfNo = new Map(shelfLevels.map((item) => [`${item.shelfId}::${Number(item.levelNo)}`, item]));
  const levelIdMap = new Map();

  for (const imported of payload.shelfLevels || []) {
    const shelfId = shelfIdMap.get(imported.shelfId) || (shelvesById.has(imported.shelfId) ? imported.shelfId : null);
    const levelNo = parseLevelNo(imported.levelNo, 1);
    const shelf = shelfId ? shelvesById.get(shelfId) : null;
    const warehouse = shelf ? warehousesById.get(shelf.warehouseId) : null;
    const locationCode = text(imported.locationCode) || (warehouse && shelf ? buildLocationCode(warehouse, shelf, levelNo) : `L${String(levelNo).padStart(2, "0")}`);
    if (!shelfId || !levelNo) {
      continue;
    }
    let level = (imported.id && levelsById.get(imported.id)) || levelsByCode.get(normalizeText(locationCode)) || levelsByShelfNo.get(`${shelfId}::${levelNo}`);
    if (!level) {
      level = {
        ...imported,
        id: imported.id && !levelsById.has(imported.id) ? imported.id : uuid("level"),
        shelfId,
        levelNo,
        locationCode,
        qrText: text(imported.qrText) || locationCode,
        sortOrder: Number(imported.sortOrder || levelNo),
        status: "active",
        createdAt: imported.createdAt || importedAt,
        updatedAt: importedAt,
      };
      shelfLevels.push(level);
      levelsById.set(level.id, level);
      levelsByCode.set(normalizeText(level.locationCode), level);
      levelsByShelfNo.set(`${shelfId}::${levelNo}`, level);
    }
    if (imported.id) {
      levelIdMap.set(imported.id, level.id);
    }
  }

  const externalById = new Map(externalLocations.map((item) => [item.id, item]));
  const externalByCode = new Map();
  for (const item of externalLocations) {
    if (text(item.code)) {
      externalByCode.set(normalizeText(item.code), item);
    }
    if (text(item.name)) {
      externalByCode.set(normalizeText(item.name), item);
    }
  }
  const externalIdMap = new Map();

  for (const imported of payload.externalLocations || []) {
    const code = text(imported.code || imported.name).toUpperCase();
    const name = text(imported.name || code);
    if (!code && !name) {
      continue;
    }
    let external = (imported.id && externalById.get(imported.id)) || externalByCode.get(normalizeText(code || name));
    if (!external) {
      external = {
        ...imported,
        id: imported.id && !externalById.has(imported.id) ? imported.id : uuid("external"),
        code: code || normalizeText(name),
        name: name || code,
        sortOrder: Number(imported.sortOrder || nextSortOrder(externalLocations)),
        status: "active",
        createdAt: imported.createdAt || importedAt,
        updatedAt: importedAt,
      };
      externalLocations.push(external);
      externalById.set(external.id, external);
      externalByCode.set(normalizeText(external.code || external.name), external);
      externalByCode.set(normalizeText(external.name || external.code), external);
    }
    if (imported.id) {
      externalIdMap.set(imported.id, external.id);
    }
  }

  const existingQtyByProductId = new Map();
  for (const balance of inventoryBalances) {
    existingQtyByProductId.set(
      balance.productId,
      (existingQtyByProductId.get(balance.productId) || 0) + Number(balance.qty || 0),
    );
  }
  const importedBalanceCountByProductId = new Map();
  for (const imported of payload.inventoryBalances || []) {
    const productId = productIdMap.get(imported.productId) || (productsById.has(imported.productId) ? imported.productId : null);
    if (productId) {
      importedBalanceCountByProductId.set(productId, (importedBalanceCountByProductId.get(productId) || 0) + 1);
    }
  }

  if (payload.replaceProductLocations) {
    const productsWithImportedLocations = new Set();
    for (const imported of payload.inventoryBalances || []) {
      const productId = productIdMap.get(imported.productId) || (productsById.has(imported.productId) ? imported.productId : null);
      if (productId) {
        productsWithImportedLocations.add(productId);
      }
    }
    if (productsWithImportedLocations.size) {
      for (let index = inventoryBalances.length - 1; index >= 0; index -= 1) {
        if (productsWithImportedLocations.has(inventoryBalances[index].productId)) {
          inventoryBalances.splice(index, 1);
        }
      }
    }
  }

  const balancesByKey = new Map(inventoryBalances.map((item) => [balanceKey(item), item]));
  const balanceIds = new Set(inventoryBalances.map((item) => item.id));
  for (const imported of payload.inventoryBalances || []) {
    const productId = productIdMap.get(imported.productId) || (productsById.has(imported.productId) ? imported.productId : null);
    const locationType = imported.locationType === "external" ? "external" : "warehouse";
    const levelId = locationType === "warehouse" ? mapLocationId(imported.levelId, levelIdMap, levelsById) : null;
    const externalLocationId = locationType === "external" ? mapLocationId(imported.externalLocationId, externalIdMap, externalById) : null;
    const preservedQty = payload.preserveExistingQty && productId ? Number(existingQtyByProductId.get(productId) || 0) : 0;
    const importedCount = Math.max(1, Number(importedBalanceCountByProductId.get(productId) || 1));
    const qty = preservedQty > 0 ? preservedQty / importedCount : Number(imported.qty || 1);
    if (!productId || qty <= 0 || (locationType === "warehouse" && !levelId) || (locationType === "external" && !externalLocationId)) {
      continue;
    }
    const draft = { productId, locationType, levelId, externalLocationId };
    const key = balanceKey(draft);
    const existing = balancesByKey.get(key);
    if (existing) {
      existing.qty = qty;
      existing.updatedAt = importedAt;
    } else {
      const balance = {
        id: imported.id && !balanceIds.has(imported.id) ? imported.id : uuid("balance"),
        ...draft,
        qty,
        updatedAt: importedAt,
      };
      inventoryBalances.push(balance);
      balancesByKey.set(key, balance);
      balanceIds.add(balance.id);
    }
  }

  const operationIds = new Set(inventoryOperations.map((item) => item.id));
  const importBatchId = uuid("import-batch");
  let addedOperations = 0;
  for (const imported of payload.inventoryOperations || []) {
    if (imported.id && operationIds.has(imported.id)) {
      continue;
    }
    const productId = productIdMap.get(imported.productId) || (productsById.has(imported.productId) ? imported.productId : null);
    if (!productId) {
      continue;
    }
    const sourceLocationType = imported.sourceLocationType || "none";
    const targetLocationType = imported.targetLocationType || "none";
    const operation = {
      ...imported,
      id: imported.id && !operationIds.has(imported.id) ? imported.id : uuid("operation"),
      batchId: imported.batchId || importBatchId,
      deviceId: imported.deviceId || "excel-import",
      operationType: imported.operationType || "put_in",
      productId,
      qty: Number(imported.qty || 0),
      sourceLocationType,
      sourceLevelId: sourceLocationType === "warehouse" ? mapLocationId(imported.sourceLevelId, levelIdMap, levelsById) : null,
      sourceExternalLocationId: sourceLocationType === "external" ? mapLocationId(imported.sourceExternalLocationId, externalIdMap, externalById) : null,
      targetLocationType,
      targetLevelId: targetLocationType === "warehouse" ? mapLocationId(imported.targetLevelId, levelIdMap, levelsById) : null,
      targetExternalLocationId: targetLocationType === "external" ? mapLocationId(imported.targetExternalLocationId, externalIdMap, externalById) : null,
      operatedAt: imported.operatedAt || importedAt,
      importedAt,
      importStatus: "imported",
      deviceStatus: "imported",
    };
    inventoryOperations.push(operation);
    operationIds.add(operation.id);
    addedOperations += 1;
  }

  const importBatches = activeRows(current.importBatches);
  importBatches.push({
    id: importBatchId,
    batchCode: `EXCEL-${new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14)}`,
    packageId: fileName || "excel-import.xlsx",
    deviceId: "excel-import",
    fileName: fileName || "excel-import.xlsx",
    baseMasterPackageId: "",
    totalCount: (payload.inventoryOperations || []).length,
    successCount: addedOperations,
    failedCount: Math.max(0, (payload.inventoryOperations || []).length - addedOperations),
    importedBy: "Excel",
    importedAt,
    status: "completed",
  });

  return {
    appMeta: mergeMetaRows(current.appMeta || [], [
      createMetaEntry("initialized", true),
      createMetaEntry("uiVersion", APP_VERSION),
      createMetaEntry("lastImportedAt", importedAt),
    ]),
    products,
    customFieldDefinitions,
    productCustomFieldValues,
    warehouses,
    shelves,
    shelfLevels,
    externalLocations,
    inventoryBalances,
    inventoryOperations,
    devices: current.devices?.length ? current.devices : [defaultDeviceProfile()],
    masterExports: current.masterExports || [],
    importBatches,
  };
}

async function importExcel(file) {
  const response = await fetch("/api/import-excel", {
    method: "POST",
    body: file,
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  const payload = await response.json();
  const current = await db.exportAll();
  const merged = mergeImportedPayload(current, payload, file.name);
  await db.replaceStores(merged);
  await refreshContext();
  setNotice("Excel 已导入");
}

function isPlaceholderImage(image) {
  return !image || /^data:image\/svg/i.test(image);
}

async function indexProductImage(productId, image, imageIndex = 0) {
  if (!productId || isPlaceholderImage(image)) return null;
  try {
    const response = await fetch(
      apiUrl("/api/phash/index"),
      {
        method: "POST",
        headers: buildAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ productId, imageIndex, image }),
      },
    );
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.warn("phash index failed:", response.status, text);
      return null;
    }
    return await response.json();
  } catch (error) {
    console.warn("phash index error:", error);
    return null;
  }
}

async function searchByImage(file) {
  setNotice("正在识别图片...", "loading");
  const dataUrl = await readFileAsDataUrl(file);
  const response = await fetch(
    apiUrl("/api/phash/search"),
    {
      method: "POST",
      headers: buildAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ image: dataUrl, threshold: 16, limit: 30 }),
    },
  );
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `搜索失败 (${response.status})`);
  }
  const payload = await response.json();
  setNotice(`找到 ${payload.total} 个相似产品`);
  renderImageSearchResultsDialog(dataUrl, payload);
}

function renderImageSearchResultsDialog(queryDataUrl, payload) {
  const ctx = state.context || {};
  const products = ctx.products || [];
  const productById = new Map(products.map((p) => [String(p.id), p]));
  const items = (payload.results || []).map((row) => {
    const product = productById.get(String(row.productId));
    if (!product) return null;
    const score = Math.max(0, 100 - row.distance * 5);
    return `
      <li class="image-search-result">
        <button class="image-search-result-button" type="button" data-action="open-image-search-result" data-product-id="${escapeHtml(product.id)}">
          <img class="image-search-thumb" src="${escapeHtml(product.image || makePlaceholderImage(product.model))}" alt="${escapeHtml(product.model)}" loading="lazy">
          <div class="image-search-meta">
            <div class="image-search-model">${escapeHtml(product.model)}</div>
            <div class="image-search-score">距离 ${row.distance} · 相似度 ${score}%</div>
          </div>
        </button>
      </li>
    `;
  }).filter(Boolean).join("");

  const empty = `<li class="sync-empty">未找到相似产品（阈值 ${payload.threshold}）。如果产品图未入索引，请先到"维护 → 重建图片索引"。</li>`;

  renderDialog(`
    <div class="dialog-panel">
      <div class="dialog-header">
        <h3 class="panel-title">按图搜索结果</h3>
        <button class="button secondary" type="button" data-action="close-dialog">关闭</button>
      </div>
      <div class="dialog-body">
        <div class="image-search-query">
          <img class="image-search-thumb" src="${escapeHtml(queryDataUrl)}" alt="查询图">
          <div class="image-search-meta">
            <div class="image-search-model">查询图</div>
            <div class="image-search-score">指纹 ${escapeHtml(payload.queryPhash || "—")}</div>
          </div>
        </div>
        <ul class="image-search-list">
          ${items || empty}
        </ul>
      </div>
    </div>
  `);
}

function renderPositionProductPanel(product, ctx, positionData, handheld = false) {
  const fieldText = getFieldDisplayText(product.id, ctx);
  return `
    <section class="panel position-product-panel ${handheld ? "handheld" : ""}">
      <div class="panel-header">
        <h3 class="panel-title">型号</h3>
      </div>
      <div class="panel-body">
        <div class="position-product-card">
          <div class="position-product-head">
            <div class="detail-media">
              <img class="detail-image position-product-image" src="${escapeHtml(product.image || makePlaceholderImage(product.model))}" alt="${escapeHtml(product.model)}">
            </div>
            <div class="position-summary-copy">
              <h4>${escapeHtml(product.model)}</h4>
              ${fieldText ? `<p>${escapeHtml(fieldText)}</p>` : ""}
            </div>
          </div>
          <div class="position-metrics">
            <div class="meta-card">
              <div class="meta-label">总数</div>
              <div class="meta-value">${formatQty(positionData.totalQty)}</div>
            </div>
            <div class="meta-card">
              <div class="meta-label">仓库</div>
              <div class="meta-value">${positionData.warehouseQtyById.size}</div>
            </div>
            <div class="meta-card">
              <div class="meta-label">非仓库位置</div>
              <div class="meta-value">${positionData.externalRows.length}</div>
            </div>
            <div class="meta-card">
              <div class="meta-label">显示</div>
              <div class="meta-value">${state.positionView === "visual" ? "图形" : "文字"}</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderRackCard(shelf, levels, positionData) {
  const stockedLevels = levels.filter((level) => positionData.levelQtyById.has(level.id));
  return `
    <div class="rack-card ${stockedLevels.length ? "stocked-pulse" : ""}">
      <div class="rack-header">
        <div class="rack-title">${escapeHtml(shelf.code)}</div>
        <div class="rack-badge">${stockedLevels.length ? `${stockedLevels.length} 层有库存` : "无库存"}</div>
      </div>
      <div class="rack-level-list">
        ${levels.length
          ? levels.map((level) => {
            const stocked = positionData.levelQtyById.has(level.id);
            return `
              <div class="rack-level-row ${stocked ? "stocked stocked-pulse" : "dimmed"}">
                <div class="rack-level-label">${escapeHtml(`${level.levelNo} 层`)}</div>
                <div class="rack-level-main">
                  <div class="rack-level-code">${escapeHtml(level.locationCode)}</div>
                </div>
                <div class="rack-level-qty">${stocked ? `${formatQty(positionData.levelQtyById.get(level.id))} 件` : "-"}</div>
              </div>
            `;
          }).join("")
          : `<div class="empty-state">这个货架还没有层数</div>`}
      </div>
    </div>
  `;
}

function renderPositionVisual(product, ctx, positionData) {
  const warehouses = ctx.warehouses;
  const focusedWarehouse = state.positionWarehouseId ? ctx.warehousesById.get(state.positionWarehouseId) : null;

  if (!focusedWarehouse) {
    return `
      <div class="position-visual-shell">
        <section class="plane-section">
          <div class="plane-section-head">
            <h4 class="plane-title">仓库</h4>
          </div>
          <div class="warehouse-grid warehouse-overview-grid">
            ${warehouses.map((warehouse, index) => {
              const stocked = positionData.warehouseQtyById.has(warehouse.id);
              return `
                <button
                  class="warehouse-node tone-${mapTone(warehouse.colorToken, index)} ${stocked ? "stocked-pulse" : ""} ${positionData.warehouseQtyById.size && !stocked ? "dimmed" : ""}"
                  type="button"
                  data-action="focus-position-warehouse"
                  data-warehouse-id="${warehouse.id}"
                >
                  <div class="warehouse-body">
                    <span class="warehouse-code">${escapeHtml(warehouse.name)}</span>
                    <span class="warehouse-label">${stocked ? `${formatQty(positionData.warehouseQtyById.get(warehouse.id))} 件` : "无库存"}</span>
                  </div>
                </button>
              `;
            }).join("")}
          </div>
        </section>
        ${positionData.externalRows.length
          ? `
            <section class="plane-section">
              <div class="plane-section-head">
                <h4 class="plane-title">非仓库位置</h4>
              </div>
              <div class="hint-row">
                ${positionData.externalRows.map((row) => `<span class="hint-pill">${escapeHtml(row.external.name)} · ${formatQty(row.qty)} 件</span>`).join("")}
              </div>
            </section>
          `
          : ""}
      </div>
    `;
  }

  const shelves = bySortOrder(ctx.shelves.filter((item) => item.warehouseId === focusedWarehouse.id));
  return `
    <div class="position-visual-shell">
      <section class="plane-section">
        <div class="plane-section-head">
          <div>
            <h4 class="plane-title">${escapeHtml(focusedWarehouse.name)}</h4>
            <div class="warehouse-label">平面货架</div>
          </div>
          <button class="button secondary" type="button" data-action="clear-position-warehouse">返回仓库</button>
        </div>
        <div class="rack-grid">
          ${shelves.length
            ? shelves.map((shelf) => {
              const levels = [...ctx.shelfLevels.filter((item) => item.shelfId === shelf.id)]
                .sort((left, right) => Number(right.levelNo) - Number(left.levelNo));
              return renderRackCard(shelf, levels, positionData);
            }).join("")
            : `<div class="empty-state">这个仓库还没有货架</div>`}
        </div>
      </section>
    </div>
  `;
}

function renderPositionsStage(ctx) {
  if (state.mode === "handheld") {
    return renderHandheldPositionsStage(ctx);
  }

  const selectedProduct = ctx.productsById.get(state.selectedProductId) || ctx.products[0] || null;
  if (!selectedProduct) {
    return `
      <section class="panel">
        <div class="panel-body empty-state">还没有产品，先新增一个产品。</div>
      </section>
    `;
  }

  const positionData = getProductPositionData(selectedProduct.id, ctx);
  const stageTitle = state.positionWarehouseId ? (ctx.warehousesById.get(state.positionWarehouseId)?.name || "仓库") : "仓库";

  return `
    <div class="main-grid position-page refined-position-page">
      <div class="single-column">
        ${renderPositionProductPanelV4(selectedProduct, ctx, positionData)}
      </div>
      <div class="single-column">
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">${escapeHtml(stageTitle)}</h3>
            </div>
            <div class="detail-tabs">
              <button class="detail-tab ${state.positionView === "visual" ? "active" : ""}" type="button" data-action="switch-position-view" data-view="visual">图形</button>
              <button class="detail-tab ${state.positionView === "table" ? "active" : ""}" type="button" data-action="switch-position-view" data-view="table">文字</button>
            </div>
          </div>
          <div class="panel-body">
            ${state.positionView === "visual" ? renderWarehouseScene(selectedProduct, ctx, positionData) : renderPositionTable(selectedProduct, ctx, positionData)}
          </div>
        </section>
      </div>
    </div>
  `;
}

function renderHandheldPositionsStage(ctx) {
  const selectedProduct = ctx.productsById.get(state.selectedProductId) || ctx.products[0] || null;
  if (!selectedProduct) {
    return `
      <section class="panel">
        <div class="panel-body empty-state">还没有产品，先新增一个产品。</div>
      </section>
    `;
  }

  const positionData = getProductPositionData(selectedProduct.id, ctx);
  const stageTitle = state.positionWarehouseId ? (ctx.warehousesById.get(state.positionWarehouseId)?.name || "仓库") : "位置";

  return `
    <div class="single-column">
      ${renderPositionProductPanel(selectedProduct, ctx, positionData, true)}
      <section class="panel">
        <div class="panel-header">
          <h3 class="panel-title">${escapeHtml(stageTitle)}</h3>
          <div class="detail-tabs">
            <button class="detail-tab ${state.positionView === "visual" ? "active" : ""}" type="button" data-action="switch-position-view" data-view="visual">图形</button>
            <button class="detail-tab ${state.positionView === "table" ? "active" : ""}" type="button" data-action="switch-position-view" data-view="table">文字</button>
          </div>
        </div>
        <div class="panel-body">
          ${state.positionView === "visual" ? renderWarehouseScene(selectedProduct, ctx, positionData) : renderPositionTable(selectedProduct, ctx, positionData)}
        </div>
      </section>
    </div>
  `;
}

function renderHeaderCompact() {
  return `
    <header class="app-header top-nav-header">
      <div class="app-header-top">
        <div class="brand">
          <div class="brand-mark" aria-hidden="true">仓</div>
          <h1 class="brand-title">库存管理</h1>
        </div>
        <div class="segmented top-tabs" role="tablist">
          ${DESKTOP_TABS.concat([{ id: "entry", label: "录入" }]).map((tab) => `
            <button class="segment ${state.desktopTab === tab.id ? "active" : ""}" type="button" role="tab" aria-selected="${state.desktopTab === tab.id}" data-action="switch-tab" data-tab="${tab.id}">
              ${escapeHtml(tab.label)}
            </button>
          `).join("")}
        </div>
        <div class="action-row top-actions">
          ${renderThemePicker()}
          <button class="button secondary" type="button" data-action="open-sync-info" title="同步与共享">同步</button>
          <button class="button secondary" type="button" data-action="import-excel" title="导入 Excel">导入</button>
          <button class="button primary" type="button" data-action="export-excel" title="导出 Excel">导出</button>
        </div>
      </div>
    </header>
  `;
}

function renderShelfOverviewCardV2(shelf, levels, positionData) {
  const stockedLevelCount = levels.filter((level) => positionData.levelQtyById.has(level.id)).length;
  return `
    <button class="shelf-overview-card ${stockedLevelCount ? "stocked-pulse stocked" : ""}" type="button" data-action="focus-position-shelf" data-shelf-id="${shelf.id}">
      <div class="shelf-overview-head">
        <span class="shelf-overview-code">${escapeHtml(shelf.code)}</span>
        <span class="shelf-overview-meta">${levels.length} 层</span>
      </div>
      <div class="shelf-overview-face">
        ${levels.length
          ? levels.map((level) => `
            <div class="shelf-overview-tier ${positionData.levelQtyById.has(level.id) ? "stocked stocked-pulse" : ""}">
              <span class="tier-line"></span>
              <span class="tier-line"></span>
              <span class="tier-line"></span>
            </div>
          `).join("")
          : `<div class="empty-state">暂无层数</div>`}
      </div>
    </button>
  `;
}

function renderShelfDetailSceneV2(product, shelf, levels, positionData) {
  return `
    <div class="shelf-detail-scene">
      <div class="shelf-detail-topbar">
        <div>
          <h4 class="plane-title">${escapeHtml(shelf.code)}</h4>
          <div class="warehouse-label">层数平面</div>
        </div>
        <button class="button secondary" type="button" data-action="clear-position-shelf">返回货架</button>
      </div>
      <div class="shelf-detail-rack">
        ${levels.length
          ? levels.map((level) => {
            const qty = positionData.levelQtyById.get(level.id) || 0;
            const itemBoxCount = qty ? Math.min(4, Math.max(1, Math.ceil(qty / 3))) : 0;
            return `
              <div class="shelf-detail-level ${qty ? "stocked stocked-pulse" : ""}">
                <div class="shelf-detail-level-label">${escapeHtml(`${level.levelNo} 层`)}</div>
                <div class="shelf-detail-display">
                  <div class="shelf-item-row">
                    ${qty
                      ? Array.from({ length: itemBoxCount }, (_, index) => `
                        <span class="shelf-item-box ${index % 2 ? "alt" : ""}">
                          <span class="shelf-item-model">${escapeHtml(product.model)}</span>
                        </span>
                      `).join("")
                      : `<span class="shelf-item-empty">空层</span>`}
                  </div>
                  <div class="shelf-board"></div>
                  <div class="shelf-detail-code">${escapeHtml(level.locationCode)}</div>
                </div>
                <div class="shelf-detail-qty">${qty ? `${formatQty(qty)} 件` : "-"}</div>
              </div>
            `;
          }).join("")
          : `<div class="empty-state">这个货架还没有层数</div>`}
      </div>
    </div>
  `;
}

function renderWarehouseSceneV2(product, ctx, positionData) {
  const focusedWarehouse = state.positionWarehouseId ? ctx.warehousesById.get(state.positionWarehouseId) : null;
  const focusedShelf = state.positionShelfId ? ctx.shelvesById.get(state.positionShelfId) : null;

  if (!focusedWarehouse) {
    return `
      <div class="position-visual-shell">
        <section class="plane-section">
          <div class="plane-section-head">
            <h4 class="plane-title">仓库</h4>
          </div>
          <div class="warehouse-grid warehouse-overview-grid">
            ${ctx.warehouses.map((warehouse, index) => {
              const stocked = positionData.warehouseQtyById.has(warehouse.id);
              return `
                <button
                  class="warehouse-node tone-${mapTone(warehouse.colorToken, index)} ${stocked ? "stocked-pulse" : ""} ${positionData.warehouseQtyById.size && !stocked ? "dimmed" : ""}"
                  type="button"
                  data-action="focus-position-warehouse"
                  data-warehouse-id="${warehouse.id}"
                >
                  <div class="warehouse-body">
                    <span class="warehouse-code">${escapeHtml(warehouse.name)}</span>
                    <span class="warehouse-label">${stocked ? `${formatQty(positionData.warehouseQtyById.get(warehouse.id))} 件` : "无库存"}</span>
                  </div>
                </button>
              `;
            }).join("")}
          </div>
        </section>
      </div>
    `;
  }

  const shelves = bySortOrder(ctx.shelves.filter((item) => item.warehouseId === focusedWarehouse.id));
  if (!focusedShelf || focusedShelf.warehouseId !== focusedWarehouse.id) {
    return `
      <div class="position-visual-shell">
        <section class="plane-section">
          <div class="plane-section-head">
            <div>
              <h4 class="plane-title">货架</h4>
              <div class="warehouse-label">${escapeHtml(focusedWarehouse.name)}</div>
            </div>
            <button class="button secondary" type="button" data-action="clear-position-warehouse">返回仓库</button>
          </div>
          <div class="shelf-overview-grid">
            ${shelves.length
              ? shelves.map((shelf) => {
                const levels = [...ctx.shelfLevels.filter((item) => item.shelfId === shelf.id)].sort((left, right) => Number(right.levelNo) - Number(left.levelNo));
                return renderShelfOverviewCardV2(shelf, levels, positionData);
              }).join("")
              : `<div class="empty-state">这个仓库还没有货架</div>`}
          </div>
        </section>
      </div>
    `;
  }

  const levels = [...ctx.shelfLevels.filter((item) => item.shelfId === focusedShelf.id)].sort((left, right) => Number(right.levelNo) - Number(left.levelNo));
  return `
    <div class="position-visual-shell">
      <section class="plane-section">
        <div class="plane-section-head">
          <div>
            <h4 class="plane-title">层数</h4>
            <div class="warehouse-label">${escapeHtml(`${focusedWarehouse.name} / ${focusedShelf.code}`)}</div>
          </div>
          <div class="action-row">
            <button class="button secondary" type="button" data-action="clear-position-shelf">返回货架</button>
            <button class="button secondary" type="button" data-action="clear-position-warehouse">返回仓库</button>
          </div>
        </div>
        ${renderShelfDetailSceneV2(product, focusedShelf, levels, positionData)}
      </section>
    </div>
  `;
}

function renderPositionsStageV2(ctx) {
  if (state.mode === "handheld") {
    return renderHandheldPositionsStageV2(ctx);
  }

  const selectedProduct = ctx.productsById.get(state.selectedProductId) || ctx.products[0] || null;
  if (!selectedProduct) {
    return `
      <section class="panel">
        <div class="panel-body empty-state">还没有产品，先新增一个产品。</div>
      </section>
    `;
  }

  const positionData = getProductPositionData(selectedProduct.id, ctx);
  const stageTitle = state.positionShelfId
    ? "层数"
    : state.positionWarehouseId
      ? "货架"
      : "仓库";

  return `
    <div class="main-grid position-page refined-position-page">
      <div class="single-column">
        ${renderPositionProductPanelV4(selectedProduct, ctx, positionData)}
      </div>
      <div class="single-column">
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">${escapeHtml(stageTitle)}</h3>
            </div>
            <div class="detail-tabs">
              <button class="detail-tab ${state.positionView === "visual" ? "active" : ""}" type="button" data-action="switch-position-view" data-view="visual">图形</button>
              <button class="detail-tab ${state.positionView === "table" ? "active" : ""}" type="button" data-action="switch-position-view" data-view="table">文字</button>
            </div>
          </div>
          <div class="panel-body">
            ${state.positionView === "visual" ? renderWarehouseSceneV4(selectedProduct, ctx, positionData) : renderPositionTable(selectedProduct, ctx, positionData)}
          </div>
        </section>
      </div>
    </div>
  `;
}

function renderHandheldPositionsStageV2(ctx) {
  const selectedProduct = ctx.productsById.get(state.selectedProductId) || ctx.products[0] || null;
  if (!selectedProduct) {
    return `
      <section class="panel">
        <div class="panel-body empty-state">还没有产品，先新增一个产品。</div>
      </section>
    `;
  }

  const positionData = getProductPositionData(selectedProduct.id, ctx);
  const stageTitle = state.positionShelfId
    ? "层数"
    : state.positionWarehouseId
      ? "货架"
      : "仓库";

  return `
    <div class="single-column">
      ${renderPositionProductPanelV4(selectedProduct, ctx, positionData, true)}
      <section class="panel">
        <div class="panel-header">
          <h3 class="panel-title">${escapeHtml(stageTitle)}</h3>
          <div class="detail-tabs">
            <button class="detail-tab ${state.positionView === "visual" ? "active" : ""}" type="button" data-action="switch-position-view" data-view="visual">图形</button>
            <button class="detail-tab ${state.positionView === "table" ? "active" : ""}" type="button" data-action="switch-position-view" data-view="table">文字</button>
          </div>
        </div>
        <div class="panel-body">
          ${state.positionView === "visual" ? renderWarehouseSceneV4(selectedProduct, ctx, positionData) : renderPositionTable(selectedProduct, ctx, positionData)}
        </div>
      </section>
    </div>
  `;
}

function renderPositionProductPanelV3(product, positionData, handheld = false) {
  return `
    <section class="panel position-product-panel ${handheld ? "handheld" : ""}">
      <div class="panel-body">
        <div class="position-product-card">
          <div class="position-product-head">
            <div class="detail-media">
              <img class="detail-image position-product-image" src="${escapeHtml(product.image || makePlaceholderImage(product.model))}" alt="${escapeHtml(product.model)}">
            </div>
            <div class="position-summary-copy">
              <span class="position-kicker">型号</span>
              <h4>${escapeHtml(product.model)}</h4>
            </div>
          </div>
          <div class="position-metrics">
            <div class="meta-card">
              <div class="meta-label">总数</div>
              <div class="meta-value">${formatQty(positionData.totalQty)}</div>
            </div>
            <div class="meta-card">
              <div class="meta-label">仓库</div>
              <div class="meta-value">${positionData.warehouseQtyById.size}</div>
            </div>
            ${positionData.externalRows.length
              ? `
                <div class="meta-card">
                  <div class="meta-label">外部</div>
                  <div class="meta-value">${positionData.externalRows.length}</div>
                </div>
              `
              : ""}
          </div>
        </div>
      </div>
    </section>
  `;
}

function buildShelfLevelsForDisplay(warehouse, shelf, levels) {
  const sorted = [...levels].sort((left, right) => Number(right.levelNo) - Number(left.levelNo));
  const maxLevelNo = sorted.reduce((max, level) => Math.max(max, Number(level.levelNo) || 0), 0);
  const levelMap = new Map(sorted.map((level) => [Number(level.levelNo), level]));
  const rows = [];
  for (let levelNo = maxLevelNo; levelNo >= 1; levelNo -= 1) {
    const existing = levelMap.get(levelNo);
    rows.push(existing || {
      id: `display-${shelf.id}-${levelNo}`,
      shelfId: shelf.id,
      levelNo,
      locationCode: warehouse ? buildLocationCode(warehouse, shelf, levelNo) : `L${String(levelNo).padStart(2, "0")}`,
      isVirtual: true,
    });
  }
  return rows;
}

function renderShelfOverviewCardV3(shelf, levels, positionData) {
  const shelfQty = positionData.shelfQtyById.get(shelf.id) || 0;
  const stockedLevelCount = levels.filter((level) => positionData.levelQtyById.has(level.id)).length;
  return `
    <button class="shelf-overview-card ${stockedLevelCount ? "stocked stocked-pulse" : ""}" type="button" data-action="focus-position-shelf" data-shelf-id="${shelf.id}">
      <div class="shelf-overview-head">
        <span class="shelf-overview-code">${escapeHtml(shelf.code)}</span>
        <div class="shelf-overview-badges">
          <span class="shelf-overview-meta">${levels.length} 层</span>
          ${shelfQty ? `<span class="shelf-overview-count">${formatQty(shelfQty)} 件</span>` : ""}
        </div>
      </div>
      <div class="shelf-overview-face">
        ${levels.length
          ? levels.map((level) => `
            <div class="shelf-overview-tier ${positionData.levelQtyById.has(level.id) ? "stocked stocked-pulse" : ""}">
              <span class="tier-line"></span>
            </div>
          `).join("")
          : `<div class="empty-state">暂无层数</div>`}
      </div>
    </button>
  `;
}

function renderShelfDetailSceneV3(warehouse, shelf, levels, positionData) {
  const shelfQty = positionData.shelfQtyById.get(shelf.id) || 0;
  return `
    <div class="shelf-detail-scene">
      <div class="shelf-detail-topbar">
        <div>
          <h4 class="plane-title">${escapeHtml(shelf.code)}</h4>
          <div class="warehouse-label">${escapeHtml(warehouse.name)}${shelfQty ? ` · ${formatQty(shelfQty)} 件` : ""}</div>
        </div>
        <button class="button secondary" type="button" data-action="clear-position-shelf">返回货架</button>
      </div>
      <div class="shelf-detail-rack">
        ${levels.length
          ? levels.map((level) => {
            const qty = positionData.levelQtyById.get(level.id) || 0;
            const itemBoxCount = qty ? Math.min(7, Math.max(1, Math.ceil(qty / 4))) : 0;
            return `
              <div class="shelf-detail-level ${qty ? "stocked stocked-pulse" : ""}">
                <div class="shelf-detail-level-label">${escapeHtml(`${level.levelNo} 层`)}</div>
                <div class="shelf-detail-display">
                  <div class="shelf-item-row" aria-hidden="true">
                    ${qty
                      ? Array.from({ length: itemBoxCount }, (_, index) => `
                        <span class="shelf-item-box tone-${(Number(level.levelNo) + index) % 5} ${index % 2 ? "alt" : ""}"></span>
                      `).join("")
                      : ""}
                  </div>
                  <div class="shelf-board"></div>
                </div>
                <div class="shelf-detail-qty">${qty ? `${formatQty(qty)} 件` : ""}</div>
              </div>
            `;
          }).join("")
          : `<div class="empty-state">暂无层数</div>`}
      </div>
    </div>
  `;
}

function renderWarehouseSceneV3(product, ctx, positionData) {
  const focusedWarehouse = state.positionWarehouseId ? ctx.warehousesById.get(state.positionWarehouseId) : null;
  const focusedShelf = state.positionShelfId ? ctx.shelvesById.get(state.positionShelfId) : null;

  if (!focusedWarehouse) {
    return `
      <div class="position-visual-shell">
        <div class="warehouse-grid warehouse-overview-grid">
          ${ctx.warehouses.map((warehouse, index) => {
            const stocked = positionData.warehouseQtyById.has(warehouse.id);
            return `
              <button
                class="warehouse-node tone-${mapTone(warehouse.colorToken, index)} ${stocked ? "stocked-pulse" : ""} ${positionData.warehouseQtyById.size && !stocked ? "dimmed" : ""}"
                type="button"
                data-action="focus-position-warehouse"
                data-warehouse-id="${warehouse.id}"
              >
                <div class="warehouse-body">
                  <span class="warehouse-code">${escapeHtml(warehouse.name)}</span>
                  <span class="warehouse-label">${stocked ? `${formatQty(positionData.warehouseQtyById.get(warehouse.id))} 件` : ""}</span>
                </div>
              </button>
            `;
          }).join("")}
        </div>
      </div>
    `;
  }

  const shelves = bySortOrder(ctx.shelves.filter((item) => item.warehouseId === focusedWarehouse.id));
  if (!focusedShelf || focusedShelf.warehouseId !== focusedWarehouse.id) {
    return `
      <div class="position-visual-shell">
        <div class="plane-section-head">
          <h4 class="plane-title">${escapeHtml(focusedWarehouse.name)}</h4>
          <button class="button secondary" type="button" data-action="clear-position-warehouse">返回仓库</button>
        </div>
        <div class="shelf-overview-grid">
          ${shelves.length
            ? shelves.map((shelf) => {
              const levels = [...ctx.shelfLevels.filter((item) => item.shelfId === shelf.id)].sort((left, right) => Number(right.levelNo) - Number(left.levelNo));
              return renderShelfOverviewCardV3(shelf, levels, positionData);
            }).join("")
            : `<div class="empty-state">暂无货架</div>`}
        </div>
      </div>
    `;
  }

  const levels = [...ctx.shelfLevels.filter((item) => item.shelfId === focusedShelf.id)].sort((left, right) => Number(right.levelNo) - Number(left.levelNo));
  return `
    <div class="position-visual-shell">
      <div class="plane-section-head">
        <h4 class="plane-title">${escapeHtml(`${focusedWarehouse.name} / ${focusedShelf.code}`)}</h4>
        <div class="action-row">
          <button class="button secondary" type="button" data-action="clear-position-shelf">返回货架</button>
          <button class="button secondary" type="button" data-action="clear-position-warehouse">返回仓库</button>
        </div>
      </div>
      ${renderShelfDetailSceneV3(focusedWarehouse, focusedShelf, levels, positionData)}
    </div>
  `;
}

function renderPositionProductPanelV4(product, ctx, positionData, handheld = false) {
  const fieldText = getFieldDisplayText(product.id, ctx);
  const inWarehouseQty = [...positionData.warehouseQtyById.values()].reduce((sum, qty) => sum + Number(qty || 0), 0);
  return `
    <section class="panel position-product-panel ${handheld ? "handheld" : ""}">
      <div class="panel-body">
        <div class="position-product-card">
          <div class="position-product-head">
            <div class="detail-media">
              <img class="detail-image position-product-image" src="${escapeHtml(product.image || makePlaceholderImage(product.model))}" alt="${escapeHtml(product.model)}">
            </div>
            <div class="position-summary-copy">
              <span class="position-kicker">型号</span>
              <h4>${escapeHtml(product.model)}</h4>
              ${fieldText ? `<p>${escapeHtml(fieldText)}</p>` : ""}
            </div>
          </div>
          <div class="position-metrics">
            <div class="meta-card">
              <div class="meta-label">总数</div>
              <div class="meta-value">${formatQty(positionData.totalQty)}</div>
            </div>
            <div class="meta-card">
              <div class="meta-label">在库数量</div>
              <div class="meta-value">${formatQty(inWarehouseQty)}</div>
            </div>
            ${positionData.externalRows.length
              ? `
                <div class="meta-card">
                  <div class="meta-label">外部</div>
                  <div class="meta-value">${positionData.externalRows.length}</div>
                </div>
              `
              : ""}
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderShelfOverviewCardV4(shelf, levels, positionData) {
  const shelfQty = positionData.shelfQtyById.get(shelf.id) || 0;
  const stockedLevelCount = levels.filter((level) => !level.isVirtual && positionData.levelQtyById.has(level.id)).length;
  return `
    <button class="shelf-overview-card ${stockedLevelCount ? "stocked stocked-pulse" : ""}" type="button" data-action="focus-position-shelf" data-shelf-id="${shelf.id}">
      <div class="shelf-overview-head">
        <span class="shelf-overview-code">${escapeHtml(shelf.code)}</span>
        <div class="shelf-overview-badges">
          <span class="shelf-overview-meta">${levels.length} 层</span>
          ${shelfQty ? `<span class="shelf-overview-count">${formatQty(shelfQty)} 件</span>` : ""}
        </div>
      </div>
      <div class="shelf-overview-face">
        ${levels.length
          ? levels.map((level) => `
            <div class="shelf-overview-tier ${(!level.isVirtual && positionData.levelQtyById.has(level.id)) ? "stocked stocked-pulse" : ""}">
              <span class="tier-line"></span>
            </div>
          `).join("")
          : `<div class="empty-state">暂无层数</div>`}
      </div>
    </button>
  `;
}

function renderShelfDetailSceneV4(warehouse, shelf, levels, positionData, product = null) {
  const shelfQty = positionData.shelfQtyById.get(shelf.id) || 0;
  return `
    <div class="shelf-detail-scene">
      <div class="shelf-detail-topbar">
        <div>
          <h4 class="plane-title">${escapeHtml(shelf.code)}</h4>
          <div class="warehouse-label">${escapeHtml(warehouse.name)}${shelfQty ? ` · ${formatQty(shelfQty)} 件` : ""}</div>
        </div>
      </div>
      <div class="shelf-detail-rack">
        ${levels.length
          ? levels.map((level) => {
            const qty = level.isVirtual ? 0 : (positionData.levelQtyById.get(level.id) || 0);
            const levelIdAttr = level.isVirtual ? "" : `data-position-level-id="${level.id}"`;
            return `
              <div class="shelf-detail-level ${qty ? "stocked stocked-pulse" : ""}" ${levelIdAttr}>
                <div class="shelf-detail-level-label">${escapeHtml(`${level.levelNo} 层`)}</div>
                <div class="shelf-detail-display">
                  <div class="shelf-item-row" aria-hidden="true">
                    ${qty
                      ? Array.from({ length: qty }, (_, index) => `
                        <span class="shelf-item-box tone-${(Number(level.levelNo) + index) % 5} ${index % 2 ? "alt" : ""}"></span>
                      `).join("")
                      : ""}
                  </div>
                  <div class="shelf-board"></div>
                </div>
                <div class="shelf-detail-side">
                  <div class="shelf-detail-qty">${qty ? `${formatQty(qty)} 件` : ""}</div>
                  ${qty && product
                    ? `<button class="button ghost level-move-button" type="button" data-action="open-move-product-dialog" data-product-id="${escapeHtml(product.id)}" data-source-level-id="${level.id}">移动</button>`
                    : ""}
                </div>
              </div>
            `;
          }).join("")
          : `<div class="empty-state">暂无层数</div>`}
      </div>
    </div>
  `;
}

function renderPositionBreadcrumb(focusedWarehouse, focusedShelf) {
  const parts = [];
  parts.push(`<button class="crumb ${!focusedWarehouse ? "current" : ""}" type="button" data-action="clear-position-warehouse">仓库</button>`);
  if (focusedWarehouse) {
    parts.push(`<span class="sep">›</span>`);
    parts.push(`<button class="crumb ${focusedWarehouse && !focusedShelf ? "current" : ""}" type="button" data-action="clear-position-shelf">${escapeHtml(focusedWarehouse.name)}</button>`);
  }
  if (focusedShelf) {
    parts.push(`<span class="sep">›</span>`);
    parts.push(`<span class="crumb current">${escapeHtml(`${focusedShelf.code}`)}</span>`);
  }
  return `<div class="position-breadcrumb" aria-label="路径">${parts.join("")}</div>`;
}

function renderWarehouseSceneV4(product, ctx, positionData) {
  const focusedWarehouse = state.positionWarehouseId ? ctx.warehousesById.get(state.positionWarehouseId) : null;
  const focusedShelf = state.positionShelfId ? ctx.shelvesById.get(state.positionShelfId) : null;
  const breadcrumb = renderPositionBreadcrumb(focusedWarehouse, focusedShelf);

  if (!focusedWarehouse) {
    if (!ctx.warehouses.length) {
      return `<div class="empty-state"><span class="empty-title">还没有仓库</span><span>到“库位”页或“+ 录入”创建第一个仓库。</span></div>`;
    }
    return `
      <div class="position-visual-shell">
        ${breadcrumb}
        <div class="warehouse-grid warehouse-overview-grid">
          ${ctx.warehouses.map((warehouse, index) => {
            const stocked = positionData.warehouseQtyById.has(warehouse.id);
            return `
              <button
                class="warehouse-node tone-${mapTone(warehouse.colorToken, index)} ${stocked ? "stocked" : ""} ${positionData.warehouseQtyById.size && !stocked ? "dimmed" : ""}"
                type="button"
                data-action="focus-position-warehouse"
                data-warehouse-id="${warehouse.id}"
              >
                <div class="warehouse-body">
                  <span class="warehouse-code">${escapeHtml(warehouse.name)}</span>
                  <span class="warehouse-label">${stocked ? `${formatQty(positionData.warehouseQtyById.get(warehouse.id))} 件` : "—"}</span>
                </div>
              </button>
            `;
          }).join("")}
        </div>
      </div>
    `;
  }

  const shelves = bySortOrder(ctx.shelves.filter((item) => item.warehouseId === focusedWarehouse.id));
  if (!focusedShelf || focusedShelf.warehouseId !== focusedWarehouse.id) {
    return `
      <div class="position-visual-shell">
        ${breadcrumb}
        <div class="shelf-overview-grid">
          ${shelves.length
            ? shelves.map((shelf) => {
              const levels = buildShelfLevelsForDisplay(
                focusedWarehouse,
                shelf,
                ctx.shelfLevels.filter((item) => item.shelfId === shelf.id),
              );
              return renderShelfOverviewCardV4(shelf, levels, positionData);
            }).join("")
            : `<div class="empty-state"><span class="empty-title">这个仓库还没有货架</span></div>`}
        </div>
      </div>
    `;
  }

  const levels = buildShelfLevelsForDisplay(
    focusedWarehouse,
    focusedShelf,
    ctx.shelfLevels.filter((item) => item.shelfId === focusedShelf.id),
  );
  return `
    <div class="position-visual-shell">
      ${breadcrumb}
      ${renderShelfDetailSceneV4(focusedWarehouse, focusedShelf, levels, positionData, product)}
    </div>
  `;
}

function handleFileInputChange(event) {
  const [file] = event.target.files || [];
  if (!file) {
    return;
  }
  const action = state.pendingFileAction;
  state.pendingFileAction = null;
  if (action === "import-excel") {
    void (async () => {
      try {
        await importExcel(file);
      } catch (error) {
        console.error(error);
        setNotice(error.message || "导入失败", "failed");
      }
    })();
  } else if (action === "search-by-image") {
    void (async () => {
      try {
        await searchByImage(file);
      } catch (error) {
        console.error(error);
        setNotice(error.message || "按图搜索失败", "failed");
      }
    })();
  }
}

async function handleAction(action, element) {
  switch (action) {
    case "switch-mode":
      state.mode = "desktop";
      render();
      return;
    case "switch-tab": {
      const tab = element.dataset.tab;
      const all = [...DESKTOP_TABS.map((t) => t.id), "entry"];
      state.desktopTab = all.includes(tab) ? tab : "overview";
      render();
      return;
    }
    case "select-theme":
      await selectTheme(element.dataset.themeId || DEFAULT_THEME_ID);
      return;
    case "clear-search":
      state.query = "";
      state.searchDraft = "";
      state.overviewPage = 1;
      syncSelection({});
      render();
      return;
    case "search-by-image":
      state.pendingFileAction = "search-by-image";
      hiddenFileInput.accept = "image/*";
      hiddenFileInput.value = "";
      hiddenFileInput.click();
      return;
    case "open-image-search-result":
      state.selectedProductId = element.dataset.productId || null;
      state.selectedWarehouseId = null;
      state.selectedShelfId = null;
      state.positionWarehouseId = null;
      state.positionShelfId = null;
      closeDialog();
      syncSelection({});
      render();
      return;
    case "open-entry-dialog":
      renderEntryDialog();
      return;
    case "open-scanner-dialog":
      renderScannerDialog();
      return;
    case "trigger-scan-from-entry":
      closeDialog();
      renderScannerDialog();
      return;
    case "close-scanner":
      stopActiveScanner();
      closeDialog();
      return;
    case "submit-scanner-manual": {
      const dialogPanel = dialog.querySelector("[data-dialog='scanner']");
      const value = dialogPanel?.querySelector("[data-role='scanner-manual']")?.value || "";
      handleScannerValue(value);
      return;
    }
    case "overview-page-prev":
      state.overviewPage = Math.max(1, (state.overviewPage || 1) - 1);
      render();
      return;
    case "overview-page-next":
      state.overviewPage = (state.overviewPage || 1) + 1;
      render();
      return;
    case "switch-position-view":
      state.positionView = element.dataset.view || "visual";
      render();
      return;
    case "open-product-dialog":
      closeDialog();
      renderProductDialog(element.dataset.productId || "");
      return;
    case "open-product-menu":
      renderProductMenu(element.dataset.productId || "");
      return;
    case "open-warehouse-menu":
      renderWarehouseMenu(element.dataset.warehouseId || "");
      return;
    case "open-shelf-menu":
      renderShelfMenu(element.dataset.shelfId || "");
      return;
    case "open-level-menu":
      renderLevelMenu(element.dataset.levelId || "");
      return;
    case "open-external-menu":
      renderExternalMenu(element.dataset.externalId || "");
      return;
    case "back-to-warehouses":
      state.layoutLevel = "warehouses";
      state.selectedWarehouseId = null;
      state.selectedShelfId = null;
      render();
      return;
    case "back-to-shelves":
      state.layoutLevel = "shelves";
      state.selectedShelfId = null;
      render();
      return;
    case "open-stock-dialog":
      renderStockDialog();
      return;
    case "open-move-product-dialog":
      renderMoveProductDialog(
        element.dataset.productId || state.selectedProductId,
        element.dataset.sourceLevelId || "",
      );
      return;
    case "set-move-qty": {
      const moveForm = document.querySelector("[data-form='move-product']");
      const qtyInput = moveForm?.querySelector("[data-role='move-qty-input']");
      if (qtyInput) {
        const requested = Number(element.dataset.qty || 0);
        const max = Number(qtyInput.max || requested);
        qtyInput.value = String(Math.max(1, Math.min(max || requested, requested)));
      }
      return;
    }
    case "open-field-dialog":
      renderFieldDialog(element.dataset.fieldId || "");
      return;
    case "open-warehouse-dialog":
      renderWarehouseDialog();
      return;
    case "open-shelf-dialog":
      renderShelfDialog();
      return;
    case "open-level-dialog":
      renderLevelDialog();
      return;
    case "open-external-dialog":
      renderExternalDialog();
      return;
    case "open-product-positions":
      closeDialog();
      state.selectedProductId = element.dataset.productId || null;
      state.selectedWarehouseId = null;
      state.selectedShelfId = null;
      state.positionWarehouseId = null;
      state.positionShelfId = null;
      state.positionView = "visual";
      state.query = "";
      state.searchDraft = "";
      state.desktopTab = "positions";
      syncSelection({});
      render();
      return;
    case "select-product":
      state.selectedProductId = element.dataset.productId || null;
      state.selectedWarehouseId = null;
      state.selectedShelfId = null;
      state.positionWarehouseId = null;
      state.positionShelfId = null;
      syncSelection({});
      render();
      return;
    case "focus-position-warehouse":
      state.positionWarehouseId = element.dataset.warehouseId || null;
      state.positionShelfId = null;
      render();
      return;
    case "clear-position-warehouse":
      state.positionWarehouseId = null;
      state.positionShelfId = null;
      render();
      return;
    case "focus-position-shelf":
      state.positionShelfId = element.dataset.shelfId || null;
      render();
      return;
    case "clear-position-shelf":
      state.positionShelfId = null;
      render();
      return;
    case "select-warehouse":
      state.selectedWarehouseId = element.dataset.warehouseId || null;
      state.selectedShelfId = null;
      syncSelection({});
      render();
      return;
    case "select-shelf":
      state.selectedShelfId = element.dataset.shelfId || null;
      render();
      return;
    case "drill-warehouse":
      state.selectedWarehouseId = element.dataset.warehouseId || null;
      state.selectedShelfId = null;
      state.layoutLevel = "shelves";
      syncSelection({});
      render();
      return;
    case "drill-shelf":
      state.selectedShelfId = element.dataset.shelfId || null;
      state.layoutLevel = "levels";
      render();
      return;
    case "delete-product":
      closeDialog();
      await deleteProduct(element.dataset.productId || "");
      return;
    case "delete-field":
      closeDialog();
      await deleteField(element.dataset.fieldId || "");
      return;
    case "delete-field-value":
      await deleteFieldValue(element.dataset.fieldId || "", element.dataset.valueText || "");
      return;
    case "delete-warehouse":
      closeDialog();
      await deleteWarehouse(element.dataset.warehouseId || "");
      return;
    case "delete-shelf":
      closeDialog();
      await deleteShelf(element.dataset.shelfId || "");
      return;
    case "delete-level":
      closeDialog();
      await deleteLevel(element.dataset.levelId || "");
      return;
    case "delete-external":
      closeDialog();
      await deleteExternal(element.dataset.externalId || "");
      return;
    case "export-excel":
      try {
        await exportExcel();
        setNotice("Excel 已导出");
      } catch (error) {
        console.error(error);
        setNotice(error.message || "导出失败", "failed");
      }
      return;
    case "import-excel":
      renderImportDialog();
      return;
    case "open-sync-info":
      await renderSyncInfoDialog();
      return;
    case "toggle-sync-token":
      state.syncTokenVisible = !state.syncTokenVisible;
      await renderSyncInfoDialog();
      return;
    case "copy-text":
      await copyText(element.dataset.text || "", element.dataset.success || "已复制");
      return;
    case "open-remote-config":
      renderRemoteConfigDialog();
      return;
    case "test-remote-config": {
      const form = readRemoteConfigForm();
      if (!form) return;
      renderRemoteConfigDialog({ ...form, status: "正在测试连接...", statusType: "loading" });
      try {
        await pingRemote(form.base, form.token);
        renderRemoteConfigDialog({ ...form, status: "连接成功！可以保存。", statusType: "ok" });
      } catch (error) {
        renderRemoteConfigDialog({ ...form, status: error.message || "连接失败", statusType: "fail" });
      }
      return;
    }
    case "clear-remote-config":
      clearRemoteConfig();
      setNotice("已切回本机模式，请刷新页面");
      closeDialog();
      setTimeout(() => location.reload(), 600);
      return;
    case "download-import-template":
      try {
        await downloadImportTemplate();
        setNotice("模板已下载");
      } catch (error) {
        console.error(error);
        setNotice(error.message || "模板下载失败", "failed");
      }
      return;
    case "choose-import-excel":
      closeDialog();
      promptImportExcel();
      return;
    case "close-dialog":
      closeDialog();
      return;
    default:
      return;
  }
}

function handleRootClick(event) {
  if (longPressJustTriggered) {
    longPressJustTriggered = false;
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  const actionTarget = event.target.closest("[data-action]");
  if (!actionTarget) {
    return;
  }
  void handleAction(actionTarget.dataset.action, actionTarget);
}

const LONGPRESS_MS = 500;
const LONGPRESS_MOVE_TOL = 10;
let longPressTimer = null;
let longPressJustTriggered = false;
let longPressStartXY = null;
const LONGPRESS_ACTIONS = {
  product: "open-product-menu",
  warehouse: "open-warehouse-menu",
  shelf: "open-shelf-menu",
  level: "open-level-menu",
  external: "open-external-menu",
};

function handleLongPressStart(event) {
  const longTarget = event.target.closest("[data-longpress]");
  if (!longTarget) {
    return;
  }
  longPressStartXY = { x: event.clientX, y: event.clientY };
  longPressTimer = window.setTimeout(() => {
    longPressTimer = null;
    longPressJustTriggered = true;
    const action = LONGPRESS_ACTIONS[longTarget.dataset.longpress];
    if (action) {
      void handleAction(action, longTarget);
    }
  }, LONGPRESS_MS);
}

function cancelLongPress() {
  if (longPressTimer !== null) {
    window.clearTimeout(longPressTimer);
    longPressTimer = null;
  }
}

function handleLongPressMove(event) {
  if (longPressTimer === null || !longPressStartXY) {
    return;
  }
  if (
    Math.abs(event.clientX - longPressStartXY.x) > LONGPRESS_MOVE_TOL ||
    Math.abs(event.clientY - longPressStartXY.y) > LONGPRESS_MOVE_TOL
  ) {
    cancelLongPress();
  }
}

function handleContextMenu(event) {
  const longTarget = event.target.closest("[data-longpress]");
  if (!longTarget) {
    return;
  }
  event.preventDefault();
  const action = LONGPRESS_ACTIONS[longTarget.dataset.longpress];
  if (action) {
    void handleAction(action, longTarget);
  }
}

function handleRootInput(event) {
  const target = event.target;
  if (target.matches("[data-role='global-search-draft']")) {
    state.searchDraft = target.value || "";
  }
}

function handleDialogInput(event) {
  const target = event.target;
  if (target.matches("[data-role='stock-operation-type']")) {
    syncStockDialogSections(target.closest("[data-form='stock']"));
  }
  if (target.matches("[data-role='move-target-warehouse']")) {
    syncMoveDialogTargets(target.closest("[data-form='move-product']"), "warehouse");
  }
  if (target.matches("[data-role='move-target-shelf']")) {
    syncMoveDialogTargets(target.closest("[data-form='move-product']"), "shelf");
  }
}

function handleRootSubmit(event) {
  const form = event.target;
  if (form.matches("[data-form='global-search']")) {
    event.preventDefault();
    state.query = text(state.searchDraft);
    state.overviewPage = 1;
    syncSelection({});
    render();
  }
}

async function handleDialogSubmit(event) {
  event.preventDefault();
  const form = event.target;
  const submitter = event.submitter;
  const continueAdding = submitter?.dataset.action === "submit-entry-continue";
  try {
    switch (form.dataset.form) {
      case "product":
        await saveProduct(form);
        break;
      case "stock":
        await saveStock(form);
        break;
      case "move-product":
        await saveMoveProduct(form);
        break;
      case "entry":
        await saveEntry(form, { continueAdding });
        break;
      case "field":
        await saveField(form);
        break;
      case "warehouse":
        await saveWarehouse(form);
        break;
      case "shelf":
        await saveShelf(form);
        break;
      case "level":
        await saveLevel(form);
        break;
      case "external":
        await saveExternal(form);
        break;
      case "remote-config":
        await saveRemoteConfig(form);
        break;
      default:
        break;
    }
  } catch (error) {
    console.error(error);
    pushToast(error.message || "保存失败", "failed");
  }
}

async function saveRemoteConfig(form) {
  const data = new FormData(form);
  const base = String(data.get("base") || "").trim();
  const token = String(data.get("token") || "").trim();
  if (!base) {
    renderRemoteConfigDialog({ base, token, status: "服务器地址不能为空", statusType: "fail" });
    return;
  }
  renderRemoteConfigDialog({ base, token, status: "正在验证连接...", statusType: "loading" });
  try {
    await pingRemote(base, token);
  } catch (error) {
    renderRemoteConfigDialog({ base, token, status: error.message || "连接失败", statusType: "fail" });
    return;
  }
  setApiBase(base);
  setSyncToken(token);
  setNotice("远程服务器已保存，正在刷新...");
  closeDialog();
  setTimeout(() => location.reload(), 600);
}

appRoot.addEventListener("click", handleRootClick);
appRoot.addEventListener("input", handleRootInput);
appRoot.addEventListener("submit", handleRootSubmit);
appRoot.addEventListener("pointerdown", handleLongPressStart);
appRoot.addEventListener("pointermove", handleLongPressMove);
appRoot.addEventListener("pointerup", cancelLongPress);
appRoot.addEventListener("pointercancel", cancelLongPress);
appRoot.addEventListener("pointerleave", cancelLongPress);
appRoot.addEventListener("contextmenu", handleContextMenu);
dialog.addEventListener("click", handleRootClick);
dialog.addEventListener("input", handleDialogInput);
dialog.addEventListener("submit", (event) => {
  void handleDialogSubmit(event);
});
hiddenFileInput.addEventListener("change", handleFileInputChange);

function trackServiceWorkerUpdate(registration) {
  const worker = registration.installing;
  if (!worker) {
    return;
  }
  worker.addEventListener("statechange", () => {
    if (worker.state === "installed" && navigator.serviceWorker.controller) {
      worker.postMessage({ type: "SKIP_WAITING" });
      setNotice("新版本已就绪，请刷新");
    }
  });
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }
  try {
    const registration = await navigator.serviceWorker.register(`./service-worker.js?v=${APP_VERSION}`);
    registration.addEventListener("updatefound", () => trackServiceWorkerUpdate(registration));
    if (registration.waiting) {
      registration.waiting.postMessage({ type: "SKIP_WAITING" });
    }
    let controllerChanged = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (controllerChanged) {
        return;
      }
      controllerChanged = true;
      setNotice("新版本已启用，请刷新");
    });
  } catch (error) {
    console.warn("Service worker registration failed", error);
  }
}

async function init() {
  try {
    await ensureSeedData();
    await loadStoredTheme();
    await refreshContext();
    await registerServiceWorker();
  } catch (error) {
    console.error(error);
    appRoot.innerHTML = `
      <section class="panel">
        <div class="panel-body empty-state">启动失败：${escapeHtml(error.message || "未知错误")}</div>
      </section>
    `;
  }
}

void init();
