const request = require('supertest');
const app = require('../app');
const { createSchema, resetData, closeDb, resetRateLimits, pool } = require('./helpers/testDb');
const { authHeader } = require('./helpers/firebaseMock');
const { SORT_KEYS } = require('../src/models/placeModel');

/** Places: read, search, write, and the validation boundary (IMP-092). */

const ADMIN = { uid: 'seed-admin-uid' };
const USER = { uid: 'seed-user-uid' };
const asAdmin = { Authorization: authHeader(ADMIN) };

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

describe('GET /api/places', () => {
  test('returns the seeded catalogue with pagination', async () => {
    const res = await request(app).get('/api/places');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(4);
    expect(res.body.pagination).toMatchObject({ hasMore: false });
  });

  test('REJECTS a limit above 100 rather than clamping it (IMP-038)', async () => {
    // Worth pinning precisely, because a code comment in the frontend claimed the opposite — that
    // the server "silently clamps". It does not: `isInt({min:1,max:100})` fails the request. Both
    // are defensible designs; the point is that only one of them is real, and a caller that
    // assumed clamping would get a 400 it never handled.
    const res = await request(app).get('/api/places?limit=100000');
    expect(res.status).toBe(400);
  });

  test('accepts the maximum allowed limit', async () => {
    expect((await request(app).get('/api/places?limit=100')).status).toBe(200);
  });

  test('offset pages through without repeating a row', async () => {
    const first = await request(app).get('/api/places?limit=2&offset=0');
    const second = await request(app).get('/api/places?limit=2&offset=2');
    const ids = [...first.body.data, ...second.body.data].map((p) => p.id);
    expect(new Set(ids).size).toBe(4);
    expect(first.body.pagination.hasMore).toBe(true);
    expect(second.body.pagination.hasMore).toBe(false);
  });

  test('filters by theme (locks in IMP-011)', async () => {
    // Collection params are JSON arrays on the wire. `placesApi.buildQuery` JSON-stringifies any
    // array value, and the validator requires exactly that shape.
    const res = await request(app).get('/api/places?themes=%5B%22beach%22%5D');
    expect(res.status).toBe(200);
    expect(res.body.data.map((p) => p.name)).toEqual(['Gokarna']);
  });

  test('rejects a bare (non-JSON) collection param rather than guessing', async () => {
    // The controller's `parseArrayParam` would happily coerce `beach` to `['beach']`, but the
    // validator runs first and refuses. Pinned because the two layers disagree: if the validator
    // is ever relaxed, this test says which behaviour was intended.
    expect((await request(app).get('/api/places?themes=beach')).status).toBe(400);
  });

  test('filters by search term across name and description', async () => {
    const res = await request(app).get('/api/places?searchTerm=coffee');
    expect(res.body.data.map((p) => p.name)).toEqual(['Coorg']);
  });

  test('a place is unclassified until somebody says otherwise', async () => {
    // `unknown` is the default and every consumer must read it as "assert nothing", not as a
    // synonym for indoor. A daylight warning produced from a guess would be fabricated data with a
    // scheduler's authority.
    const res = await request(app)
      .post('/api/admin/places')
      .set(asAdmin)
      .send({ name: 'Unclassified', location: 'Nowhere' });

    expect(res.status).toBe(201);
    expect(res.body.setting).toBe('unknown');
  });

  test('a setting is stored when given, and refused when it is not one of the four', async () => {
    const ok = await request(app)
      .post('/api/admin/places')
      .set(asAdmin)
      .send({ name: 'Open Ruins', location: 'Hampi', setting: 'outdoor' });
    expect(ok.status).toBe(201);
    expect(ok.body.setting).toBe('outdoor');

    const bad = await request(app)
      .post('/api/admin/places')
      .set(asAdmin)
      .send({ name: 'Bad', location: 'Nowhere', setting: 'outdoorsy' });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).toMatch(/setting/);
  });

  test('an edit that does not mention setting leaves the classification alone', async () => {
    // `updatePlace` keys on `column in placeData`, so an unconditional pass-through would send
    // undefined -> NULL and the NOT NULL column would reject the edit. This is that guard.
    const created = await request(app)
      .post('/api/admin/places')
      .set(asAdmin)
      .send({ name: 'Keeps Its Setting', location: 'Somewhere', setting: 'mixed' });
    expect(created.status).toBe(201);

    const edited = await request(app)
      .put(`/api/admin/places/${created.body.id}`)
      .set(asAdmin)
      .send({ name: 'Renamed Only', location: 'Somewhere' });

    expect(edited.status).toBe(200);
    expect(edited.body.setting).toBe('mixed');
  });

  test('an empty setting on a multipart edit means "leave it alone", not a 500 (BUG-055)', async () => {
    // Reachable from an ordinary browser: an HTML <select> with its empty option selected submits
    // `setting=""`, and a multipart form submits every field it renders whether or not anybody
    // touched it. The validator is `optional({ values: 'falsy' })` so it never sees the value; the
    // controller used to pass it through, and `places_setting_known` rejected the whole edit.
    const res = await request(app)
      .put('/api/admin/places/2')
      .set('Authorization', authHeader({ uid: 'seed-admin-uid' }))
      .field('setting', '')
      .field('name', 'Renamed With An Empty Setting');

    expect(res.status).toBe(200);

    const { rows } = await pool.query('SELECT name, setting FROM places WHERE id = 2');
    expect(rows[0].name).toBe('Renamed With An Empty Setting');
    // Untouched, which is what "said nothing" has to mean.
    expect(rows[0].setting).toBe('unknown');
  });

  test('an unknown theme is refused on write, though it is tolerated on a read', async () => {
    // The asymmetry is deliberate and this pins both halves. `themes` is a closed vocabulary shared
    // with the browse filter, so storing one nothing offers creates a place no filter can find --
    // which is how the seed came to carry `heritage` and `spiritual`. But a *query* for an unknown
    // theme is a stale bookmark, and 200-with-nothing is friendlier there than a 400.
    const res = await request(app)
      .post('/api/admin/places')
      .set(asAdmin)
      .send({ name: 'Nowhere', location: 'Nowhere', themes: JSON.stringify(['spiritual']) });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/spiritual/);

    // the same value as a filter is not an error
    const read = await request(app).get('/api/places?themes=%5B%22spiritual%22%5D');
    expect(read.status).toBe(200);
  });

  test('a valid theme is accepted on write', async () => {
    // Guarding the guard: if the validator rejected everything, the test above would still pass.
    const res = await request(app)
      .post('/api/admin/places')
      .set(asAdmin)
      .send({ name: 'Somewhere', location: 'Somewhere', themes: JSON.stringify(['historical']) });

    expect(res.status).toBe(201);
  });

  test('an unmatched filter returns an empty list, not an error', async () => {
    const res = await request(app).get('/api/places?themes=%5B%22nonexistent-theme%22%5D');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  test('exposes a computed average_rating, and null rather than 0 when unrated (IMP-073)', async () => {
    const res = await request(app).get('/api/places');
    const byName = Object.fromEntries(res.body.data.map((p) => [p.name, p]));
    // Hampi has a 5 and a 4.
    expect(Number(byName.Hampi.rating_count)).toBe(2);
    expect(Number(byName.Hampi.rating_sum)).toBe(9);
    // Badami has none. A zero average would render as a zero-star rating.
    expect(Number(byName.Badami.rating_count)).toBe(0);
  });
});

