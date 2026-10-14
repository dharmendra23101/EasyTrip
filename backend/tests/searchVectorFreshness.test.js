const { createSchema, resetData, closeDb, pool } = require('./helpers/testDb');

/**
 * `TD-022` — the stored search vectors must agree with a recomputation.
 *
 * `places.search_vector` is `GENERATED ALWAYS AS (... easytrip_text_words(tags) ...) STORED`, so
 * the flattening helper is baked into every stored value. Postgres records the dependency and will
 * refuse to `DROP` that function — but it permits **`CREATE OR REPLACE`, and replacing it does not
 * recompute the rows already stored.** A future edit that added a separator or lower-cased
 * differently would apply to new writes only, and the catalogue would search inconsistently with
 * no error anywhere: no exception, no failing build, and a search box that finds some rows and not
 * others depending on when they were written. `009_search.sql` states the hazard at the point of
 * the hazard; this is the part that notices.
 *
 * ---------------------------------------------------------------------------
 * Why the expression is read from the catalog rather than written down here
 * ---------------------------------------------------------------------------
 * The obvious version of this check copies the generating expression into the test and compares
 * against that. It would be a **second definition of "searchable"** — the exact thing `ADR-032`
 * rejected a trigger for — and it would drift the first time the migration changed, failing for a
 * reason that has nothing to do with staleness.
 *
 * So the expression comes from `information_schema.columns.generation_expression`: the database's
 * own copy, the one it actually used. There is nothing to keep in step, and the check keeps working
 * unchanged if the weights or the columns are ever revised.
 *
 * ---------------------------------------------------------------------------
 * What each half of this file proves, stated honestly
 * ---------------------------------------------------------------------------
 * The freshness assertion **cannot fail on a database this suite just built**: every row is
 * inserted after the helper is created, so the stored value and a recomputation agree by
 * construction. Its value is against a database that has *existed across a change* — production, or
 * the re-used local cluster `backend/tests/README.md` warns about.
 *
 * That makes the first test, on its own, indistinguishable from one that asserts nothing. The
 * second test is what gives it meaning: it reproduces the hazard — replaces the helper, leaves the
 * stored rows alone — and proves the check reports it. A guard nobody has watched fail is a guard
 * nobody should trust.
 */

/** The column the whole feature reads, and the one that can silently go stale. */
const GENERATED_COLUMN = { table: 'places', column: 'search_vector' };

/** The helper the generated expression depends on — the thing `CREATE OR REPLACE` can move. */
const HELPER = 'easytrip_text_words';

/** The column's own generating expression, as the database recorded it. */
const generationExpression = async () => {
  const { rows } = await pool.query(
    `SELECT generation_expression AS expr
       FROM information_schema.columns
      WHERE table_name = $1 AND column_name = $2`,
    [GENERATED_COLUMN.table, GENERATED_COLUMN.column]
  );

  // A missing expression means the column stopped being generated, which is a bigger finding than
  // staleness and must not read as "nothing is stale".
  if (!rows[0]?.expr) {
    throw new Error(
      `${GENERATED_COLUMN.table}.${GENERATED_COLUMN.column} has no generation expression — ` +
        'it is no longer a GENERATED column, and this check no longer means what it says.'
    );
  }
  return rows[0].expr;
};

/**
 * Rows whose stored vector disagrees with recomputing that expression **now**.
 *
 * The expression is interpolated rather than parameterised because it is SQL, not a value — and it
 * comes from the system catalog, never from a request.
 */
const staleRowIds = async () => {
  const expr = await generationExpression();
  const { rows } = await pool.query(
    `SELECT id
       FROM ${GENERATED_COLUMN.table}
      WHERE ${GENERATED_COLUMN.column} IS DISTINCT FROM (${expr})
      ORDER BY id`
  );
  return rows.map((row) => row.id);
};

const staleRowCount = async () => (await staleRowIds()).length;

const helperDefinition = async () => {
  const { rows } = await pool.query(
    'SELECT pg_get_functiondef(oid) AS def FROM pg_proc WHERE proname = $1',
    [HELPER]
  );
  if (!rows[0]?.def) throw new Error(`${HELPER}() is missing; 009_search.sql did not apply.`);
  return rows[0].def;
};

beforeAll(async () => {
  await createSchema();
});
beforeEach(async () => {
  await resetData();
});
afterAll(async () => {
  await closeDb();
});

describe('TD-022 — stored search vectors agree with the expression that generates them', () => {
  test('no row in the catalogue is stale', async () => {
    await expect(staleRowCount()).resolves.toBe(0);
  });

  test('the catalogue is not empty, so the check has something to check', async () => {
    // Without this, the assertion above passes just as happily against zero rows — which is how a
    // freshness check quietly stops checking after a seed change.
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM places');
    expect(rows[0].n).toBeGreaterThan(0);
  });

  test('replacing the helper without recomputing is reported, and is otherwise silent', async () => {
    const original = await helperDefinition();
    expect(await staleRowCount()).toBe(0);

    try {
      // The hazard, reproduced exactly: CREATE OR REPLACE succeeds against a function a generated
      // column depends on, and the stored rows are left as they were.
      await pool.query(`
        CREATE OR REPLACE FUNCTION ${HELPER}(arr text[])
        RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS
        $$ SELECT coalesce(array_to_string(arr, ' '), '') || ' relocated' $$;
      `);

      // Nothing has errored, and nothing will: this is what "silently disagree" means in practice.
      const stale = await staleRowCount();
      expect(stale).toBeGreaterThan(0);

      // Every row, not merely one — the helper feeds every row's C-weighted section.
      const { rows } = await pool.query('SELECT count(*)::int AS n FROM places');
      expect(stale).toBe(rows[0].n);
    } finally {
      // Restored from the definition captured above rather than from a copy written here, and in a
      // `finally` because a failure that left the shared database mutated would break every suite
      // that runs after this one.
      await pool.query(original);
    }

    expect(await staleRowCount()).toBe(0);
  });

  test('a row written after the change is fresh, which is what makes the stale ones invisible', async () => {
    const original = await helperDefinition();
    try {
      await pool.query(`
        CREATE OR REPLACE FUNCTION ${HELPER}(arr text[])
        RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS
        $$ SELECT coalesce(array_to_string(arr, ' '), '') || ' relocated' $$;
      `);

      const { rows } = await pool.query(
        `INSERT INTO places (name, location, tags, themes)
         VALUES ('Freshly Written', 'Somewhere', ARRAY['coffee'], ARRAY['hills'])
         RETURNING id`
      );
      const writtenAfter = rows[0].id;

      // The new row is consistent with the *new* helper, so a check that only sampled recent writes
      // would report a healthy catalogue. That split is the whole reason this is dangerous: the
      // damage is confined to rows nobody has touched since, and they are the quiet ones.
      const stale = await staleRowIds();
      expect(stale).not.toContain(writtenAfter);
      expect(stale.length).toBeGreaterThan(0);
    } finally {
      await pool.query(original);
    }
  });
});
