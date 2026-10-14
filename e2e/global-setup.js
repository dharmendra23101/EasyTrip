/**
 * Provision everything the browser will talk to (IMP-094).
 *
 * Runs once before the suite: a database with the real schema and deterministic fixtures, and the
 * real Express API pointed at it. Playwright's own `webServer` starts only the Next server, so this
 * file does not depend on Playwright's ordering between `globalSetup` and `webServer`.
 *
 * **Two provisioning modes, deliberately.** If `DATABASE_URL` is already set — which is what CI's
 * Postgres service container gives us — it is used as-is. Otherwise a throwaway cluster is booted
 * on a port nobody else uses and destroyed on teardown. The suite therefore runs from a clean
 * checkout on a laptop *and* in CI without a second code path for either.
 *
 * **The suite never touches a developer's own database.** It truncates and re-seeds, so pointing it
 * at port 5432 would be destructive. The throwaway cluster uses its own port and its own data
 * directory under the OS temp dir.
 */
const { spawn, execFileSync } = require('node:child_process');
const { generateKeyPairSync } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const authEmulator = require('./auth-emulator');

const ROOT = path.resolve(__dirname, '..');
const BACKEND = path.join(ROOT, 'backend');
const API_PORT = Number(process.env.E2E_API_PORT || 5100);
const FRONTEND_PORT = Number(process.env.E2E_FRONTEND_PORT || 3100);
const PG_PORT = Number(process.env.E2E_PG_PORT || 55470);

/** Written for global-teardown, which runs in a separate process. */
const STATE_FILE = path.join(os.tmpdir(), 'easytrip-e2e-state.json');

const log = (message) => console.log(`  [e2e setup] ${message}`);

/**
 * Record a started resource immediately, rather than describing the whole stack at the end.
 *
 * **Why incrementally.** This file used to write `STATE_FILE` once, after Postgres, the schema, the
 * auth emulator *and* the API had all succeeded — and `global-teardown` returns early when the file
 * does not exist. So any failure part-way through setup left teardown with nothing to stop, and
 * whatever had already started leaked. Observed on 2026-08-11: the emulator failed to become ready,
 * setup threw, and the throwaway Postgres was still holding port 55470 afterwards.
 *
 * Writing after each resource means teardown can always clean up exactly what got as far as
 * existing. It survives a hard kill of this process too, which a `try/catch` around the body would
 * not. `global-teardown` already guards every field independently, so a partial file is something
 * it handles rather than something it has to be taught.
 */
const recordState = (patch) => {
  let current = {};
  try {
    current = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    /* first write of this run, or an unreadable leftover — either way start clean */
  }
  fs.writeFileSync(STATE_FILE, JSON.stringify({ ...current, ...patch }));
};

/** Locate the Postgres binaries without assuming they are on PATH. */
const findPgBin = () => {
  if (process.env.E2E_PG_BIN) return process.env.E2E_PG_BIN;
  try {
    execFileSync('pg_ctl', ['--version'], { stdio: 'ignore' });
    return '';
  } catch {
    /* not on PATH — fall through to the well-known Windows install locations */
  }
  const candidates = [18, 17, 16, 15, 14].map((v) => `C:/Program Files/PostgreSQL/${v}/bin`);
  const found = candidates.find((dir) => fs.existsSync(path.join(dir, 'pg_ctl.exe')));
  if (!found) {
    throw new Error(
      'No Postgres binaries found. Either set DATABASE_URL to an existing throwaway database, ' +
        'or set E2E_PG_BIN to a directory containing initdb/pg_ctl.'
    );
  }
  return found;
};

const pgTool = (pgBin, name) => (pgBin ? path.join(pgBin, name) : name);

