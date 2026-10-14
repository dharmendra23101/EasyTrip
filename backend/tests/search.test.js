const request = require('supertest');
const app = require('../app');
const { createSchema, resetData, closeDb, resetRateLimits, pool } = require('./helpers/testDb');

/**
 * Ranked full-text search (`IMP-112`, `ADR-032`).
 *
 * These assertions exist because the thing being replaced *worked*. `name ILIKE '%q%' OR
 * description ILIKE '%q%'` returned rows, returned them fast enough at this data size, and would
 * have kept passing every test that only ever checked "does searching 'coffee' find Coorg".
 *
 * So every test here pins a property ILIKE **did not have**, and would fail if the filter were
 * reverted:
 *
 *   - stemming: a plural finds the singular
 *   - prefix:   a half-typed word finds the whole one, which is what a debounced search box sends
 *   - weight:   a name match outranks a description match
 *   - breadth:  the state and the tags are searchable, not only name and description
 *   - safety:   query metacharacters are text, not syntax
 *
 * and two that pin a deliberate *regression* from ILIKE, so nobody later "fixes" it by accident:
 * a stopword-only query matches nothing, and an infix fragment no longer matches mid-word.
 */

const names = (res) => res.body.data.map((p) => p.name);

const search = async (term, extra = '') =>
  request(app).get(`/api/places?searchTerm=${encodeURIComponent(term)}${extra}`);

beforeAll(async () => {
  await createSchema();
});
beforeEach(async () => {
  await resetData();
  resetRateLimits(app);
});
afterAll(async () => {
  await closeDb();
});

describe('search — language, not substrings', () => {
  test('a plural finds the singular, and vice versa', async () => {
    // The seed has Gokarna tagged `temples` and Badami described as "cave temples"; neither the
    // word "temple" nor the word "temples" appears in both forms. Under ILIKE, searching the
    // singular missed every one of them — the classic "we don't have that" false negative.
    expect((await search('temple')).body.data.length).toBeGreaterThan(0);
    expect(names(await search('temple')).sort()).toEqual(['Badami', 'Gokarna']);
    expect(names(await search('temples')).sort()).toEqual(['Badami', 'Gokarna']);
  });

  test('a half-typed word finds the place, because the search box is debounced-as-you-type', async () => {
    // `useBrowsePlaces` sends a request 250ms after a keystroke, so the server genuinely receives
    // "h", "ha", "ham". Plain full-text search matches whole lexemes and would return nothing for
    // all three, blanking the grid until the user finished the word. This is why
    // `easytrip_search_query` appends `:*` rather than using `websearch_to_tsquery`.
    expect(names(await search('hamp'))).toEqual(['Hampi']);
    expect(names(await search('coff'))).toEqual(['Coorg']);
    // Down to a single character, which is the first thing the server ever sees.
    expect(names(await search('g'))).toContain('Gokarna');
  });

  test('prefix search survives the double stemming it goes through', async () => {
    // `easytrip_search_query` stems twice — once building the tsvector from the raw input, once
    // inside `to_tsquery` — and the second pass is lossy: 'waterfall' → 'waterfal' → 'waterf'.
    // That is only harmless because of `:*`; as an exact lexeme it would match nothing stored.
    // Pinned here so removing the prefix operator fails loudly rather than subtly.
    await pool.query(
      `INSERT INTO places (name, location, description, created_at, updated_at)
       VALUES ('Dudhsagar', 'Goa', 'A four-tiered waterfall on the Mandovi.', NOW(), NOW())`
    );
    expect(names(await search('waterfall'))).toContain('Dudhsagar');
    expect(names(await search('waterfalls'))).toContain('Dudhsagar');
  });
});

