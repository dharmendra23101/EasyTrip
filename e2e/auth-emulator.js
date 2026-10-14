/**
 * Firebase Auth Emulator lifecycle and token minting for the E2E suite (`TD-020`, `ADR-028`).
 *
 * **Why an emulator rather than a bypass.** The suite needs to act as a signed-in admin. The
 * tempting shortcuts — an env-gated test verifier in `authMiddleware`, accepting unsigned JWTs
 * outside production, or committing a throwaway service account — were all rejected in `ADR-028`.
 * The first two are a signature check with an off switch, which is the `x-user: AdminX` bypass
 * Phase 1 existed to delete; the third is a committed private key, and `SECURITY_AUDIT` §12.0
 * records what that costs.
 *
 * The emulator avoids all three. Tokens it mints are verified by the **real** `firebase-admin`
 * `verifyIdToken()` — the same call production makes, on the same code path — because the Admin
 * SDK honours `FIREBASE_AUTH_EMULATOR_HOST`. **No production code is modified, and no production
 * code knows the emulator exists.**
 *
 * That variable also disables signature verification, which is why `env.js` refuses to boot when it
 * is set with `NODE_ENV=production` (Sprint 6.4). The guard and this file are two halves of one
 * decision.
 *
 * **Graceful absence is deliberate.** When `firebase-tools` is not installed, this module reports
 * it and the authenticated specs *skip with a stated reason* rather than silently passing — an
 * unavailable dependency should look like an unavailable dependency, not like coverage.
 */
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// Resolves `firebase-admin` subpaths from the backend's package, honouring its `exports` map.
const { createRequire } = require('node:module');

const ROOT = path.resolve(__dirname, '..');
const BACKEND = path.join(ROOT, 'backend');
const HOST = '127.0.0.1';
const PORT = Number(process.env.E2E_AUTH_EMULATOR_PORT || 9099);
const PROJECT_ID = 'easytrip-e2e';

const EMULATOR_HOST = `${HOST}:${PORT}`;
const BASE = `http://${EMULATOR_HOST}/identitytoolkit.googleapis.com/v1`;

/**
 * Where the Firebase CLI records the running hub, so a second `firebase` command can find it.
 *
 * The path is the CLI's, not ours — it writes `hub-<projectId>.json` into the OS temp directory and
 * does **not** remove it when it is killed rather than asked to stop. `releaseStalePorts` deletes it
 * for the same reason it frees the ports: what a previous run left behind is this run's problem.
 */
const HUB_LOCATOR = path.join(os.tmpdir(), `hub-${PROJECT_ID}.json`);

/** Written for the specs and for teardown, both of which run in other processes. */
const AUTH_STATE_FILE = path.join(os.tmpdir(), 'easytrip-e2e-auth.json');

const log = (message) => console.log(`  [e2e auth] ${message}`);

/**
 * The three identities the suite needs, and the security property each one proves.
 *
 * The third is the important one. `resolveAdminStatus` treats `users.is_admin` as the authority and
 * a Firebase custom `admin` claim as merely a cache of it — a disagreement resolves to NOT admin.
 * Minting a genuinely signed token that *claims* admin while the database says otherwise is the
 * only way to exercise that, and it is exactly the shape of the original `IMP-002` defect.
 */
const IDENTITIES = [
  {
    key: 'admin',
    email: 'e2e-admin@easytrip.test',
    isAdmin: true,
    claim: null,
    proves: 'a real token plus users.is_admin = true is allowed through'
  },
  {
    key: 'nonAdmin',
    email: 'e2e-user@easytrip.test',
    isAdmin: false,
    claim: null,
    proves: 'a perfectly valid token is still not an admin'
  },
  {
    key: 'claimOnly',
    email: 'e2e-claim@easytrip.test',
    isAdmin: false,
    claim: { admin: true },
    proves: 'a signed admin CLAIM does not beat the database'
  }
];

/**
 * Can the emulator run here?
 *
 * **No JVM check, deliberately.** The Firebase docs list Java as a prerequisite for "the
 * emulators", and it is easy to copy that into a precondition — but it applies to Firestore,
 * Realtime Database and Pub/Sub. **The Auth emulator is implemented in Node**, which was confirmed
 * here by observing the running process rather than by reading the docs. Requiring Java would have
 * skipped this suite on any runner without a JVM, for no reason, and a skipped security test is
 * indistinguishable from an absent one.
 */
const isAvailable = () => {
  const cli = path.join(
    ROOT,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'firebase.cmd' : 'firebase'
  );
  if (!fs.existsSync(cli)) {
    return { ok: false, reason: 'firebase-tools is not installed (run `npm ci` at the repo root)' };
  }
  return { ok: true, cli };
};

