const CACHE_NAME = 'cindy-v5';
const CORE_ASSETS = [
  './index.html',
  './app.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './mascot-happy.svg',
  './mascot-warn.svg',
  './storage-shim.js',
  './firebase-auth.js',
  './firestore-sync.js'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // Cache each core file individually (not cache.addAll) so a single
      // missing/renamed file doesn't abort caching of everything else.
      Promise.all(
        CORE_ASSETS.map((url) =>
          fetch(url).then((res) => {
            if (res && res.ok) return cache.put(url, res);
          }).catch(() => {})
        )
      )
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

/* Stale-while-revalidate: answer instantly from cache when we have it
 * (this is what makes repeat launches feel fast — no waiting on the
 * network for images, fonts, or the Firebase CDN scripts), while always
 * kicking off a background fetch to refresh the cache for NEXT time. This
 * keeps the "edit on GitHub Pages, app picks it up automatically" workflow
 * working — updates just show up one launch later instead of blocking the
 * current one. */
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(event.request).then((cached) => {
        const network = fetch(event.request)
          .then((res) => {
            if (res && (res.ok || res.type === 'opaque')) {
              cache.put(event.request, res.clone());
            }
            return res;
          })
          .catch(() => null);

        if (cached) {
          // Don't block on the network fetch — just let it update the
          // cache in the background for next time.
          network;
          return cached;
        }
        return network.then((res) => res || caches.match('./index.html'));
      })
    )
  );
});
