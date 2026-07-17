const CACHE_VERSION = "vognary-static-v1";
const OFFLINE_URL = "/offline";
const INSTALL_ASSETS = [
  OFFLINE_URL,
  "/pwa/icon-192.png",
  "/pwa/icon-512.png",
  "/pwa/icon-maskable-512.png",
  "/brand/vognary-mark.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll(INSTALL_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("vognary-") && key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  if (!isPublicStaticAsset(url.pathname)) return;
  event.respondWith(staleWhileRevalidateStatic(request));
});

function isPublicStaticAsset(pathname) {
  return pathname.startsWith("/_next/static/")
    || pathname.startsWith("/brand/")
    || pathname.startsWith("/pwa/")
    || pathname === "/favicon.ico"
    || pathname === "/icon.svg"
    || pathname === "/apple-icon";
}

async function staleWhileRevalidateStatic(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);
  const refresh = fetch(request).then(async (response) => {
    if (isCacheableStaticResponse(response)) await cache.put(request, response.clone());
    return response;
  });
  if (cached) {
    void refresh.catch(() => undefined);
    return cached;
  }
  return refresh;
}

function isCacheableStaticResponse(response) {
  if (!response.ok || response.type !== "basic") return false;
  const cacheControl = response.headers.get("cache-control") ?? "";
  const contentType = response.headers.get("content-type") ?? "";
  return !/(private|no-store)/i.test(cacheControl) && !/application\/json/i.test(contentType);
}
