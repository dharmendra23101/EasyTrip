/**
 * The translation vocabulary, enforced (`IMP-114`).
 *
 * A dictionary rots in three directions, and only one of them is visible while you work:
 *
 *  1. **A component asks for a key nothing defines.** `translate` returns the key itself, so the
 *     page renders `nav.saved` in the navbar. Visible — but only on the page you did not open.
 *  2. **A locale carries a key `en` does not.** Dead weight that reads as coverage: somebody counts
 *     twenty Hindi strings and believes twenty things are translated.
 *  3. **`next.config.js` and the code disagree about which locales exist.** A switcher offering a
 *     locale the router will not serve, or a locale served with no name to show for it.
 *
 * This is the same shape as `check-theme-vocabulary.mjs`, and for the same reason: two lists that
 * must agree, in files that are edited months apart by people who cannot see both at once.
 *
 * **`hi` being a subset of `en` is legal and checked as such** — that is the design (see
 * `dictionaries.js`), so the check asserts *no extra keys*, never *no missing keys*. A check that
 * demanded completeness would have to be suppressed on the day it was written, and a suppressed
 * check is not a check.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'frontend/src');
const DICTIONARIES = path.join(SRC, 'i18n/dictionaries.js');
const I18N_INDEX = path.join(SRC, 'i18n/index.js');
const NEXT_CONFIG = path.join(ROOT, 'frontend/next.config.js');

const problems = [];
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

/**
 * The dictionaries are read as text, not imported.
 *
 * This script is ESM and the frontend is transpiled by Next; importing a JSX-adjacent module here
 * means dragging a build step into a guard that has to run in `lint-and-build` on a bare Node. The
 * keys are quoted string literals at a known nesting, so a scan is sufficient and has no toolchain.
 */
const readDictionary = (text, name) => {
  const start = text.indexOf(`export const ${name} = {`);
  if (start === -1) return null;
  const open = text.indexOf('{', start);
  let depth = 0;
  let end = open;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const body = text.slice(open, end);
  return new Set([...body.matchAll(/^\s*'([^']+)':/gm)].map((m) => m[1]));
};

const walk = (dir, found = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, found);
    else if (/\.(js|jsx)$/.test(entry.name)) found.push(full);
  }
  return found;
};

const dictText = fs.readFileSync(DICTIONARIES, 'utf8');
const en = readDictionary(dictText, 'en');
const hi = readDictionary(dictText, 'hi');

if (!en || !hi) {
  console.error(
    `  FAIL  ${rel(DICTIONARIES)} no longer exports both \`en\` and \`hi\` as objects.`
  );
  console.error('        The guard reads them by name; renaming one silently disables this check.');
  process.exit(1);
}

// 2. No locale may carry a key English does not define.
for (const key of hi) {
  if (!en.has(key)) problems.push(`hi defines '${key}', which \`en\` does not. Dead string.`);
}

// 1. Every key a component asks for must resolve in English.
const callSites = new Map();
for (const file of walk(SRC)) {
  if (file.startsWith(path.join(SRC, 'i18n'))) continue;
  const text = fs.readFileSync(file, 'utf8');
  for (const match of text.matchAll(/\bt\(\s*'([^']+)'\s*\)/g)) {
    if (!callSites.has(match[1])) callSites.set(match[1], rel(file));
  }
}
for (const [key, file] of callSites) {
  if (!en.has(key)) problems.push(`${file} asks for '${key}', which \`en\` does not define.`);
}

// 3. The locale list, the endonyms and the router config must be the same set.
const indexText = fs.readFileSync(I18N_INDEX, 'utf8');
const declared = [
  ...(indexText.match(/export const LOCALES = \[([^\]]+)\]/)?.[1] ?? '').matchAll(/'([^']+)'/g)
].map((m) => m[1]);
const named = [
  ...(indexText.match(/export const LOCALE_NAMES = \{([^}]+)\}/)?.[1] ?? '').matchAll(/(\w+):/g)
].map((m) => m[1]);
const routed = [
  ...(fs.readFileSync(NEXT_CONFIG, 'utf8').match(/locales:\s*\[([^\]]+)\]/)?.[1] ?? '').matchAll(
    /'([^']+)'/g
  )
].map((m) => m[1]);

if (declared.length === 0)
  problems.push('`LOCALES` could not be read from frontend/src/i18n/index.js.');
if (routed.length === 0)
  problems.push('`i18n.locales` could not be read from frontend/next.config.js.');

const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
if (declared.length && routed.length && !same(declared, routed)) {
  problems.push(
    `LOCALES [${declared}] and next.config.js i18n.locales [${routed}] disagree. ` +
      'The switcher would offer a locale the router will not serve, or the reverse.'
  );
}
if (declared.length && !same(declared, named)) {
  problems.push(
    `LOCALES [${declared}] and LOCALE_NAMES [${named}] disagree — a locale with no name to show.`
  );
}

if (problems.length > 0) {
  console.error('  FAIL  translation vocabulary is inconsistent:\n');
  for (const problem of problems) console.error(`        - ${problem}`);
  process.exit(1);
}

const coverage = Math.round((hi.size / en.size) * 100);
console.log(
  `  OK  ${en.size} English strings, ${callSites.size} distinct call sites, all resolved; ` +
    `hi covers ${hi.size}/${en.size} (${coverage}%) with no dead keys; ` +
    `locales [${declared}] agree across config, code and names`
);