/**
 * The sort enum (`m1`, closed by `IMP-038`/`IMP-046`).
 *
 * `sortOrder: 'popular'` was offered in the browse dropdown for a long time and did nothing: the
 * client-side `switch` handled `newest`/`rating`/`name` and silently ignored the fourth. Sorting
 * moved server-side with `IMP-038`, and `popular` became real — but **nothing tested any of it**,
 * which left the fix guarded by nothing at all.
 *
 * The failure mode is what makes this worth pinning. `SORT_ORDERS[sort] || SORT_ORDERS.newest`
 * means deleting a key does not raise anything — the endpoint keeps returning 200 with a
 * plausible-looking list in the wrong order. That is precisely how `m1` behaved for months.
 */
describe('GET /api/places — sort ordering (m1)', () => {
  const namesSortedBy = async (sort) => {
    const res = await request(app).get(`/api/places?sort=${sort}`);
    expect(res.status).toBe(200);
    return res.body.data.map((p) => p.name);
  };

  test('newest and oldest are genuine opposites', async () => {
    // The seed writes all four in one statement, so `created_at` ties and `places.id` breaks it.
    // That tiebreaker is the reason this assertion is stable rather than clock-dependent.
    expect(await namesSortedBy('newest')).toEqual(['Badami', 'Gokarna', 'Coorg', 'Hampi']);
    expect(await namesSortedBy('oldest')).toEqual(['Hampi', 'Coorg', 'Gokarna', 'Badami']);
  });

  test('name sorts alphabetically', async () => {
    expect(await namesSortedBy('name')).toEqual(['Badami', 'Coorg', 'Gokarna', 'Hampi']);
  });

  test('rating puts unrated places last rather than treating them as zero', async () => {
    const names = await namesSortedBy('rating');
    // Hampi 4.5, Gokarna 3.0, then the two unrated. `NULLS LAST` is the whole point: without it
    // Postgres sorts NULL highest on a DESC ordering, so the places nobody has reviewed would
    // lead the "Highest Rated" list.
    expect(names.slice(0, 2)).toEqual(['Hampi', 'Gokarna']);
    expect(names.slice(2).sort()).toEqual(['Badami', 'Coorg']);
  });

  test('popular ranks by how many reviews, not how good they are', async () => {
    // The seed alone cannot tell `popular` from `rating` — Hampi leads on both counts, so a test
    // written against the fixture as-is would pass even if `popular` were mapped to `rating`'s
    // SQL. Two more middling reviews on Gokarna separate them: it then has the most reviews and
    // the worse average.
    await pool.query(
      `INSERT INTO place_reviews (place_id, user_id, user_name, rating, comment, created_at, updated_at)
       VALUES (3, 'sort-uid-a', 'A', 3, null, NOW(), NOW()),
              (3, 'sort-uid-b', 'B', 3, null, NOW(), NOW())`
    );

    // Gokarna: 3 reviews averaging 3.0. Hampi: 2 reviews averaging 4.5.
    expect((await namesSortedBy('popular')).slice(0, 2)).toEqual(['Gokarna', 'Hampi']);
    expect((await namesSortedBy('rating')).slice(0, 2)).toEqual(['Hampi', 'Gokarna']);
  });

  test('an unknown sort is refused, so a new UI option cannot fail silently', async () => {
    // This is the guard that keeps `m1` from recurring. If the browse dropdown grows a fifth
    // option the server does not implement, the request fails loudly here instead of quietly
    // returning the default order and looking like the sort simply does not work well.
    expect((await request(app).get('/api/places?sort=trending')).status).toBe(400);
  });

  test('every sort the API advertises is one it actually implements', async () => {
    // The validator's `isIn` list and the model's `SORT_ORDERS` map are two separate declarations
    // of the same set. Accepting a value the map lacks is the silent-fallback bug; rejecting one
    // it has makes a working ordering unreachable.
    //
    // Enumerated from the model rather than restated, so a sort added there is covered here
    // automatically. The hardcoded list this replaced went stale the moment `relevance` landed
    // (IMP-112): it kept passing while silently testing four fifths of the surface.
    const advertised = SORT_KEYS;
    expect(advertised).toContain('relevance');
    for (const sort of advertised) {
      expect((await request(app).get(`/api/places?sort=${sort}`)).status).toBe(200);
    }
    // And the orders are genuinely distinct, not five names for two behaviours. `relevance` is
    // excluded from the distinctness count on purpose: with no search term it resolves to `newest`
    // by design, so counting it here would assert the opposite of what the fallback intends.
    const orders = new Set(
      await Promise.all(
        advertised
          .filter((s) => s !== 'relevance')
          .map(async (s) => (await namesSortedBy(s)).join(','))
      )
    );
    expect(orders.size).toBeGreaterThanOrEqual(4);
  });
});

