/* ============================================================
   sw.js — service worker for offline use.

   Strategy: "cache-first" for our own app files (an app shell).
   Bump CACHE_VERSION whenever you change files so phones pull the
   new version; the activate step deletes old caches.
   ============================================================ */
const CACHE_VERSION = "tracker-v7";
const APP_SHELL = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/util.js",
  "./js/config.js",
  "./js/store.js",
  "./js/fasting.js",
  "./js/tracking.js",
  "./js/app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-180.png",
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(resp => {
        // Cache same-origin successful responses for next time.
        if (resp.ok && new URL(event.request.url).origin === self.location.origin) {
          const copy = resp.clone();
          caches.open(CACHE_VERSION).then(c => c.put(event.request, copy));
        }
        return resp;
      }).catch(() => cached);
    })
  );
});