/**
 * Release whatever a previous run left behind: the ports, and the CLI's own hub locator.
 *
 * The Firebase CLI supervises child processes, so killing the CLI alone can orphan whatever is
 * bound to 9099 — and the next run then sits silently retrying a port it will never get, which is
 * exactly how this integration failed the first time it was wired up. Cleaning up first turns a
 * confusing hang into a non-event.
 *
 * **The locator is the half this used to miss (`TD-025`).** Freeing a port does not remove
 * `hub-easytrip-e2e.json`, so the next `firebase emulators:start` could read a file naming a process
 * that no longer exists. Observed on 2026-09-04: a locator pointing at a dead pid on port 4401, and
 * an emulator that printed one line and exited `-1`.
 *
 * **That causal claim is deliberately weak and is not the reason this line is here.** Deleting the
 * locator preceded the run that worked, which is n = 1, and it was never isolated from the other
 * change made at the same time. What is not in doubt is that a file naming a dead process is
 * garbage from a previous run, and this function is where a previous run's garbage is dealt with.
 */
const releaseStalePorts = () => {
  try {
    fs.rmSync(HUB_LOCATOR, { force: true });
  } catch {
    /* not there, or not ours to delete — either way nothing to release */
  }

  for (const port of [PORT, 4400, 4500]) {
    try {
      if (process.platform === 'win32') {
        const out = execFileSync('netstat', ['-ano'], { encoding: 'utf8' });
        const pids = new Set(
          out
            .split('\n')
            .filter((line) => line.includes(`:${port} `) && line.includes('LISTENING'))
            .map((line) => line.trim().split(/\s+/).pop())
        );
        for (const pid of pids) {
          execFileSync('taskkill', ['/PID', pid, '/T', '/F'], { stdio: 'ignore' });
          log(`released port ${port} from a previous run (pid ${pid})`);
        }
      } else {
        const pids = execFileSync('lsof', ['-ti', `tcp:${port}`], { encoding: 'utf8' }).split('\n');
        for (const pid of pids.filter(Boolean)) {
          process.kill(Number(pid), 'SIGKILL');
          log(`released port ${port} from a previous run (pid ${pid})`);
        }
      }
    } catch {
      /* nothing listening, or no tool to ask — either way there is nothing to release */
    }
  }
};

