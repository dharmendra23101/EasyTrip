/**
 * Runs before the test framework is installed (`setupFiles`).
 *
 * **The time zone is set by `npm test`, not here.** `package.json` runs jest through
 * `cross-env TZ=America/Los_Angeles`, because Node caches the zone at startup: assigning
 * `process.env.TZ` from inside a setup file has no effect on Windows, so the suite silently ran in
 * the machine's local zone and the timezone assertions passed for the wrong reason. That was caught
 * by the "does NOT run in UTC" test in `dateFormat.test.js` — a guard on the guard.
 *
 * **Why not UTC.** `dateFormat.js` names `timeZone: 'UTC'` on every call because `BUG-046` was a
 * value rendering one day early for anyone behind UTC. If the suite ran in UTC, deleting that
 * option would change nothing and the tests would still pass — and CI runs in UTC, so the bug would
 * ship. `America/Los_Angeles` is far enough behind that a UTC-midnight timestamp falls on the
 * previous calendar day, previous month and previous *year* locally, which is exactly the condition
 * the formatters must be immune to.
 *
 * This file is kept as the documented home for anything that must exist before module evaluation.
 */

// Fallback only — the authoritative setting is the `cross-env` prefix in `package.json`. If that is
// ever dropped, the assertion in `dateFormat.test.js` fails rather than passing quietly.
process.env.TZ = process.env.TZ || 'America/Los_Angeles';
