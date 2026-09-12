const CACHE_NAME = 'dollar-to-lira-pwa-0056';
const CACHE_PREFIX = 'dollar-to-lira-pwa-';
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
  event.waitUntil((async () => {
    const keys = await caches.keys();
    const hadPreviousAppCache = keys.some(
      (key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME
    );

    await Promise.all(
      keys
        .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
        .map((key) => caches.delete(key))
    );
    await self.clients.claim();

    // Existing tabs / installed PWAs may still be executing an older bundle.
    // On a real upgrade, navigate them once after the new worker is active.
    if (hadPreviousAppCache) {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      await Promise.all(windows.map(async (client) => {
        try {
          if (typeof client.navigate === 'function') {
            await client.navigate(client.url);
          } else {
            client.postMessage({ type: 'DTL_UPDATE_READY', build: CACHE_NAME.slice(CACHE_PREFIX.length) });
          }
        } catch (_) {
          try {
            client.postMessage({ type: 'DTL_UPDATE_READY', build: CACHE_NAME.slice(CACHE_PREFIX.length) });
          } catch (_) {}
        }
      }));
    }
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'DTL_SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'DTL_GET_BUILD') {
    event.source?.postMessage?.({
      type: 'DTL_BUILD',
      build: CACHE_NAME.slice(CACHE_PREFIX.length)
    });
  }
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
        return await put(request, await fetch(request, { cache: 'no-store' }));
      } catch (_) {
        throw new Error('offline');
      }
    })());
    return;
  }

  event.respondWith((async () => {
    try {
      return await put(request, await fetch(request, { cache: 'no-store' }));
    } catch (_) {
      const cached = await caches.match(request);
      if (cached) return cached;
      if (isNavigation) return caches.match('./index.html');
      throw new Error('offline');
    }
  })());
});
