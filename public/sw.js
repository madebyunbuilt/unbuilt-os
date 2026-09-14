// Unbuilt OS service worker (14-platform.md, App shell): installable, with an offline page. No offline data editing,
// and no caching of app data: only the offline page and its brand assets are stored.

const CACHE = 'unbuilt-offline-v1';
const OFFLINE_URL = '/offline';
const PRECACHE = [OFFLINE_URL, '/icon.svg', '/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// Page loads go to the network; only when the network is unreachable does the offline page answer.
self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE_URL)));
});
