const request = require('supertest');
const app = require('../app');
const { createSchema, resetData, closeDb, resetRateLimits, pool } = require('./helpers/testDb');
const { authHeader } = require('./helpers/firebaseMock');

/**
 * `GET /api/auth/reviews` — the caller's own review history (`IMP-117`).
 *
 * **The interesting property is that this endpoint deliberately does the opposite of the public
 * one.** `GET /places/:id/reviews` exists partly to *prevent* correlating a person's reviews across
 * the site: `IMP-021` replaced the author uid with a per-place digest for exactly that reason. This
 * endpoint performs that correlation — for the one person entitled to it.
 *
 * So the assertions worth having are the two that keep those apart:
 *
 * 1. it returns **only** the caller's reviews, from the token and nothing else, and
 * 2. it does **not** re-introduce a uid into a review payload, which `SECURITY_AUDIT` M7 removed.
 *
 * The seed puts two reviews on place 1 (one from each of two users) and one on place 3 — so
 * "everything by this user" and "everything on this place" are different sets, and an endpoint
 * that quietly filtered by the wrong column would return the wrong list rather than an empty one.
 */

const USER = { uid: 'seed-user-uid' };
const OTHER = { uid: 'seed-other-uid' };
const ADMIN = { uid: 'seed-admin-uid' };

const asUser = { Authorization: authHeader(USER) };
const asOther = { Authorization: authHeader(OTHER) };
const asAdmin = { Authorization: authHeader(ADMIN) };

const RATED_PLACE = 1; // two seeded reviews: seed-user-uid and seed-other-uid
const OTHER_RATED_PLACE = 3; // one seeded review: seed-user-uid

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

describe('a review history requires an identity', () => {
  test('an anonymous caller gets a 401, not an empty list', async () => {
    const res = await request(app).get('/api/auth/reviews');
    expect(res.status).toBe(401);
  });

  test('a malformed token is refused', async () => {
    const res = await request(app)
      .get('/api/auth/reviews')
      .set('Authorization', authHeader('INVALID'));
    expect(res.status).toBe(401);
  });
});

describe('it returns the caller’s reviews and nobody else’s', () => {
  test('the seeded author sees both of their own reviews, across two places', async () => {
    const res = await request(app).get('/api/auth/reviews').set(asUser);

    expect(res.status).toBe(200);
    expect(res.body.reviews.map((r) => r.place_id).sort()).toEqual([
      RATED_PLACE,
      OTHER_RATED_PLACE
    ]);
  });

  test('the other author sees only theirs — one review, on the shared place', async () => {
    // Place 1 carries a review from each user. An endpoint filtering by place instead of by author
    // would return two here, which is why the fixture matters: the wrong filter gives a *wrong*
    // answer rather than an empty one, and an empty one is what a careless test would notice.
    const res = await request(app).get('/api/auth/reviews').set(asOther);

    expect(res.body.reviews).toHaveLength(1);
    expect(res.body.reviews[0].place_id).toBe(RATED_PLACE);
  });

  test('a user with no reviews gets an empty list, not an error', async () => {
    const res = await request(app).get('/api/auth/reviews').set(asAdmin);

    expect(res.status).toBe(200);
    expect(res.body.reviews).toEqual([]);
  });

  test('a client-supplied user id in the query string is ignored', async () => {
    const res = await request(app)
      .get(`/api/auth/reviews?user_id=${USER.uid}&userId=${USER.uid}&uid=${USER.uid}`)
      .set(asAdmin);

    // The admin has no reviews. If any of those parameters were honoured, this returns two.
    expect(res.body.reviews).toEqual([]);
  });
});

