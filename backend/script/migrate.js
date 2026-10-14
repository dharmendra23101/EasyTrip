#!/usr/bin/env node
/**
 * The migration runner (IMP-069, supersedes ADR-007).
 *
 * Replaces the `ALTER TABLE ... IF NOT EXISTS` block that used to run inside `app.js` on every
 * boot. That approach meant schema truth was split four ways, the runtime database role needed
 * DDL privileges permanently, and there was no record of what had been applied — so the only way
 * to answer "does this database have migration 003?" was to go and look at the columns.
 *
 * This runner keeps a `schema_migrations` table and applies, in filename order, every `.sql` file
 * in `src/config/migrations/` that is not already recorded there.
 *
 * ---------------------------------------------------------------------------
 * Three design decisions worth knowing before editing this file
 * ---------------------------------------------------------------------------
 *
 * 1. NO NEW DEPENDENCY, AND THE MIGRATIONS STAY PLAIN `.sql`.
 *    node-pg-migrate was the obvious alternative. It wants its own migration format and its own
 *    filename convention, which would mean rewriting four hand-written, heavily-commented SQL
 *    files whose comments are the best documentation the schema has. It would also break the
 *    documented `psql -f` path that every one of those files advertises in its header, and that
 *    `app.js` used to print in an error message. A runner is roughly a hundred lines of SQL
 *    bookkeeping; the files are worth more than the hundred lines are.
 *
 * 2. EACH MIGRATION OWNS ITS OWN TRANSACTION — THIS RUNNER DOES NOT WRAP THEM.
 *    Most runners open a transaction, run the file inside it, and record the row in the same
 *    transaction so the two commit atomically. That is the better design in general, and it is
 *    deliberately not used here, for two concrete reasons:
 *      - 001/002/003 already contain their own `BEGIN`/`COMMIT`. A `COMMIT` inside an outer
 *        transaction commits the OUTER one, so wrapping them would silently end the runner's
 *        transaction partway through and the bookkeeping insert would land outside it.
 *      - 004 deliberately has no transaction at all, because it documents a future move to
 *        `CREATE INDEX CONCURRENTLY`, which cannot run inside a transaction block.
 *    Stripping `BEGIN`/`COMMIT` from the files would fix the first point and break the documented
 *    `psql -f` path — 001 deletes rows, so it must stay transactional when run by hand.
 *
 *    The cost of not wrapping: a crash in the window between "migration committed" and "row
 *    recorded" leaves a migration applied but unrecorded, and it runs again on the next attempt.
 *    That is safe here and only here, because of decision 3.
 *
 * 3. EVERY MIGRATION MUST BE RE-RUNNABLE. This is a hard requirement of the convention, not a
 *    nicety — see `src/config/migrations/README.md`. All five existing files state it in their
 *    own headers and satisfy it. It is what makes decision 2's crash window harmless, and it is
 *    what lets an existing production database adopt this runner with no baselining step: on a
 *    database where 001–004 were already applied by hand, the first run re-applies them as
 *    no-ops and records them.
 *
 * Usage:
 *   node script/migrate.js            # apply everything pending
 *   node script/migrate.js status     # show what is applied and what is pending; changes nothing
 *   node script/migrate.js --dry-run  # list what WOULD be applied; changes nothing
 */

const path = require('path');

require('dotenv').config();

const pool = require('../src/config/db');
const { listMigrationFiles, MIGRATIONS_DIR } = require('../src/config/migrationFiles');

// Two deploys starting at once would otherwise both see the same pending list and both try to
// apply it. A session-level advisory lock is the standard Postgres answer: the second process
// blocks here until the first finishes, then re-reads the table and finds nothing pending. The
// key is an arbitrary constant — it only has to be stable and not collide with another user of
// advisory locks in the same database.
const ADVISORY_LOCK_KEY = 4_073_120_069;

const ensureMigrationsTable = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      checksum   TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
};

const fetchApplied = async (client) => {
  const { rows } = await client.query(
    'SELECT filename, checksum, applied_at FROM schema_migrations'
  );
  return new Map(rows.map((row) => [row.filename, row]));
};

/**
 * A file whose checksum no longer matches what was recorded when it ran. Reported rather than
 * repaired: the database has the old version, the working tree has the new one, and only a person
 * who knows what changed can say which is right. The fix is normally a new migration.
 */