describe('GET /api/places/:id', () => {
  test('returns one place', async () => {
    const res = await request(app).get('/api/places/1');
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Hampi');
  });

  // `TD-023`. `places.setting` had a migration, a validator, a CHECK constraint, an index and two
  // features reading it — and this query never selected it. The write path accepted a
  // classification the read path could not return, so the admin form had no way to show what a
  // place already was, and every unrelated edit would have silently reset it to the default.
  //
  // A one-column omission, invisible to every backend test, because nothing asked.
  test('returns the place’s setting, so an editor can show what it already is', async () => {
    const res = await request(app).get('/api/places/1');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('setting');
    // Seeded rows carry the column default: nothing in the catalogue is classified yet, which is
    // the state `TD-023` exists to make changeable.
    expect(res.body.setting).toBe('unknown');
  });

  test('and reports a real classification once one is set', async () => {
    await pool.query("UPDATE places SET setting = 'outdoor' WHERE id = 1");

    const res = await request(app).get('/api/places/1');
    expect(res.body.setting).toBe('outdoor');
  });

  // Found by the E2E suite (IMP-094): this endpoint is public and Next serialises the whole payload
  // into `__NEXT_DATA__`, so shipping `created_by`/`updated_by` put a curating admin's raw Firebase
  // UID into the HTML of every place page, for every anonymous visitor. Nothing consumed it — both
  // `PlaceCard` and `MagazineDetails` list these keys in their exclusion filters, and the list
  // projection already omitted them.
  //
  // The same rule `IMP-021` applies to review authors, applied to the people with write access.
  test('never exposes the curating admin’s Firebase uid', async () => {
    const res = await request(app).get('/api/places/1');
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('created_by');
    expect(res.body).not.toHaveProperty('updated_by');
    expect(JSON.stringify(res.body)).not.toContain('seed-admin-uid');
  });

  test('the list projection does not expose it either', async () => {
    const res = await request(app).get('/api/places');
    expect(JSON.stringify(res.body)).not.toContain('seed-admin-uid');
  });

  test('404s for an id that does not exist', async () => {
    expect((await request(app).get('/api/places/99999')).status).toBe(404);
  });

  test('rejects a non-numeric id rather than reaching the database', async () => {
    const res = await request(app).get('/api/places/not-an-id');
    expect([400, 404]).toContain(res.status);
  });
});

