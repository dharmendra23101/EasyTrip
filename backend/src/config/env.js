/**
 * Fail-fast environment validation (IMP-100).
 *
 * The failure mode this exists to prevent: the server boots happily with a missing variable, and
 * the problem surfaces later as something that looks unrelated. A missing `FIREBASE_PRIVATE_KEY`
 * used to present as every authenticated request returning 500. An unset `DATABASE_URL` produced
 * "database does not exist" against a default local socket, naming a database nobody configured.
 * Both are ten-second fixes once you know, and a long afternoon when you don't.
 *
 * Two rules shape this file:
 *
 * 1. REPORT EVERY PROBLEM AT ONCE. Validating one variable, exiting, and making the operator
 *    re-run to discover the next one turns a single fix into five deploys.
 *
 * 2. NEVER PRINT A VALUE. Only names and a description of what is wrong. Boot logs end up in
 *    dashboards, CI output, and screenshots; a validator that echoes the connection string it is
 *    complaining about is a credential leak with good intentions.
 *
 * Called from `app.js` before anything else is required, so it runs before the Firebase and
 * Cloudinary config modules try to use the values.
 */

const isProduction = () => process.env.NODE_ENV === 'production';

const isBlank = (value) => value === undefined || value === null || String(value).trim() === '';

/**
 * The contract. `required: true` means the server cannot work without it; `productionOnly` means
 * it is required when NODE_ENV=production and merely warned about in development, where a working
 * default exists or the feature it powers is optional locally.
 */
const RULES = [
  {
    name: 'DATABASE_URL',
    required: true,
    describe: 'Postgres connection string, e.g. postgresql://user:pass@host:5432/easytrip',
    validate: (value) => {
      // Checked by parsing rather than by regex: `new URL` is what pg effectively does, so this
      // rejects exactly the strings pg would choke on and accepts the ones it would not.
      let parsed;
      try {
        parsed = new URL(value);
      } catch {
        return 'is not a valid URL';
      }
      if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
        return `has protocol "${parsed.protocol}" — expected postgres:// or postgresql://`;
      }
      if (!parsed.pathname || parsed.pathname === '/') {
        return 'has no database name after the host';
      }
      return null;
    }
  },
  {
    name: 'FIREBASE_PROJECT_ID',
    required: true,
    describe: 'Firebase project id — "project_id" in the service-account JSON'
  },
  {
    name: 'FIREBASE_CLIENT_EMAIL',
    required: true,
    describe: 'Service-account email — "client_email" in the service-account JSON',
    validate: (value) => (value.includes('@') ? null : 'does not look like an email address')
  },
  {
    name: 'FIREBASE_PRIVATE_KEY',
    required: true,
    describe: 'Service-account private key — "private_key" in the service-account JSON',
    validate: (value) => {
      if (!value.includes('BEGIN PRIVATE KEY')) {
        return 'does not contain "BEGIN PRIVATE KEY" — is the whole key present?';
      }
      // The single most common way this variable is wrong. dotenv keeps `\n` literal inside a
      // quoted value, and firebase-admin.js expands it back; an unquoted or truly multi-line value
      // arrives truncated at the first newline and fails deep inside the Admin SDK.
      if (!value.includes('\\n') && !value.includes('\n')) {
        return 'has no line breaks — wrap it in double quotes and keep the literal \\n sequences';
      }
      return null;
    }
  },
  {
    name: 'OPENROUTESERVICE_API_KEY',
    // Deliberately neither required nor production-only. Absent, `routingService` reports itself
    // unconfigured and the feasibility engine keeps the straight-line estimate it has always used
    // (`FV-026` stage b) — so a deployment with no key is a *less precise* product, not a broken
    // one, and the boot gate must not claim otherwise.
    describe:
      'Optional. OpenRouteService key for real road distances; without it travel times stay estimates'
  },
  {
    name: 'CORS_ALLOWED_ORIGINS',
    productionOnly: true,
    describe: 'Comma-separated browser origins allowed to call this API',
    // In production an empty allowlist 403s every browser request, which presents as a site-wide
    // outage with no server error. Development falls back to http://localhost:3000 in app.js.
    productionReason: 'every browser request would be rejected with a CORS failure'
  },
  {
    name: 'CLOUDINARY_CLOUD_NAME',
    productionOnly: true,
    describe: 'Cloudinary cloud name',
    productionReason: 'image uploads would fail'
  },
  {
    name: 'CLOUDINARY_API_KEY',
    productionOnly: true,
    describe: 'Cloudinary API key',
    productionReason: 'image uploads would fail'
  },
  {
    name: 'CLOUDINARY_API_SECRET',
    productionOnly: true,
    describe: 'Cloudinary API secret — treat as a password',
    productionReason: 'image uploads would fail'
  },
  {
    name: 'PORT',
    optional: true,
    describe: 'Port Express listens on (default 5000)',
    validate: (value) => {
      const port = Number(value);
      return Number.isInteger(port) && port > 0 && port < 65536
        ? null
        : 'is not a port number between 1 and 65535';
    }
  },
  {
    name: 'TRUST_PROXY_HOPS',
    optional: true,
    describe: 'Number of reverse-proxy hops in front of the app',
    validate: (value) => {
      const hops = Number(value);
      return Number.isInteger(hops) && hops >= 0
        ? null
        : 'is not a non-negative integer — leave it unset when nothing proxies the app';
    }
  },
  {
    name: 'PG_POOL_MAX',
    optional: true,
    describe: 'Maximum Postgres connections in the pool (default 10)',
    validate: (value) => {
      const max = Number(value);
      return Number.isInteger(max) && max > 0 ? null : 'is not a positive integer';
    }
  }
];

