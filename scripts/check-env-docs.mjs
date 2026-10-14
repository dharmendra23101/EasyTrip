#!/usr/bin/env node
/**
 * Assert that every environment variable the application reads is documented in the matching
 * `.env.example`, and that every documented variable is actually read.
 *
 * **Why this exists.** `RELEASE_CHECKLIST.md` §11 carried this as a manual step — *"diff against
 * `grep -rhoE "process\.env\.[A-Z_]+"`"* — which is a check nobody runs between releases. Running it
 * once, on 2026-08-16, found both directions already broken:
 *
 *   - **Phantom.** The README documented five `POSTGRES_HOST`/`PORT`/`USER`/`PASSWORD`/`DB`
 *     variables under the claim that they were *"still read by `src/config/db.js`"*. They are not.
 *     `db.js`'s own header says the pool that read them is gone, and `backend/.env.example` says so
 *     too — so the README was contradicted by two files it sits beside.
 *   - **Undocumented.** `API_URL` is a deliberate, load-bearing variable: server-only on purpose, so
 *     the Next server can reach the API over an internal address while the browser bundle keeps the
 *     public one. It appeared in no template, so the only way to discover it was to read
 *     `apiConfig.js`.
 *
 * The undocumented direction is the one that matters more. A phantom variable wastes somebody's
 * time; an undocumented one is a capability nobody can use, and in a deployment it is the difference
 * between a working internal route and an unexplained timeout.
 *
 * Same class as `check-api-docs.mjs`: a falsifiable claim about the repository, asserted by reading
 * text rather than by booting anything. Not a test — it makes no claim about behaviour.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * What counts as application code.
 *
 * Test and tooling files are excluded on purpose: `jest.env.js` sets `TZ`, the E2E harness sets
 * database and emulator variables, and neither belongs in a template a deployer fills in. Including
 * them would make the guard demand documentation for variables no deployment has.
 */
const TIERS = [
  {
    name: 'backend',
    template: 'backend/.env.example',
    sources: ['backend/app.js', 'backend/src', 'backend/script']
  },
  {
    name: 'frontend',
    template: 'frontend/.env.example',
    sources: ['frontend/src', 'frontend/next.config.js']
  }
];

/**
 * Variables the runtime provides, not the operator.
 *
 * Each needs a reason, so that "we forgot to document it" cannot hide as "it is on the list".
 */
const PROVIDED_BY_THE_PLATFORM = new Map([
  [
    'NODE_ENV',
    'set by the runtime or the start script, never by an operator filling in a template'
  ],
  ['CI', 'set by the CI provider'],
  ['TZ', 'process-level, set by the test runner rather than by a deployment']
]);

const JS = /\.(js|jsx|mjs|cjs)$/;

const walk = (path, out = []) => {
  const stats = statSync(path, { throwIfNoEntry: false });
  if (!stats) return out;
  if (stats.isFile()) {
    if (JS.test(path)) out.push(path);
    return out;
  }
  for (const entry of readdirSync(path)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    walk(join(path, entry), out);
  }
  return out;
};

/** Every `process.env.NAME` in a tier's application code, with the file that reads it. */
const readVariables = (tier) => {
  const found = new Map();
  for (const source of tier.sources) {
    for (const file of walk(join(ROOT, source))) {
      const text = readFileSync(file, 'utf8');
      for (const [, name] of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
        if (!found.has(name)) found.set(name, relative(ROOT, file).replace(/\\/g, '/'));
      }
    }
  }
  return found;
};

/**
 * Every variable a template mentions, whether live or commented out.
 *
 * A commented-out line counts as documented: `# TRUST_PROXY_HOPS=1` is how the templates express
 * "optional, here is what it does", and demanding an uncommented default would be worse advice.
 */
const documentedVariables = (tier) => {
  const text = readFileSync(join(ROOT, tier.template), 'utf8');
  const found = new Set();
  for (const [, name] of text.matchAll(/^\s*#?\s*([A-Z][A-Z0-9_]*)=/gm)) found.add(name);
  return found;
};

let failed = 0;
let checked = 0;

for (const tier of TIERS) {
  const read = readVariables(tier);
  const documented = documentedVariables(tier);

  const undocumented = [...read.keys()].filter(
    (name) => !documented.has(name) && !PROVIDED_BY_THE_PLATFORM.has(name)
  );
  const phantom = [...documented].filter((name) => !read.has(name));

  checked += read.size;

  for (const name of undocumented) {
    console.error(
      `  UNDOCUMENTED  ${name} — read by ${read.get(name)}, absent from ${tier.template}`
    );
    failed++;
  }
  for (const name of phantom) {
    console.error(`  PHANTOM       ${name} — documented in ${tier.template}, read by nothing`);
    failed++;
  }
}

if (failed === 0) {
  console.log(`  OK  ${checked} environment variables read, all documented, and no others`);
  process.exit(0);
}

console.error(`\n  ${failed} environment variable(s) out of step with their template`);
process.exit(1);
