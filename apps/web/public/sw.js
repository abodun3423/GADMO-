/*
 * GADMO service worker: makes repeat visits fast and shows a friendly page offline.
 * - Built JS/CSS (/_next/static, content-hashed) and icons: cache first.
 * - Pages: network first, falling back to the last copy, then to /offline.
 * - API calls (/v1/*) are NEVER cached: they carry private, changing data.
 */
const VERSION = 'gadmo-v2';
// Registered as /sw.js?dev=1 by `next dev`: alerts only, no caching (dev files change constantly).
const DEV = new URL(self.location.href).searchParams.has('dev');
const STATIC_CACHE = `${VERSION}-static`;
const PAGE_CACHE = `${VERSION}-pages`;
const OFFLINE_URL = '/offline';

self.addEventListener('install', (event) => {
  if (DEV) {
    event.waitUntil(self.skipWaiting());
    return;
  }
  event.waitUntil(
    caches
      .open(PAGE_CACHE)
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: 'reload' })))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (DEV) return;
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/v1/')) return;

  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(STATIC_CACHE).then((c) => c.put(request, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  if (request.mode === 'navigate') {
    // Only public pages are kept for offline use; account pages always come fresh.
    const cacheable = url.pathname === '/' || url.pathname === OFFLINE_URL;
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (cacheable && res.ok) {
            const copy = res.clone();
            caches.open(PAGE_CACHE).then((c) => c.put(request, copy));
          }
          return res;
        })
        .catch(() =>
          caches
            .match(request)
            .then((hit) => hit || caches.match(OFFLINE_URL))
            .then((res) => res || new Response('Offline', { status: 503 })),
        ),
    );
  }
});

/*
 * Alerts (web push). The payload is { title, body, url, tag } from the GADMO API; it never
 * contains phone numbers or emails. Nothing is shown if that page is already open and in
 * front, because the page updates itself.
 */
self.addEventListener('push', (event) => {
  let alert;
  try {
    alert = event.data ? event.data.json() : null;
  } catch {
    alert = null;
  }
  if (!alert || typeof alert.title !== 'string') return;
  const url = typeof alert.url === 'string' && alert.url.startsWith('/') ? alert.url : '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const watching = windows.some(
        (w) => w.focused && new URL(w.url).pathname === url.split('?')[0],
      );
      if (watching) return undefined;
      return self.registration.showNotification(alert.title, {
        body: typeof alert.body === 'string' ? alert.body : '',
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag: typeof alert.tag === 'string' ? alert.tag : undefined,
        renotify: typeof alert.tag === 'string',
        data: { url },
      });
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const same = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (same) {
        return same.navigate(url).then((w) => (w || same).focus());
      }
      return self.clients.openWindow(url);
    }),
  );
});
