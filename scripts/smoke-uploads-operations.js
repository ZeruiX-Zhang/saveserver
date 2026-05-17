// Smoke test for sync.applyUploadsPayload `operations[]` consumer branch.
//
// Validates:
//   1. A put_in op lands in `inventory_operations` and bumps
//      `inventory_balances` for (product_id, target_level_id).
//   2. Re-uploading the SAME package_id is a no-op (package-level dedup).
//   3. Re-uploading the SAME operation_id under a DIFFERENT package_id
//      counts as duplicate (operation-level dedup).
//   4. A move op that would drive a source balance below 0 is reported
//      as failed and does not modify any balance.
//
// Usage:
//   node scripts/smoke-uploads-operations.js
//
// Exits with code 0 on success, 1 on any assertion failure.

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const assert = require("node:assert/strict");

// Route the SQLite + token files to a temp directory before requiring the
// sync layer, so the smoke test never touches real data.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "warehouse-smoke-"));
process.env.WAREHOUSE_DB_PATH = path.join(tmpRoot, "warehouse.db");
process.env.WAREHOUSE_TOKEN_PATH = path.join(tmpRoot, "sync-token.txt");

const sync = require("../sync.js");
const dbStore = require("../database/db.js");

function log(step, message) {
  console.log(`[smoke ${step}] ${message}`);
}

function sectionHeader(title) {
  console.log(`\n=== ${title} ===`);
}

function uuid() {
  return crypto.randomUUID();
}