/**
 * Returns `{ errors, warnings }` rather than exiting, so it can be exercised without spawning a
 * process. `validateEnv()` below is the part that decides a bad environment is fatal.
 */
const collectEnvProblems = (env = process.env) => {
  const errors = [];
  const warnings = [];
  const production = env.NODE_ENV === 'production';

  /**
   * `FIREBASE_AUTH_EMULATOR_HOST` must never be set in production.
   *
   * This is not one of the RULES below because it is not a variable this app reads — it is one the
   * **Firebase Admin SDK reads on its own**. When it is set, `verifyIdToken()` stops checking
   * signatures and accepts any token the named emulator would issue, including the `alg: none`
   * tokens the emulator mints freely. Setting it against a production deployment therefore turns
   * the entire authentication layer off, silently, with no code change and nothing in the logs.
   *
   * That was true before this check existed; the SDK has always honoured the variable. What is new
   * is that the E2E suite (`IMP-094`/`TD-020`) now *uses* it deliberately, which makes it a value
   * someone might copy from a test environment into a real one. A misconfiguration that disables
   * signature verification should stop the server, not be discovered later.
   *
   * The same reasoning as `IMP-002`: the difference between "authentication is enforced" and
   * "authentication is skipped" must not be a single environment variable nobody checks.
   */
  if (production && !isBlank(env.FIREBASE_AUTH_EMULATOR_HOST)) {
    errors.push(
      'FIREBASE_AUTH_EMULATOR_HOST is set while NODE_ENV=production — the Firebase Admin SDK ' +
        'would skip token signature verification entirely and accept forged tokens. Unset it. ' +
        'It belongs only to the E2E suite (see e2e/README.md).'
    );
  }

  for (const rule of RULES) {
    const value = env[rule.name];

    if (isBlank(value)) {
      if (rule.required) {
        errors.push(`${rule.name} is not set — ${rule.describe}`);
      } else if (rule.productionOnly) {
        const message = `${rule.name} is not set — ${rule.describe}`;
        if (production) {
          errors.push(`${message}. In production ${rule.productionReason}.`);
        } else {
          warnings.push(`${message}. Required in production.`);
        }
      }
      continue;
    }

    // Format checks run on whatever is present, required or not: a malformed optional value is
    // worse than an absent one, because the absent one falls back to a working default.
    if (rule.validate) {
      const problem = rule.validate(String(value));
      if (problem) {
        const message = `${rule.name} ${problem}`;
        if (rule.optional) {
          warnings.push(`${message}. Falling back to the default.`);
        } else {
          errors.push(message);
        }
      }
    }
  }

  return { errors, warnings };
};

/**
 * Validates and, on failure, prints every problem and exits non-zero.
 *
 * Exiting is the point. A process that half-works is harder to diagnose than one that refuses to
 * start with a list of what is missing.
 */
const validateEnv = (env = process.env) => {
  const { errors, warnings } = collectEnvProblems(env);

  for (const warning of warnings) {
    console.warn(`⚠️  ${warning}`);
  }

  if (errors.length === 0) {
    return true;
  }

  console.error(`\n❌ FATAL: the environment is not usable — ${errors.length} problem(s) found.\n`);
  for (const error of errors) {
    console.error(`   • ${error}`);
  }
  console.error(
    `\n   backend/.env.example documents every variable. To start from it:\n` +
      `       cp backend/.env.example backend/.env\n` +
      `\n   NODE_ENV is currently ${env.NODE_ENV ? `"${env.NODE_ENV}"` : 'unset (treated as non-production)'}.\n`
  );

  process.exit(1);
};

module.exports = { validateEnv, collectEnvProblems, isProduction, RULES };
