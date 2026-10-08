// Build replaces the asset list and app-content hash. No API/auth response is
// cached: only these exact static URLs under this application's scope qualify.
const CACHE_PREFIX = `budget-buddy:${new URL(self.registration.scope).pathname}:`;
const CACHE_NAME = CACHE_PREFIX + "0.1.0-dev";
const APP_SHELL = ["./", "./index.html", "./styles.css", "./app.js", "./config.js", "./manifest.webmanifest", "./icons/logo-icon.svg", "./icons/logo-icon.png"];
const allowed = new Set(APP_SHELL.map((asset) => new URL(asset, self.registration.scope).href));
self.addEventListener("install", (event) => {
  event.waitUntil((async () => { const cache = await caches.open(CACHE_NAME); await cache.addAll(APP_SHELL); await self.skipWaiting(); })());
});
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME || key.startsWith("budget-buddy-shell-")).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || !allowed.has(event.request.url)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetch(event.request);
      if (response.ok && response.type !== "opaque") {
        await cache.put(event.request, response.clone());
        return response;
      }
      return await cache.match(event.request) || response;
    } catch (error) {
      const cached = await cache.match(event.request);
      if (cached) return cached;
      // Never send HTML in place of JS, images or API JSON.
      throw error;
    }
  })());
});
