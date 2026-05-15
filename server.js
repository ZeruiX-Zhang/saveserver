const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const dbStore = require("./database/db.js");
const sync = require("./sync.js");
const phash = require("./scripts/phash.js");

const fsp = fs.promises;
const root = path.join(__dirname, "app");
const bridgeScript = path.join(__dirname, "scripts", "excel_bridge.py");
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "0.0.0.0";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

const noCacheHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

// CORS for PWA / Android clients fetching from a different origin (e.g.
// installed-to-home-screen apps with internal scheme). Wide-open is fine for
// a private LAN deployment — auth on /api/sync/* is enforced via X-Sync-Token.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Sync-Token, Authorization",
  "Access-Control-Max-Age": "600",
};

const pythonCandidates = [
  process.env.WAREHOUSE_APP_PYTHON,
  process.env.PYTHON,
  "python",
  "py",
].filter(Boolean);

function sendError(response, statusCode, message) {
  if (response.headersSent) {
    response.end();
    return;
  }
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    ...noCacheHeaders,
    ...corsHeaders,
  });
  response.end(message);
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(stderr.trim() || stdout.trim() || `Excel bridge failed (${code}).`));
    });
  });
}

async function runExcelBridge(mode, inputFile, outputFile) {
  let lastError = null;

  if (!fs.existsSync(bridgeScript)) {
    throw new Error("Excel bridge script is missing.");
  }

  for (const candidate of pythonCandidates) {
    const args = candidate.toLowerCase().endsWith("py") ? ["-3", bridgeScript, mode, inputFile, outputFile] : [bridgeScript, mode, inputFile, outputFile];
    try {
      await runProcess(candidate, args);
      return;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("No Python runtime available for Excel import/export.");
}

async function cleanupFiles(paths) {
  await Promise.all(paths.map(async (targetPath) => {
    if (!targetPath) {
      return;
    }
    try {
      await fsp.unlink(targetPath);
    } catch {
      // ignore cleanup failures
    }
  }));
}

async function handleExcelExport(request, response) {
  const body = await readRequestBody(request);
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const jsonPath = path.join(os.tmpdir(), `warehouse-export-${stamp}.json`);
  const xlsxPath = path.join(os.tmpdir(), `warehouse-export-${stamp}.xlsx`);

  try {
    await fsp.writeFile(jsonPath, body);
    await runExcelBridge("export", jsonPath, xlsxPath);
    const workbook = await fsp.readFile(xlsxPath);
    const filename = `warehouse-export-${new Date().toISOString().slice(0, 10)}.xlsx`;
    response.writeHead(200, {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
      ...noCacheHeaders,
    });
    response.end(workbook);
  } finally {
    await cleanupFiles([jsonPath, xlsxPath]);
  }
}

async function handleImportTemplate(request, response) {
  const body = await readRequestBody(request);
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const jsonPath = path.join(os.tmpdir(), `warehouse-template-${stamp}.json`);
  const xlsxPath = path.join(os.tmpdir(), `warehouse-template-${stamp}.xlsx`);

  try {
    await fsp.writeFile(jsonPath, body);
    await runExcelBridge("template", jsonPath, xlsxPath);
    const workbook = await fsp.readFile(xlsxPath);
    const filename = `warehouse-import-template-${new Date().toISOString().slice(0, 10)}.xlsx`;
    response.writeHead(200, {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
      ...noCacheHeaders,
    });
    response.end(workbook);
  } finally {
    await cleanupFiles([jsonPath, xlsxPath]);
  }
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    ...noCacheHeaders,
    ...corsHeaders,
  });
  response.end(JSON.stringify(body));
}

async function readJsonBody(request) {
  const buffer = await readRequestBody(request);
  if (buffer.length === 0) {
    return undefined;
  }
  return JSON.parse(buffer.toString("utf-8"));
}

function mapDbError(error) {
  const message = String(error?.message || error || "Unknown error");
  if (message.startsWith("Unknown store:")) {
    return { status: 404, message };
  }
  if (message.startsWith("Record is missing required key")) {
    return { status: 400, message };
  }
  return { status: 500, message };
}

