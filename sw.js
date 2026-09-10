const CACHE_NAME = 'dollar-to-lira-pwa-0056';
const APP_SHELL = [
  './',
  './index.html',
  './publish.html',
  './styles.css?v=20260906-1140',
  './pwa-mobile-20260906.css?v=20260906-1140',
  './manifest.webmanifest?v=20260906-1141',
  './icon-dollar-lira.svg?v=20260906-1141',
  './runtime-20260906-1140.js?v=20260911-0056'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

const put = async (request, response) => {
  if (response && response.ok) {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  }
  return response;
};

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isNavigation = request.mode === 'navigate';
  const isData = url.pathname.includes('/data/');
  const isRuntime = /\/runtime-[^/]+\.js$/.test(url.pathname);
  const isImmutableAsset = !isNavigation && !isData && !isRuntime && /\.(?:js|css|svg|webmanifest)$/.test(url.pathname);

  if (isRuntime) {
    event.respondWith((async () => {
      try {
        return await put(request, await fetch(request, { cache: 'no-store' }));
      } catch (_) {
        const cached = await caches.match(request);
        if (cached) return cached;
        throw new Error('offline');
      }
    })());
    return;
  }

  if (isImmutableAsset) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      try {
        return await put(request, await fetch(request));
      } catch (_) {
        throw new Error('offline');
      }
    })());
    return;
  }

  event.respondWith((async () => {
    try {
      return await put(request, await fetch(request));
    } catch (_) {
      const cached = await caches.match(request);
      if (cached) return cached;
      if (isNavigation) return caches.match('./index.html');
      throw new Error('offline');
    }
  })());
});
