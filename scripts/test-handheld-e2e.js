// scripts/test-handheld-e2e.js
//
// End-to-end smoke test for the handheld → desktop LAN upload flow.
//
// What this script does, with NO device dependency:
//
//   1. Picks a free TCP port and points server.js at a fresh temp DB +
//      pre-seeded sync token (so we don't touch real data).
//   2. Spawns `node server.js` as a child process.
//   3. Drives a simulated handheld through the full happy path:
//        GET  /api/sync/ping          → expect 200, { ok: true }
//        GET  /api/sync/master-data   → expect 200 with 8 store arrays
//        POST /api/sync/upload        → put_in Operation_Package, expect
//                                        operationsApplied=1, no failures
//        POST /api/sync/upload (same  → expect operationsApplied=0,
//             package_id again)         operationsSkippedDuplicate=1
//   4. Reads the SQLite DB directly via better-sqlite3 to verify that
//      inventory_operations got a new row and inventory_balances reflects
//      the put_in qty. Re-probes after the second upload to confirm no
//      double-write (package-level idempotency, R18.3).
//   5. Tears down the server and removes the temp dir.
//
// Validates: Requirements 12.1, 12.2, 12.3, 18.3
//
// Usage:    node scripts/test-handheld-e2e.js
// Exit:     0 on success, 1 on any assertion failure or unexpected error.

const fs = require("fs");
const os = require("os");
const net = require("net");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { pathToFileURL } = require("node:url");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nowMs() {
  return Number(process.hrtime.bigint() / 1_000_000n);
}

function logStep(name, startedAt, extra = "") {
  const elapsed = nowMs() - startedAt;
  const tail = extra ? ` ${extra}` : "";
  console.log(`[e2e] ${name} ✓ (${elapsed} ms)${tail}`);
}

