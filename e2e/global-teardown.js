/**
 * Undo everything `global-setup.js` provisioned (IMP-094).
 *
 * Written to be safe to run twice and safe to run after a crashed setup: every step is guarded,
 * because a teardown that throws leaves an orphaned Postgres holding a port and the next run fails
 * for a reason that has nothing to do with the code under test.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const STATE_FILE = path.join(os.tmpdir(), 'easytrip-e2e-state.json');
const log = (message) => console.log(`  [e2e teardown] ${message}`);

/**
 * Delete the cluster's data directory, retrying briefly.
 *
 * **`pg_ctl stop` returning does not mean Windows has released the directory.** The postmaster
 * acknowledges the shutdown and exits, but its child processes finish flushing and close their
 * handles a moment later, and `rmSync` in between fails with `EBUSY: resource busy or locked`.
 *
 * Observed, not theorised: a full run passed 46/46 and then exited **non-zero** on this line, which
 * in CI is a red build for a green suite — the worst kind of failure, because the natural response
 * is to stop trusting the suite. A bounded retry is the fix; there is nothing to wait *for* other
 * than the OS, and no event to subscribe to.
 *
 * Failure to delete is deliberately not fatal. A leftover temp directory costs disk and nothing
 * else, and `startThrowawayPostgres` already stops and removes a stale one on the next run. Losing
 * the whole run's exit code over it is the outcome this function exists to prevent.
 */
const removeWithRetry = (dir, attempts = 20) => {
  for (let i = 0; i < attempts; i++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      if (i === attempts - 1) {
        log(`could not remove ${dir} (${error.code}) — left for the next run to clean up`);
        return;
      }
      // Synchronous by necessity: Playwright's globalTeardown is awaited, but this whole file is
      // written synchronously and one blocking wait of a few ms beats restructuring it.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
};

module.exports = async () => {
  if (!fs.existsSync(STATE_FILE)) return;

  let state;
  try {
    state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    fs.rmSync(STATE_FILE, { force: true });
    return;
  }

  if (state.apiPid) {
    try {
      process.kill(state.apiPid);
      log(`stopped the API (pid ${state.apiPid})`);
    } catch {
      /* already gone */
    }
  }

  if (state.authPid) {
    // The Firebase CLI spawns a JVM child, so killing the CLI alone can leave the emulator holding
    // port 9099 and the next run fails to start for a reason unrelated to the code under test.
    // `taskkill /T` on Windows and a process-group kill elsewhere take the tree with it.
    try {
      if (process.platform === 'win32') {
        execFileSync('taskkill', ['/PID', String(state.authPid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        process.kill(-state.authPid);
      }
      log(`stopped the auth emulator (pid ${state.authPid})`);
    } catch {
      try {
        process.kill(state.authPid);
      } catch {
        /* already gone */
      }
    }
  }

  require('./auth-emulator').cleanup();

  if (state.dataDir) {
    const pgCtl = state.pgBin ? path.join(state.pgBin, 'pg_ctl') : 'pg_ctl';
    try {
      execFileSync(pgCtl, ['-D', state.dataDir, '-m', 'immediate', 'stop'], { stdio: 'ignore' });
      log('stopped the throwaway Postgres');
    } catch {
      /* already stopped */
    }
    removeWithRetry(state.dataDir);
    fs.rmSync(`${state.dataDir}.log`, { force: true });
  }

  fs.rmSync(STATE_FILE, { force: true });
};
