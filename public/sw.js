/*
 * NEXUS service worker.
 *
 * Scope of responsibility, deliberately narrow:
 *
 *   • app shell + static assets  → cache-first, refreshed in the background
 *   • navigations                → network-first, cached shell, then /offline
 *   • GET /api/*                 → network-first, cached copy as fallback
 *   • POST, /api/chat, /api/ftp  → never cached, never replayed
 *
 * What it does NOT do: cache prompts, replies, model weights or anything from a
 * POST. Chat content is not "app data" and the on-device models live in OPFS
 * where the Cache API cannot see them.
 *
 * Versioning: bump CACHE_VERSION to retire old caches. `activate` deletes every
 * cache that is not in KEEP, so a bad deploy cannot leave stale HTML behind.
 */

const CACHE_VERSION = 'v1';
const SHELL_CACHE = `nexus-shell-${CACHE_VERSION}`;
const ASSET_CACHE = `nexus-assets-${CACHE_VERSION}`;
const API_CACHE = `nexus-api-${CACHE_VERSION}`;
const KEEP = new Set([SHELL_CACHE, ASSET_CACHE, API_CACHE]);

const SHELL_URLS = ['/', '/offline', '/manifest.webmanifest', '/icon.svg'];
const API_TTL_MS = 10 * 60_000;
const MAX_API_ENTRIES = 60;

/** Never store these, even though they are GET. */
const NEVER_CACHE = [/\/api\/chat/, /\/api\/ftp/, /\/api\/speech/, /\/api\/llm\/verify/];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Individually, so one 404 does not fail the whole install.
      await Promise.all(
        SHELL_URLS.map(async (url) => {
          try {
            await cache.add(new Request(url, { cache: 'reload' }));
          } catch {
            /* a missing optional asset must not block activation */
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => !KEEP.has(name)).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') self.skipWaiting();
  if (data.type === 'PING') event.source?.postMessage({ type: 'PONG', version: CACHE_VERSION });
});

self.addEventListener('sync', (event) => {
  if (event.tag !== 'nexus-sync') return;
  // The queue itself lives in IndexedDB, which the page owns. The SW's job is to
  // wake a client and let it flush with the code that knows how.
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clients) client.postMessage({ type: 'SYNC_NOW' });
    })(),
  );
});

function isStaticAsset(url) {
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/hologram/') ||
    url.pathname.startsWith('/hud/') ||
    url.pathname.startsWith('/vendor/') ||
    url.pathname.startsWith('/workers/') ||
    /\.(?:css|js|svg|png|jpg|jpeg|webp|woff2?|wasm|ico)$/.test(url.pathname)
  );
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (NEVER_CACHE.some((pattern) => pattern.test(url.pathname))) return;

  /* ---------------- navigations: shell with an offline fallback ---------------- */
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          const cache = await caches.open(SHELL_CACHE);
          cache.put('/', response.clone()).catch(() => {});
          return response;
        } catch {
          const cached = (await caches.match('/')) || (await caches.match('/offline'));
          return (
            cached ||
            new Response(
              '<!doctype html><meta charset="utf-8"><title>Offline</title><body style="background:#02080a;color:#9ff8ff;font:14px monospace;padding:2rem">NEXUS is offline. Reconnect to restore the console.</body>',
              { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
            )
          );
        }
      })(),
    );
    return;
  }

  /* ---------------- API GET: network-first, cached fallback ---------------- */
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (response.ok) {
            const cache = await caches.open(API_CACHE);
            const copy = response.clone();
            const headers = new Headers(copy.headers);
            headers.set('x-nexus-cached-at', String(Date.now()));
            cache
              .put(
                request,
                new Response(await copy.arrayBuffer(), {
                  status: copy.status,
                  headers,
                }),
              )
              .then(() => trimApiCache())
              .catch(() => {});
          }
          return response;
        } catch {
          const cached = await caches.match(request);
          if (cached) {
            const headers = new Headers(cached.headers);
            headers.set('x-nexus-stale', '1');
            return new Response(await cached.arrayBuffer(), { status: cached.status, headers });
          }
          return new Response(
            JSON.stringify({
              error: 'Offline and no cached response for this endpoint',
              code: 'offline-no-cache',
              fix: 'Reconnect and retry.',
            }),
            { status: 503, headers: { 'Content-Type': 'application/json' } },
          );
        }
      })(),
    );
    return;
  }

  /* ---------------- static assets: cache-first ---------------- */
  if (isStaticAsset(url)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        try {
          const response = await fetch(request);
          if (response.ok) {
            const cache = await caches.open(ASSET_CACHE);
            cache.put(request, response.clone()).catch(() => {});
          }
          return response;
        } catch {
          return new Response('', { status: 504, statusText: 'Offline' });
        }
      })(),
    );
  }
});

async function trimApiCache() {
  const cache = await caches.open(API_CACHE);
  const keys = await cache.keys();
  if (keys.length <= MAX_API_ENTRIES) return;
  // Insertion order is oldest-first.
  for (const key of keys.slice(0, keys.length - MAX_API_ENTRIES)) await cache.delete(key);
}

/* Exposed for a future TTL sweep; kept because Cache API entries carry no age. */
self.__API_TTL_MS = API_TTL_MS;
