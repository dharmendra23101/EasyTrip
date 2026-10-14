const { Pool } = require('pg');
const logger = require('../utils/logger');

/**
 * The single Postgres connection pool for the server process (IMP-044).
 *
 * There were seven. Six connected via `DATABASE_URL` with *inconsistent* TLS settings — and two of
 * them (`authController`, `newsletterController`) had no `ssl` key at all, so against a host that
 * requires TLS they would fail while their neighbours worked. The seventh was this file, which read
 * an entirely different set of `POSTGRES_*` variables that nothing else sets, and was imported only
 * by `adminModel`/`userModel` — both dead code.
 *
 * Why one pool matters: each `new Pool()` maintains its own set of connections (pg defaults to 10).
 * Seven pools meant up to 70 connections from a single instance, against managed Postgres tiers that
 * often cap total connections around 60–100. Under load the app could exhaust its own database
 * before serving meaningful traffic, and the failure looks like unrelated timeouts.
 */

if (!process.env.DATABASE_URL) {
  // Fail loudly at require time. A pool built on `undefined` connects to a default local socket and
  // produces confusing "database does not exist" errors far from the real cause.
  logger.error('DATABASE_URL is not set — the server cannot reach Postgres.');
}

/**
 * TLS policy (IMP-063, repays TD-001). Lives here and only here — which is the whole reason the
 * Phase 4 pool consolidation had to land first.
 *
 * Until this change the value was `{ rejectUnauthorized: false }` in production, which encrypts the
 * connection but verifies nothing about who is on the other end. That accepts any certificate,
 * including one an attacker presents, so it stops a passive eavesdropper and does nothing about an
 * active one — every credential and every row in transit. It was accepted knowingly in Phase 1
 * because the provider's CA was not wired up and blocking the auth fixes on TLS plumbing would have
 * been worse; the debt entry has been open since.
 *
 * The default is now verification ON in production. Two escape hatches, in order of preference:
 *
 *   DATABASE_CA_CERT — the provider's CA certificate, PEM contents. The correct answer for a
 *   managed provider that issues certificates from its own root (Supabase, Render, Heroku,
 *   DigitalOcean). Verification stays on and the chain actually resolves.
 *
 *   DATABASE_SSL_NO_VERIFY=true — restores the old behaviour explicitly, for a deployment that
 *   cannot supply a CA today. It is deliberately loud: an unverified TLS connection is a decision
 *   somebody made, and it should appear in the boot log every time rather than hiding in a default.
 */
const buildSslConfig = () => {
  // Local Postgres over a loopback socket has no certificate and needs none.
  if (process.env.NODE_ENV !== 'production') return false;

  if (process.env.DATABASE_SSL_NO_VERIFY === 'true') {
    logger.warn(
      'DATABASE_SSL_NO_VERIFY=true — the Postgres TLS certificate is NOT being verified. The ' +
        'connection is encrypted but the peer is unauthenticated, so it is not protected against ' +
        'an active man-in-the-middle. Set DATABASE_CA_CERT to the provider CA instead.'
    );
    return { rejectUnauthorized: false };
  }

  if (process.env.DATABASE_CA_CERT) {
    return {
      rejectUnauthorized: true,
      // Providers hand this out as a PEM block. Supporting the literal `\n` form as well means it
      // survives being pasted into a single-line .env or a dashboard secret field, which is how it
      // is usually supplied — the same escaping the Firebase private key already needs.
      ca: process.env.DATABASE_CA_CERT.replace(/\\n/g, '\n')
    };
  }

  return { rejectUnauthorized: true };
};

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,

  ssl: buildSslConfig(),

  // Bounded and explicit rather than relying on defaults, now that one pool serves the whole
  // process. 10 is pg's default; stating it makes the ceiling visible next to the reasoning above.
  max: Number(process.env.PG_POOL_MAX) || 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000
});

// A pooled client can be dropped by the server (idle timeout, failover). Without a listener, that
// arrives as an unhandled 'error' event and takes the process down.
pool.on('error', (error) => {
  logger.error({ err: error }, 'Unexpected error on an idle Postgres client');
});

/**
 * A snapshot of the pool's occupancy (`FV-021`).
 *
 * **Why this exists at all.** `max` is 10 and `connectionTimeoutMillis` is 10 seconds, so a
 * saturated pool does not fail fast — it queues, and then throws
 * *"timeout exceeded when trying to connect"*. That message is identical whether the database is
 * unreachable, asleep behind a cold-start, or perfectly healthy and simply out of connections
 * because ten slow queries are in flight. Those are three different incidents with three different
 * responses, and the log line could not tell them apart.
 *
 * `waiting > 0` is the one that distinguishes them: it means the pool itself is the bottleneck.
 *
 * Read straight off the pool rather than counted independently — a second counter is a second
 * thing that can be wrong, and it would be wrong in exactly the situation nobody can reproduce.
 */
const poolStats = () => ({
  total: pool.totalCount,
  idle: pool.idleCount,
  waiting: pool.waitingCount,
  max: pool.options?.max ?? null
});

/**
 * Whether an error is the pool giving up rather than the database refusing.
 *
 * Matched on the message because `pg` does not give this error a `code` — it is constructed in
 * `pg-pool` as a plain `Error`. Anchored on the distinctive part of the string, so a message that
 * changes wording fails to match and the line simply loses its annotation, rather than
 * mis-attributing an unrelated failure to pool exhaustion.
 */
const isConnectionTimeout = (error) =>
  typeof error?.message === 'string' &&
  error.message.includes('timeout exceeded when trying to connect');

// Export the pool itself and nothing more. An earlier version also assigned
// `module.exports.query = (text, params) => pool.query(text, params)` as a convenience — but since
// `module.exports` *is* `pool`, that overwrote `pool.query` with a function calling itself, and the
// first query blew the stack. The pool already exposes `.query`, so both `pool.query(...)` and the
// legacy `db.query(...)` call style work with no wrapper at all.
module.exports = pool;
// Attached to the pool rather than exported separately, because `module.exports` **is** the pool —
// see the note above about what happened the last time this file exported a second thing.
module.exports.poolStats = poolStats;
module.exports.isConnectionTimeout = isConnectionTimeout;