const post = async (endpoint, body) => {
  const response = await fetch(`${BASE}/${endpoint}?key=fake-api-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(`Auth emulator rejected ${endpoint}: ${JSON.stringify(json)}`);
  }
  return json;
};

/**
 * Kill the CLI **and** whatever it spawned.
 *
 * On Windows this module spawns with `shell: true`, so `child` is `cmd.exe` and the Firebase CLI is
 * its grandchild; the CLI in turn supervises a JVM. `child.kill()` reaches only the first of those,
 * which is how a failed start used to leave a live emulator holding 4400 for the next run to trip
 * over (`TD-025`). `taskkill /T` takes the tree, and a process-group kill does the same elsewhere.
 *
 * Best-effort by construction: every branch here is racing a process that may already be gone, and
 * "it was already dead" is the outcome this function wants anyway.
 */
const killTree = (child) => {
  if (!child || child.pid === undefined) return;
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      process.kill(-child.pid);
    }
  } catch {
    try {
      child.kill();
    } catch {
      /* already gone */
    }
  }
};

/**
 * Describe what the child printed, including when it printed nothing.
 *
 * **"Nothing" is a finding and it used to render as a blank line.** The 2026-09-04 failure that
 * opened `TD-025` reported `The auth emulator never became ready on 127.0.0.1:9099:` followed by
 * emptiness, which reads as a truncated message rather than as evidence — and it is evidence: a
 * process that produced no output in ninety seconds never got as far as starting, which points
 * somewhere completely different from one that printed an error and exited.
 */
const describe = (output) =>
  output.trim() === ''
    ? '  (the process printed nothing at all on stdout or stderr, which usually means it never got\n' +
      '   as far as running — check that `npx firebase --version` works and that no other emulator\n' +
      `   is holding ${EMULATOR_HOST}, 4400 or 4500)`
    : output;

/** Start the emulator and wait until it answers. Returns the child process. */
const start = async (cli) => {
  releaseStalePorts();

  const child = spawn(
    cli,
    [
      'emulators:start',
      '--only',
      'auth',
      '--project',
      PROJECT_ID,
      '--config',
      path.join(__dirname, 'firebase.json')
    ],
    {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
      // Non-interactive: the CLI must never wait on a prompt this suite cannot answer.
      env: { ...process.env, CI: 'true', NO_COLOR: '1' }
    }
  );

  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));

  for (let attempt = 0; attempt < 90; attempt++) {
    if (child.exitCode !== null) {
      throw new Error(
        `The auth emulator exited during startup (${child.exitCode}):\n${describe(output)}`
      );
    }
    try {
      const response = await fetch(`http://${EMULATOR_HOST}/`);
      if (response.status < 500) {
        log(`emulator ready on ${EMULATOR_HOST}`);
        return child;
      }
    } catch {
      /* not listening yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  // `child.kill()` was here, and on Windows `shell: true` means `child` is **cmd.exe** rather
  // than the CLI. Killing it left the emulator running and holding 4400 for the next run to trip
  // over (`TD-025`) — the exact orphan `releaseStalePorts` above then has to clean up.
  // `global-teardown` already took the tree with `taskkill /T`; this path did not, and it is the
  // path that runs when something has already gone wrong.
  killTree(child);
  throw new Error(
    `The auth emulator never became ready on ${EMULATOR_HOST} after 90s:\n${describe(output)}`
  );
};

/**
 * Create the identities in the emulator and in Postgres, and mint a token for each.
 *
 * The two halves have to agree: the emulator owns the uid, and `users.firebase_uid` has to carry
 * that same uid for `resolveAdminStatus` to find the row. Inserting after signUp rather than
 * seeding a fixed uid is what keeps them in step.
 */
const provisionIdentities = async (pool) => {
  // `firebase-admin` v13 removed the single-namespace export: `admin.apps` and `app.auth()` are
  // gone, and the package root is now the modular app API. This harness resolves the SDK out of the
  // backend's own `node_modules` deliberately — the point is to mint tokens with the *same* library
  // that will verify them — so it moves with the backend's version.
  // `createRequire`, not `path.join`. The old single-namespace export could be reached by joining a
  // filesystem path to the package directory, because Node falls back to its `main`. A **subpath**
  // like `firebase-admin/app` is resolved through the package's `exports` map, which only applies to
  // a bare specifier — a joined path resolves as a file and is simply not found. Requiring from the
  // backend's own `package.json` keeps the intent (use the SDK that will verify these tokens) while
  // letting Node do the resolution properly.
  const backendRequire = createRequire(path.join(BACKEND, 'package.json'));
  const { initializeApp, getApps } = backendRequire('firebase-admin/app');
  const { getAuth } = backendRequire('firebase-admin/auth');

  const existing = getApps().find((candidate) => candidate.name === 'e2e-auth');
  const app = existing || initializeApp({ projectId: PROJECT_ID }, 'e2e-auth');

  const tokens = {};

  for (const identity of IDENTITIES) {
    const created = await post('accounts:signUp', {
      email: identity.email,
      password: 'e2e-password',
      returnSecureToken: true
    });
    const uid = created.localId;

    if (identity.claim) {
      // Set the claim through the real Admin SDK, then sign in again — a token only carries the
      // claims that existed when it was issued.
      await getAuth(app).setCustomUserClaims(uid, identity.claim);
    }

    const signedIn = await post('accounts:signInWithPassword', {
      email: identity.email,
      password: 'e2e-password',
      returnSecureToken: true
    });

    await pool.query(
      `INSERT INTO users (firebase_uid, email, name, is_admin)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (firebase_uid) DO UPDATE SET is_admin = EXCLUDED.is_admin`,
      [uid, identity.email, `E2E ${identity.key}`, identity.isAdmin]
    );

    tokens[identity.key] = { uid, email: identity.email, idToken: signedIn.idToken };
    log(`${identity.key}: uid ${uid.slice(0, 8)}… — ${identity.proves}`);
  }

  return tokens;
};

const writeState = (state) => fs.writeFileSync(AUTH_STATE_FILE, JSON.stringify(state, null, 2));

/** Read by the specs. Returns `{ enabled, reason?, tokens? }`. */
const readState = () => {
  if (!fs.existsSync(AUTH_STATE_FILE)) {
    return { enabled: false, reason: 'the auth emulator did not run for this suite' };
  }
  return JSON.parse(fs.readFileSync(AUTH_STATE_FILE, 'utf8'));
};

const cleanup = () => fs.rmSync(AUTH_STATE_FILE, { force: true });

module.exports = {
  AUTH_STATE_FILE,
  EMULATOR_HOST,
  PROJECT_ID,
  IDENTITIES,
  isAvailable,
  start,
  provisionIdentities,
  writeState,
  readState,
  cleanup
};
