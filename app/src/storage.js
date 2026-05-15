// HTTP-backed storage client.
//
// External shape kept identical to the previous IndexedDB implementation
// so callers in app.js / seed.js / search.js need no changes. Internally
// every call goes through fetch to server.js, which reads/writes SQLite.
//
// The base URL and (optional) X-Sync-Token come from api-config so the
// same code works as a local desktop PWA (relative URL, no token) and as
// an Android-installed PWA pointing at a remote PC (absolute URL + token).

import { apiUrl, buildAuthHeaders } from "./api-config.js";

export const STORE_NAMES = {
  appMeta: "appMeta",
  products: "products",
  customFieldDefinitions: "customFieldDefinitions",
  productCustomFieldValues: "productCustomFieldValues",
  warehouses: "warehouses",
  shelves: "shelves",
  shelfLevels: "shelfLevels",
  externalLocations: "externalLocations",
  inventoryBalances: "inventoryBalances",
  inventoryOperations: "inventoryOperations",
  devices: "devices",
  masterExports: "masterExports",
  importBatches: "importBatches",
};

const KEY_PATH = {
  [STORE_NAMES.appMeta]: "key",
};

function keyOf(storeName, value) {
  const path = KEY_PATH[storeName] || "id";
  const raw = value?.[path];
  if (raw === undefined || raw === null || raw === "") {
    throw new Error(`Record for store "${storeName}" is missing key "${path}"`);
  }
  return String(raw);
}

async function jsonOrThrow(response) {
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status} ${response.statusText} — ${text}`.trim());
  }
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return undefined;
  }
  return response.json();
}

function storeUrl(storeName, ...rest) {
  const parts = [encodeURIComponent(storeName), ...rest.map((part) => encodeURIComponent(part))];
  return apiUrl(`/api/store/${parts.join("/")}`);
}

function fetchOpts(extra = {}) {
  return {
    ...extra,
    headers: buildAuthHeaders(extra.headers),
  };
}

async function getAll(storeName) {
  const response = await fetch(storeUrl(storeName), fetchOpts());
  return (await jsonOrThrow(response)) || [];
}

async function get(storeName, key) {
  const response = await fetch(storeUrl(storeName, String(key)), fetchOpts());
  if (response.status === 404) {
    return undefined;
  }
  return jsonOrThrow(response);
}

async function put(storeName, value) {
  const id = keyOf(storeName, value);
  const response = await fetch(
    storeUrl(storeName, id),
    fetchOpts({
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
    }),
  );
  await jsonOrThrow(response);
  return id;
}

async function remove(storeName, key) {
  const response = await fetch(storeUrl(storeName, String(key)), fetchOpts({ method: "DELETE" }));
  await jsonOrThrow(response);
}

async function clear(storeName) {
  const response = await fetch(storeUrl(storeName), fetchOpts({ method: "DELETE" }));
  await jsonOrThrow(response);
}

async function bulkPut(storeName, values) {
  if (!Array.isArray(values) || values.length === 0) {
    return;
  }
  const response = await fetch(
    `${storeUrl(storeName)}/bulk`,
    fetchOpts({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    }),
  );
  await jsonOrThrow(response);
}

async function replaceStores(dataMap) {
  const response = await fetch(
    apiUrl("/api/replace-stores"),
    fetchOpts({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dataMap),
    }),
  );
  await jsonOrThrow(response);
}

async function exportAll() {
  const response = await fetch(apiUrl("/api/export-all"), fetchOpts());
  return (await jsonOrThrow(response)) || {};
}

async function count(storeName) {
  const response = await fetch(`${storeUrl(storeName)}/count`, fetchOpts());
  const body = await jsonOrThrow(response);
  return body?.count || 0;
}

async function openDatabase() {
  // No-op for HTTP backend. Kept for API compatibility with the previous
  // IndexedDB version: callers may have awaited db.openDatabase() before
  // running queries.
  return true;
}

export const db = {
  openDatabase,
  getAll,
  get,
  put,
  remove,
  clear,
  bulkPut,
  replaceStores,
  exportAll,
  count,
  storeNames: STORE_NAMES,
};