describe('search — ranking', () => {
  test('a place NAMED for the term outranks one that merely mentions it', async () => {
    // The seed's Gokarna is described as "a temple town with a quieter coastline than Goa", so
    // 'goa' is in its description at weight D. A place actually named "Goa Beaches" carries it at
    // weight A. This is the ordering ILIKE could not express at all: both were simply "a match",
    // and which came first was decided by `created_at` — meaning the *older* of the two lost.
    const inserted = await pool.query(
      `INSERT INTO places (name, location, description, created_at, updated_at)
       VALUES ('Goa Beaches', 'Panaji', 'Sand.', NOW() - INTERVAL '10 years', NOW())
       RETURNING id`
    );
    expect(inserted.rows[0].id).toBeDefined();

    const res = await search('goa');
    // Both match…
    expect(names(res)).toEqual(expect.arrayContaining(['Goa Beaches', 'Gokarna']));
    // …and the name match leads, despite being ten years older than the description match.
    expect(names(res)[0]).toBe('Goa Beaches');
  });

  test('searching defaults to relevance, and says so', async () => {
    const res = await search('temple');
    expect(res.status).toBe(200);
    expect(res.body.pagination.sort).toBe('relevance');
  });

  test('an explicit sort still wins — the dropdown is not overridden', async () => {
    const res = await search('temple', '&sort=name');
    expect(res.body.pagination.sort).toBe('name');
    expect(names(res)).toEqual(['Badami', 'Gokarna']);
  });

  test('a browse page with no search term is still newest-first', async () => {
    // The relevance default must be scoped to searches. If it leaked into the unfiltered catalogue
    // read, every row would rank 0 and the "order" would be whatever the tiebreakers produced.
    const res = await request(app).get('/api/places');
    expect(res.body.pagination.sort).toBe('newest');
    expect(names(res)).toEqual(['Badami', 'Gokarna', 'Coorg', 'Hampi']);
  });

  test('sort=relevance with nothing to rank falls back to newest rather than ranking by zero', async () => {
    const res = await request(app).get('/api/places?sort=relevance');
    expect(res.status).toBe(200);
    // The response reports the sort that ran, not the one that was asked for.
    expect(res.body.pagination.sort).toBe('newest');
    expect(names(res)).toEqual(['Badami', 'Gokarna', 'Coorg', 'Hampi']);
  });
});

describe('search — what is searchable', () => {
  test('the state and district are searchable, not just the name and description', async () => {
    // Weight B. A traveller types "Karnataka" into a search box far more readily than they find
    // the state facet and spell it identically — and under ILIKE, which only looked at name and
    // description, that search returned nothing at all.
    expect(names(await search('Karnataka')).sort()).toEqual([
      'Badami',
      'Coorg',
      'Gokarna',
      'Hampi'
    ]);
    expect(names(await search('Kodagu'))).toEqual(['Coorg']);
  });

  test('curated tags are searchable', async () => {
    // Weight C. `unesco` is a tag on Hampi and appears in no other column.
    expect(names(await search('unesco'))).toEqual(['Hampi']);
  });

  test('multiple words are ANDed, the way a search box implies', async () => {
    // "cave temples" must not behave like "cave OR temples" — Gokarna has temples and no caves.
    expect(names(await search('cave temples'))).toEqual(['Badami']);
    expect(names(await search('temples')).sort()).toEqual(['Badami', 'Gokarna']);
  });

  test('search composes with the other filters instead of replacing them', async () => {
    const res = await search('temples', '&themes=%5B%22beach%22%5D');
    // Badami matches the search but is not a beach.
    expect(names(res)).toEqual(['Gokarna']);
  });

  test('the count and the page agree when a search is active', async () => {
    // `buildFilters` returns one WHERE fragment used by both the page query and the count query.
    // A search term bound into only one of them would show "2 results" above a list of four.
    const res = await search('temples', '&limit=1');
    expect(res.body.data).toHaveLength(1);
    expect(res.body.pagination.total).toBe(2);
    expect(res.body.pagination.hasMore).toBe(true);
  });
});