const findDrift = (files, applied) =>
  files
    .filter((file) => applied.has(file.name) && applied.get(file.name).checksum !== file.checksum)
    .map((file) => file.name);

const runStatus = async (client, files, applied) => {
  const drift = findDrift(files, applied);

  console.log(
    `\n  ${files.length} migration file(s) in ${path.relative(process.cwd(), MIGRATIONS_DIR)}\n`
  );

  for (const file of files) {
    const record = applied.get(file.name);
    if (!record) {
      console.log(`  [ pending ]  ${file.name}`);
    } else if (drift.includes(file.name)) {
      console.log(
        `  [ CHANGED ]  ${file.name}  — applied ${record.applied_at.toISOString()}, but the file has been edited since`
      );
    } else {
      console.log(`  [ applied ]  ${file.name}  — ${record.applied_at.toISOString()}`);
    }
  }

  const pending = files.filter((file) => !applied.has(file.name));
  console.log(`\n  ${applied.size} applied, ${pending.length} pending.\n`);

  return drift;
};

const main = async () => {
  const argv = process.argv.slice(2);
  const isStatus = argv.includes('status');
  const isDryRun = argv.includes('--dry-run');

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set — nothing to migrate. Set it in backend/.env.');
    process.exitCode = 1;
    return;
  }

  const files = listMigrationFiles();
  if (files.length === 0) {
    console.error(`No .sql files found in ${MIGRATIONS_DIR}.`);
    process.exitCode = 1;
    return;
  }

  // One client for the whole run: the advisory lock below is session-scoped, so it has to be
  // held on the same connection that does the work. Taking it from the pool per-query would
  // release it immediately and defeat the point.
  const client = await pool.connect();

  try {
    await ensureMigrationsTable(client);

    if (isStatus) {
      const drift = await runStatus(client, files, await fetchApplied(client));
      if (drift.length > 0) process.exitCode = 1;
      return;
    }

    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);

    // Re-read AFTER taking the lock. Reading before it would race with whoever held it.
    const applied = await fetchApplied(client);

    const drift = findDrift(files, applied);
    if (drift.length > 0) {
      console.error(
        `\nRefusing to run. These migrations were edited after they were applied:\n` +
          drift.map((name) => `  - ${name}`).join('\n') +
          `\n\nThe database has the old version and the working tree has the new one. Applied\n` +
          `migrations are immutable by convention — put the change in a new migration instead.\n` +
          `Run \`npm run migrate:status\` for detail.\n`
      );
      process.exitCode = 1;
      return;
    }

    const pending = files.filter((file) => !applied.has(file.name));

    if (pending.length === 0) {
      console.log(
        `\n  Database is up to date — ${applied.size} migration(s) applied, 0 pending.\n`
      );
      return;
    }

    if (isDryRun) {
      console.log(`\n  Would apply ${pending.length} migration(s):\n`);
      pending.forEach((file) => console.log(`  - ${file.name}`));
      console.log('\n  --dry-run: nothing was changed.\n');
      return;
    }

    console.log(`\n  Applying ${pending.length} migration(s)...\n`);

    for (const file of pending) {
      const startedAt = process.hrtime.bigint();
      try {
        // The file's own BEGIN/COMMIT applies here — see decision 2 in the header.
        await client.query(file.sql);
        await client.query(
          'INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2) ' +
            'ON CONFLICT (filename) DO UPDATE SET checksum = EXCLUDED.checksum',
          [file.name, file.checksum]
        );
        const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
        console.log(`  ✅ ${file.name}  (${ms.toFixed(0)} ms)`);
      } catch (error) {
        console.error(`  ❌ ${file.name}\n     ${error.message}`);
        // Stop at the first failure. Continuing would apply migrations out of order against a
        // schema that is not in the state they were written for.
        console.error(
          `\n  Stopped. ${file.name} was not recorded as applied; fix the error and re-run.\n`
        );
        process.exitCode = 1;
        return;
      }
    }

    console.log(`\n  Done — ${pending.length} applied, database is up to date.\n`);
  } finally {
    // Releasing the advisory lock explicitly is tidy, but dropping the connection would release
    // it anyway. Wrapped because it throws if the lock was never taken (the `status` path).
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]);
    } catch {
      /* not held — nothing to release */
    }
    client.release();
    await pool.end();
  }
};

main().catch((error) => {
  console.error(`\nMigration run failed: ${error.message}\n`);
  process.exit(1);
});
