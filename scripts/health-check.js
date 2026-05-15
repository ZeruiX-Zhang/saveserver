const http = require("http");
const path = require("path");
const { start, server } = require(path.join("..", "server.js"));

const port = Number(process.env.HEALTH_CHECK_PORT || 4174);

const targets = [
  "/index.html",
  "/styles.css",
  "/manifest.webmanifest",
  "/src/app.js",
  "/src/storage.js",
  "/src/seed.js",
  "/src/utils.js",
];

function fetchTarget(target) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}${target}`, (response) => {
      response.resume();
      response.on("end", () => resolve({ target, status: response.statusCode }));
    }).on("error", reject);
  });
}

async function run() {
  start(port);
  await new Promise((resolve) => setTimeout(resolve, 400));
  const results = [];
  for (const target of targets) {
    results.push(await fetchTarget(target));
  }
  results.forEach((item) => {
    console.log(`${item.target} => ${item.status}`);
  });
  const failed = results.filter((item) => item.status !== 200);
  server.close(() => {
    process.exit(failed.length ? 1 : 0);
  });
}

run().catch((error) => {
  console.error(`health-check failed: ${error.message}`);
  try {
    server.close(() => process.exit(1));
  } catch {
    process.exit(1);
  }
});
