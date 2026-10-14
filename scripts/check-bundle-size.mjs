#!/usr/bin/env node
/**
 * Assert that the JavaScript this app ships has not quietly grown.
 *
 * **Why this exists (`PE-021`).** The roadmap carries "Lighthouse CI" as a performance gate, and its
 * adoption trigger cites a baseline in `PERFORMANCE_AUDIT.md` — a file whose own header says
 * *"static analysis only; no install, no build, no runtime profiling"*, with its sizes marked `≈`
 * and a note to confirm them with `next build`. There was no baseline to calibrate a gate against.
 *
 * Phase 14 took the measurement. What it found is that **the bundle is almost entirely shared**:
 * 240.6 kB gzip of framework, Firebase, framer-motion and axios that every page pays before any of
 * its own code, against 7.7–51.5 kB of route-specific JavaScript. The number that matters is one
 * number, not twenty-six.
 *
 * **Why this and not Lighthouse CI.** A Lighthouse score is a measurement of a machine as much as of
 * a page — CPU throttling, network emulation and a scoring curve that moves between versions. On a
 * shared CI runner it varies by ten points between identical runs, and a gate that fails randomly
 * gets raised until it stops failing, which is how a performance budget becomes a decoration.
 * **Bundle bytes are deterministic**: the same input produces the same gzip length on every machine.
 * This gate catches the regression that actually happens — somebody adds a dependency — and it does
 * so at the point of the change rather than in a score three weeks later.
 *
 * That is not an argument that Lighthouse is worthless. It is an argument that a lab score needs a
 * deployed URL to be meaningful (`H2`), and that until there is one, this is the half of `PE-021`
 * that can be honest.
 *
 * **Two budgets, deliberately, and not a per-route table.** `axe.spec.js` carried a per-route
 * allowlist for twenty sprints and it rotted: entries stayed because nobody re-checked them, and
 * Phase 14 found its description had stopped matching the failures it named. A twenty-six row size
 * table would rot the same way and for the same reason. So: one budget on the shared baseline
 * (which is on every page) and one on any single route's own code (which catches a page importing
 * something heavy). Every route is printed regardless, so drift is visible in the CI log before it
 * is a failure.
 *
 * Same class as the other guards: a falsifiable claim about the repository, asserted without
 * booting anything. Unlike the others it needs `next build` to have run, so it lives in the
 * `lint-and-build` job immediately after the build step.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NEXT = join(ROOT, 'frontend/.next');

/**
 * Ceilings, not targets — the phrasing `axe.spec.js` got right.
 *
 * Measured 2026-09-07 (Sprint 8.74) at **240.6 kB** shared and **51.5 kB** for the largest route
 * (`/places/[id]`). The headroom is deliberately small: a few kB absorbs a patch release of React
 * or Firebase, and anything larger than that is a decision somebody should have to make on purpose.
 *
 * **Lower these when the bundle improves.** Two reductions are already measured and specified in
 * `PERFORMANCE_AUDIT.md` §12 — framer-motion (39.5 kB) and Firebase (36.7 kB) are both in the
 * shared bundle and both are deferrable.
 */
const SHARED_BUDGET_KB = 250;
const ROUTE_BUDGET_KB = 58;

/**
 * Pages that are not pages.
 *
 * `build-manifest.json` lists JavaScript for every entry in `pages/`, including the two that return
 * `text/plain` and `application/xml` from `getServerSideProps` and never render in a browser. Their
 * chunks are built and never fetched, so counting them would attribute a quarter of a megabyte of
 * JavaScript to a robots file and make the worst-route number meaningless.
 */
const NOT_BROWSER_PAGES = new Set(['/robots.txt', '/sitemap.xml']);

if (!existsSync(join(NEXT, 'build-manifest.json'))) {
  console.error(
    '  SKIPPED  frontend/.next/build-manifest.json is absent — run `npm run build` first.\n' +
      '           This guard measures build output, so it cannot run on a clean checkout.'
  );
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(join(NEXT, 'build-manifest.json'), 'utf8'));

const gzipKb = (files) => {
  let total = 0;
  for (const file of files) {
    try {
      total += gzipSync(readFileSync(join(NEXT, file))).length;
    } catch {
      // A file listed in the manifest but absent from disk is a broken build, not a size problem.
      // The build step ahead of this one is what fails on that.
    }
  }
  return total / 1024;
};

/** What every page pays before any of its own code: framework, `_app`, polyfills. */
const shared = [
  ...new Set([
    ...(manifest.rootMainFiles || []),
    ...(manifest.pages['/_app'] || []),
    ...(manifest.polyfillFiles || [])
  ])
];
const sharedKb = gzipKb(shared);

const routes = Object.entries(manifest.pages)
  .filter(([page]) => page !== '/_app' && !NOT_BROWSER_PAGES.has(page))
  .map(([page, files]) => {
    const own = files.filter((file) => !shared.includes(file));
    return { page, ownKb: gzipKb(own), firstLoadKb: sharedKb + gzipKb(own) };
  })
  .sort((a, b) => b.firstLoadKb - a.firstLoadKb);

console.log(`  Shared baseline: ${sharedKb.toFixed(1)} kB gzip (budget ${SHARED_BUDGET_KB} kB)\n`);
console.log(`  ${'Route'.padEnd(28)}${'First load'.padStart(12)}${'Route only'.padStart(13)}`);
for (const route of routes) {
  console.log(
    `  ${route.page.padEnd(28)}${`${route.firstLoadKb.toFixed(1)} kB`.padStart(12)}` +
      `${`${route.ownKb.toFixed(1)} kB`.padStart(13)}`
  );
}

const failures = [];

if (sharedKb > SHARED_BUDGET_KB) {
  failures.push(
    `  OVER BUDGET  shared baseline is ${sharedKb.toFixed(1)} kB gzip, budget is ${SHARED_BUDGET_KB} kB.\n` +
      '               This is paid by every page on the site, so it is the expensive one.'
  );
}

for (const route of routes.filter((r) => r.ownKb > ROUTE_BUDGET_KB)) {
  failures.push(
    `  OVER BUDGET  ${route.page} ships ${route.ownKb.toFixed(1)} kB gzip of its own code, ` +
      `budget is ${ROUTE_BUDGET_KB} kB.`
  );
}

if (failures.length === 0) {
  console.log(
    `\n  OK  ${routes.length} routes within budget; shared baseline ${sharedKb.toFixed(1)} kB ` +
      `of ${SHARED_BUDGET_KB} kB`
  );
  process.exit(0);
}

console.error('');
for (const failure of failures) console.error(failure);
console.error(
  '\n  A dependency is easy to add and hard to remove (`IMP-120`). If the growth is deliberate,\n' +
    '  raise the budget in this file **and say why in the commit** — a budget raised silently to\n' +
    '  make a build pass is not a budget.'
);
process.exit(1);