let exitCode = 0;
try {
  sectionHeader("Step 1: put_in lands in store and bumps balance");
  const productId = "prd-smoke-" + uuid().slice(0, 8);
  const levelId = "level-smoke-" + uuid().slice(0, 8);
  const packageId1 = uuid();
  const operationId1 = uuid();

  const result1 = sync.applyUploadsPayload({
    package_id: packageId1,
    device_id: "device-smoke",
    device_name: "Smoke Device",
    operations: [
      {
        operation_id: operationId1,
        operation_type: "put_in",
        product_id: productId,
        qty: 7,
        source_location_type: "none",
        source_level_id: null,
        source_external_location_id: null,
        target_location_type: "warehouse",
        target_level_id: levelId,
        target_external_location_id: null,
        operator_name: "smoke",
        operated_at: new Date().toISOString(),
        note: "smoke put_in",
      },
    ],
  });

  log(1, JSON.stringify(result1));
  assert.equal(result1.operationsApplied, 1, "first put_in should apply");
  assert.equal(result1.operationsSkippedDuplicate, 0);
  assert.deepEqual(result1.operationsFailed, []);

  const opsAfter1 = dbStore.listAll("inventoryOperations");
  const matched = opsAfter1.find((o) => o && o.id === operationId1);
  assert.ok(matched, "inventory_operations row missing");
  assert.equal(matched.product_id, productId);
  assert.equal(matched.qty, 7);
  assert.equal(matched.target_level_id, levelId);
  assert.equal(matched.import_status, "imported");

  const balancesAfter1 = dbStore
    .listAll("inventoryBalances")
    .filter((b) => b && b.productId === productId && b.levelId === levelId);
  assert.equal(balancesAfter1.length, 1, "exactly one balance row expected");
  assert.equal(balancesAfter1[0].qty, 7);

  sectionHeader("Step 2: same package_id is idempotent");
  const result2 = sync.applyUploadsPayload({
    package_id: packageId1,
    device_id: "device-smoke",
    device_name: "Smoke Device",
    operations: [
      {
        operation_id: operationId1,
        operation_type: "put_in",
        product_id: productId,
        qty: 7,
        source_location_type: "none",
        source_level_id: null,
        source_external_location_id: null,
        target_location_type: "warehouse",
        target_level_id: levelId,
        target_external_location_id: null,
        operator_name: "smoke",
        operated_at: new Date().toISOString(),
        note: "smoke put_in retry",
      },
    ],
  });
  log(2, JSON.stringify(result2));
  assert.equal(result2.operationsApplied, 0, "retry must not re-apply");
  assert.equal(result2.operationsSkippedDuplicate, 1);
  assert.deepEqual(result2.operationsFailed, []);

  const balancesAfter2 = dbStore
    .listAll("inventoryBalances")
    .filter((b) => b && b.productId === productId && b.levelId === levelId);
  assert.equal(balancesAfter2.length, 1);
  assert.equal(balancesAfter2[0].qty, 7, "balance must remain at 7");

  sectionHeader("Step 3: same operation_id under new package = duplicate");
  const packageId2 = uuid();
  const result3 = sync.applyUploadsPayload({
    package_id: packageId2,
    device_id: "device-smoke",
    device_name: "Smoke Device",
    operations: [
      {
        operation_id: operationId1, // already imported above
        operation_type: "put_in",
        product_id: productId,
        qty: 7,
        source_location_type: "none",
        source_level_id: null,
        source_external_location_id: null,
        target_location_type: "warehouse",
        target_level_id: levelId,
        target_external_location_id: null,
        operator_name: "smoke",
        operated_at: new Date().toISOString(),
        note: "split retry",
      },
    ],
  });
  log(3, JSON.stringify(result3));
  assert.equal(result3.operationsApplied, 0);
  assert.equal(result3.operationsSkippedDuplicate, 1);

  sectionHeader("Step 4: insufficient source qty fails the op");
  const targetLevelId = "level-smoke-tgt-" + uuid().slice(0, 8);
  const result4 = sync.applyUploadsPayload({
    package_id: uuid(),
    device_id: "device-smoke",
    device_name: "Smoke Device",
    operations: [
      {
        operation_id: uuid(),
        operation_type: "move",
        product_id: productId,
        qty: 999, // more than the 7 we put in
        source_location_type: "warehouse",
        source_level_id: levelId,
        source_external_location_id: null,
        target_location_type: "warehouse",
        target_level_id: targetLevelId,
        target_external_location_id: null,
        operator_name: "smoke",
        operated_at: new Date().toISOString(),
        note: "smoke move overdraw",
      },
    ],
  });
  log(4, JSON.stringify(result4));
  assert.equal(result4.operationsApplied, 0);
  assert.equal(result4.operationsFailed.length, 1);
  assert.match(result4.operationsFailed[0].reason, /库存不足/);

  // Source balance should NOT have changed.
  const balanceAfter4 = dbStore
    .listAll("inventoryBalances")
    .find((b) => b && b.productId === productId && b.levelId === levelId);
  assert.equal(balanceAfter4 && balanceAfter4.qty, 7);
  // No new balance for the target level.
  const tgtBalance = dbStore
    .listAll("inventoryBalances")
    .find((b) => b && b.productId === productId && b.levelId === targetLevelId);
  assert.equal(tgtBalance, undefined);

  sectionHeader("Step 5: legitimate move shifts qty between locations");
  const movePackage = uuid();
  const moveOp = uuid();
  const result5 = sync.applyUploadsPayload({
    package_id: movePackage,
    device_id: "device-smoke",
    device_name: "Smoke Device",
    operations: [
      {
        operation_id: moveOp,
        operation_type: "move",
        product_id: productId,
        qty: 3,
        source_location_type: "warehouse",
        source_level_id: levelId,
        source_external_location_id: null,
        target_location_type: "warehouse",
        target_level_id: targetLevelId,
        target_external_location_id: null,
        operator_name: "smoke",
        operated_at: new Date().toISOString(),
        note: "smoke move ok",
      },
    ],
  });
  log(5, JSON.stringify(result5));
  assert.equal(result5.operationsApplied, 1);

  const srcAfter5 = dbStore
    .listAll("inventoryBalances")
    .find((b) => b && b.productId === productId && b.levelId === levelId);
  const tgtAfter5 = dbStore
    .listAll("inventoryBalances")
    .find((b) => b && b.productId === productId && b.levelId === targetLevelId);
  assert.equal(srcAfter5.qty, 4, "source should drop from 7 to 4");
  assert.equal(tgtAfter5.qty, 3, "target should rise from 0 to 3");

  sectionHeader("Step 6: master-store branch still works alongside operations");
  const result6 = sync.applyUploadsPayload({
    products: [
      {
        id: "prd-smoke-extra",
        model: "SMOKE-1",
        modelNormalized: "SMOKE1",
        status: "active",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    package_id: uuid(),
    operations: [],
  });
  log(6, JSON.stringify(result6));
  assert.equal(result6.applied.products, 1);
  assert.equal(result6.operationsApplied, 0);
  assert.deepEqual(result6.operationsFailed, []);

  console.log("\nSmoke test PASSED ✅");
} catch (err) {
  console.error("\nSmoke test FAILED ❌");
  console.error(err);
  exitCode = 1;
} finally {
  try {
    dbStore.close();
  } catch {
    // ignore
  }
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // ignore
  }
  process.exit(exitCode);
}
