// ==========================================================================
// BlaBlaNotes — Service Worker (offline-first)
// Bump CACHE_VERSION on every release so clients pick up the new shell.
// ==========================================================================

const CACHE_VERSION = 'v2';
const CACHE_NAME = `blablanotes-${CACHE_VERSION}`;

/**
 * The complete app shell. Every ES module is listed explicitly because the
 * browser resolves imports at runtime and the worker never sees them
 * otherwise, which would leave the app broken offline.
 */
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './css/main.css',
  './js/main.js',
  './js/app.js',
  './js/state/store.js',
  './js/state/storage.js',
  './js/services/voiceService.js',
  './js/services/commandParser.js',
  './js/services/wakeWord.js',
  './js/services/acousticTrigger.js',
  './js/services/shareService.js',
  './js/services/pwa.js',
  './js/ui/render.js',
  './js/ui/modal.js',
  './js/ui/toast.js',
  './js/ui/voiceButton.js',
  './js/ui/shareFab.js',
  './js/ui/dashboardTheme.js',
  './js/utils/colors.js',
  './js/utils/id.js',
  './js/utils/text.js',
  './assets/icons/icon-192x192.png',
  './assets/icons/icon-512x512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // Cached one by one: a single missing file must not abort the install.
      Promise.all(
        PRECACHE_URLS.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch((error) => {
            console.warn('[SW] No se pudo precachear', url, error);
          })
        )
      )
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

/** Network-first: keeps navigations fresh, falls back to the cached shell. */
async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request)) || (await cache.match('./index.html')) || Response.error();
  }
}

/** Stale-while-revalidate: instant from cache, refreshed in the background. */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  return cached || (await network) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Third-party URLs (wa.me, mailto handlers…) are left to the network.
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});
