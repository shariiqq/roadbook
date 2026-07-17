/* Roadbook service worker — offline app shell + map tile caching */
const SHELL = 'roadbook-shell-v3';
const TILES = 'roadbook-tiles-v3';

const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './vendor/maplibre/maplibre-gl.js',
  './vendor/maplibre/maplibre-gl.css',
  './vendor/pmtiles/pmtiles.js',
  './vendor/pmtiles/pm-style.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL)
      .then((c) => c.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== SHELL && k !== TILES).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Map tiles: cache-first, then network (stores every tile we ever load)
  if (/tile\.openstreetmap\.org$/.test(url.hostname) || /tile\./.test(url.hostname)) {
    e.respondWith(
      caches.open(TILES).then(async (cache) => {
        const hit = await cache.match(e.request);
        if (hit) return hit;
        try {
          const res = await fetch(e.request);
          cache.put(e.request, res.clone());
          return res;
        } catch (err) {
          return hit || Response.error();
        }
      })
    );
    return;
  }

  // App shell: cache-first, fall back to network, then to index for navigations
  e.respondWith(
    caches.match(e.request).then((hit) => {
      if (hit) return hit;
      return fetch(e.request).catch(() => {
        if (e.request.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      });
    })
  );
});

// Let the page report how many tiles are cached / clear them
self.addEventListener('message', async (e) => {
  if (e.data === 'tileCount') {
    const cache = await caches.open(TILES);
    const keys = await cache.keys();
    e.source.postMessage({ type: 'tileCount', count: keys.length });
  }
  if (e.data === 'clearTiles') {
    await caches.delete(TILES);
    e.source.postMessage({ type: 'tilesCleared' });
  }
});
