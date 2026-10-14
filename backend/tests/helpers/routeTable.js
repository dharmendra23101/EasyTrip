/**
 * Enumerate the routes actually mounted on an Express app, as `(method, full path)` pairs.
 *
 * **Why this walks a private API.** `app._router.stack` is not public Express. Nothing else
 * answers the question, though: the route table is assembled at import time from four routers
 * mounted at three prefixes, two of which overlap (`/api` and `/api/admin`), and the only
 * authority on what that produced is the structure Express built. Reading the route *files* back
 * would re-implement the mounting rules and then agree with itself — the tautology
 * `VERIFICATION_LEDGER` retired a whole family of scripts for.
 *
 * **Express 5 removes `_router`.** That is why `C2`'s guard was deferred in Sprint 6.9, on the
 * stated grounds that the introspection "is removed in Express 5 — which is precisely what
 * `IMP-075` upgrades". It is not: `IMP-075` names Next, Firebase, `firebase-admin` and `nodemon`,
 * and `FRAMEWORK_UPGRADE_PLAN` §4 records Express 5 as **not scheduled**, with `app.use('*')` at
 * `app.js:297` as its one concrete blocker. The coupling accepted here is to a major the project
 * is staying on deliberately, and `expectRouterIntrospection` below turns the day that stops being
 * true into a loud failure rather than a guard that silently enumerates nothing.
 *
 * **What counts as a shadow, and what does not.** The naive form of this check — "no
 * `(method, path)` declared twice" — reports five duplicates on this app, and all five are
 * correct code. `app.js:190-196` attaches per-route rate limiters through the routing API
 * (`app.post('/api/places/:id/reviews', reviewWriteLimiter)`), which Express records as a route
 * even though its handler calls `next()` and the real handler lives in a mounted router. Those are
 * layered middleware, not competing handlers.
 *
 * So the pair is split by origin. `viaRouter` marks the declarations that came from inside a
 * mounted router — the ones where a second declaration really is unreachable, because the first
 * ends the request. The top-level declarations are pinned separately by name, so the exemption
 * cannot quietly grow into a hiding place for a real duplicate.
 */

/** The router container, across the two places Express has kept it. */
const routerOf = (app) => app._router || app.router;

/**
 * Fail if the private introspection this module depends on has gone away.
 *
 * A guard that quietly enumerates zero routes passes forever, which is the failure mode that lets
 * a route-shadowing regression through while the suite stays green.
 */
const expectRouterIntrospection = (app) => {
  const router = routerOf(app);
  if (!router || !Array.isArray(router.stack)) {
    throw new Error(
      'Express no longer exposes `app._router.stack`. The route-shadowing guard cannot enumerate ' +
        'the route table and must be rewritten against the new introspection API before it can be ' +
        'trusted again (BUGS_AND_TECH_DEBT C2, FRAMEWORK_UPGRADE_PLAN §4).'
    );
  }
  return router;
};

/**
 * Turn a mounted router's compiled `regexp` back into the prefix it was mounted at.
 *
 * Express keeps no copy of the original string; `layer.regexp.source` is the only record of it.
 * `fast_slash` marks a router mounted at `/`, which contributes no prefix.
 */
/**
 * The prefixes this app mounts routers at.
 *
 * **A fixture, not a re-implementation of Express's mounting rules.** Express 5 keeps no static
 * record of a mount path - `layer.regexp` is gone and the pattern survives only inside a matcher
 * closure - so a prefix can no longer be *derived* from the structure. It can still be
 * *confirmed*: a matcher answers "is this path under me, and how much of it did I consume".
 *
 * So this list is probed against the live routers rather than trusted. `prefixOf` throws when a
 * mounted router matches none of it, which is what stops a new mount point from silently
 * producing routes with no prefix - the failure mode that would make this whole check vacuous.
 * Adding a mount means adding a line here, and forgetting to is a loud failure.
 */
const MOUNT_CANDIDATES = ['/api/auth', '/api/admin', '/api/newsletter', '/api', ''];

