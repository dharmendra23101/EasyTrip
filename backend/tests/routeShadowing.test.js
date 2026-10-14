const app = require('../app');
const { closeDb } = require('./helpers/testDb');
const {
  routeTable,
  shadowedRoutes,
  appLevelRoutes,
  expectRouterIntrospection
} = require('./helpers/routeTable');

/**
 * The route table is structurally sound — `C2`, finally guarded.
 *
 * **`C2` was fixed in Phase 1 and left unguarded for five sprints.** The bug was duplicate admin
 * route declarations where mount order silently decided which one answered and the other became
 * unreachable code that still looked live. `BUGS_AND_TECH_DEBT` recorded the fix with "Guarded by:
 * **nothing**", and the stated reason was that the durable check walks `app._router.stack`, "a
 * private Express API that is removed in Express 5 — which is precisely what `IMP-075` upgrades".
 *
 * **That reason does not hold.** `IMP-075` names Next, Firebase, `firebase-admin` and `nodemon`.
 * It does not name Express, `FRAMEWORK_UPGRADE_PLAN` §4 records Express 5 as *not scheduled*, and
 * §1's advisory work closed inside Express 4. The guard was deferred behind an upgrade nobody had
 * planned, which is why it is written now rather than after one.
 *
 * **These are structural assertions, not request assertions.** The other suites prove each route
 * behaves; none of them can see a *second* declaration of a route that behaves correctly, because
 * the correct one answers and the request looks fine. That is the whole failure mode.
 */

afterAll(async () => {
  await closeDb();
});

/**
 * The six rate limiters attached through the routing API, plus the one genuinely app-level route.
 *
 * `app.js:190-196` writes `app.post('/api/places/:id/reviews', reviewWriteLimiter)` and five
 * others. Express records each as a route, but the handler calls `next()` and the real handler
 * lives in a mounted router — so they are layered middleware, not competing declarations. They are
 * listed by name rather than pattern-matched, so the exemption cannot quietly widen into a place a
 * real duplicate could hide.
 */
const RATE_LIMITED_WRITES = [
  'POST /api/admin/places',
  'POST /api/admin/places/:id/images',
  'POST /api/newsletter',
  'POST /api/places/:id/reviews',
  'POST /api/places/:id/reviews/:reviewId/report',
  'PUT /api/admin/places/:id'
];

const APP_LEVEL_HANDLERS = ['GET /api/health'];

describe('no route is declared twice (BUG C2)', () => {
  test('the introspection this guard depends on still exists', () => {
    // Without this the suite's real failure mode is silence: `_router` disappears, the walk
    // enumerates nothing, every assertion below passes over an empty table, and a genuine
    // shadowed route ships green. Asserted first so the reason is named before anything is
    // measured.
    expect(() => expectRouterIntrospection(app)).not.toThrow();
    expect(routeTable(app).length).toBeGreaterThan(20);
  });

  test('no (method, path) pair is declared by more than one router', () => {
    // The property itself. Two routers claiming the same pair means mount order decides, and the
    // loser is dead code — which is exactly what C2 was.
    expect(shadowedRoutes(app)).toEqual([]);
  });

  test('the overlapping mounts really do overlap, or this proves nothing', () => {
    // `/api` and `/api/admin` are both mounted, so the two routers *can* collide — that is what
    // makes the assertion above meaningful rather than vacuously true of an app whose routers
    // occupy disjoint namespaces.
    const paths = routeTable(app)
      .filter((r) => r.viaRouter)
      .map((r) => r.path);
    expect(paths.filter((p) => p.startsWith('/api/admin/')).length).toBeGreaterThan(0);
    expect(paths.filter((p) => p.startsWith('/api/places')).length).toBeGreaterThan(0);
  });
});

describe('the app-level declarations are the ones we think they are', () => {
  test('nothing is declared directly on the app except the limiters and health', () => {
    // A terminal handler added directly on the app would sit *ahead* of every router and could
    // shadow one without the assertion above noticing — the router-only check cannot see across
    // that boundary. Pinning the set means a new one has to be justified here.
    expect(appLevelRoutes(app)).toEqual([...RATE_LIMITED_WRITES, ...APP_LEVEL_HANDLERS].sort());
  });

  test('every rate-limited write is a route some router actually serves', () => {
    // A limiter attached to a path no router serves protects nothing, and looks like protection.
    // A typo in `app.js` is silent today: the limiter registers, the request 404s somewhere else,
    // and the endpoint it was meant to bound runs unlimited.
    const served = new Set(
      routeTable(app)
        .filter((r) => r.viaRouter)
        .map((r) => `${r.method} ${r.path}`)
    );
    for (const write of RATE_LIMITED_WRITES) {
      expect({ write, served: served.has(write) }).toEqual({ write, served: true });
    }
  });

  test('health is served by the app and not also by a router', () => {
    const served = routeTable(app).filter((r) => `${r.method} ${r.path}` === 'GET /api/health');
    expect(served).toHaveLength(1);
    expect(served[0].viaRouter).toBe(false);
  });
});