async function handleStoreRoute(request, response, segments) {
  // segments are the path parts after "/api/store"
  const [storeName, action] = segments;
  if (!storeName) {
    sendError(response, 400, "Missing store name");
    return true;
  }

  try {
    if (!action) {
      if (request.method === "GET") {
        sendJson(response, 200, dbStore.listAll(storeName));
        return true;
      }
      if (request.method === "DELETE") {
        dbStore.clearStore(storeName);
        sendJson(response, 200, { ok: true });
        return true;
      }
      sendError(response, 405, "Method not allowed");
      return true;
    }

    if (action === "count" && segments.length === 2) {
      if (request.method !== "GET") {
        sendError(response, 405, "Method not allowed");
        return true;
      }
      sendJson(response, 200, { count: dbStore.countStore(storeName) });
      return true;
    }

    if (action === "bulk" && segments.length === 2) {
      if (request.method !== "POST") {
        sendError(response, 405, "Method not allowed");
        return true;
      }
      const body = await readJsonBody(request);
      if (!Array.isArray(body)) {
        sendError(response, 400, "Bulk body must be an array");
        return true;
      }
      dbStore.bulkPut(storeName, body);
      sendJson(response, 200, { ok: true, count: body.length });
      return true;
    }

    // /api/store/:name/:id
    const id = action;
    if (request.method === "GET") {
      const record = dbStore.getOne(storeName, id);
      if (record === undefined) {
        sendJson(response, 404, { error: "Not found" });
        return true;
      }
      sendJson(response, 200, record);
      return true;
    }
    if (request.method === "PUT") {
      const body = await readJsonBody(request);
      if (!body || typeof body !== "object") {
        sendError(response, 400, "Body must be an object");
        return true;
      }
      const savedId = dbStore.putOne(storeName, body);
      sendJson(response, 200, { ok: true, id: savedId });
      return true;
    }
    if (request.method === "DELETE") {
      dbStore.removeOne(storeName, id);
      sendJson(response, 200, { ok: true });
      return true;
    }
    sendError(response, 405, "Method not allowed");
    return true;
  } catch (error) {
    const mapped = mapDbError(error);
    sendError(response, mapped.status, mapped.message);
    return true;
  }
}

async function handleReplaceStores(request, response) {
  if (request.method !== "POST") {
    sendError(response, 405, "Method not allowed");
    return;
  }
  try {
    const body = await readJsonBody(request);
    if (!body || typeof body !== "object") {
      sendError(response, 400, "Body must be an object");
      return;
    }
    dbStore.replaceStores(body);
    sendJson(response, 200, { ok: true });
  } catch (error) {
    const mapped = mapDbError(error);
    sendError(response, mapped.status, mapped.message);
  }
}

function handleExportAll(request, response) {
  if (request.method !== "GET") {
    sendError(response, 405, "Method not allowed");
    return;
  }
  try {
    sendJson(response, 200, dbStore.exportAll());
  } catch (error) {
    const mapped = mapDbError(error);
    sendError(response, mapped.status, mapped.message);
  }
}

async function handleSyncRoute(request, response, segments) {
  const [action] = segments;

  // /api/sync/token-info & /api/sync/server-info: used by the desktop UI
  // running on the same machine to surface the token and LAN addresses.
  // Restricted to localhost so a remote attacker can't read the token.
  if ((action === "token-info" || action === "server-info") && request.method === "GET") {
    const remote = request.socket.remoteAddress || "";
    const isLocal = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
    if (!isLocal) {
      sendError(response, 403, "Forbidden");
      return;
    }
    if (action === "token-info") {
      sendJson(response, 200, { token: sync.getOrCreateToken() });
      return;
    }
    const interfaces = os.networkInterfaces();
    const addresses = [];
    for (const [name, list] of Object.entries(interfaces)) {
      for (const entry of list || []) {
        if (entry.family === "IPv4" && !entry.internal) {
          addresses.push({ iface: name, address: entry.address });
        }
      }
    }
    sendJson(response, 200, {
      token: sync.getOrCreateToken(),
      hostname: os.hostname(),
      port,
      addresses,
    });
    return;
  }

  if (!sync.authorize(request)) {
    sendError(response, 401, "Unauthorized");
    return;
  }

  try {
    if (action === "ping" && request.method === "GET") {
      sendJson(response, 200, { ok: true, time: new Date().toISOString() });
      return;
    }

    if (action === "master-data" && request.method === "GET") {
      sendJson(response, 200, sync.buildMasterPayload());
      return;
    }

    if (action === "upload" && request.method === "POST") {
      const body = await readJsonBody(request);
      const counts = sync.applyUploadsPayload(body);
      sendJson(response, 200, { ok: true, applied: counts });
      return;
    }

    if (action === "export-package" && request.method === "GET") {
      const buffer = sync.exportMasterPackageBuffer();
      const filename = `warehouse-master-${new Date().toISOString().replace(/[:.]/g, "-")}.json.gz`;
      response.writeHead(200, {
        "Content-Type": "application/gzip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        ...noCacheHeaders,
      });
      response.end(buffer);
      return;
    }

    if (action === "import-package" && request.method === "POST") {
      const buffer = await readRequestBody(request);
      const counts = sync.importPackageBuffer(buffer);
      sendJson(response, 200, { ok: true, applied: counts });
      return;
    }

    sendError(response, 404, "Unknown sync action");
  } catch (error) {
    sendError(response, 400, String(error.message || error));
  }
}

