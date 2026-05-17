// Sync layer for Android handheld <-> Desktop PC.
//
// Two transports share the same payload format:
//   1. LAN HTTP — /api/sync/* endpoints
//   2. USB file package — gzipped JSON file with `{type, generatedAt, data}`
//
// Token is generated lazily on first access and persisted to
// data/sync-token.txt. The desktop UI will surface this token so the
// operator can type/scan it into the Android app once.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const dbStore = require("./database/db.js");

const TOKEN_FILE =
  process.env.WAREHOUSE_TOKEN_PATH ||
  path.join(__dirname, "data", "sync-token.txt");

// Stores the desktop pushes down to handhelds during master-data sync.
// Operation logs / batches / device records stay desktop-only.
const MASTER_STORES = [
  "products",
  "customFieldDefinitions",
  "productCustomFieldValues",
  "warehouses",
  "shelves",
  "shelfLevels",
  "externalLocations",
  "inventoryBalances",
];

// Stores the handheld is allowed to push back to the desktop.
//
// NOTE: the `operations` array on an Operation_Package is NOT a member of
// this store whitelist. It is a separate branch of `applyUploadsPayload`
// that consumes `data.operations` and writes to `inventoryOperations` /
// `inventoryBalances` per design doc §3.9 / §5.2 (with `package_id` +
// `operation_id` double-layer deduplication, see Requirement 18.3).
const UPLOAD_STORES = [
  "products",
  "customFieldDefinitions",
  "productCustomFieldValues",
];

const PACKAGE_TYPE_MASTER = "warehouse-master-package";
const PACKAGE_TYPE_UPLOADS = "warehouse-uploads-package";
const PACKAGE_VERSION = 1;