describe('what the payload carries', () => {
  test('enough of the place to render a card and link back to it', async () => {
    const res = await request(app).get('/api/auth/reviews').set(asUser);
    const review = res.body.reviews.find((r) => r.place_id === RATED_PLACE);

    expect(review).toMatchObject({ place_id: RATED_PLACE });
    expect(review.place_name).toEqual(expect.any(String));
    expect(review).toHaveProperty('place_location');
    expect(review).toHaveProperty('place_image_url');
    expect(review.rating).toBeGreaterThanOrEqual(1);
    expect(review).toHaveProperty('comment');
    expect(review).toHaveProperty('created_at');
    // `id` is what the delete route needs; without it the list can render but not act.
    expect(review.id).toEqual(expect.any(Number));
  });

  test('no Firebase uid appears anywhere in the response', async () => {
    // `SECURITY_AUDIT` M7 removed uids from review payloads. This response is the caller's own
    // data so a uid would not leak to a third party — but payload shapes get copied, and the next
    // handler to copy this one might not be scoped to the owner.
    const res = await request(app).get('/api/auth/reviews').set(asUser);

    const body = JSON.stringify(res.body);
    expect(body).not.toContain(USER.uid);
    expect(body).not.toContain(OTHER.uid);
    expect(res.body.reviews[0]).not.toHaveProperty('user_id');
  });

  test('most recently updated first, and the order is total', async () => {
    // Two rows written in the same statement share `updated_at`; without the `id DESC` tiebreak
    // Postgres may return either order and this assertion would be flaky rather than wrong.
    await pool.query('DELETE FROM place_reviews WHERE user_id = $1', [USER.uid]);
    await pool.query(
      `INSERT INTO place_reviews (place_id, user_id, user_name, rating, comment, created_at, updated_at)
       VALUES (1, $1, 'Tom', 4, 'a', $2, $2), (2, $1, 'Tom', 5, 'b', $2, $2)`,
      [USER.uid, '2026-01-01T00:00:00Z']
    );

    const first = await request(app).get('/api/auth/reviews').set(asUser);
    const second = await request(app).get('/api/auth/reviews').set(asUser);

    expect(first.body.reviews.map((r) => r.id)).toEqual(second.body.reviews.map((r) => r.id));
    // Same timestamp, so the higher id wins — the row inserted second.
    expect(first.body.reviews.map((r) => r.place_id)).toEqual([2, 1]);
  });
});

describe('the history stays in step with the reviews it lists', () => {
  test('deleting a review through the place route removes it from the history', async () => {
    const before = await request(app).get('/api/auth/reviews').set(asUser);
    const target = before.body.reviews.find((r) => r.place_id === OTHER_RATED_PLACE);

    const deleted = await request(app)
      .delete(`/api/places/${OTHER_RATED_PLACE}/reviews/${target.id}`)
      .set(asUser);
    // 204, not 200 — `IMP-019`'s delete returns no content, which is the right answer for a delete
    // and the contract `reviews.test.js` already pins.
    expect(deleted.status).toBe(204);

    const after = await request(app).get('/api/auth/reviews').set(asUser);
    expect(after.body.reviews.map((r) => r.place_id)).not.toContain(OTHER_RATED_PLACE);
  });

  test('re-reviewing edits the existing entry rather than adding a second', async () => {
    // `UNIQUE (place_id, user_id)` plus the upsert means the history cannot grow by editing. If it
    // could, a user's own page would be the first place the duplicate became visible.
    await request(app)
      .post(`/api/places/${RATED_PLACE}/reviews`)
      .set(asUser)
      .send({ rating: 2, comment: 'Changed my mind.' });

    const res = await request(app).get('/api/auth/reviews').set(asUser);
    const forPlace = res.body.reviews.filter((r) => r.place_id === RATED_PLACE);

    expect(forPlace).toHaveLength(1);
    expect(forPlace[0].rating).toBe(2);
    expect(forPlace[0].comment).toBe('Changed my mind.');
  });

  test('deleting the place takes the review and the history entry with it', async () => {
    const removed = await request(app).delete(`/api/admin/places/${RATED_PLACE}`).set(asAdmin);
    expect(removed.status).toBe(200);

    const res = await request(app).get('/api/auth/reviews').set(asUser);
    expect(res.body.reviews.map((r) => r.place_id)).not.toContain(RATED_PLACE);
    // The INNER JOIN matters here: a review whose place is gone must not render as a card with a
    // null name and a dead link.
    expect(res.body.reviews.every((r) => typeof r.place_name === 'string')).toBe(true);
  });
});