describe('write routes are gated', () => {
  const body = { name: 'New Place', location: 'Somewhere' };

  test('POST without a token is 401', async () => {
    expect((await request(app).post('/api/admin/places').send(body)).status).toBe(401);
  });

  test('POST with a non-admin token is 403', async () => {
    const res = await request(app)
      .post('/api/admin/places')
      .set({ Authorization: authHeader(USER) })
      .send(body);
    expect(res.status).toBe(403);
  });

  test('PUT without a token is 401', async () => {
    expect((await request(app).put('/api/admin/places/1').send(body)).status).toBe(401);
  });

  test('DELETE without a token is 401', async () => {
    expect((await request(app).delete('/api/admin/places/1')).status).toBe(401);
  });
});

describe('validation on the write path (IMP-057)', () => {
  const cases = [
    ['a missing name', { location: 'Somewhere' }],
    ['a missing location', { name: 'Nameless' }],
    ['latitude out of range', { name: 'X', location: 'Y', latitude: 999 }],
    ['longitude out of range', { name: 'X', location: 'Y', longitude: 999 }],
    [
      'a description over the 5000-character limit',
      { name: 'X', location: 'Y', description: 'x'.repeat(5001) }
    ]
  ];

  test.each(cases)('rejects %s with 400', async (_label, body) => {
    const res = await request(app).post('/api/admin/places').set(asAdmin).send(body);
    expect(res.status).toBe(400);
  });

  test('accepts a valid place and persists it', async () => {
    const res = await request(app)
      .post('/api/admin/places')
      .set(asAdmin)
      .send({ name: 'Chikmagalur', location: 'Chikmagalur', latitude: 13.31, longitude: 75.77 });
    expect(res.status).toBe(201);

    const { rows } = await pool.query('SELECT name FROM places WHERE name = $1', ['Chikmagalur']);
    expect(rows).toHaveLength(1);
  });

  test('a 5000-character description is accepted — the client and API agree (Sprint 5.12)', async () => {
    const res = await request(app)
      .post('/api/admin/places')
      .set(asAdmin)
      .send({ name: 'Long', location: 'Somewhere', description: 'x'.repeat(5000) });
    expect(res.status).toBe(201);
  });
});

describe('DELETE cascades', () => {
  test('removing a place removes its reviews and images', async () => {
    const before = await pool.query(
      'SELECT count(*)::int AS n FROM place_reviews WHERE place_id = 1'
    );
    expect(before.rows[0].n).toBe(2);

    const res = await request(app).delete('/api/admin/places/1').set(asAdmin);
    expect([200, 204]).toContain(res.status);

    const reviews = await pool.query(
      'SELECT count(*)::int AS n FROM place_reviews WHERE place_id = 1'
    );
    const images = await pool.query(
      'SELECT count(*)::int AS n FROM place_images WHERE place_id = 1'
    );
    expect(reviews.rows[0].n).toBe(0);
    expect(images.rows[0].n).toBe(0);
  });
});

describe('taxonomy endpoints', () => {
  test.each([
    ['/api/places/locations', 'Hampi'],
    ['/api/places/districts', 'Ballari'],
    ['/api/places/states', 'Karnataka'],
    ['/api/places/tags', 'unesco']
  ])('%s returns distinct real values including %s', async (route, expected) => {
    const res = await request(app).get(route);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).toContain(expected);
  });
});
