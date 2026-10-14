const request = require('supertest');
const app = require('../app');
const { createSchema, resetData, closeDb, resetRateLimits, pool } = require('./helpers/testDb');
const { authHeader } = require('./helpers/firebaseMock');

/**
 * The server-persisted wishlist — `GET/POST/DELETE /api/auth/favorites` (`IMP-108`, `ADR-030`).
 *
 * **The invariant worth guarding here is not "saving works".** It is that a wishlist is private,
 * and that its privacy comes from the *query*, not from a check somebody remembered to write.
 * Every handler derives the owner from `req.user.uid`; nothing in the request names a user. The
 * suite is arranged so that the mutation which would break that — reading a uid from the body,
 * dropping the `user_id` predicate from the DELETE — fails an assertion rather than merely
 * loosening one.
 *
 * The second theme is **idempotency**. A heart is a toggle, so a double-click, a retry after a
 * dropped response, and a stale tab all send the request that was already sent. Every one of those
 * must land on the state the user wanted rather than on a conflict the UI has to decode.
 */

const USER = { uid: 'seed-user-uid' };
const OTHER = { uid: 'seed-other-uid' };

const asUser = { Authorization: authHeader(USER) };
const asOther = { Authorization: authHeader(OTHER) };

// Seeded place ids. Nothing seeds `user_saved_places`, so every test starts from a genuinely empty
// wishlist and the empty-state assertions are not accidentally true.
//
// The rated/unrated split is the seed's, not a guess: *"Reviews on places 1 and 3 only, so places
// 2 and 4 exercise the unrated path."* An earlier version of this file assumed place 3 was unrated
// and asserted `null` against its 3.0.
const PLACE = 1; // rated (two reviews)
const OTHER_PLACE = 2; // unrated
const THIRD_PLACE = 3; // rated (one review)
const UNRATED_PLACE = 4;

const rowsFor = async (uid) => {
  const result = await pool.query(
    'SELECT place_id, created_at, id FROM user_saved_places WHERE user_id = $1 ORDER BY id',
    [uid]
  );
  return result.rows;
};

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

describe('a wishlist requires an identity', () => {
  test('an anonymous caller cannot read one', async () => {
    const res = await request(app).get('/api/auth/favorites');
    expect(res.status).toBe(401);
  });

  test('an anonymous caller cannot save', async () => {
    const res = await request(app).post('/api/auth/favorites').send({ place_id: PLACE });

    expect(res.status).toBe(401);
    // The 401 has to happen *before* the write, not alongside it. A handler that rejected the
    // response while still reaching the database would pass a status assertion on its own.
    expect(await rowsFor(USER.uid)).toHaveLength(0);
  });

  test('an anonymous caller cannot remove', async () => {
    await pool.query('INSERT INTO user_saved_places (user_id, place_id) VALUES ($1, $2)', [
      USER.uid,
      PLACE
    ]);

    const res = await request(app).delete(`/api/auth/favorites/${PLACE}`);

    expect(res.status).toBe(401);
    expect(await rowsFor(USER.uid)).toHaveLength(1);
  });

  test('a malformed token is refused rather than treated as anonymous', async () => {
    const res = await request(app)
      .get('/api/auth/favorites')
      .set('Authorization', authHeader('INVALID'));

    expect(res.status).toBe(401);
  });
});

describe('one user cannot reach another user’s wishlist', () => {
  /**
   * This is the block that matters. `SECURITY_AUDIT`'s standing rule since `IMP-001/002/003` is
   * that identity comes from the verified token and from nowhere else, and a new resource is
   * exactly where that rule gets re-broken.
   */

  test('a saved place appears only in the wishlist of the user who saved it', async () => {
    await request(app).post('/api/auth/favorites').set(asUser).send({ place_id: PLACE });

    const mine = await request(app).get('/api/auth/favorites').set(asUser);
    const theirs = await request(app).get('/api/auth/favorites').set(asOther);

    expect(mine.body.placeIds).toEqual([PLACE]);
    expect(theirs.body.placeIds).toEqual([]);
    expect(theirs.body.places).toEqual([]);
  });

  test('a client-supplied user id in the body is ignored, not obeyed', async () => {
    // The attack the whole design exists to refuse: name somebody else and see whose wishlist
    // grows. `user_id` is not in the validator, is not read by the controller, and must therefore
    // be inert — the row must land on the *token's* owner.
    await request(app)
      .post('/api/auth/favorites')
      .set(asUser)
      .send({ place_id: PLACE, user_id: OTHER.uid, userId: OTHER.uid, uid: OTHER.uid });

    expect((await rowsFor(OTHER.uid)).map((r) => r.place_id)).toEqual([]);
    expect((await rowsFor(USER.uid)).map((r) => r.place_id)).toEqual([PLACE]);
  });

  test('a client-supplied user id in the query string is ignored too', async () => {
    await pool.query('INSERT INTO user_saved_places (user_id, place_id) VALUES ($1, $2)', [
      OTHER.uid,
      PLACE
    ]);

    const res = await request(app)
      .get(`/api/auth/favorites?user_id=${OTHER.uid}&userId=${OTHER.uid}`)
      .set(asUser);

    expect(res.status).toBe(200);
    expect(res.body.placeIds).toEqual([]);
  });

  test('deleting a place saved by somebody else leaves their row intact', async () => {
    await pool.query('INSERT INTO user_saved_places (user_id, place_id) VALUES ($1, $2)', [
      OTHER.uid,
      PLACE
    ]);

    const res = await request(app).delete(`/api/auth/favorites/${PLACE}`).set(asUser);

    // 200 with `removed: false`. Not a 404 — the response must not become an oracle for whether
    // somebody else saved this place (`ADR-030`).
    expect(res.status).toBe(200);
    expect(res.body.removed).toBe(false);
    expect((await rowsFor(OTHER.uid)).map((r) => r.place_id)).toEqual([PLACE]);
  });

  test('the same place saved by two users is two independent rows', async () => {
    await request(app).post('/api/auth/favorites').set(asUser).send({ place_id: PLACE });
    await request(app).post('/api/auth/favorites').set(asOther).send({ place_id: PLACE });

    // The UNIQUE constraint is on (user_id, place_id), not on place_id. Getting that backwards
    // would make the second save a no-op and one user's heart would silently stop working.
    expect((await rowsFor(USER.uid)).map((r) => r.place_id)).toEqual([PLACE]);
    expect((await rowsFor(OTHER.uid)).map((r) => r.place_id)).toEqual([PLACE]);

    await request(app).delete(`/api/auth/favorites/${PLACE}`).set(asUser);

    // And removing one must not remove the other.
    expect(await rowsFor(USER.uid)).toHaveLength(0);
    expect((await rowsFor(OTHER.uid)).map((r) => r.place_id)).toEqual([PLACE]);
  });
});

