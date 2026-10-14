#!/usr/bin/env node
/**
 * Refuse to let a credential become tracked (`IMP-051`, the enforcement half).
 *
 * **This repository has already paid for the absence of this check.** `backend/.env` — real
 * Firebase private key, real Cloudinary secret, real database URL — sits in three commits of public
 * history (`SECURITY_AUDIT` §12.0). `.gitignore` was added afterwards (`IMP-051`), which stops the
 * *next* accidental `git add` but proves nothing on an ongoing basis: a `.gitignore` line can be
 * deleted, a secret can be pasted into a file that is not named `.env`, and neither shows up in a
 * lint run, a build, or any of the 278 assertions.
 *
 * This is the detection half. **It cannot fix the exposure that already exists** — that needs
 * credential rotation, which is the owner's decision and is deliberately untouched here.
 *
 * ## What it checks, and why in this order
 *
 * 1. **Ignore rules still work.** For every tier shipping a `.env.example`, the sibling `.env` must
 *    be ignored. This is the invariant that actually failed in 2025; asserting the *rule* rather
 *    than the *absence of the file* is what makes it a guard instead of a coincidence — a clean
 *    checkout has no `.env` either way.
 * 2. **No credential-shaped file is tracked.** `.env`, service-account JSON, `.pem`/`.key`/`.p12`.
 *    Name-based, so it catches a real key regardless of its contents.
 * 3. **No credential-shaped value is tracked.** Content patterns, deliberately narrow (below).
 *
 * ## Why the content patterns are narrow
 *
 * A scanner that cries wolf gets disabled, and this repo has an entry about exactly that
 * (`@next/next/no-img-element`, switched off because 19 warnings per run made the whole lint run
 * unreadable). So every pattern here requires evidence of a *real* value, not the shape of one:
 * a PEM header must be followed by a genuine base64 body, a Postgres URL must carry a password that
 * is not one of the documented dev placeholders. `backend/.env.example` legitimately contains
 * `-----BEGIN PRIVATE KEY-----\nREPLACE_WITH_YOUR_PRIVATE_KEY\n-----END PRIVATE KEY-----` and must
 * pass, forever, without a waiver.
 *
 * ## It never prints a secret
 *
 * Findings report `file:line` and the name of the rule that fired. CI logs are public, and a
 * scanner that echoes the value it found has published it a second time.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Known-safe values that would otherwise look real.
 *
 * Same contract as `scripts/check-module-size.mjs`: an entry that stops matching anything is itself
 * a failure. A waiver list nobody prunes becomes a list of rules nobody enforces.
 */
const WAIVERS = [];

/** Passwords that appear in this repo on purpose, in documentation and local compose files. */
const PLACEHOLDER_SECRETS = new Set([
  'easytrip',
  'postgres',
  'password',
  'changeme',
  'example',
  'replace_me',
  'your_password',
  'secret'
]);

const PLACEHOLDER_MARKERS =
  /replace[_-]?(me|with)|your[_-]|placeholder|example|xxxxx|<[a-z-]+>|\$\{|changeme|\bci-\b|\be2e-\b/i;

const RULES = [
  {
    name: 'private-key-with-body',
    // A PEM header is not a secret; a PEM header followed by an actual base64 body is. The example
    // file's `REPLACE_WITH_YOUR_PRIVATE_KEY` is 29 chars of A-Z and underscores, and underscore is
    // not in the base64 alphabet — so it cannot reach the threshold however long it gets.
    test: (text) =>
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\\n]*[A-Za-z0-9+/=\s\\n]{200,}/.test(
        text
      )
  },
  {
    name: 'google-api-key',
    // Google/Firebase browser keys are exactly `AIza` + 35 chars. Nothing else has that shape.
    test: (text) => /AIza[0-9A-Za-z_-]{35}/.test(text)
  },
  {
    name: 'cloudinary-url',
    test: (text) => /cloudinary:\/\/\d{9,}:[A-Za-z0-9_-]{20,}@/.test(text)
  },
  {
    name: 'postgres-url-with-password',
    test: (text) => {
      for (const m of text.matchAll(/postgres(?:ql)?:\/\/[^:@\s/'"]+:([^@\s/'"]+)@/g)) {
        const password = m[1];
        if (PLACEHOLDER_SECRETS.has(password.toLowerCase())) continue;
        if (PLACEHOLDER_MARKERS.test(password)) continue;
        if (password.length < 8) continue;
        return true;
      }
      return false;
    }
  },
  {
    name: 'assigned-secret-literal',
    test: (text) => {
      const re =
        /\b(?:[A-Z_]*(?:SECRET|PASSWORD|PRIVATE_KEY|ACCESS_TOKEN|API_KEY)[A-Z_]*)\s*[=:]\s*["']?([A-Za-z0-9+/_-]{24,})["']?/g;
      for (const m of text.matchAll(re)) {
        const value = m[1];
        if (PLACEHOLDER_MARKERS.test(value)) continue;
        // Require a genuinely mixed alphabet. Long lowercase-only words are English, not entropy —
        // `CLOUDINARY_API_SECRET=replace-with-cloudinary-api-secret` must not fire.
        const mixed = /[a-z]/.test(value) && /[A-Z]/.test(value) && /[0-9]/.test(value);
        if (!mixed) continue;
        return true;
      }
      return false;
    }
  }
];

/** File names that are credentials whatever they contain. */
const FORBIDDEN_NAMES = [
  { pattern: /(^|\/)\.env(\.|$)/, unless: /\.env\.example$/, why: 'environment file' },
  { pattern: /service[-_]?account.*\.json$/i, why: 'service-account key' },
  { pattern: /firebase-adminsdk.*\.json$/i, why: 'Firebase Admin service-account key' },
  { pattern: /\.(pem|p12|p8|key)$/i, why: 'private key or certificate' }
];

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'),
  '..'
);
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });

