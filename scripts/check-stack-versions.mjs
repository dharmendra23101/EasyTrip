#!/usr/bin/env node
/**
 * Assert that every stated framework version matches the `package.json` that owns it.
 *
 * **Why this exists.** The README's badges and `Structure.txt`'s one-line tier descriptions are
 * hand-typed numbers sitting beside three manifests that hold the truth. Sprints 8.53–8.54 moved
 * Express 4 → 5, Next 13 → 16 and React 18 → 19, and on 2026-09-07 — a month later — the
 * documentation had drifted in two directions at once:
 *
 *   - **`Structure.txt` had not moved at all.** It still described an *"Express 4 API"* and a
 *     *"Next.js 13 (Pages Router), React 18"* frontend. A reviewer reading the repository's own
 *     structure file would have concluded the stack was two majors behind what it is.
 *   - **The README's Express badge had moved, but not far enough** — it said 5.1 against an
 *     installed 5.2.1. Right major, wrong minor, and nothing checking.
 *
 * This is the same shape as the route-count sentences `check-api-docs.mjs` gained in Sprint 8.72:
 * a guarded fact (the manifest) grows an unguarded description, and **the description is what a
 * reader meets first.** Nobody opens `package.json` to find out what the stack is; they read the
 * badge.
 *
 * **What it compares, and what it deliberately does not.** A badge says `16.3`; the manifest says
 * `16.3.4`. Demanding the patch version in a badge would mean editing the README on every patch
 * bump, which is how a guard becomes a nuisance people route around. So the rule is
 * **prefix agreement**: the stated version must be a prefix of the installed one at a version
 * boundary. `16.3` matches `16.3.4`; `16` matches `16.3.4`; `16.2` does not, and neither does `5.1`
 * against `5.2.1`.
 *
 * Same class as the other guards: a falsifiable claim about the repository, asserted by reading
 * text, needing no build and no network.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const read = (file) => readFileSync(join(ROOT, file), 'utf8');
const manifest = (file) => JSON.parse(read(file));

/** `^5.2.1` / `~16.3.4` / `16.3.4` -> `5.2.1`. */
const installed = (range) => String(range || '').replace(/^[\^~>=<\s]*/, '');

const DEPS = {
  express: installed(manifest('backend/package.json').dependencies?.express),
  'firebase-admin': installed(manifest('backend/package.json').dependencies?.['firebase-admin']),
  next: installed(manifest('frontend/package.json').dependencies?.next),
  react: installed(manifest('frontend/package.json').dependencies?.react)
};

/**
 * Every place a version is stated in prose, and which dependency owns it.
 *
 * Each pattern is anchored tightly enough to name one specific claim, so a new sentence is visibly
 * unclaimed rather than silently unchecked — and adding it here is one line.
 */
const CLAIMS = [
  {
    where: "README's Next.js badge",
    dep: 'next',
    file: 'README.md',
    pattern: /Next\.js-([\d.]+)-black/
  },
  {
    where: "README's React badge",
    dep: 'react',
    file: 'README.md',
    pattern: /React-([\d.]+)-blue/
  },
  {
    where: "README's Express badge",
    dep: 'express',
    file: 'README.md',
    pattern: /Express-([\d.]+)-lightgrey/
  },
  {
    where: 'Structure.txt backend line',
    dep: 'express',
    file: 'Structure.txt',
    pattern: /Express (\d+) API/
  },
  {
    where: 'Structure.txt frontend line',
    dep: 'next',
    file: 'Structure.txt',
    pattern: /Next\.js (\d+) \(Pages Router\)/
  },
  {
    where: 'Structure.txt React mention',
    dep: 'react',
    file: 'Structure.txt',
    pattern: /Pages Router\), React (\d+)/
  }
];

/** `16.3` is a prefix of `16.3.4`; `16.2` and `5.1` are not. Compared segment-wise, not as text. */
const agrees = (stated, real) => {
  const claimed = stated.split('.');
  const actual = real.split('.');
  if (claimed.length > actual.length) return false;
  return claimed.every((segment, i) => segment === actual[i]);
};

const failures = [];
let checked = 0;

for (const { where, dep, file, pattern } of CLAIMS) {
  const real = DEPS[dep];
  if (!real) {
    failures.push(
      `  MISSING     no version for '${dep}' in its package.json — cannot check ${where}`
    );
    continue;
  }

  const found = pattern.exec(read(file));
  if (!found) {
    failures.push(
      `  MISSING     ${where} no longer matches its pattern. Restore the claim or retire it here\n` +
        `              deliberately — a claim this guard cannot find is a claim nobody is checking.`
    );
    continue;
  }

  checked++;
  if (!agrees(found[1], real)) {
    failures.push(`  STALE       ${where} says ${dep} ${found[1]}; package.json has ${real}`);
  }
}

if (failures.length === 0) {
  console.log(`  OK  ${checked} stated stack versions agree with the manifests that own them`);
  process.exit(0);
}

for (const failure of failures) console.error(failure);
console.error(
  '\n  The manifests are the source of truth. Update the badge or the line — and note that a\n' +
    '  badge may state fewer segments than the manifest (16.3 for 16.3.4), just not different ones.'
);
process.exit(1);
