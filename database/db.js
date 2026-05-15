// SQLite KV-blob backend for warehouse stores.
//
// Phase 1 strategy: every IndexedDB object store maps to one SQL table
// with shape (id TEXT PRIMARY KEY, payload TEXT, updated_at TEXT).
// The full record JSON is stored in payload. Phase 4 will relationalize
// the products table and split images out to disk.

const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

const STORE_TABLES = [
  { store: "appMeta", table: "kv_app_meta", keyPath: "key" },
  { store: "products", table: "kv_products", keyPath: "id" },
  { store: "customFieldDefinitions", table: "kv_custom_field_definitions", keyPath: "id" },
  { store: "productCustomFieldValues", table: "kv_product_custom_field_values", keyPath: "id" },
  { store: "warehouses", table: "kv_warehouses", keyPath: "id" },
  { store: "shelves", table: "kv_shelves", keyPath: "id" },
  { store: "shelfLevels", table: "kv_shelf_levels", keyPath: "id" },
  { store: "externalLocations", table: "kv_external_locations", keyPath: "id" },
  { store: "inventoryBalances", table: "kv_inventory_balances", keyPath: "id" },
  { store: "inventoryOperations", table: "kv_inventory_operations", keyPath: "id" },
  { store: "devices", table: "kv_devices", keyPath: "id" },
  { store: "masterExports", table: "kv_master_exports", keyPath: "id" },
  { store: "importBatches", table: "kv_import_batches", keyPath: "id" },
];

const STORE_BY_NAME = new Map(STORE_TABLES.map((entry) => [entry.store, entry]));

function defaultDbPath() {
  if (process.env.WAREHOUSE_DB_PATH) {
    return process.env.WAREHOUSE_DB_PATH;
  }
  return path.join(__dirname, "..", "data", "warehouse.db");
}

let database = null;

function ensureDirFor(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function initSchema(db) {
  const stmts = STORE_TABLES.map(
    ({ table }) =>
      `CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')));`,
  );
  db.exec(stmts.join("\n"));

  db.exec(`
    CREATE TABLE IF NOT EXISTS product_phashes (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      image_index INTEGER NOT NULL DEFAULT 0,
      phash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_phashes_product ON product_phashes(product_id);
  `);
}

function open() {
  if (database) {
    return database;
  }
  const dbPath = defaultDbPath();
  ensureDirFor(dbPath);
  database = new Database(dbPath);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  initSchema(database);
  return database;
}

function close() {
  if (database) {
    database.close();
    database = null;
  }
}

function resolveStore(storeName) {
  const entry = STORE_BY_NAME.get(storeName);
  if (!entry) {
    throw new Error(`Unknown store: ${storeName}`);
  }
  return entry;
}

function extractKey(record, keyPath) {
  const value = record?.[keyPath];
  if (value === undefined || value === null || value === "") {
    throw new Error(`Record is missing required key "${keyPath}".`);
  }
  return String(value);
}

function listAll(storeName) {
  const { table } = resolveStore(storeName);
  const db = open();
  const rows = db.prepare(`SELECT payload FROM ${table}`).all();
  return rows.map((row) => JSON.parse(row.payload));
}

function getOne(storeName, key) {
  const { table } = resolveStore(storeName);
  const db = open();
  const row = db.prepare(`SELECT payload FROM ${table} WHERE id = ?`).get(String(key));
  return row ? JSON.parse(row.payload) : undefined;
}

function putOne(storeName, record) {
  const entry = resolveStore(storeName);
  const id = extractKey(record, entry.keyPath);
  const payload = JSON.stringify(record);
  const db = open();
  db.prepare(
    `INSERT INTO ${entry.table} (id, payload, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = datetime('now')`,
  ).run(id, payload);
  return id;
}

function removeOne(storeName, key) {
  const { table } = resolveStore(storeName);
  const db = open();
  db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(String(key));
}

function clearStore(storeName) {
  const { table } = resolveStore(storeName);
  const db = open();
  db.prepare(`DELETE FROM ${table}`).run();
}

function bulkPut(storeName, records) {
  const entry = resolveStore(storeName);
  const db = open();
  const stmt = db.prepare(
    `INSERT INTO ${entry.table} (id, payload, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = datetime('now')`,
  );
  const tx = db.transaction((rows) => {
    for (const record of rows) {
      const id = extractKey(record, entry.keyPath);
      stmt.run(id, JSON.stringify(record));
    }
  });
  tx(records);
}

function replaceStores(dataMap) {
  const db = open();
  const entries = Object.keys(dataMap).map((name) => ({
    entry: resolveStore(name),
    rows: Array.isArray(dataMap[name]) ? dataMap[name] : [],
  }));
  const tx = db.transaction(() => {
    for (const { entry, rows } of entries) {
      db.prepare(`DELETE FROM ${entry.table}`).run();
      const insert = db.prepare(
        `INSERT INTO ${entry.table} (id, payload, updated_at) VALUES (?, ?, datetime('now'))`,
      );
      for (const record of rows) {
        const id = extractKey(record, entry.keyPath);
        insert.run(id, JSON.stringify(record));
      }
    }
  });
  tx();
}

function exportAll() {
  const result = {};
  for (const { store } of STORE_TABLES) {
    result[store] = listAll(store);
  }
  return result;
}

function countStore(storeName) {
  const { table } = resolveStore(storeName);
  const db = open();
  const row = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get();
  return row.c;
}

function indexPhash(productId, imageIndex, phash) {
  if (!productId) {
    throw new Error("indexPhash requires productId");
  }
  if (!phash) {
    throw new Error("indexPhash requires phash");
  }
  const idx = Number(imageIndex) || 0;
  const id = `${productId}::${idx}`;
  const db = open();
  db.prepare(
    `INSERT INTO product_phashes (id, product_id, image_index, phash, created_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET phash = excluded.phash, created_at = datetime('now')`,
  ).run(id, String(productId), idx, String(phash));
  return id;
}

function listAllPhashes() {
  const db = open();
  return db.prepare(`SELECT product_id, image_index, phash FROM product_phashes`).all();
}

function deletePhashesForProduct(productId) {
  const db = open();
  db.prepare(`DELETE FROM product_phashes WHERE product_id = ?`).run(String(productId));
}

function countPhashes() {
  const db = open();
  return db.prepare(`SELECT COUNT(*) AS c FROM product_phashes`).get().c;
}

module.exports = {
  STORE_TABLES,
  open,
  close,
  listAll,
  getOne,
  putOne,
  removeOne,
  clearStore,
  bulkPut,
  replaceStores,
  exportAll,
  countStore,
  defaultDbPath,
  indexPhash,
  listAllPhashes,
  deletePhashesForProduct,
  countPhashes,
};
