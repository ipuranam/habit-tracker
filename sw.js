/* ============================================================
   sw.js — service worker for offline use.

   Strategy: "cache-first" for our own app files (an app shell).
   Bump CACHE_VERSION whenever you change files so phones pull the
   new version; the activate step deletes old caches.
   ============================================================ */
const CACHE_VERSION = "tracker-v16";
const APP_SHELL = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/util.js",
  "./js/config.js",
  "./js/store.js",
  "./js/fasting.js",
  "./js/tracking.js",
  "./js/gcal.js",
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

// Network-first for our OWN files: always try the network so updates land
// immediately when online, and fall back to the cache only when offline.
// Cross-origin requests (Google sign-in / Calendar API) pass straight through.
self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  if (new URL(req.url).origin !== self.location.origin) return; // don't touch Google etc.
  event.respondWith(
    fetch(req).then(resp => {
      if (resp && resp.ok) {
        const copy = resp.clone();
        caches.open(CACHE_VERSION).then(c => c.put(req, copy));
      }
      return resp;
    }).catch(() =>
      caches.match(req).then(c => c || (req.mode === "navigate" ? caches.match("./index.html") : undefined))
    )
  );
});