describe('saving is idempotent', () => {
  test('saving twice leaves one row and still reports success', async () => {
    const first = await request(app)
      .post('/api/auth/favorites')
      .set(asUser)
      .send({ place_id: PLACE });
    const second = await request(app)
      .post('/api/auth/favorites')
      .set(asUser)
      .send({ place_id: PLACE });

    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ saved: true, created: true, place_id: PLACE });
    // The repeat is a success, not a 409: this is what a double-click sends.
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ saved: true, created: false, place_id: PLACE });

    expect(await rowsFor(USER.uid)).toHaveLength(1);
  });

  test('the second save does not move the entry to the top of the list', async () => {
    // `ON CONFLICT DO NOTHING`, not `DO UPDATE SET created_at = NOW()`. Re-saving something must
    // not reorder the wishlist — the user did not do anything, and a list that reshuffles when a
    // stale tab retries is a bug nobody would think to look for.
    await request(app).post('/api/auth/favorites').set(asUser).send({ place_id: PLACE });
    await request(app).post('/api/auth/favorites').set(asUser).send({ place_id: OTHER_PLACE });

    const before = await request(app).get('/api/auth/favorites').set(asUser);
    await request(app).post('/api/auth/favorites').set(asUser).send({ place_id: PLACE });
    const after = await request(app).get('/api/auth/favorites').set(asUser);

    expect(after.body.placeIds).toEqual(before.body.placeIds);
  });

  test('removing twice is a success both times', async () => {
    await request(app).post('/api/auth/favorites').set(asUser).send({ place_id: PLACE });

    const first = await request(app).delete(`/api/auth/favorites/${PLACE}`).set(asUser);
    const second = await request(app).delete(`/api/auth/favorites/${PLACE}`).set(asUser);

    expect(first.status).toBe(200);
    expect(first.body.removed).toBe(true);
    expect(second.status).toBe(200);
    expect(second.body.removed).toBe(false);
    expect(await rowsFor(USER.uid)).toHaveLength(0);
  });

  test('save, remove, save again returns to the saved state', async () => {
    await request(app).post('/api/auth/favorites').set(asUser).send({ place_id: PLACE });
    await request(app).delete(`/api/auth/favorites/${PLACE}`).set(asUser);
    await request(app).post('/api/auth/favorites').set(asUser).send({ place_id: PLACE });

    const res = await request(app).get('/api/auth/favorites').set(asUser);
    expect(res.body.placeIds).toEqual([PLACE]);
  });
});

describe('what it refuses to save', () => {
  test('a place that does not exist is a 404 and creates nothing', async () => {
    const res = await request(app)
      .post('/api/auth/favorites')
      .set(asUser)
      .send({ place_id: 999999 });

    expect(res.status).toBe(404);
    // The orphan check. The foreign key is what makes this true; an application-level existence
    // check would leave a window between the check and the insert.
    expect(await rowsFor(USER.uid)).toHaveLength(0);
    const orphans = await pool.query(
      'SELECT 1 FROM user_saved_places s LEFT JOIN places p ON p.id = s.place_id WHERE p.id IS NULL'
    );
    expect(orphans.rowCount).toBe(0);
  });

  test('a non-numeric place id is a 400 from the validator, not a 500 from the query', async () => {
    const res = await request(app)
      .post('/api/auth/favorites')
      .set(asUser)
      .send({ place_id: 'not-a-number' });

    expect(res.status).toBe(400);
    expect(await rowsFor(USER.uid)).toHaveLength(0);
  });

  test('a missing place id is a 400', async () => {
    const res = await request(app).post('/api/auth/favorites').set(asUser).send({});
    expect(res.status).toBe(400);
  });

  test.each([0, -1])('place id %p is rejected before it reaches the database', async (placeId) => {
    const res = await request(app)
      .post('/api/auth/favorites')
      .set(asUser)
      .send({ place_id: placeId });

    expect(res.status).toBe(400);
  });

  test('a non-numeric id in the delete path is a 400, not a 500', async () => {
    const res = await request(app).delete('/api/auth/favorites/not-a-number').set(asUser);
    expect(res.status).toBe(400);
  });
});

