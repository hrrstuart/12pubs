// Service worker: makes 12 Pubs installable and lets the app shell open on bad pub signal.
// Network first, so a new deploy shows up straight away; the cache is only a fallback.
// Live game traffic (/socket.io) and the API never touch the cache.
const CACHE = "12pubs-v5";
const SHELL = [
  "/", "/css/styles.css", "/js/app.js", "/js/api.js", "/js/recap.js", "/js/photos.js", "/vendor/qrcode.mjs", "/manifest.webmanifest",
  "/fonts/fredoka-latin-500-normal.woff2", "/fonts/fredoka-latin-600-normal.woff2", "/fonts/fredoka-latin-700-normal.woff2",
  "/fonts/nunito-latin-600-normal.woff2", "/fonts/nunito-latin-700-normal.woff2", "/fonts/nunito-latin-800-normal.woff2",
  "/icons/icon-192.png", "/rules",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/socket.io") || url.pathname.startsWith("/api/") || url.pathname === "/healthz") return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || (e.request.mode === "navigate" ? caches.match("/") : Response.error())))
  );
});
