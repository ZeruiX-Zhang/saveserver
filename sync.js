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

function applyUploadsPayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Uploads payload must be an object");
  }
  const data = payload.data || payload;
  const counts = {};
  for (const store of UPLOAD_STORES) {
    const rows = data[store];
    if (Array.isArray(rows) && rows.length > 0) {
      dbStore.bulkPut(store, rows);
      counts[store] = rows.length;
    }
  }
  return counts;
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
  exportMasterPackageBuffer,
  importPackageBuffer,
};
