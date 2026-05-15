const CACHE_NAME = "warehouse-pwa-shell-v20260506-bypass-api";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./assets/icon.svg",
  "./src/app.js",
  "./src/storage.js",
  "./src/seed.js",
  "./src/utils.js",
  "./src/detectors.js",
  "./src/themes.js",
  "./src/scanner.js",
  "./src/search.js",
  "./vendor/xlsx.full.min.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
    )),
  );
  self.clients.claim();
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const url = new URL(event.request.url);
  const isSameOrigin = url.origin === self.location.origin;

  // API calls must always hit the network with their own headers (auth tokens,
  // fresh data). Caching them would return stale data after writes and would
  // also let a wrong-token request reuse a previous right-token 200.
  if (isSameOrigin && url.pathname.startsWith("/api/")) {
    return;
  }

  const isAppShellRequest =
    isSameOrigin &&
    (
      event.request.mode === "navigate" ||
      ["script", "style", "document", "manifest"].includes(event.request.destination)
    );

  event.respondWith(
    (isAppShellRequest
      ? fetch(event.request)
          .then((response) => {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
            return response;
          })
          .catch(() => caches.match(event.request).then((cached) => cached || caches.match("./index.html")))
      : caches.match(event.request).then((cached) => {
          if (cached) {
            return cached;
          }
          return fetch(event.request).then((response) => {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
            return response;
          }).catch(() => caches.match("./index.html"));
        })),
  );
});