function assertOk(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function sleep(durationMs) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

/**
 * Reserve a free port by listening on 0, reading the assigned port, then
 * closing immediately. There is a tiny race between close and the child
 * process binding, but in practice it's reliable on a quiescent dev box.
 */
function pickFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

/** Poll /api/sync/ping until 200 or timeout. */
async function waitForReady(url, headers, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { headers });
      if (res.status === 200) {
        return;
      }
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    await sleep(150);
  }
  throw new Error(
    `Server did not become ready within ${timeoutMs} ms: ${lastErr && lastErr.message}`,
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const repoRoot = path.resolve(__dirname, "..");
  const serverPath = path.join(repoRoot, "server.js");

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "warehouse-e2e-"));
  const dbPath = path.join(tmpRoot, "warehouse.db");
  const tokenPath = path.join(tmpRoot, "sync-token.txt");

  // Pre-seed the sync token so the simulated handheld can auth on the very
  // first request. server.js will read this file instead of regenerating.
  const syncToken = crypto.randomBytes(24).toString("hex");
  fs.writeFileSync(tokenPath, syncToken, "utf-8");

  const port = await pickFreePort();
  const apiBase = `http://127.0.0.1:${port}`;

  const serverEnv = {
    ...process.env,
    PORT: String(port),
    HOST: "127.0.0.1",
    WAREHOUSE_DB_PATH: dbPath,
    WAREHOUSE_TOKEN_PATH: tokenPath,
  };

  console.log(`[e2e] tmp=${tmpRoot}`);
  console.log(`[e2e] apiBase=${apiBase}`);

  const child = spawn(process.execPath, [serverPath], {
    cwd: repoRoot,
    env: serverEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });

  // Surface server output for debugging on failure.
  child.stdout.on("data", (chunk) =>
    process.stdout.write(`[server] ${chunk.toString().trimEnd()}\n`),
  );
  child.stderr.on("data", (chunk) =>
    process.stderr.write(`[server-err] ${chunk.toString().trimEnd()}\n`),
  );

  let exitCode = 0;
  try {
    const headers = {
      "X-Sync-Token": syncToken,
      "Content-Type": "application/json",
    };

    // ───── Step A: boot + ping ────────────────────────────────────────────
    let t = nowMs();
    await waitForReady(`${apiBase}/api/sync/ping`, headers);
    const pingRes = await fetch(`${apiBase}/api/sync/ping`, { headers });
    assertOk(pingRes.status === 200, `ping HTTP=${pingRes.status}`);
    const pingBody = await pingRes.json();
    assertOk(pingBody.ok === true, `ping body.ok !== true: ${JSON.stringify(pingBody)}`);
    logStep("A. server boot + ping", t);

    // ───── Step B: master-data ───────────────────────────────────────────
    t = nowMs();
    const masterRes = await fetch(`${apiBase}/api/sync/master-data`, { headers });
    assertOk(masterRes.status === 200, `master-data HTTP=${masterRes.status}`);
    const masterBody = await masterRes.json();
    assertOk(masterBody && typeof masterBody.data === "object", "master-data missing .data");
    const expectedStores = [
      "products",
      "customFieldDefinitions",
      "productCustomFieldValues",
      "warehouses",
      "shelves",
      "shelfLevels",
      "externalLocations",
      "inventoryBalances",
    ];
    for (const store of expectedStores) {
      assertOk(
        Array.isArray(masterBody.data[store]),
        `master-data.${store} is not an array (got ${typeof masterBody.data[store]})`,
      );
    }
    logStep("B. master-data", t, `(${expectedStores.length} stores)`);

    // ───── Step C: build put_in Operation_Package via shared modules ─────
    t = nowMs();
    // app/shared/* is ESM, this script is CommonJS — bridge with dynamic
    // import + pathToFileURL so it works the same on Windows and POSIX.
    const opBuilders = await import(
      pathToFileURL(path.join(repoRoot, "app", "shared", "op-builders.js")).href
    );
    const packageBuilder = await import(
      pathToFileURL(path.join(repoRoot, "app", "shared", "package-builder.js")).href
    );

    const productId = crypto.randomUUID();
    const targetLevelId = crypto.randomUUID();
    const deviceId = crypto.randomUUID();
    const qty = 5;

    const op = opBuilders.buildPutIn({
      productId,
      qty,
      targetLevelId,
      operatorName: "e2e-runner",
      note: "handheld e2e put_in",
    });

    const pkg = packageBuilder.buildOperationPackage({
      deviceId,
      deviceName: "E2E Handheld",
      operations: [op],
      baseMasterPackageId: null,
    });
    logStep(
      "C. build Operation_Package",
      t,
      `package_id=${pkg.package_id} operation_id=${op.operation_id}`,
    );

    // ───── Step D: first upload (apply) ──────────────────────────────────
    t = nowMs();
    const upload1Res = await fetch(`${apiBase}/api/sync/upload`, {
      method: "POST",
      headers,
      body: JSON.stringify(pkg),
    });
    assertOk(upload1Res.status === 200, `upload#1 HTTP=${upload1Res.status}`);
    const upload1Body = await upload1Res.json();
    assertOk(upload1Body.ok === true, `upload#1 body.ok !== true: ${JSON.stringify(upload1Body)}`);
    assertOk(
      upload1Body.operationsApplied === 1,
      `upload#1 operationsApplied=${upload1Body.operationsApplied}, expected 1`,
    );
    assertOk(
      upload1Body.operationsSkippedDuplicate === 0,
      `upload#1 operationsSkippedDuplicate=${upload1Body.operationsSkippedDuplicate}, expected 0`,
    );
    assertOk(
      Array.isArray(upload1Body.operationsFailed) && upload1Body.operationsFailed.length === 0,
      `upload#1 operationsFailed=${JSON.stringify(upload1Body.operationsFailed)}`,
    );
    logStep("D. upload #1 (apply)", t);

    // ───── Step E: SQLite probe — operation + balance landed ─────────────
    t = nowMs();
    const Database = require("better-sqlite3");
    const probe1 = new Database(dbPath, { readonly: true });
    let opRowCount = 0;
    let balanceQty = null;
    try {
      const opRows = probe1
        .prepare("SELECT payload FROM kv_inventory_operations")
        .all()
        .map((r) => JSON.parse(r.payload));
      opRowCount = opRows.length;
      const matchedOp = opRows.find((r) => r && r.id === op.operation_id);
      assertOk(
        matchedOp,
        `inventory_operations missing row for operation_id=${op.operation_id} (rows=${opRowCount})`,
      );
      assertOk(
        matchedOp.product_id === productId,
        `operation row product_id=${matchedOp.product_id}, expected ${productId}`,
      );
      assertOk(
        matchedOp.qty === qty,
        `operation row qty=${matchedOp.qty}, expected ${qty}`,
      );
      assertOk(
        matchedOp.target_level_id === targetLevelId,
        `operation row target_level_id=${matchedOp.target_level_id}, expected ${targetLevelId}`,
      );
      assertOk(
        matchedOp.import_status === "imported",
        `operation row import_status=${matchedOp.import_status}, expected "imported"`,
      );

      const balanceRows = probe1
        .prepare("SELECT payload FROM kv_inventory_balances")
        .all()
        .map((r) => JSON.parse(r.payload))
        .filter((b) => b && b.productId === productId && b.levelId === targetLevelId);
      assertOk(
        balanceRows.length === 1,
        `inventory_balances rows for (product, level) = ${balanceRows.length}, expected 1`,
      );
      balanceQty = balanceRows[0].qty;
      assertOk(balanceQty === qty, `balance qty=${balanceQty}, expected ${qty}`);
    } finally {
      probe1.close();
    }
    logStep("E. SQLite probe", t, `ops=${opRowCount}, balance.qty=${balanceQty}`);

    // ───── Step F: idempotent re-upload ──────────────────────────────────
    t = nowMs();
    const upload2Res = await fetch(`${apiBase}/api/sync/upload`, {
      method: "POST",
      headers,
      body: JSON.stringify(pkg),
    });
    assertOk(upload2Res.status === 200, `upload#2 HTTP=${upload2Res.status}`);
    const upload2Body = await upload2Res.json();
    assertOk(upload2Body.ok === true, `upload#2 body.ok !== true: ${JSON.stringify(upload2Body)}`);
    assertOk(
      upload2Body.operationsApplied === 0,
      `upload#2 operationsApplied=${upload2Body.operationsApplied}, expected 0`,
    );
    assertOk(
      upload2Body.operationsSkippedDuplicate === 1,
      `upload#2 operationsSkippedDuplicate=${upload2Body.operationsSkippedDuplicate}, expected 1`,
    );
    assertOk(
      Array.isArray(upload2Body.operationsFailed) && upload2Body.operationsFailed.length === 0,
      `upload#2 operationsFailed=${JSON.stringify(upload2Body.operationsFailed)}`,
    );
    logStep("F. upload #2 (idempotent)", t);

    // ───── Step G: re-probe SQLite — no double-write ─────────────────────
    t = nowMs();
    const probe2 = new Database(dbPath, { readonly: true });
    try {
      const opCountRow = probe2
        .prepare("SELECT COUNT(*) AS c FROM kv_inventory_operations WHERE id = ?")
        .get(op.operation_id);
      assertOk(
        opCountRow.c === 1,
        `operation row count after re-upload = ${opCountRow.c}, expected 1`,
      );

      const balanceRows = probe2
        .prepare("SELECT payload FROM kv_inventory_balances")
        .all()
        .map((r) => JSON.parse(r.payload))
        .filter((b) => b && b.productId === productId && b.levelId === targetLevelId);
      assertOk(
        balanceRows.length === 1,
        `balance rows after re-upload = ${balanceRows.length}, expected 1`,
      );
      assertOk(
        balanceRows[0].qty === qty,
        `balance qty after re-upload = ${balanceRows[0].qty}, expected ${qty}`,
      );
    } finally {
      probe2.close();
    }
    logStep("G. SQLite re-probe (no double-write)", t);

    console.log("\n[e2e] all steps PASSED ✅");
  } catch (err) {
    console.error("\n[e2e] FAILED ❌");
    console.error(err && err.stack ? err.stack : err);
    exitCode = 1;
  } finally {
    // Tear down the server. On Windows, child.kill() always force-terminates
    // so SIGTERM/SIGKILL semantics are best-effort cross-platform.
    if (child && !child.killed) {
      try {
        child.kill("SIGTERM");
      } catch {
        // ignore
      }
      const closed = await Promise.race([
        new Promise((resolve) => child.once("exit", () => resolve("exit"))),
        sleep(1500).then(() => "timeout"),
      ]);
      if (closed === "timeout") {
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore
        }
      }
    }
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      // Windows may briefly hold file locks; non-fatal for the test result.
    }
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error("[e2e] unexpected:", err);
  process.exit(1);
});