const tracked = git('ls-files').split('\n').filter(Boolean);
const findings = [];
const waiversUsed = new Set();

const waiverFor = (file, rule) =>
  WAIVERS.find((w) => w.file === file.replace(/\\/g, '/') && w.rule === rule);

// ---------------------------------------------------------------------------
// 1. The ignore rules still do their job.
// ---------------------------------------------------------------------------
for (const example of tracked.filter((f) => f.endsWith('.env.example'))) {
  const envPath = example.replace(/\.env\.example$/, '.env');
  let ignored = false;
  try {
    execFileSync('git', ['check-ignore', '-q', envPath], { cwd: ROOT, stdio: 'ignore' });
    ignored = true;
  } catch {
    /* check-ignore exits 1 when the path is NOT ignored */
  }
  if (!ignored) {
    // `git check-ignore` reports a **tracked** file as not-ignored, whatever `.gitignore` says —
    // because that is the truth. Ignore rules only ever apply to untracked paths. Distinguishing
    // the two cases matters here: they need opposite fixes, and the second one is this repository's
    // actual history. `backend/.env` was committed *before* `IMP-051` added the rule, and adding
    // the rule afterwards changed nothing about the file already in the index.
    const isTracked = tracked.includes(envPath);
    findings.push({
      file: envPath,
      rule: isTracked ? 'env-tracked-despite-ignore-rule' : 'env-not-ignored',
      detail: isTracked
        ? 'this file is TRACKED, which overrides every ignore rule — `git rm --cached` it, and rotate anything it ever contained'
        : `${example} exists, so someone will create ${envPath}, and no ignore rule covers it`
    });
  }
}

// ---------------------------------------------------------------------------
// 2. No credential-shaped file is tracked.
// ---------------------------------------------------------------------------
for (const file of tracked) {
  const posix = file.replace(/\\/g, '/');
  for (const rule of FORBIDDEN_NAMES) {
    if (rule.unless && rule.unless.test(posix)) continue;
    if (rule.pattern.test(posix)) {
      findings.push({ file: posix, rule: 'tracked-credential-file', detail: rule.why });
    }
  }
}

// ---------------------------------------------------------------------------
// 3. No credential-shaped value is tracked.
// ---------------------------------------------------------------------------
const BINARY = /\.(png|jpe?g|gif|ico|webp|woff2?|pdf|zip|mp4)$/i;
for (const file of tracked) {
  if (BINARY.test(file)) continue;
  const full = path.join(ROOT, file);
  let text;
  try {
    text = fs.readFileSync(full, 'utf8');
  } catch {
    continue;
  }
  // A NUL byte means the file is binary despite its extension. Scanning it produces noise, not
  // findings, and a noisy scanner is one somebody eventually switches off. Written as an escape
  // rather than a literal NUL so this source file stays text to grep, diff and review tools.
  if (text.includes('\u0000')) continue;

  for (const rule of RULES) {
    if (!rule.test(text)) continue;
    const waiver = waiverFor(file, rule.name);
    if (waiver) {
      waiversUsed.add(`${waiver.file}::${waiver.rule}`);
      continue;
    }
    // Locate the line without ever storing or printing the value.
    const line = text.split('\n').findIndex((l) => rule.test(l)) + 1;
    findings.push({ file: file.replace(/\\/g, '/'), rule: rule.name, line: line || undefined });
  }
}

// ---------------------------------------------------------------------------
// 4. Stale waivers are failures too.
// ---------------------------------------------------------------------------
for (const w of WAIVERS) {
  if (!waiversUsed.has(`${w.file}::${w.rule}`)) {
    findings.push({
      file: w.file,
      rule: 'stale-waiver',
      detail: `waives "${w.rule}", which no longer matches. Delete the waiver.`
    });
  }
}

if (findings.length > 0) {
  console.error('\n  SECRET SCAN FAILED\n');
  for (const f of findings) {
    const where = f.line ? `${f.file}:${f.line}` : f.file;
    console.error(`  ${f.rule.padEnd(26)} ${where}${f.detail ? ` — ${f.detail}` : ''}`);
  }
  console.error(
    '\n  Values are deliberately not printed: this output goes to a public CI log.\n' +
      '  If a real credential reached a commit, rotate it first — removing it from the working\n' +
      '  tree does not remove it from history. See SECURITY_AUDIT.md §12.0.\n'
  );
  process.exit(1);
}

console.log(
  `  OK  ${tracked.length} tracked files, no credential-shaped names or values ` +
    `(${WAIVERS.length} documented waiver${WAIVERS.length === 1 ? '' : 's'})`
);
