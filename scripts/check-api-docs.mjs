#!/usr/bin/env node
/**
 * Assert that README's API reference matches the routes the backend actually registers.
 *
 * **Why this exists.** The README's endpoint table opens with the sentence *"The table below is the
 * complete set of Express routes the backend actually registers."* That is a falsifiable claim, and
 * on 2026-08-15 it was false by 23 routes — trips, the wishlist, weather, typeahead, moderation,
 * analytics and geocoding had all shipped without it. Nothing failed, because nothing was checking.
 *
 * This is the same class of guard as `check-module-size.mjs`: it asserts a property no test covers
 * and no build breaks on. It is **not** a test — it makes no claim about behaviour — so it lives in
 * `scripts/` and runs as `npm run check:api-docs`.
 *
 * The parse is deliberately dumb. A regex over the route files and a regex over the markdown table
 * beats importing the Express app, which would need a database, Firebase credentials and the whole
 * environment gate to answer a question about text.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROUTES_DIR = join(ROOT, 'backend/src/routes');
const README = join(ROOT, 'README.md');

/** Where each router file is mounted, from `app.js`. */
const MOUNTS = {
  'adminRoutes.js': '/admin',
  'authRoutes.js': '/auth',
  'newsletterRoutes.js': '/newsletter',
  'placeRoutes.js': ''
};

/**
 * Routes that exist but are deliberately undocumented.
 *
 * Empty, and that is the point: an entry here needs a reason next to it, so "we forgot" cannot
 * masquerade as "we decided".
 */
const UNDOCUMENTED_BY_DESIGN = new Set([]);

/** `/health` is registered directly in `app.js`, not in a router file. */
const EXTRA_ROUTES = new Set(['GET /health']);

const realRoutes = () => {
  const found = new Set(EXTRA_ROUTES);

  for (const file of readdirSync(ROUTES_DIR).filter((f) => f.endsWith('.js'))) {
    const source = readFileSync(join(ROUTES_DIR, file), 'utf8');

    // **Not every file in `routes/` is a router.** `placeValidators.js` holds the express-validator
    // chains `placeRoutes.js` applies, extracted when that file outgrew the size limit; it declares
    // no endpoints, so demanding a mount path for it would mean inventing one.
    //
    // The test is what the file *does*, not what it is called. A name pattern — skip anything
    // matching `*Validators.js` — would be a loophole a real router could be dropped through by
    // being named carelessly. A router that someone forgets to add to `MOUNTS` still calls
    // `express.Router()`, so it still throws below, which is the case this guard exists for.
    if (!source.includes('express.Router()')) continue;

    const mount = MOUNTS[file];
    if (mount === undefined) {
      throw new Error(
        `${file} has no mount recorded in check-api-docs.mjs. Add it (and its mount path from app.js).`
      );
    }

    // Multi-line declarations are the norm here — the verb and path are on the first line, the
    // middleware on the ones after — so this matches only up to the path and ignores the rest.
    for (const [, verb, path] of source.matchAll(
      /router\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/g
    )) {
      const full = `${mount}${path}`.replace(/\/$/, '') || '/';
      found.add(`${verb.toUpperCase()} ${full}`);
    }
  }

  return found;
};

/** Every `| VERB | \`/path\` |` row in the README's tables. */
const documentedRoutes = () => {
  const source = readFileSync(README, 'utf8');
  const found = new Set();

  for (const [, verb, path] of source.matchAll(
    /^\|\s*(GET|POST|PUT|PATCH|DELETE)\s*\|\s*`([^`]+)`/gm
  )) {
    found.add(`${verb} ${path.replace(/\/$/, '') || '/'}`);
  }

  return found;
};

const real = realRoutes();
const documented = documentedRoutes();

const missing = [...real].filter((r) => !documented.has(r) && !UNDOCUMENTED_BY_DESIGN.has(r));
const phantom = [...documented].filter((r) => !real.has(r));

/**
 * The route table is guarded; the sentences *about* the route table were not.
 *
 * The README states the route count in three more places than the table itself, and on 2026-09-07
 * **two of the three disagreed with it**: the guards table said *"(77 today)"* and the summary at
 * the top said *"the 77-route API table"*, while the badge correctly said 78. The table had been
 * right the whole time, because this guard checks it — which is precisely why the drift collected
 * in the prose beside it instead.
 *
 * A guard that leaves a stale number in the sentence describing it is only most of a guard. Each
 * pattern below is anchored tightly enough to identify one specific claim, so a new sentence is not
 * silently unchecked — it is simply not yet claimed, and adding it here is a one-line change.
 */
const COUNT_CLAIMS = [
  { label: 'the Routes badge', pattern: /API%20routes-(\d+)%20documented/ },
  { label: 'the summary at the top', pattern: /the (\d+)-route API table/ },
  {
    label: "the guards table's row",
    pattern: /\|\s*`check:api-docs`\s*\|[^|]*?\((\d+) today\)/
  }
];

const readme = readFileSync(README, 'utf8');
const staleClaims = COUNT_CLAIMS.flatMap(({ label, pattern }) => {
  const found = pattern.exec(readme);
  if (!found || Number(found[1]) === real.size) return [];
  return [`  SUMMARY     ${label} says ${found[1]} routes; ${real.size} are registered`];
});

if (missing.length === 0 && phantom.length === 0 && staleClaims.length === 0) {
  console.log(
    `  OK  README documents all ${real.size} registered routes, and no others; ` +
      `${COUNT_CLAIMS.length} prose claims agree`
  );
  process.exit(0);
}

for (const claim of staleClaims) console.error(claim);

// Both directions matter, and for different reasons. A missing route is a README that undersells
// the API; a phantom one is a README that promises an endpoint returning 404 — which is worse,
// because somebody will write a client against it.
for (const route of missing) {
  console.error(`  UNDOCUMENTED  ${route} — registered by the backend, absent from README`);
}
for (const route of phantom) {
  console.error(`  PHANTOM       ${route} — documented in README, registered nowhere`);
}

console.error(
  `\n  ${missing.length} undocumented, ${phantom.length} phantom (${real.size} routes registered)`
);
process.exit(1);