describe('what a wishlist read returns', () => {
  test('an empty wishlist is an empty list, not an error', async () => {
    const res = await request(app).get('/api/auth/favorites').set(asUser);

    expect(res.status).toBe(200);
    expect(res.body.places).toEqual([]);
    expect(res.body.placeIds).toEqual([]);
  });

  test('newest first, and the order is total', async () => {
    for (const id of [PLACE, OTHER_PLACE, THIRD_PLACE]) {
      await request(app).post('/api/auth/favorites').set(asUser).send({ place_id: id });
    }

    const res = await request(app).get('/api/auth/favorites').set(asUser);

    expect(res.body.placeIds).toEqual([THIRD_PLACE, OTHER_PLACE, PLACE]);
    expect(res.body.places.map((p) => p.id)).toEqual([THIRD_PLACE, OTHER_PLACE, PLACE]);
  });

  test('rows sharing a timestamp still come back in a defined order', async () => {
    // The reason `SAVED_ORDER` ends in `id DESC`. Three saves at an identical `created_at` is
    // exactly what a bulk import or a fast double-tap produces; without the tiebreak Postgres may
    // return any permutation and the assertion above would be flaky rather than wrong.
    await pool.query(
      `INSERT INTO user_saved_places (user_id, place_id, created_at)
       VALUES ($1, $2, $4), ($1, $3, $4)`,
      [USER.uid, PLACE, OTHER_PLACE, '2026-01-01T00:00:00Z']
    );

    const first = await request(app).get('/api/auth/favorites').set(asUser);
    const second = await request(app).get('/api/auth/favorites').set(asUser);

    expect(first.body.placeIds).toEqual(second.body.placeIds);
    // Same timestamp, so the higher id wins — which is the row inserted second.
    expect(first.body.placeIds).toEqual([OTHER_PLACE, PLACE]);
  });

  test('the card payload carries what a card renders, and no uid', async () => {
    await request(app).post('/api/auth/favorites').set(asUser).send({ place_id: PLACE });

    const res = await request(app).get('/api/auth/favorites').set(asUser);
    const [card] = res.body.places;

    expect(card).toMatchObject({ id: PLACE });
    expect(card.name).toEqual(expect.any(String));
    expect(card).toHaveProperty('primary_image_url');
    expect(card).toHaveProperty('average_rating');
    expect(card).toHaveProperty('saved_at');
    // The response is the caller's own data, so a uid would not be a leak — but it would be the
    // first place one appears in a payload since `SECURITY_AUDIT` M7 removed them, and payload
    // shapes get copied.
    expect(JSON.stringify(res.body)).not.toContain(USER.uid);
  });

  test('an unrated place reports null, and a rated one reports its average', async () => {
    // `IMP-073`: 0 renders as a zero-star rating, which is a claim about quality nobody made.
    // Null is "no ratings yet". Both halves are asserted, because a projection that returned null
    // for *everything* would satisfy the first on its own.
    await request(app).post('/api/auth/favorites').set(asUser).send({ place_id: PLACE });
    await request(app).post('/api/auth/favorites').set(asUser).send({ place_id: UNRATED_PLACE });

    const res = await request(app).get('/api/auth/favorites').set(asUser);
    const byId = Object.fromEntries(res.body.places.map((p) => [p.id, p.average_rating]));

    expect(byId[UNRATED_PLACE]).toBeNull();
    // Place 1 carries a 5 and a 4.
    expect(Number(byId[PLACE])).toBeCloseTo(4.5, 1);
  });
});

describe('a deleted place does not leave a broken card behind', () => {
  test('deleting a place removes it from every wishlist that held it', async () => {
    await request(app).post('/api/auth/favorites').set(asUser).send({ place_id: PLACE });
    await request(app).post('/api/auth/favorites').set(asOther).send({ place_id: PLACE });

    // The admin delete path, not a raw DELETE — this asserts the cascade holds through the code
    // that actually removes places.
    const admin = { Authorization: authHeader({ uid: 'seed-admin-uid' }) };
    const deleted = await request(app).delete(`/api/admin/places/${PLACE}`).set(admin);
    expect(deleted.status).toBe(200);

    expect(await rowsFor(USER.uid)).toHaveLength(0);
    expect(await rowsFor(OTHER.uid)).toHaveLength(0);

    const mine = await request(app).get('/api/auth/favorites').set(asUser);
    expect(mine.body.places).toEqual([]);
  });
});
