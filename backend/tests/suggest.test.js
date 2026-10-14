const request = require('supertest');
const app = require('../app');
const { createSchema, resetData, closeDb, resetRateLimits, pool } = require('./helpers/testDb');

/**
 * The typeahead endpoint (`IMP-112` second half, `ADR-033`).
 *
 * A suggestion list is a different contract from a search result, and the assertions here are
 * about the difference: the tiering that puts what you are typing first, the cap that makes the
 * endpoint cheap, and the fact that `q` is text rather than a LIKE pattern.
 */

const names = (res) => res.body.data.map((p) => p.name);
const suggest = async (q, extra = '') =>
  request(app).get(`/api/places/suggest?q=${encodeURIComponent(q)}${extra}`);

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

describe('GET /api/places/suggest — the route resolves at all', () => {
  test('`suggest` is not swallowed by /places/:id', async () => {
    // The literal segment is declared before the parameterised one. If that order were reversed,
    // this request would reach `getPlaceById` with id="suggest" — the `BUG C2` shape.
    const res = await suggest('hampi');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('a place id still resolves as an id', async () => {
    const res = await request(app).get('/api/places/1');
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('data');
  });
});

describe('suggestions are tiered, not merely relevant', () => {
  test('a name starting with the text comes before a name merely containing it', async () => {
    await pool.query(
      `INSERT INTO places (name, location, rating_count, rating_sum, created_at, updated_at)
       VALUES ('Old Goa Churches', 'Goa', 0, 0, NOW(), NOW()),
              ('Goa Beaches', 'Panaji', 0, 0, NOW(), NOW())`
    );
    // Both contain "Goa"; only one starts with it. Tier 0 wins regardless of anything else.
    const result = names(await suggest('goa'));
    expect(result[0]).toBe('Goa Beaches');
    expect(result).toContain('Old Goa Churches');
  });

  test('a mid-word fragment still suggests, though it no longer searches', async () => {
    // `KNOWN_LIMITATIONS`: full-text search dropped infix matching, so `/api/places?searchTerm=ampi`
    // is empty. The typeahead deliberately keeps it — a generous suggestion costs one dropdown row,
    // where a generous search result set costs the user's trust in the grid.
    expect((await request(app).get('/api/places?searchTerm=ampi')).body.data).toEqual([]);
    expect(names(await suggest('ampi'))).toEqual(['Hampi']);
  });

  test('tier 2 reaches what the name does not — state, district and tags', async () => {
    // "unesco" appears only in Hampi's tags; no name contains it.
    expect(names(await suggest('unesco'))).toEqual(['Hampi']);
    expect(names(await suggest('Kodagu'))).toEqual(['Coorg']);
  });

  test('a name match outranks a tag-only match for the same word', async () => {
    await pool.query(
      `INSERT INTO places (name, location, tags, created_at, updated_at)
       VALUES ('Coffee Estate Walk', 'Chikmagalur', ARRAY['plantation'], NOW(), NOW())`
    );
    // Coorg carries `coffee` as a tag and in its description; the new place is named for it.
    const result = names(await suggest('coffee'));
    expect(result[0]).toBe('Coffee Estate Walk');
    expect(result).toContain('Coorg');
  });
});

describe('the response is shaped for a dropdown', () => {
  test('it carries what a suggestion row needs and nothing heavier', async () => {
    const res = await suggest('hampi');
    expect(res.body.data[0]).toEqual({
      id: expect.any(Number),
      name: 'Hampi',
      location: 'Hampi',
      district: 'Ballari',
      state: 'Karnataka'
    });
  });

  test('the ranking tier is not part of the contract', async () => {
    // Exposing it would couple a client to how ordering happens to be expressed today.
    const res = await suggest('hampi');
    expect(res.body.data[0]).not.toHaveProperty('tier');
  });

  test('there is no pagination envelope, because there is no page two', async () => {
    const res = await suggest('a');
    expect(res.body).not.toHaveProperty('pagination');
  });
});

describe('the list is capped', () => {
  test('at most 8 by default, however many match', async () => {
    const values = Array.from(
      { length: 20 },
      (_, i) => `('Beach Number ${i}', 'Goa', NOW(), NOW())`
    );
    await pool.query(
      `INSERT INTO places (name, location, created_at, updated_at) VALUES ${values.join(',')}`
    );
    expect((await suggest('beach')).body.data).toHaveLength(8);
  });

  test('a caller may ask for fewer', async () => {
    expect((await suggest('a', '&limit=3')).body.data.length).toBeLessThanOrEqual(3);
  });

  test('a caller may NOT ask for more — the cap is refused, not clamped', async () => {
    // Same choice as `listPlaces` (`IMP-038`): a 400 the caller can see beats a silent clamp they
    // will build on.
    expect((await suggest('a', '&limit=50')).status).toBe(400);
    expect((await suggest('a', '&limit=11')).status).toBe(400);
    expect((await suggest('a', '&limit=10')).status).toBe(200);
  });
});

describe('q is text, not a LIKE pattern', () => {
  test('a lone percent sign suggests nothing rather than everything', async () => {
    // Unescaped, `%` is the LIKE wildcard: `name ILIKE '%' || '%' || '%'` matches every row, and
    // the endpoint would answer "what are you typing?" with "here is the catalogue".
    const res = await suggest('%');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  test('an underscore is a literal underscore, not "any character"', async () => {
    await pool.query(
      `INSERT INTO places (name, location, created_at, updated_at)
       VALUES ('Under_score Falls', 'Nowhere', NOW(), NOW())`
    );
    // `_` unescaped would make "H_mpi" match Hampi. It must match only the literal.
    expect(names(await suggest('H_mpi'))).toEqual([]);
    expect(names(await suggest('Under_score'))).toEqual(['Under_score Falls']);
  });

  test('a backslash does not corrupt the escape sequence', async () => {
    const res = await suggest('\\');
    expect(res.status).toBe(200);
  });

  test('tsquery metacharacters cannot produce a 500 here either', async () => {
    for (const hostile of ['a & b | c ! ( ) : *', '&', "' OR 1=1 --", '%_\\', ':*']) {
      const res = await suggest(hostile);
      expect([res.status, hostile]).toEqual([200, hostile]);
    }
  });
});

describe('the empty cases', () => {
  test('no q at all is an empty list, not a 400', async () => {
    const res = await request(app).get('/api/places/suggest');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  test('whitespace only is an empty list, not the whole catalogue', async () => {
    // `'   '` trimmed is empty, but an untrimmed `ILIKE '%   %'` would match nothing while
    // `easytrip_search_query('   ')` matches nothing either — the risk is a future change making
    // one of them permissive. Pinned as the endpoint's contract rather than as today's accident.
    const res = await suggest('   ');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  test('a term matching nothing is an empty list', async () => {
    expect((await suggest('zzzzzzzz')).body.data).toEqual([]);
  });

  test('an over-long term is refused', async () => {
    expect((await suggest('x'.repeat(201))).status).toBe(400);
    expect((await suggest('x'.repeat(200))).status).toBe(200);
  });
});
