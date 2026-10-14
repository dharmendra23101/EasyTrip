/**
 * Fail-fast environment validation for the frontend (IMP-100).
 *
 * Required from `next.config.js`, which Next loads for `dev`, `build` and `start` alike — so this
 * is the one place that runs before anything else regardless of how the app was started.
 *
 * Why it matters more here than on a server: every `NEXT_PUBLIC_*` value is **inlined into the
 * JavaScript bundle at build time**. A missing variable is not a runtime configuration problem
 * that can be fixed by restarting with the right value — it is baked into the artifact. The build
 * succeeds, deploys, and then every Firebase call fails in the browser with `auth/invalid-api-key`,
 * or every API request goes to the literal string "undefined/places". Catching it at build time is
 * the difference between a red pipeline and a broken production site.
 *
 * Severity depends on the command, and ONLY `next build` is fatal:
 *
 *   `next build`  → missing required variables THROW and stop the build. This is the only moment
 *                   that matters, because it is the only moment the values are captured.
 *   `next start`  → warn only. The bundle it serves was built earlier; these variables were baked
 *                   in then and are not read now. Failing here would block a correctly-built
 *                   artifact from starting over variables it no longer needs.
 *   `next dev`    → warn only. A newcomer who has cloned the repo and not yet filled in .env.local
 *                   should still be able to start the app and see the UI.
 *   `next lint`   → warn only. Linting is static analysis; requiring a runtime environment to run
 *                   it would mean CI has to provision credentials before it can check syntax.
 *
 * (The first version of this file threw on everything except `next dev`, which broke `next lint`
 * outright — and CI lints before it builds, so it would have failed on the lint step with an
 * error about Firebase configuration.)
 *
 * Never prints a value — only names. See backend/src/config/env.js for the same rule and why.
 */

const REQUIRED = [
  {
    name: 'NEXT_PUBLIC_API_URL',
    describe: 'Base URL of the Express backend, including the /api suffix',
    validate: (value) => {
      try {
        new URL(value);
      } catch {
        return 'is not a valid URL';
      }
      // The service layer concatenates this with paths like `/places`. A trailing slash produces
      // `.../api//places`, which some hosts 404 and others silently redirect.
      if (value.endsWith('/')) return 'has a trailing slash — remove it';
      if (!value.endsWith('/api')) {
        return 'does not end in /api — the service layer appends paths directly to it';
      }
      return null;
    }
  },
  {
    name: 'NEXT_PUBLIC_FIREBASE_API_KEY',
    describe: 'firebaseConfig.apiKey — a public project identifier, not a secret'
  },
  {
    name: 'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
    describe: 'firebaseConfig.authDomain — used by the sign-in redirect flow'
  },
  {
    name: 'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
    describe: 'firebaseConfig.projectId'
  },
  {
    name: 'NEXT_PUBLIC_FIREBASE_APP_ID',
    describe: 'firebaseConfig.appId'
  }
];

const RECOMMENDED = [
  {
    name: 'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
    describe: 'firebaseConfig.storageBucket — getStorage() is initialised at import time'
  },
  {
    name: 'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
    describe: 'firebaseConfig.messagingSenderId'
  }
];

const isBlank = (value) => value === undefined || value === null || String(value).trim() === '';

const collectEnvProblems = (env = process.env) => {
  const errors = [];
  const warnings = [];

  for (const rule of REQUIRED) {
    const value = env[rule.name];
    if (isBlank(value)) {
      errors.push(`${rule.name} is not set — ${rule.describe}`);
    } else if (rule.validate) {
      const problem = rule.validate(String(value).trim());
      if (problem) errors.push(`${rule.name} ${problem}`);
    }
  }

  for (const rule of RECOMMENDED) {
    if (isBlank(env[rule.name])) {
      warnings.push(`${rule.name} is not set — ${rule.describe}`);
    }
  }

  return { errors, warnings };
};

/**
 * True only when the current process is `next build`.
 *
 * Read from argv rather than NODE_ENV, because NODE_ENV cannot tell `build` from `start` — Next
 * sets it to "production" for both — and `start` must not be fatal.
 */
const isBuildCommand = (argv = process.argv) => argv.slice(2)[0] === 'build';

const validateEnv = ({ env = process.env, isBuild = isBuildCommand() } = {}) => {
  const { errors, warnings } = collectEnvProblems(env);

  for (const warning of warnings) {
    console.warn(`⚠️  ${warning}`);
  }

  if (errors.length === 0) return true;

  const summary =
    `\n${isBuild ? '❌' : '⚠️ '} frontend environment: ${errors.length} problem(s) found.\n\n` +
    errors.map((error) => `   • ${error}`).join('\n') +
    `\n\n   frontend/.env.example documents every variable. To start from it:\n` +
    `       cp frontend/.env.example frontend/.env.local\n`;

  if (!isBuild) {
    // Warn and continue — see the header. The app will start; Firebase and the API will not work.
    console.warn(`${summary}\n   Continuing anyway — only \`next build\` treats this as fatal.\n`);
    return false;
  }

  // Throwing from next.config.js is what actually stops `next build`. `process.exit(1)` would
  // work too but skips Next's own error formatting and reads like a crash rather than a check.
  throw new Error(
    `${summary}\n   These values are inlined into the browser bundle at build time, so building ` +
      `without them\n   produces an artifact that cannot be fixed by setting them later.\n`
  );
};

module.exports = { validateEnv, collectEnvProblems, isBuildCommand, REQUIRED, RECOMMENDED };
