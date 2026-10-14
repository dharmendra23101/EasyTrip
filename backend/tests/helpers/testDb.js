const fs = require('fs');
const path = require('path');
const pool = require('../../src/config/db');
const { reseed } = require('../../src/config/seed');

/**
 * Test database lifecycle (IMP-092).
 *
 * Uses the application's own pool rather than a second one, so the suite exercises the same
 * connection configuration production does — including the TLS behaviour from `IMP-063`. A
 * separate pool would test a database, but not *this app's* access to it.
 */

const SCHEMA = path.join(__dirname, '../../src/config/schema.sql');
const MIGRATIONS = path.join(__dirname, '../../src/config/migrations');

/**
 * Build the schema from nothing, then apply every migration in order.
 *
 * This is the same path CI's `migrations` job takes and the same one a new contributor gets from
 * docker-compose. Running it here means a migration that breaks a fresh database fails the API
 * suite too, rather than only the one job that happens to check it.
 */
async function createSchema() {
  await pool.query(fs.readFileSync(SCHEMA, 'utf8'));

  const files = fs
    .readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    await pool.query(fs.readFileSync(path.join(MIGRATIONS, file), 'utf8'));
  }
}

/** Wipe and re-seed. Call in `beforeEach` so no test can depend on another's writes. */
async function resetData() {
  await reseed(pool);
}

/** Release the pool, or Jest reports open handles and hangs. */
async function closeDb() {
  await pool.end();
}

/**
 * Empty every rate-limiter bucket.
 *
 * The stores are in-memory and per-process, so they accumulate across a whole test file. Without
 * this the newsletter limiter (5 per hour, deliberately tight) starts 429-ing partway through and
 * every later assertion depends on how many requests the earlier ones happened to make — an
 * order-dependent suite that fails differently depending on which tests you run.
 *
 * Production behaviour is untouched: this only calls the reset the library already exposes.
 */
function resetRateLimits(app) {
  for (const limiter of Object.values(app.locals.rateLimiters || {})) {
    if (typeof limiter.resetKey === 'function') {
      // express-rate-limit v7 keys by IP; supertest always connects from ::ffff:127.0.0.1.
      for (const key of ['::ffff:127.0.0.1', '127.0.0.1', '::1']) limiter.resetKey(key);
    }
  }
}

module.exports = { pool, createSchema, resetData, closeDb, resetRateLimits };
