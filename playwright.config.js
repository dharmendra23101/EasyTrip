/**
 * Playwright configuration for the end-to-end suite (IMP-094).
 *
 * **What this layer is for, and what it deliberately is not.**
 *
 * The API suite already proves the server's contracts against a real Postgres, and the component
 * suite proves the React units and their seams. Repeating either of those through a browser would
 * be slower and prove less. This suite exists for the class of failure neither can see:
 *
 *   - a route that 404s or redirects wrongly in a real Next server
 *   - hydration mismatches (BUG-046 was exactly this, twice)
 *   - client-side state that survives a navigation, or fails to
 *   - a form that submits in jsdom but not in a browser
 *   - the frontend and backend disagreeing about a contract they each pass in isolation
 *
 * **Why `next dev` rather than a production build.** `next build && next start` is more faithful,
 * and it is already covered by its own CI job, which fails on a broken import or component. What
 * this suite needs is SSR, hydration, routing and client state — all of which `next dev` runs for
 * real — at a cost that keeps the suite runnable. A two-minute build before every E2E run is how a
 * suite stops being run. The tradeoff is recorded in `e2e/README.md`.
 *
 * **Orchestration.** `global-setup.js` provisions Postgres, applies the schema and migrations,
 * seeds deterministic fixtures, and starts the API. This config's `webServer` starts only the Next
 * server. Splitting it that way means the suite does not depend on Playwright's internal ordering
 * between `globalSetup` and `webServer`.
 */
const { defineConfig, devices } = require('@playwright/test');

// The emulator's host and project id, read from the module that owns them rather than copied. A
// second spelling of `9099` here is how the browser ends up talking to a port nothing is on.
const authEmulator = require('./e2e/auth-emulator');

// Deliberately not 3000/5000/5432: a developer's own `npm run dev` and their own Postgres must be
// able to keep running while the E2E suite does. A suite that demands the machine to itself gets
// run less often.
const FRONTEND_PORT = Number(process.env.E2E_FRONTEND_PORT || 3100);
const API_PORT = Number(process.env.E2E_API_PORT || 5100);

const BASE_URL = `http://127.0.0.1:${FRONTEND_PORT}`;
const API_URL = `http://127.0.0.1:${API_PORT}/api`;

module.exports = defineConfig({
  testDir: './e2e/tests',
  globalSetup: require.resolve('./e2e/global-setup.js'),
  globalTeardown: require.resolve('./e2e/global-teardown.js'),

  // The journeys share one seeded database, and several of them write to it. Running files in
  // parallel would let a delete in one race a read in another — the same reasoning as the API
  // suite's `maxWorkers: 1`, for the same reason: a fast suite that lies is worse than a slow one
  // that does not.
  workers: 1,
  fullyParallel: false,

  // A retry hides a flake rather than fixing it, and a flaky E2E suite is how teams learn to
  // re-run red builds. If something here is unstable, that is a finding.
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 30_000,
  expect: { timeout: 10_000 },

  // The `json` reporter is CI-only and is not a report anybody reads: it is the input to
  // `scripts/check-test-counts.mjs`, which asserts that the README's "88 browser journeys" is still
  // true (`IMP-128`). It is added alongside `list` rather than replacing it, because a reporter
  // swap that hid the console output would trade a drifting number for an unreadable failure.
  reporter: process.env.CI
    ? [['github'], ['list'], ['json', { outputFile: 'test-count-e2e.json' }]]
    : [['list']],

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off'
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ],

  webServer: {
    command: 'npm run dev',
    cwd: 'frontend',
    // `/login`, not `/` (IMP-129). Playwright starts `webServer` **before** `globalSetup`, so the
    // readiness probe was hitting the home page while the API it fetches from did not exist yet.
    // `getStaticProps` caught the failure, fell back to an empty catalogue, and — because the error
    // branch sets `revalidate: 30` — cached that emptiness for the first thirty seconds of the run.
    // Every run logged `[getStaticProps] home: fetch failed`, nothing failed, and the home page's
    // server data path went unexercised.
    //
    // `/login` renders from nothing, so it answers the question this probe is actually asking —
    // "can Next render a page?" — without poisoning an ISR cache to do it.
    url: `${BASE_URL}/login`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      PORT: String(FRONTEND_PORT),
      // Read by the browser bundle AND by `getServerSideProps` (the admin gate calls the API from
      // the Next server), so it must be reachable from both.
      NEXT_PUBLIC_API_URL: API_URL,
      // Point the browser's Firebase SDK at the Auth Emulator (`TD-024`). Static, and set whether
      // or not the emulator turns out to be runnable: `webServer` starts **before** `globalSetup`,
      // which is where availability is discovered, so this cannot be conditional on it. Nothing is
      // lost by that — `connectAuthEmulator` only configures, and the journeys that actually sign
      // in skip themselves when `readState()` reports the emulator did not run.
      NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: authEmulator.EMULATOR_HOST,

      // The API key stays fake — the emulator accepts any, and `auth-emulator.js` mints tokens with
      // the literal string `fake-api-key`. **The project id does not get to be fake.** `firebase.json`
      // runs the emulator in `singleProjectMode`, so a client announcing a different project is
      // talking to the wrong tenant; and the same id has to reach `firebase-admin` on the server or
      // `verifyIdToken` rejects the audience. One id, from one place.
      NEXT_PUBLIC_FIREBASE_API_KEY: 'e2e-placeholder-api-key',
      NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: `${authEmulator.PROJECT_ID}.firebaseapp.com`,
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: authEmulator.PROJECT_ID,
      NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: `${authEmulator.PROJECT_ID}.appspot.com`,
      NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '000000000000',
      NEXT_PUBLIC_FIREBASE_APP_ID: '1:000000000000:web:0000000000000000000000'
    }
  }
});

module.exports.PORTS = { FRONTEND_PORT, API_PORT, BASE_URL, API_URL };
