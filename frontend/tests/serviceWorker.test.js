/**
 * @jest-environment node
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/**
 * The service worker's caching policy (`IMP-115`, `ADR-038`).
 *
 * **The property under test is a security one.** A service worker cache is per *origin*, not per
 * user: two people sharing a laptop share it, and so does a signed-out visitor with whoever was
 * signed in ten minutes earlier. Caching an authenticated response would hand one person's
 * wishlist, trips or review history to the next — and it has no visible symptom until it happens to
 * the wrong pair of people.
 *
 * `sw.js` cannot be imported: it is a classic worker script that assigns to `self` and registers
 * listeners at load. So it is loaded into a `vm` context with a minimal `ServiceWorkerGlobalScope`
 * stand-in, which also lets the `fetch` handler be driven directly.
 */

const SW_PATH = path.join(__dirname, '../public/sw.js');

/** A request object with the surface `sw.js` actually reads. */
const makeRequest = (url, { method = 'GET', headers = {}, mode = 'no-cors' } = {}) => {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    url,
    method,
    mode,
    headers: {
      has: (name) => name.toLowerCase() in lower,
      get: (name) => lower[name.toLowerCase()]
    }
  };
};

/**
 * Load `sw.js` and return a harness that reports what the fetch handler decided.
 *
 * `respondWith` is recorded rather than executed: the decision — intercept or stand aside, and with
 * which strategy — is the whole policy, and running the strategies would need a full Cache API.
 */
const loadWorker = () => {
  const listeners = {};

  // A real (if minimal) Cache API stand-in, not a bare `jest.fn()`.
  //
  // `event.respondWith(cacheFirst(request, ...))` *calls* the strategy to produce the promise
  // before `respondWith` ever sees it, so the strategy runs whatever the stub records. With
  // `open` returning undefined the chain rejects with an unhandled TypeError and the whole file
  // dies — which is exactly what happened the first time this ran.
  const stores = new Map();
  const caches = {
    open: async (name) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        match: async (request) => store.get(request.url),
        put: async (request, response) => store.set(request.url, response),
        add: async () => {}
      };
    },
    keys: async () => [...stores.keys()],
    match: async () => undefined,
    delete: async (name) => stores.delete(name)
  };

  const self = {
    location: { origin: 'https://easytrip.example' },
    addEventListener: (type, handler) => {
      listeners[type] = handler;
    },
    skipWaiting: jest.fn(async () => {}),
    clients: { claim: jest.fn(async () => {}) }
  };

  // `fetch` resolves rather than rejecting: the strategies run for real when a request is
  // intercepted, and a rejection here would surface as an unhandled rejection rather than as a
  // test result.
  const fetch = jest.fn(async () => ({ ok: true, clone: () => ({}) }));

  const context = vm.createContext({ self, caches, fetch, URL, Promise, console });
  vm.runInContext(fs.readFileSync(SW_PATH, 'utf8'), context);

  /** Returns `{ intercepted }` for one request. */
  const dispatchFetch = (request) => {
    let intercepted = false;
    listeners.fetch({
      request,
      respondWith: () => {
        intercepted = true;
      }
    });
    return { intercepted };
  };

  return { listeners, dispatchFetch, self, caches, source: fs.readFileSync(SW_PATH, 'utf8') };
};

const ORIGIN = 'https://easytrip.example';

describe('per-user data is never cached — the rule this file exists for', () => {
  test('an authenticated API request is not intercepted at all', () => {
    // /api/auth/* is every authenticated endpoint: wishlist, trips, profile, review history.
    const { dispatchFetch } = loadWorker();

    for (const url of [
      `${ORIGIN}/api/auth/favorites`,
      `${ORIGIN}/api/auth/trips`,
      `${ORIGIN}/api/auth/reviews`,
      `${ORIGIN}/api/auth/profile`
    ]) {
      expect([url, dispatchFetch(makeRequest(url)).intercepted]).toEqual([url, false]);
    }
  });

  test('a request carrying a bearer token is not intercepted, whatever the path', () => {
    // The belt to /api/auth's braces: a public-looking URL fetched with credentials still returns
    // a response scoped to one person.
    const { dispatchFetch } = loadWorker();
    const request = makeRequest(`${ORIGIN}/api/places/1`, {
      headers: { Authorization: 'Bearer some-token' }
    });

    expect(dispatchFetch(request).intercepted).toBe(false);
  });

  test('the admin surface is not intercepted', () => {
    const { dispatchFetch } = loadWorker();

    for (const url of [`${ORIGIN}/admin`, `${ORIGIN}/admin/moderation`, `${ORIGIN}/admin/users`]) {
      expect([url, dispatchFetch(makeRequest(url, { mode: 'navigate' })).intercepted]).toEqual([
        url,
        false
      ]);
    }
  });

  test('a path merely CONTAINING "admin" is not accidentally exempted', () => {
    // `/places/administrative-building` must still be cacheable. A `.includes('admin')` test would
    // silently disable offline support for real content.
    const { dispatchFetch } = loadWorker();
    const request = makeRequest(`${ORIGIN}/places/42`, { mode: 'navigate' });
    expect(dispatchFetch(request).intercepted).toBe(true);
  });
});