describe('search — the input is text, never query syntax', () => {
  test('tsquery metacharacters cannot produce a 500', async () => {
    // `to_tsquery` RAISES on malformed input, which is precisely why the raw term is never handed
    // to it. Each of these is a syntax error as a tsquery and must be treated as ordinary text.
    for (const hostile of [
      'a & b | c ! ( ) : *',
      '&',
      '!!!',
      '|||',
      '<->',
      "' OR 1=1 --",
      'goa & ',
      '(((',
      ':*',
      'a:*&b:*'
    ]) {
      const res = await search(hostile);
      expect([res.status, hostile]).toEqual([200, hostile]);
    }
  });

  test('a term with an apostrophe is quoted, not broken', async () => {
    await pool.query(
      `INSERT INTO places (name, location, created_at, updated_at)
       VALUES ('O''Brien Point', 'Kochi', NOW(), NOW())`
    );
    const res = await search("o'brien");
    expect(res.status).toBe(200);
    expect(names(res)).toContain("O'Brien Point");
  });

  test('the term is bound, so it cannot reach the SQL text', async () => {
    // The whole catalogue must not come back for an injected always-true predicate.
    const res = await search("x') OR TRUE --");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});

describe('search — the deliberate regressions from ILIKE', () => {
  test('a stopword-only query matches nothing rather than everything', async () => {
    // ILIKE '%the%' matched every place whose description contained those three letters anywhere —
    // which for English prose is most of them, presented as search results. Under full text, "the"
    // reduces to an empty tsquery and matches nothing. Recorded in KNOWN_LIMITATIONS; pinned here
    // so it reads as a decision rather than a bug when someone finds it.
    const res = await search('the');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.pagination.total).toBe(0);
  });

  test('a fragment from the MIDDLE of a word no longer matches', async () => {
    // ILIKE '%ampi%' found Hampi. Prefix search does not, and that is the trade: infix matching is
    // what made the old search return "Champion Trail" for "amp". Only the leading edge matches.
    expect(names(await search('ampi'))).toEqual([]);
    expect(names(await search('hampi'))).toEqual(['Hampi']);
  });

  test('a term matching nothing is an empty list, not an error', async () => {
    const res = await search('zzzzzzz');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});

describe('search — the index is actually used', () => {
  test('the GIN index on search_vector serves the filter', async () => {
    // The point of the migration is not that the query returns the right rows — ILIKE did too —
    // but that it stops reading every row to find them. At four seeded places Postgres will pick a
    // sequential scan regardless, because that is genuinely cheaper, so the plan is forced here.
    // Without the index the forced plan is unavailable and the scan reappears, which is the real
    // assertion: `places_search_vector_idx` exists and is applicable to this predicate.
    const { rows } = await pool.query(
      `SELECT indexname FROM pg_indexes
       WHERE tablename = 'places' AND indexname = 'places_search_vector_idx'`
    );
    expect(rows).toHaveLength(1);

    // One checked-out client inside a real transaction, not two `pool.query` calls. `SET LOCAL`
    // outside a transaction block is a no-op that only raises a warning, and the pool is free to
    // hand the second query a different connection — so the two-call version asserted nothing and
    // passed or failed depending on which backend answered. It was caught by the IMP-112 mutation
    // run, where it failed on mutations that had nothing to do with indexing.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL enable_seqscan = off');
      const plan = await client.query(
        `EXPLAIN (FORMAT TEXT)
         SELECT id FROM places WHERE search_vector @@ easytrip_search_query('temple')`
      );
      expect(plan.rows.map((r) => r['QUERY PLAN']).join('\n')).toContain(
        'places_search_vector_idx'
      );
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  test('the vector is generated, so an UPDATE cannot leave it stale', async () => {
    // A trigger-maintained column drifts the first time a write path forgets to fire it.
    // GENERATED ALWAYS makes that unrepresentable — this is the assertion that says so.
    const { rows } = await pool.query(
      `INSERT INTO places (name, location, created_at, updated_at)
       VALUES ('Placeholder', 'Nowhere', NOW(), NOW()) RETURNING id`
    );
    const id = rows[0].id;

    expect(names(await search('Placeholder'))).toContain('Placeholder');

    await pool.query(`UPDATE places SET name = 'Renamed Lagoon' WHERE id = $1`, [id]);

    expect(names(await search('Placeholder'))).not.toContain('Renamed Lagoon');
    expect(names(await search('lagoon'))).toContain('Renamed Lagoon');
  });

  test('a tags edit is reflected too, which is the half a NEW/OLD trigger usually misses', async () => {
    const { rows } = await pool.query(
      `INSERT INTO places (name, location, tags, created_at, updated_at)
       VALUES ('Tag Test', 'Nowhere', ARRAY['original'], NOW(), NOW()) RETURNING id`
    );
    await pool.query(`UPDATE places SET tags = ARRAY['kayaking'] WHERE id = $1`, [rows[0].id]);

    expect(names(await search('original'))).toEqual([]);
    expect(names(await search('kayaking'))).toEqual(['Tag Test']);
  });
});
