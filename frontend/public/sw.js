/* eslint-env serviceworker */

/**
 * EasyTrip service worker (`IMP-115`, `ADR-038`).
 *
 * **Hand-rolled rather than `next-pwa`/Workbox.** Workbox is excellent and would have been the
 * right call for a large surface with many caching strategies. Here the whole policy is four rules,
 * and the cost of the library is a build-time integration plus a dependency tree in a project still
 * working through `IMP-119`'s advisory backlog after `IMP-068` pruned fifteen unused packages. The
 * rules below are the entire feature, and they are readable.
 *
 * ---------------------------------------------------------------------------
 * THE RULE THAT MATTERS MOST: never cache anything that belongs to one person.
 * ---------------------------------------------------------------------------
 *
 * A service worker cache is **per origin, not per user**. Two people sharing a laptop share it, and
 * so do a signed-out visitor and the person who was signed in ten minutes ago. Caching an
 * authenticated response would leak one user's wishlist, trips or review history to the next — a
 * far worse bug than the offline support it would buy, and one with no visible symptom until it
 * happens to the wrong pair of people.
 *
 * So `shouldBypass` below is the first thing every request meets, and it is deliberately
 * over-broad: anything authenticated, anything admin, anything not a GET, and anything carrying an
 * Authorization header is passed straight to the network and never stored.
 */

// Bump to invalidate everything. Old caches are deleted on activate, so a stale shell cannot
// outlive a deploy — which is the usual way a service worker becomes the thing serving last week's
// JavaScript to a user who cannot work out why the app is broken.
const VERSION = 'v1';
const SHELL_CACHE = `easytrip-shell-${VERSION}`;
const PAGES_CACHE = `easytrip-pages-${VERSION}`;
const API_CACHE = `easytrip-api-${VERSION}`;
const CURRENT_CACHES = [SHELL_CACHE, PAGES_CACHE, API_CACHE];

const OFFLINE_URL = '/offline';

/**
 * Precached at install: only what the offline page itself needs to render.
 *
 * Deliberately not the app shell's JavaScript. Next's bundles are content-hashed and their names
 * change every build, so a hard-coded list goes stale silently — and a precache manifest generated
 * at build time is most of what `next-pwa` exists to do. The runtime rules below cache those files
 * the first time they are actually fetched, which costs one online visit and never goes stale.
 */
const PRECACHE = [OFFLINE_URL, '/manifest.webmanifest', '/icons/icon-192.png'];

/**
 * Requests this worker must not touch.
 *
 * Ordered cheapest-first, and every branch has a reason:
 *
 *   - non-GET       — a POST is not idempotent and must never be replayed from a cache.
 *   - cross-origin  — Cloudinary and Open-Meteo have their own cache headers; duplicating them here
 *                     would mean two policies for one resource, and opaque responses cannot be
 *                     inspected to know whether they were even successful.
 *   - Authorization — the request carries a bearer token, so the response is one person's.
 *   - /api/auth/*   — every authenticated endpoint lives under this prefix (wishlist, trips,
 *                     profile, review history). See `ARCHITECTURE.md`.
 *   - /admin*       — the admin surface, which is gated server-side and has no offline story.
 */
const shouldBypass = (request, url) => {
  if (request.method !== 'GET') return true;
  if (url.origin !== self.location.origin) return true;
  if (request.headers.has('Authorization')) return true;
  if (url.pathname.startsWith('/api/auth')) return true;
  if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) return true;
  return false;
};

/** Immutable build output. Content-hashed, so a cache hit is always correct. */
const isStaticAsset = (url) =>
  url.pathname.startsWith('/_next/static/') ||
  url.pathname.startsWith('/icons/') ||
  url.pathname.startsWith('/images/') ||
  url.pathname === '/manifest.webmanifest';

/** Public catalogue reads. Everything under /api that is not /api/auth. */
const isPublicApi = (url) => url.pathname.startsWith('/api/');

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // `Promise.allSettled`, not `addAll`: `addAll` rejects the whole install if any single URL
      // 404s, which would leave the worker permanently uninstalled because one icon was renamed.
      await Promise.allSettled(PRECACHE.map((url) => cache.add(url)));
      // Take over as soon as installed rather than waiting for every tab to close. Safe here
      // because the fetch rules are conservative and `activate` clears superseded caches.
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith('easytrip-') && !CURRENT_CACHES.includes(name))
          .map((name) => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

/** Cache-first. For content-hashed files a hit is always correct, so the network is never consulted. */
const cacheFirst = async (request, cacheName) => {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;

  const response = await fetch(request);
  // Only 200s. Caching a 404 or a 500 pins the failure for the life of the cache version.
  if (response.ok) cache.put(request, response.clone());
  return response;
};

/**
 * Network-first, falling back to whatever was stored.
 *
 * The right way round for anything that changes: a place's rating, a new photo, a corrected
 * description. Cache-first would show a stale page to somebody who is perfectly online, which is a
 * worse failure than a slightly slower load.
 */
const networkFirst = async (request, cacheName, fallbackUrl) => {
  const cache = await caches.open(cacheName);

  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const hit = await cache.match(request);
    if (hit) return hit;
    if (fallbackUrl) {
      const fallback = await caches.match(fallbackUrl);
      if (fallback) return fallback;
    }
    throw error;
  }
};

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Untouched: not intercepted, not cached, not even inspected further. The browser's own handling
  // is exactly right for these, and a worker that "helps" is a worker that can break them.
  if (shouldBypass(request, url)) return;

  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
    return;
  }

  if (isPublicApi(url)) {
    event.respondWith(networkFirst(request, API_CACHE));
    return;
  }

  // A page navigation. The offline page is the last resort, so a cold start with no network shows
  // something explanatory rather than the browser's dinosaur.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, PAGES_CACHE, OFFLINE_URL));
  }
});

/**
 * Let the page tell a waiting worker to activate.
 *
 * Without this, a user who has the app open when a deploy lands keeps the old worker until every
 * tab is closed — which for an installed PWA can be days.
 */
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
