#!/usr/bin/env node
/**
 * Assert that the README's test counts match the suites that actually ran.
 *
 * **Why this exists (`IMP-128`).** `check-api-docs.mjs` made the route table impossible to drift,
 * and the sentence beside it — *"1,009 assertions across three layers"* — was still a number
 * somebody typed. It had been wrong three times, always upward, always because the suites grew and
 * nobody re-counted. It is the last falsifiable claim in the README that nothing checks.
 *
 * **Why the cheap version does not work.** Counting `test(`/`it(` occurrences in the source is the
 * obvious approach and it is wrong: measured at Sprint 8.3 it gave 455/316/78 against Jest's actual
 * 509/330/81, because `test.each` and generated cases produce more tests than there are call sites.
 * A guard that is reliably off by fifty is worse than no guard, because the first person to see it
 * fail will "fix" the README to match the wrong number.
 *
 * So the counts come from the runners themselves: `numTotalTests` from a `jest --json` report, and
 * the spec tree of a Playwright `--reporter=json` report. CI writes all three as artifacts and the
 * `test-counts` job compares them against this file.
 *
 * **Two checks, and the first one is free.** The README's own arithmetic — does the headline total
 * equal its three parts — needs no test run at all, so it also runs in `lint-and-build` and on any
 * laptop. It catches the likeliest edit: updating one layer's number and forgetting the total.
 *
 * Same class of guard as `check-api-docs.mjs` and `check-module-size.mjs`: it asserts a property no
 * test covers and no build breaks on, so it lives in `scripts/` and is **not** a test.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const README = join(ROOT, 'README.md');

/**
 * The sentence this guard exists to check.
 *
 * Deliberately anchored on the prose rather than on a line number, and deliberately strict: if the
 * wording changes, this guard **fails** rather than quietly finding nothing. A guard whose target
 * has vanished and which still exits 0 is the worst of both worlds — it reports success for a claim
 * it is no longer reading.
 */
const CLAIM =
  /\*\*([\d,]+)\s+assertions across three layers\*\*[^\n]*?\b([\d,]+)\s+API tests\b[^\n]*?\b([\d,]+)\s+component tests\b[^\n]*?\b([\d,]+)\s+browser journeys\b/;

/** `'1,009'` -> `1009`. The README writes thousands with a separator; the runners do not. */
const toNumber = (text) => Number(String(text).replace(/,/g, ''));

/**
 * The places the README **repeats** the counts, which is now three (`IMP-128`, extended).
 *
 * The restructured front door states the numbers before a reader reaches the canonical sentence:
 * a shields.io badge, the opening "why this repo" bullet, and the Testing & Verification table.
 * That is good for the reader and it is four copies of one fact — the exact shape this guard was
 * written for, reintroduced by the file it guards.
 *
 * And the README now says out loud that *"the counts above cannot go stale"*. A claim about a
 * guard is itself a claim, so it has to be true of every copy rather than only the one the guard
 * happened to be pointed at first.
 *
 * Each entry is matched against the canonical claim, never against a literal — so there is still
 * exactly one number to edit when a suite grows. **A missing echo is a failure, not a skip**, for
 * the same reason `CLAIM` is strict: an echo that has been reworded away is an unchecked number,
 * and a guard that silently stops checking one is worse than one that never checked it.
 */