/** Boot a disposable cluster. Returns the connection string. */
const startThrowawayPostgres = () => {
  const pgBin = findPgBin();
  const dataDir = path.join(os.tmpdir(), `easytrip-e2e-pg-${PG_PORT}`);

  // A previous run that was interrupted leaves a live postmaster holding this directory, and
  // `rmSync` then fails with EBUSY — a confusing error that has nothing to do with the code under
  // test. Stop whatever is there first. Same reasoning as `releaseStalePorts` in `auth-emulator.js`:
  // a test harness that cannot recover from its own crash makes every later failure ambiguous.
  try {
    execFileSync(pgTool(pgBin, 'pg_ctl'), ['-D', dataDir, '-m', 'immediate', 'stop'], {
      stdio: 'ignore'
    });
    log('stopped a Postgres left running by an interrupted run');
  } catch {
    /* nothing running there, which is the normal case */
  }

  fs.rmSync(dataDir, { recursive: true, force: true });
  log(`initialising a throwaway Postgres in ${dataDir}`);
  execFileSync(
    pgTool(pgBin, 'initdb'),
    ['-D', dataDir, '-U', 'postgres', '--auth=trust', '--encoding=UTF8'],
    {
      stdio: 'ignore'
    }
  );

  execFileSync(
    pgTool(pgBin, 'pg_ctl'),
    [
      '-D',
      dataDir,
      '-o',
      `-p ${PG_PORT} -c listen_addresses=127.0.0.1`,
      '-l',
      `${dataDir}.log`,
      'start'
    ],
    { stdio: 'ignore' }
  );

  // pg_ctl returns before the server accepts connections.
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      execFileSync(
        pgTool(pgBin, 'pg_isready'),
        ['-h', '127.0.0.1', '-p', String(PG_PORT), '-U', 'postgres'],
        {
          stdio: 'ignore'
        }
      );
      break;
    } catch {
      execFileSync(process.execPath, ['-e', 'setTimeout(()=>{},500)']);
    }
  }

  execFileSync(
    pgTool(pgBin, 'createdb'),
    ['-h', '127.0.0.1', '-p', String(PG_PORT), '-U', 'postgres', 'easytrip_e2e'],
    {
      stdio: 'ignore'
    }
  );

  log(`throwaway Postgres ready on ${PG_PORT}`);
  return { url: `postgresql://postgres@127.0.0.1:${PG_PORT}/easytrip_e2e`, dataDir, pgBin };
};

/** Build the schema from nothing, apply every migration, then seed — the same path CI takes. */
const buildSchema = async (databaseUrl) => {
  const { Pool } = require(path.join(BACKEND, 'node_modules', 'pg'));
  const pool = new Pool({ connectionString: databaseUrl });

  const schema = fs.readFileSync(path.join(BACKEND, 'src/config/schema.sql'), 'utf8');
  await pool.query(schema);

  const migrationsDir = path.join(BACKEND, 'src/config/migrations');
  const migrations = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of migrations) {
    await pool.query(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
  }
  log(`schema + ${migrations.length} migrations applied`);

  // The same deterministic fixtures the API suite uses (IMP-095), so a place id means the same
  // thing in both suites and an assertion can name "place 1" without inspecting the database.
  const { reseed } = require(path.join(BACKEND, 'src/config/seed.js'));
  await reseed(pool);
  log('seeded');

  await pool.end();
};

/**
 * A structurally valid throwaway RSA key.
 *
 * `firebase-admin` parses the private key at init and `app.js` refuses to start if it cannot —
 * correct behaviour, since every authenticated route would otherwise reject. A placeholder string
 * fails DER parsing, so the API would never boot. This key is generated per run, never written to
 * the repository, and never used to sign anything: the suite does not authenticate through
 * Firebase (see `e2e/README.md`).
 */
const throwawayPrivateKey = () =>
  generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' }
  }).privateKey;