async function handlePhashRoute(request, response, segments) {
  const [action] = segments;
  if (request.method !== "POST") {
    sendError(response, 405, "Method not allowed");
    return;
  }

  let body;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    sendError(response, 400, `Invalid JSON: ${error.message}`);
    return;
  }
  if (!body || typeof body !== "object") {
    sendError(response, 400, "JSON body required");
    return;
  }

  const buffer = phash.decodeImageInput(body.image);
  if (!buffer) {
    sendError(response, 400, "Could not decode image (empty / SVG placeholder / not base64)");
    return;
  }

  let queryHash;
  try {
    queryHash = await phash.computePhash(buffer);
  } catch (error) {
    sendError(response, 400, `Could not compute hash: ${error.message}`);
    return;
  }

  if (action === "index") {
    if (!body.productId) {
      sendError(response, 400, "productId required");
      return;
    }
    const imageIndex = Number(body.imageIndex || 0);
    dbStore.indexPhash(body.productId, imageIndex, queryHash);
    sendJson(response, 200, { ok: true, phash: queryHash, productId: body.productId, imageIndex });
    return;
  }

  if (action === "search") {
    const threshold = Math.max(0, Math.min(64, Number(body.threshold ?? 12)));
    const limit = Math.max(1, Math.min(100, Number(body.limit ?? 30)));
    const all = dbStore.listAllPhashes();
    const matches = [];
    for (const row of all) {
      const distance = phash.hammingDistance(queryHash, row.phash);
      if (distance <= threshold) {
        matches.push({ productId: row.product_id, imageIndex: row.image_index, distance });
      }
    }
    matches.sort((a, b) => a.distance - b.distance);
    sendJson(response, 200, {
      ok: true,
      queryPhash: queryHash,
      threshold,
      total: matches.length,
      results: matches.slice(0, limit),
    });
    return;
  }

  sendError(response, 404, "Unknown phash action");
}

async function handleExcelImport(request, response) {
  const body = await readRequestBody(request);
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const xlsxPath = path.join(os.tmpdir(), `warehouse-import-${stamp}.xlsx`);
  const jsonPath = path.join(os.tmpdir(), `warehouse-import-${stamp}.json`);

  try {
    await fsp.writeFile(xlsxPath, body);
    await runExcelBridge("import", xlsxPath, jsonPath);
    const payload = await fsp.readFile(jsonPath, "utf-8");
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      ...noCacheHeaders,
    });
    response.end(payload);
  } finally {
    await cleanupFiles([xlsxPath, jsonPath]);
  }
}

async function serveStatic(requestPath, response) {
  let filePath = path.join(root, requestPath === "/" ? "index.html" : requestPath);

  if (!filePath.startsWith(root)) {
    sendError(response, 403, "Forbidden");
    return;
  }

  let stats = null;
  try {
    stats = await fsp.stat(filePath);
  } catch {
    stats = null;
  }

  if (stats?.isDirectory()) {
    filePath = path.join(filePath, "index.html");
  }

  let data;
  try {
    data = await fsp.readFile(filePath);
  } catch {
    sendError(response, 404, "Not found");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  response.writeHead(200, {
    "Content-Type": mimeTypes[ext] || "application/octet-stream",
    ...noCacheHeaders,
  });
  response.end(data);
}

const server = http.createServer((request, response) => {
  (async () => {
    const requestPath = decodeURIComponent((request.url || "/").split("?")[0]);

    // CORS preflight: respond immediately with the allowed methods/headers.
    if (request.method === "OPTIONS") {
      response.writeHead(204, corsHeaders);
      response.end();
      return;
    }

    if (request.method === "POST" && requestPath === "/api/export-excel") {
      await handleExcelExport(request, response);
      return;
    }

    if (request.method === "POST" && requestPath === "/api/import-template") {
      await handleImportTemplate(request, response);
      return;
    }

    if (request.method === "POST" && requestPath === "/api/import-excel") {
      await handleExcelImport(request, response);
      return;
    }

    if (requestPath === "/api/replace-stores") {
      await handleReplaceStores(request, response);
      return;
    }

    if (requestPath === "/api/export-all") {
      handleExportAll(request, response);
      return;
    }

    if (requestPath.startsWith("/api/store/")) {
      const segments = requestPath
        .slice("/api/store/".length)
        .split("/")
        .filter(Boolean)
        .map((seg) => decodeURIComponent(seg));
      await handleStoreRoute(request, response, segments);
      return;
    }

    if (requestPath.startsWith("/api/sync/")) {
      const segments = requestPath
        .slice("/api/sync/".length)
        .split("/")
        .filter(Boolean)
        .map((seg) => decodeURIComponent(seg));
      await handleSyncRoute(request, response, segments);
      return;
    }

    if (requestPath.startsWith("/api/phash/")) {
      const segments = requestPath
        .slice("/api/phash/".length)
        .split("/")
        .filter(Boolean)
        .map((seg) => decodeURIComponent(seg));
      await handlePhashRoute(request, response, segments);
      return;
    }

    if (requestPath.startsWith("/api/")) {
      sendError(response, 405, "Method not allowed");
      return;
    }

    await serveStatic(requestPath, response);
  })().catch((error) => {
    sendError(response, 500, error.message || "Internal server error");
  });
});

function start(targetPort = port, targetHost = host) {
  return server.listen(targetPort, targetHost, () => {
    // eslint-disable-next-line no-console
    console.log(`Warehouse PWA server running at http://${targetHost}:${targetPort}`);
  });
}

if (require.main === module) {
  start();
}

module.exports = {
  server,
  start,
};