/**
 * Recover a mount prefix from an Express 5 layer by probing its matchers.
 *
 * A matcher returns `{ path }` naming the portion it consumed, so a candidate both tests the guess
 * and reads the answer back. Longest candidate first, because `/api` also matches a router mounted
 * at `/api/auth` and the more specific mount is the true one.
 */
const prefixFromMatchers = (layer) => {
  const matchers = Array.isArray(layer.matchers) ? layer.matchers : [];
  if (matchers.length === 0) return '';

  for (const candidate of MOUNT_CANDIDATES) {
    for (const match of matchers) {
      const result = match(candidate || '/');
      if (result && typeof result.path === 'string') {
        // A router mounted at `/` consumes `/` and contributes no prefix.
        return result.path === '/' ? '' : result.path;
      }
    }
  }

  throw new Error(
    'routeTable: a mounted router matched none of MOUNT_CANDIDATES. A new mount point was added ' +
      'without updating that list, and every route under it would be recorded with no prefix - ' +
      'which would make the shadowing check pass while enumerating the wrong paths.'
  );
};

const prefixOf = (layer) => {
  // Express 5 removed `layer.regexp`; the mount pattern lives in a matcher closure instead.
  if (!layer.regexp) return prefixFromMatchers(layer);
  if (layer.regexp && layer.regexp.fast_slash) return '';
  const source = layer.regexp && layer.regexp.source;
  if (!source) return '';
  const inner = source
    .replace(/^\^/, '')
    .replace(/\\\/\?\(\?=\\\/\|\$\)$/, '')
    .replace(/\$$/, '');
  return inner.replace(/\\\//g, '/').replace(/\\\./g, '.');
};

/** Collapse `//` and drop a trailing `/`, so `/api/newsletter/` and `/api/newsletter` compare equal. */
const normalise = (path) => {
  const collapsed = path.replace(/\/{2,}/g, '/');
  return collapsed.length > 1 ? collapsed.replace(/\/$/, '') : collapsed;
};

/**
 * Every `(method, path)` the app will route.
 *
 * `viaRouter` distinguishes a declaration made inside a mounted router from one made directly on
 * the app. Only `Route` layers are collected — plain middleware declares no method/path pair and
 * is not what `C2` is about.
 */
const routeTable = (app) => {
  const found = [];

  const walk = (stack, prefix, viaRouter) => {
    for (const layer of stack) {
      if (layer.route) {
        const path = normalise(`${prefix}${layer.route.path}`);
        for (const [method, enabled] of Object.entries(layer.route.methods)) {
          if (enabled && method !== '_all') {
            found.push({ method: method.toUpperCase(), path, viaRouter });
          }
        }
      } else if (layer.name === 'router' && layer.handle && Array.isArray(layer.handle.stack)) {
        walk(layer.handle.stack, `${prefix}${prefixOf(layer)}`, true);
      }
    }
  };

  walk(expectRouterIntrospection(app).stack, '', false);
  return found;
};

/**
 * `(method, path)` pairs a mounted router declares more than once.
 *
 * This is `C2` stated as a property: when two routers declare the same pair, mount order decides
 * which one answers and the other is dead code that looks live.
 */
const shadowedRoutes = (app) => {
  const seen = new Map();
  for (const { method, path, viaRouter } of routeTable(app)) {
    if (!viaRouter) continue;
    const key = `${method} ${path}`;
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  return [...seen.entries()]
    .filter(([, count]) => count > 1)
    .map(([key, count]) => `${key} (declared ${count}×)`)
    .sort();
};

/** `(method, path)` pairs declared directly on the app rather than inside a mounted router. */
const appLevelRoutes = (app) =>
  routeTable(app)
    .filter((r) => !r.viaRouter)
    .map((r) => `${r.method} ${r.path}`)
    .sort();

module.exports = { routeTable, shadowedRoutes, appLevelRoutes, expectRouterIntrospection };