const startApi = async (databaseUrl) => {
  const api = spawn(process.execPath, ['app.js'], {
    cwd: BACKEND,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      // Not "production": that turns on TLS certificate verification (IMP-063) against a plaintext
      // local cluster and would fail for the wrong reason.
      NODE_ENV: 'test',
      PORT: String(API_PORT),
      LOG_LEVEL: 'silent',
      // Must match the emulator's project: `verifyIdToken` checks the token's `aud`/`iss`
      // against it, so a mismatch here rejects every emulator-issued token for the wrong
      // reason. Kept identical whether or not the emulator ran, so there is one value.
      FIREBASE_PROJECT_ID: authEmulator.PROJECT_ID,
      FIREBASE_CLIENT_EMAIL: `e2e@${authEmulator.PROJECT_ID}.iam.gserviceaccount.com`,
      FIREBASE_PRIVATE_KEY: throwawayPrivateKey(),
      CLOUDINARY_CLOUD_NAME: 'e2e-cloud',
      CLOUDINARY_API_KEY: 'e2e-key',
      CLOUDINARY_API_SECRET: 'e2e-secret',
      // The browser loads the app from :3100 and calls the API on :5100 — a cross-origin request.
      // Both spellings, because a browser sends whichever the address bar used.
      CORS_ALLOWED_ORIGINS: `http://127.0.0.1:${FRONTEND_PORT},http://localhost:${FRONTEND_PORT}`
    }
  });

  let output = '';
  api.stdout.on('data', (chunk) => (output += chunk));
  api.stderr.on('data', (chunk) => (output += chunk));

  const healthUrl = `http://127.0.0.1:${API_PORT}/api/health`;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (api.exitCode !== null) {
      throw new Error(`The API exited during startup (code ${api.exitCode}):\n${output}`);
    }
    try {
      const response = await fetch(healthUrl);
      if (response.ok) {
        log(`API healthy on ${API_PORT}`);
        return api;
      }
    } catch {
      /* not listening yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  api.kill();
  throw new Error(`The API never became healthy at ${healthUrl}:\n${output}`);
};

/**
 * Bring up the Firebase Auth Emulator and provision the three test identities.
 *
 * Returns `{ pid, child }` when it ran, or `{ pid: null }` when it could not — a missing JVM or an
 * uninstalled `firebase-tools` is reported and the authenticated specs skip **with that reason
 * printed**, rather than the suite quietly losing its most important coverage.
 */
const startAuthEmulator = async (databaseUrl) => {
  const available = authEmulator.isAvailable();
  if (!available.ok) {
    log(`auth emulator NOT started — ${available.reason}`);
    log('the authenticated admin journeys will SKIP (see e2e/README.md)');
    authEmulator.writeState({ enabled: false, reason: available.reason });
    return { pid: null };
  }

  const child = await authEmulator.start(available.cli);

  // Set for this process so `setCustomUserClaims` below talks to the emulator, and inherited by the
  // API spawned after it so `verifyIdToken` does too.
  process.env.FIREBASE_AUTH_EMULATOR_HOST = authEmulator.EMULATOR_HOST;
  process.env.GOOGLE_CLOUD_PROJECT = authEmulator.PROJECT_ID;

  const { Pool } = require(path.join(BACKEND, 'node_modules', 'pg'));
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const tokens = await authEmulator.provisionIdentities(pool);
    authEmulator.writeState({ enabled: true, tokens });
  } finally {
    await pool.end();
  }

  return { pid: child.pid, child };
};

module.exports = async () => {
  // A leftover file from a run that was killed outright would otherwise have its stale pids merged
  // into this run's state. Stale *ports* are a separate problem, and are released independently
  // below and in `auth-emulator.js`.
  fs.rmSync(STATE_FILE, { force: true });

  const provided = process.env.DATABASE_URL;
  let cluster = null;

  if (provided) {
    log('using the DATABASE_URL already in the environment (CI service container)');
  } else {
    cluster = startThrowawayPostgres();
    // Recorded before the schema build, because everything after this point can throw.
    recordState({ dataDir: cluster.dataDir, pgBin: cluster.pgBin });
  }
  const databaseUrl = provided || cluster.url;

  await buildSchema(databaseUrl);

  // The auth emulator must come up BEFORE the API, because the API inherits
  // `FIREBASE_AUTH_EMULATOR_HOST` from this process's environment at boot — that variable is what
  // makes the real `firebase-admin` accept emulator-issued tokens (ADR-028). Nothing in production
  // code changes; the SDK reads the variable itself.
  const auth = await startAuthEmulator(databaseUrl);
  recordState({ authPid: auth.pid ?? null });

  const api = await startApi(databaseUrl);
  recordState({ apiPid: api.pid });

  // Detach the handles so this process can exit while the API keeps running for the suite.
  api.unref();
  auth.child?.unref();
};

module.exports.STATE_FILE = STATE_FILE;