function ensureDirFor(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function getOrCreateToken() {
  ensureDirFor(TOKEN_FILE);
  if (fs.existsSync(TOKEN_FILE)) {
    const existing = fs.readFileSync(TOKEN_FILE, "utf-8").trim();
    if (existing) {
      return existing;
    }
  }
  const token = crypto.randomBytes(24).toString("hex");
  fs.writeFileSync(TOKEN_FILE, token, "utf-8");
  return token;
}

function extractToken(request) {
  const auth = request.headers["authorization"] || "";
  if (auth.startsWith("Bearer ")) {
    return auth.slice(7).trim();
  }
  const headerToken = request.headers["x-sync-token"];
  if (headerToken) {
    return String(headerToken).trim();
  }
  // Fallback: ?token=... query string for casual curl/USB-imitation usage.
  const url = request.url || "";
  const queryIndex = url.indexOf("?");
  if (queryIndex >= 0) {
    const params = new URLSearchParams(url.slice(queryIndex + 1));
    const queryToken = params.get("token");
    if (queryToken) {
      return queryToken.trim();
    }
  }
  return "";
}

function authorize(request) {
  const got = extractToken(request);
  if (!got) {
    return false;
  }
  const expected = getOrCreateToken();
  if (got.length !== expected.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

function buildMasterPayload() {
  const data = {};
  for (const store of MASTER_STORES) {
    data[store] = dbStore.listAll(store);
  }
  return {
    type: PACKAGE_TYPE_MASTER,
    version: PACKAGE_VERSION,
    generatedAt: new Date().toISOString(),
    data,
  };
}

// ---------------------------------------------------------------------------
// Operations consumer — implements the `operations[]` branch of an
// Operation_Package upload. See design.md §Data Models and
// docs/offline-warehouse-design.md §3.9 / §5.2 for the wire schema and
// import rules.
// ---------------------------------------------------------------------------

function balanceLookupKey(productId, locationType, levelId, externalLocationId) {
  return [
    String(productId || ""),
    String(locationType || ""),
    String(levelId || ""),
    String(externalLocationId || ""),
  ].join("|");
}

function computeBalanceDelta(op) {
  const qty = Number(op.qty);
  const sourceType = op.source_location_type;
  const targetType = op.target_location_type;
  const changes = [];

  if (sourceType && sourceType !== "none") {
    if (sourceType === "warehouse") {
      if (!op.source_level_id) {
        return { error: "缺少来源仓库层数 ID" };
      }
      changes.push({
        locationType: "warehouse",
        levelId: op.source_level_id,
        externalLocationId: null,
        delta: -qty,
      });
    } else if (sourceType === "external") {
      if (!op.source_external_location_id) {
        return { error: "缺少来源外部位置 ID" };
      }
      changes.push({
        locationType: "external",
        levelId: null,
        externalLocationId: op.source_external_location_id,
        delta: -qty,
      });
    } else {
      return { error: `不支持的来源位置类型：${sourceType}` };
    }
  }

  if (targetType && targetType !== "none") {
    if (targetType === "warehouse") {
      if (!op.target_level_id) {
        return { error: "缺少目标仓库层数 ID" };
      }
      changes.push({
        locationType: "warehouse",
        levelId: op.target_level_id,
        externalLocationId: null,
        delta: qty,
      });
    } else if (targetType === "external") {
      if (!op.target_external_location_id) {
        return { error: "缺少目标外部位置 ID" };
      }
      changes.push({
        locationType: "external",
        levelId: null,
        externalLocationId: op.target_external_location_id,
        delta: qty,
      });
    } else {
      return { error: `不支持的目标位置类型：${targetType}` };
    }
  }

  if (changes.length === 0) {
    return {
      error: `操作类型 ${op.operation_type || "unknown"} 没有产生任何库存变化`,
    };
  }

  return { changes };
}

function applyOperations(operations, meta) {
  const result = {
    applied: 0,
    skipped: 0,
    failed: [],
  };
  if (!Array.isArray(operations) || operations.length === 0) {
    return result;
  }

  const packageId = meta.package_id || null;

  // Package-level dedup (Requirement 18.3 / design §5.4): an entire
  // Operation_Package re-uploaded with the same package_id MUST be a no-op.
  if (packageId) {
    const batches = dbStore.listAll("importBatches");
    if (batches.some((b) => b && b.packageId === packageId)) {
      result.skipped = operations.length;
      return result;
    }
  }

  // Pre-load existing operation IDs and balances for in-memory lookup.
  const existingOpIds = new Set(
    dbStore.listAll("inventoryOperations").map((op) => op && op.id),
  );
  const balanceByKey = new Map();
  for (const balance of dbStore.listAll("inventoryBalances")) {
    if (!balance) continue;
    balanceByKey.set(
      balanceLookupKey(
        balance.productId,
        balance.locationType,
        balance.levelId,
        balance.externalLocationId,
      ),
      balance,
    );
  }

  const importedAt = new Date().toISOString();
  const batchId = packageId || crypto.randomUUID();

  for (const op of operations) {
    const operationId = op && op.operation_id;
    if (!operationId) {
      result.failed.push({
        operationId: null,
        reason: "operation_id 缺失",
      });
      continue;
    }

    // Operation-level dedup — second layer of defense against split / partial
    // re-uploads (Requirement 18.3 / design §5.4).
    if (existingOpIds.has(operationId)) {
      result.skipped += 1;
      continue;
    }

    if (!op.product_id) {
      result.failed.push({ operationId, reason: "product_id 缺失" });
      continue;
    }

    const qty = Number(op.qty);
    if (!(qty > 0)) {
      result.failed.push({ operationId, reason: "数量必须大于 0" });
      continue;
    }

    const delta = computeBalanceDelta({ ...op, qty });
    if (delta.error) {
      result.failed.push({ operationId, reason: delta.error });
      continue;
    }

    // Source-qty-sufficient check (design §5.3): drive any balance below 0 →
    // mark op as failed and don't write anything.
    let sufficient = true;
    for (const change of delta.changes) {
      if (change.delta >= 0) continue;
      const k = balanceLookupKey(
        op.product_id,
        change.locationType,
        change.levelId,
        change.externalLocationId,
      );
      const existing = balanceByKey.get(k);
      const currentQty = Number(existing?.qty || 0);
      if (currentQty + change.delta < 0) {
        sufficient = false;
        break;
      }
    }
    if (!sufficient) {
      result.failed.push({ operationId, reason: "来源位置库存不足" });
      continue;
    }

    // Apply balance changes.
    for (const change of delta.changes) {
      const k = balanceLookupKey(
        op.product_id,
        change.locationType,
        change.levelId,
        change.externalLocationId,
      );
      const existing = balanceByKey.get(k);
      const newQty = Number(existing?.qty || 0) + change.delta;
      if (existing) {
        if (newQty <= 0) {
          dbStore.removeOne("inventoryBalances", existing.id);
          balanceByKey.delete(k);
        } else {
          const updated = { ...existing, qty: newQty, updatedAt: importedAt };
          dbStore.putOne("inventoryBalances", updated);
          balanceByKey.set(k, updated);
        }
      } else if (newQty > 0) {
        const created = {
          id: crypto.randomUUID(),
          productId: op.product_id,
          locationType: change.locationType,
          levelId: change.levelId,
          externalLocationId: change.externalLocationId,
          qty: newQty,
          updatedAt: importedAt,
        };
        dbStore.putOne("inventoryBalances", created);
        balanceByKey.set(k, created);
      }
      // newQty <= 0 with no existing balance: nothing to insert.
    }

    // Write inventory_operations row using the snake_case wire schema
    // (docs/offline-warehouse-design.md §3.9). The desktop demo seed uses
    // camelCase; both shapes coexist as JSON blobs in kv_inventory_operations
    // because the column is just `payload TEXT`.
    const opRecord = {
      id: operationId,
      batch_id: batchId,
      device_id: meta.device_id || null,
      operation_type: op.operation_type || null,
      product_id: op.product_id,
      qty,
      source_location_type: op.source_location_type || "none",
      source_level_id: op.source_level_id ?? null,
      source_external_location_id: op.source_external_location_id ?? null,
      target_location_type: op.target_location_type || "none",
      target_level_id: op.target_level_id ?? null,
      target_external_location_id: op.target_external_location_id ?? null,
      note: op.note ?? "",
      operator_name: op.operator_name ?? meta.device_name ?? "",
      operated_at: op.operated_at || importedAt,
      imported_at: importedAt,
      import_status: "imported",
      failure_reason: null,
    };
    dbStore.putOne("inventoryOperations", opRecord);
    existingOpIds.add(operationId);
    result.applied += 1;
  }

  // Persist the import batch so the same package_id is rejected on retry.
  // The batch is written even if every op failed validation, to honour
  // package-level idempotency.
  if (packageId) {
    let status = "completed";
    if (result.failed.length > 0 && result.applied === 0) {
      status = "failed";
    } else if (result.failed.length > 0) {
      status = "partial_failed";
    }
    const batchRecord = {
      id: batchId,
      batchCode: String(batchId).slice(0, 8).toUpperCase(),
      packageId,
      deviceId: meta.device_id || null,
      fileName: null,
      baseMasterPackageId: meta.base_master_package_id || null,
      totalCount: operations.length,
      successCount: result.applied,
      failedCount: result.failed.length,
      importedBy: meta.device_name || "handheld",
      importedAt,
      status,
    };
    dbStore.putOne("importBatches", batchRecord);
  }

  return result;
}

function applyUploadsPayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Uploads payload must be an object");
  }
  // Accept both an outer envelope `{ data: { ... } }` and the bare
  // Operation_Package shape `{ package_id, operations, ... }` — fields are
  // looked up on both layers so legacy callers keep working.
  const data = payload.data && typeof payload.data === "object" ? payload.data : payload;

  const applied = {};
  for (const store of UPLOAD_STORES) {
    const rows = data[store];
    if (Array.isArray(rows) && rows.length > 0) {
      dbStore.bulkPut(store, rows);
      applied[store] = rows.length;
    }
  }

  let operationsApplied = 0;
  let operationsSkippedDuplicate = 0;
  let operationsFailed = [];

  const operations = Array.isArray(data.operations) ? data.operations : null;
  if (operations) {
    const meta = {
      package_id: data.package_id || payload.package_id || null,
      device_id: data.device_id || payload.device_id || null,
      device_name: data.device_name || payload.device_name || null,
      base_master_package_id:
        data.base_master_package_id || payload.base_master_package_id || null,
      exported_at: data.exported_at || payload.exported_at || null,
    };
    const opResult = applyOperations(operations, meta);
    operationsApplied = opResult.applied;
    operationsSkippedDuplicate = opResult.skipped;
    operationsFailed = opResult.failed;
  }

  return {
    applied,
    operationsApplied,
    operationsSkippedDuplicate,
    operationsFailed,
  };
}

function exportMasterPackageBuffer() {
  const payload = buildMasterPayload();
  return zlib.gzipSync(Buffer.from(JSON.stringify(payload), "utf-8"));
}

function importPackageBuffer(buffer) {
  let json;
  try {
    json = zlib.gunzipSync(buffer).toString("utf-8");
  } catch {
    // Allow uncompressed JSON for tooling / debugging.
    json = buffer.toString("utf-8");
  }
  const pkg = JSON.parse(json);
  if (pkg?.type !== PACKAGE_TYPE_UPLOADS) {
    throw new Error(`Unsupported package type: ${pkg?.type || "unknown"}`);
  }
  return applyUploadsPayload(pkg);
}

module.exports = {
  TOKEN_FILE,
  MASTER_STORES,
  UPLOAD_STORES,
  PACKAGE_TYPE_MASTER,
  PACKAGE_TYPE_UPLOADS,
  PACKAGE_VERSION,
  getOrCreateToken,
  authorize,
  buildMasterPayload,
  applyUploadsPayload,
  applyOperations,
  computeBalanceDelta,
  exportMasterPackageBuffer,
  importPackageBuffer,
};
