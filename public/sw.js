// Hot Cocoa service worker — offline app shell (Phase 4, see OFFLINE.md).
//
// Caches the app shell (the /write document + Next's hashed static assets) so the
// editor cold-opens with no network. The app's own IndexedDB layer (offlineQueue
// + offlineCache) supplies book content offline; this worker only makes the app
// itself reachable.
//
// What is deliberately NEVER cached, so it always hits the network and fails
// cleanly offline (which the app's offline handling expects):
//   - Supabase auth + data (cross-origin) — passed straight through.
//   - Same-origin /api/* routes — dynamic, never served stale.
//   - Any non-GET request (writes).
//
// Hand-written rather than Serwist/Workbox because those require webpack and this
// app builds with Turbopack.

const CACHE = "hotcocoa-shell-v1";
// The shell entry, precached so /write can cold-open offline even if it hasn't
// been visited since install. Hashed asset URLs change per build, so those are
// cached at runtime as they're requested instead of precached here.
const PRECACHE = ["/write"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE).catch(() => {})));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop caches from older versions so a shell update fully replaces the old one.
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // writes — never cache, let them hit network
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // Supabase & other cross-origin → network only
  if (url.pathname.startsWith("/api/")) return; // dynamic app endpoints → network only

  // Navigations: network-first so an online user always gets the freshest shell
  // (and we refresh the cache), falling back to the cached shell when offline.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(request);
          const cache = await caches.open(CACHE);
          cache.put(request, res.clone());
          return res;
        } catch {
          const cache = await caches.open(CACHE);
          return (await cache.match(request)) || (await cache.match("/write")) || Response.error();
        }
      })()
    );
    return;
  }

  // Same-origin static assets (hashed, immutable): cache-first, populating the
  // cache on first fetch so later loads work offline.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
      try {
        const res = await fetch(request);
        if (res.ok) cache.put(request, res.clone());
        return res;
      } catch {
        return cached || Response.error();
      }
    })()
  );
});
