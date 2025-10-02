const APP_VERSION = '20250203';
const PRECACHE_CACHE = `allincompassing-precache-${APP_VERSION}`;
const RUNTIME_CACHE = `allincompassing-runtime-${APP_VERSION}`;
const IMMUTABLE_CACHE = `allincompassing-immutable-${APP_VERSION}`;
const FONT_CACHE = `allincompassing-fonts-${APP_VERSION}`;
const IMAGE_CACHE = `allincompassing-images-${APP_VERSION}`;
const API_CACHE = `allincompassing-api-${APP_VERSION}`;
const PRECACHE_URLS = ['/', '/index.html', '/offline.html', '/manifest.webmanifest'];
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(PRECACHE_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const cacheKeys = await caches.keys();
      await Promise.all(
        cacheKeys
          .filter((key) => !key.includes(APP_VERSION))
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

const isHashedAsset = (url) => {
  return /\/assets\/.+\.[a-f0-9]{8,}\.(js|css|mjs|woff2|png|jpe?g|svg|webp)$/.test(url.pathname);
};

const isJsonRequest = (request) => {
  const acceptHeader = request.headers.get('accept') || '';
  return request.destination === '' && acceptHeader.includes('application/json');
};

const cacheFirst = async (request, cacheName) => {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }
  const networkResponse = await fetch(request);
  if (networkResponse && networkResponse.status === 200) {
    cache.put(request, networkResponse.clone());
  }
  return networkResponse;
};

const staleWhileRevalidate = async (request, cacheName) => {
  const cache = await caches.open(cacheName);
  const cachedResponsePromise = cache.match(request);
  const networkResponsePromise = fetch(request)
    .then((response) => {
      if (response && response.status === 200) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  const cachedResponse = await cachedResponsePromise;
  return cachedResponse || networkResponsePromise;
};

const networkFirst = async (request, cacheName) => {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }
    throw error;
  }
};

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(RUNTIME_CACHE).then((cache) => cache.put('/index.html', copy));
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(RUNTIME_CACHE);
          const cachedShell = await cache.match('/index.html');
          if (cachedShell) {
            return cachedShell;
          }
          return caches.match(OFFLINE_URL);
        }),
    );
    return;
  }

  if (isJsonRequest(request) || url.pathname.startsWith('/api/')) {
    event.respondWith(
      networkFirst(request, API_CACHE).catch(async () => {
        const fallback = await caches.match(OFFLINE_URL);
        return fallback || Response.error();
      }),
    );
    return;
  }

  if (request.destination === 'font' || url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(staleWhileRevalidate(request, FONT_CACHE));
    return;
  }

  if (request.destination === 'image') {
    event.respondWith(staleWhileRevalidate(request, IMAGE_CACHE));
    return;
  }

  if (isHashedAsset(url)) {
    event.respondWith(cacheFirst(request, IMMUTABLE_CACHE));
    return;
  }

  if (request.destination === 'style' || request.destination === 'script') {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
  }
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