describe('what else is left alone', () => {
  test('non-GET requests are never touched', () => {
    // A POST is not idempotent and must never be replayed from a cache.
    const { dispatchFetch } = loadWorker();

    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const request = makeRequest(`${ORIGIN}/api/places/1/reviews`, { method });
      expect([method, dispatchFetch(request).intercepted]).toEqual([method, false]);
    }
  });

  test('cross-origin requests are never touched', () => {
    // Cloudinary and Open-Meteo have their own cache headers; duplicating them here would be two
    // policies for one resource, and an opaque response cannot be inspected for success.
    const { dispatchFetch } = loadWorker();

    for (const url of [
      'https://res.cloudinary.com/demo/image/upload/x.jpg',
      'https://api.open-meteo.com/v1/forecast?latitude=15'
    ]) {
      expect([url, dispatchFetch(makeRequest(url)).intercepted]).toEqual([url, false]);
    }
  });

  test('a non-navigation request for an unknown path is left to the browser', () => {
    // Not static, not API, not a navigation — the worker has no rule for it and must not invent one.
    const { dispatchFetch } = loadWorker();
    expect(dispatchFetch(makeRequest(`${ORIGIN}/something.txt`)).intercepted).toBe(false);
  });
});

describe('what IS cached', () => {
  test('public catalogue reads are', () => {
    const { dispatchFetch } = loadWorker();

    for (const url of [
      `${ORIGIN}/api/places`,
      `${ORIGIN}/api/places/1`,
      `${ORIGIN}/api/places/1/reviews`
    ]) {
      expect([url, dispatchFetch(makeRequest(url)).intercepted]).toEqual([url, true]);
    }
  });

  test('build output and icons are', () => {
    const { dispatchFetch } = loadWorker();

    for (const url of [
      `${ORIGIN}/_next/static/chunks/main-abc123.js`,
      `${ORIGIN}/icons/icon-192.png`,
      `${ORIGIN}/images/hero-bg.jpg`,
      `${ORIGIN}/manifest.webmanifest`
    ]) {
      expect([url, dispatchFetch(makeRequest(url)).intercepted]).toEqual([url, true]);
    }
  });

  test('page navigations are', () => {
    const { dispatchFetch } = loadWorker();
    const request = makeRequest(`${ORIGIN}/browse`, { mode: 'navigate' });
    expect(dispatchFetch(request).intercepted).toBe(true);
  });
});

describe('lifecycle', () => {
  test('it registers the three lifecycle handlers plus fetch', () => {
    const { listeners } = loadWorker();
    expect(Object.keys(listeners).sort()).toEqual(['activate', 'fetch', 'install', 'message']);
  });

  test('caches are versioned, so a deploy cannot be served last week’s shell', () => {
    // The classic service-worker failure: a stale cache outliving a deploy, serving JavaScript that
    // no longer matches the API, with no way for the user to clear it.
    const { source } = loadWorker();
    expect(source).toMatch(/const VERSION = '[^']+'/);
    expect(source).toMatch(/easytrip-shell-\$\{VERSION\}/);
  });

  test('activate deletes superseded caches but leaves other origins’ alone', async () => {
    const { listeners } = loadWorker();
    const deleted = [];

    const caches = {
      keys: async () => ['easytrip-shell-v0', 'easytrip-shell-v1', 'someone-elses-cache'],
      delete: async (name) => deleted.push(name)
    };

    // Re-run activate against a controlled caches stand-in.
    const context = vm.createContext({
      self: {
        location: { origin: ORIGIN },
        addEventListener: (type, handler) => {
          if (type === 'activate') context.__activate = handler;
        },
        skipWaiting: async () => {},
        clients: { claim: async () => {} }
      },
      caches,
      fetch: () => {},
      URL,
      Promise,
      console
    });
    vm.runInContext(fs.readFileSync(SW_PATH, 'utf8'), context);

    let work;
    context.__activate({ waitUntil: (promise) => (work = promise) });
    await work;

    expect(deleted).toEqual(['easytrip-shell-v0']);
    expect(deleted).not.toContain('someone-elses-cache');
    expect(listeners.activate).toBeDefined();
  });
});

describe('the offline fallback', () => {
  test('the precache list is small and includes the offline page', () => {
    // Precaching the app shell's JavaScript would go stale silently — Next's bundles are
    // content-hashed and rename on every build.
    const { source } = loadWorker();
    expect(source).toMatch(/const PRECACHE = \[/);
    expect(source).toContain('OFFLINE_URL');
    expect(source).not.toMatch(/_next\/static\/chunks\/[a-z0-9]+\.js'/);
  });
});