const ECHOES = [
  {
    label: 'the assertions badge',
    // `1%2C923` — the comma is percent-encoded inside the shields.io URL.
    pattern: /!\[Tests\]\(https:\/\/img\.shields\.io\/badge\/assertions-([\d]+(?:%2C[\d]+)*)-/,
    of: 'total',
    decode: (raw) => toNumber(raw.replace(/%2C/g, ''))
  },
  {
    label: 'the "why this repo" opening bullet',
    pattern:
      /\*\*([\d,]+)\s+assertions\*\*\s+—\s+([\d,]+)\s+API tests[^\n]*?([\d,]+)\s+component tests,\s+([\d,]+)\s*\n?\s*browser journeys/,
    of: ['total', 'api', 'component', 'e2e']
  },
  {
    label: 'the Testing & Verification table',
    pattern:
      /\|\s*API\s*\|\s*\*\*([\d,]+)\*\*[\s\S]*?\|\s*Component\s*\|\s*\*\*([\d,]+)\*\*[\s\S]*?\|\s*Browser\s*\|\s*\*\*([\d,]+)\*\*/,
    of: ['api', 'component', 'e2e']
  }
];

const checkEchoes = (claim, readme) => {
  const problems = [];

  for (const echo of ECHOES) {
    const match = echo.pattern.exec(readme);
    if (!match) {
      problems.push(
        `  MISSING ECHO  ${echo.label} is gone or reworded — this guard can no longer read it.\n` +
          '                If that was deliberate, update ECHOES in scripts/check-test-counts.mjs.'
      );
      continue;
    }

    const keys = Array.isArray(echo.of) ? echo.of : [echo.of];
    keys.forEach((key, index) => {
      const found = echo.decode ? echo.decode(match[index + 1]) : toNumber(match[index + 1]);
      if (found !== claim[key]) {
        problems.push(
          `  ECHO MISMATCH  ${echo.label} says ${key} is ${found}, the canonical sentence says ` +
            `${claim[key]}`
        );
      }
    });
  }

  return problems;
};

const readClaim = () => {
  const match = CLAIM.exec(readFileSync(README, 'utf8'));
  if (!match) {
    console.error(
      '  MISSING  README no longer contains the "N assertions across three layers" sentence.\n' +
        '           That sentence is what this guard checks. If it was reworded deliberately,\n' +
        '           update CLAIM in scripts/check-test-counts.mjs to match the new wording.'
    );
    process.exit(1);
  }

  const [, total, api, component, e2e] = match;
  return {
    total: toNumber(total),
    api: toNumber(api),
    component: toNumber(component),
    e2e: toNumber(e2e)
  };
};

/** `numTotalTests` from a `jest --json` report — every case Jest actually ran. */
const jestCount = (file) => {
  const report = JSON.parse(readFileSync(file, 'utf8'));
  if (typeof report.numTotalTests !== 'number') {
    throw new Error(`${file} has no numTotalTests — is it a "jest --json" report?`);
  }
  return report.numTotalTests;
};

/**
 * Every test in a Playwright JSON report, walked from the spec tree.
 *
 * `stats` is not used: it counts outcomes (expected, skipped, flaky), and a journey that skipped
 * because the Auth Emulator was unavailable is still a journey the suite contains. The tree is the
 * count that stays stable, which is what a README claim needs.
 */
const playwrightCount = (file) => {
  const report = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(report.suites)) {
    throw new Error(`${file} has no suites array — is it a "playwright --reporter=json" report?`);
  }

  const walk = (suite) =>
    (suite.suites || []).reduce((n, child) => n + walk(child), 0) +
    (suite.specs || []).reduce((n, spec) => n + (spec.tests || []).length, 0);

  return report.suites.reduce((n, suite) => n + walk(suite), 0);
};

const LAYERS = [
  { key: 'api', label: 'API tests', countFromJson: jestCount },
  { key: 'component', label: 'component tests', countFromJson: jestCount },
  { key: 'e2e', label: 'browser journeys', countFromJson: playwrightCount }
];

/** `--api=563` / `--api-json=path/to/report.json`, in either order. */
const parseArgs = () =>
  new Map(
    process.argv.slice(2).map((arg) => {
      const [key, ...rest] = arg.replace(/^--/, '').split('=');
      return [key, rest.join('=')];
    })
  );

const args = parseArgs();
const claim = readClaim();

const failures = [];

// ---------------------------------------------------------------------------
// Check 0 — the README agreeing with itself. Needs no test run either.
// ---------------------------------------------------------------------------
failures.push(...checkEchoes(claim, readFileSync(README, 'utf8')));

// ---------------------------------------------------------------------------
// Check 1 — the README's own arithmetic. Needs no test run.
// ---------------------------------------------------------------------------
const parts = claim.api + claim.component + claim.e2e;
if (parts !== claim.total) {
  failures.push(
    `  ARITHMETIC  README says ${claim.total.toLocaleString('en-US')} assertions in total, but its ` +
      `own parts add to ${parts.toLocaleString('en-US')} ` +
      `(${claim.api} API + ${claim.component} component + ${claim.e2e} journeys)`
  );
}

// ---------------------------------------------------------------------------
// Check 2 — the measured counts, for whichever layers were supplied.
// ---------------------------------------------------------------------------
const measured = [];
for (const layer of LAYERS) {
  const direct = args.get(layer.key);
  const file = args.get(`${layer.key}-json`);

  if (direct !== undefined && file !== undefined) {
    console.error(`  --${layer.key} and --${layer.key}-json are mutually exclusive; pass one.`);
    process.exit(1);
  }

  let count;
  if (direct !== undefined) count = toNumber(direct);
  else if (file !== undefined) count = layer.countFromJson(resolve(ROOT, file));
  else continue;

  measured.push(layer.key);
  if (count !== claim[layer.key]) {
    const direction = count > claim[layer.key] ? 'grown' : 'shrunk';
    failures.push(
      `  MISMATCH    ${layer.label} — README says ${claim[layer.key]}, the suite has ${count} ` +
        `(${direction} by ${Math.abs(count - claim[layer.key])})`
    );
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  console.error(
    '\n  The README states these numbers as fact. Re-run the suites, update the sentence in\n' +
      '  README.md (including the headline total), and note the sprint it was measured at.'
  );
  process.exit(1);
}

const summary =
  `${claim.total.toLocaleString('en-US')} = ${claim.api} API + ${claim.component} component + ` +
  `${claim.e2e} journeys`;

if (measured.length === LAYERS.length) {
  console.log(`  OK  README's test counts match all three suites (${summary})`);
} else if (measured.length > 0) {
  console.log(`  OK  README's arithmetic holds (${summary}); measured: ${measured.join(', ')}`);
} else {
  // Said plainly rather than reported as a clean bill of health: nothing here ran a test.
  console.log(`  OK  README's arithmetic holds (${summary}) — no measured counts supplied`);
}
