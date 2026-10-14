const request = require('supertest');
const app = require('../app');
const { createSchema, resetData, closeDb, resetRateLimits, pool } = require('./helpers/testDb');
const { authHeader } = require('./helpers/firebaseMock');

/**
 * Reviews (IMP-092, locking in IMP-019/021/023).
 *
 * Three of this project's worst shipped bugs lived here: a review form wired to no-ops, a report
 * button that faked success with a setTimeout, and a delete operation with no route at all. Every
 * one of them was invisible to a build and a lint run.
 */

const USER = { uid: 'seed-user-uid', name: 'Tom Traveller' };
const FRESH = { uid: 'seed-fresh-uid', name: 'Fern Fresh' };
const asUser = { Authorization: authHeader(USER) };

const ratingOf = async (placeId) => {
  const { rows } = await pool.query('SELECT rating_sum, rating_count FROM places WHERE id = $1', [
    placeId
  ]);
  return { sum: Number(rows[0].rating_sum), count: Number(rows[0].rating_count) };
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

describe('GET /api/places/:id/reviews', () => {
  test('returns the seeded reviews', async () => {
    const res = await request(app).get('/api/places/1/reviews');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  test('returns an empty array for a place with no reviews', async () => {
    const res = await request(app).get('/api/places/4/reviews');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  // This route is the one review endpoint with no express-validator chain in front of it — it is
  // public and soft-authenticated, so the controller's own `isNaN` guard is the only thing between
  // a non-numeric id and `WHERE place_id = 'abc'` against an integer column. Without the guard
  // Postgres raises 22P02 and the caller gets a 500 for what is plainly a client error.
  test('rejects a non-numeric place id with 400, not a 500 from the driver', async () => {
    const res = await request(app).get('/api/places/abc/reviews');
    expect(res.status).toBe(400);
  });

  describe('the author-privacy contract (IMP-021)', () => {
    test('never sends the raw firebase uid', async () => {
      const res = await request(app).get('/api/places/1/reviews');
      expect(JSON.stringify(res.body)).not.toContain('seed-user-uid');
      expect(JSON.stringify(res.body)).not.toContain('seed-other-uid');
    });

    test('the digest is stable within a place but differs between places', async () => {
      // Same author, two places. A digest shared across places would let anyone correlate one
      // person's whole review history, which is the leak the digest exists to prevent.
      const one = await request(app).get('/api/places/1/reviews');
      const three = await request(app).get('/api/places/3/reviews');
      const onTwo = one.body.find((r) => r.user_name === 'Tom Traveller').user_id;
      const onThree = three.body.find((r) => r.user_name === 'Tom Traveller').user_id;
      expect(onTwo).toBeTruthy();
      expect(onThree).toBeTruthy();
      expect(onTwo).not.toBe(onThree);
    });

    test('passes the display name through as written', async () => {
      const res = await request(app).get('/api/places/1/reviews');
      expect(res.body.map((r) => r.user_name)).toContain('Tom Traveller');
    });

    test('is_own is false for an anonymous caller and true for the author', async () => {
      const anon = await request(app).get('/api/places/1/reviews');
      expect(anon.body.every((r) => r.is_own === false)).toBe(true);

      const mine = await request(app).get('/api/places/1/reviews').set(asUser);
      const own = mine.body.filter((r) => r.is_own);
      expect(own).toHaveLength(1);
      expect(own[0].user_name).toBe('Tom Traveller');
    });
  });
});

describe('POST /api/places/:id/reviews', () => {
  test('requires authentication', async () => {
    const res = await request(app).post('/api/places/4/reviews').send({ rating: 5 });
    expect(res.status).toBe(401);
  });

  test('creates a review and the trigger updates the place aggregate', async () => {
    expect(await ratingOf(4)).toEqual({ sum: 0, count: 0 });

    const res = await request(app)
      .post('/api/places/4/reviews')
      .set(asUser)
      .send({ rating: 4, comment: 'Worth the detour.' });
    expect([200, 201]).toContain(res.status);

    // Migration 006 exists because no migration ever created this trigger, so the aggregates
    // drifted from the reviews. Asserting the aggregate rather than the row is what would catch
    // that happening again.
    expect(await ratingOf(4)).toEqual({ sum: 4, count: 1 });
  });

  test('a second submit by the same user EDITS rather than duplicating', async () => {
    await request(app)
      .post('/api/places/4/reviews')
      .set(asUser)
      .send({ rating: 4, comment: 'First' });
    await request(app)
      .post('/api/places/4/reviews')
      .set(asUser)
      .send({ rating: 2, comment: 'Second' });

    const { rows } = await pool.query(
      'SELECT rating, comment FROM place_reviews WHERE place_id = 4'
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].rating).toBe(2);
    expect(rows[0].comment).toBe('Second');
    expect(await ratingOf(4)).toEqual({ sum: 2, count: 1 });
  });

  test('identity comes from the token, not the body', async () => {
    // The body tries to attribute the review to someone else. The server must ignore it — this is
    // the same class as the AdminX header (IMP-002).
    await request(app)
      .post('/api/places/4/reviews')
      .set(asUser)
      .send({ rating: 5, comment: 'x', user_id: 'seed-other-uid', user_name: 'Impersonated' });

    const { rows } = await pool.query('SELECT user_id FROM place_reviews WHERE place_id = 4');
    expect(rows[0].user_id).toBe('seed-user-uid');
  });

  test.each([
    ['a rating of 0', { rating: 0 }],
    ['a rating of 6', { rating: 6 }],
    ['a non-numeric rating', { rating: 'five' }],
    ['no rating at all', { comment: 'nice' }]
  ])('rejects %s', async (_label, body) => {
    const res = await request(app).post('/api/places/4/reviews').set(asUser).send(body);
    expect(res.status).toBe(400);
  });

  test('rejects a review for a place that does not exist', async () => {
    const res = await request(app)
      .post('/api/places/99999/reviews')
      .set(asUser)
      .send({ rating: 5 });
    expect([400, 404]).toContain(res.status);
  });
});

describe('DELETE /api/places/:id/reviews/:reviewId (IMP-019)', () => {
  let reviewId;
  beforeEach(async () => {
    const { rows } = await pool.query(
      "SELECT id FROM place_reviews WHERE place_id = 1 AND user_id = 'seed-user-uid'"
    );
    reviewId = rows[0].id;
  });

  test('requires authentication', async () => {
    expect((await request(app).delete(`/api/places/1/reviews/${reviewId}`)).status).toBe(401);
  });

  // 403 exactly, not "403 or 404". The controller deliberately keeps the two apart — reviews are
  // public, so their ids are not a secret and blurring "not yours" into "does not exist" would only
  // make it harder to debug. An assertion that accepts either would let that decision be reversed
  // silently, which is the regression this test exists to catch.
  test('a different user cannot delete somebody else’s review', async () => {
    const res = await request(app)
      .delete(`/api/places/1/reviews/${reviewId}`)
      .set({ Authorization: authHeader(FRESH) });
    expect(res.status).toBe(403);

    const { rows } = await pool.query('SELECT id FROM place_reviews WHERE id = $1', [reviewId]);
    expect(rows).toHaveLength(1);
  });

  // The other half of the same distinction: a review that genuinely is not there is a 404, and the
  // caller can tell the two apart.
  test('a review that does not exist is 404, not 403', async () => {
    const res = await request(app).delete('/api/places/1/reviews/999999').set(asUser);
    expect(res.status).toBe(404);
  });

  test('the author can delete their own, and the aggregate follows', async () => {
    expect(await ratingOf(1)).toEqual({ sum: 9, count: 2 });

    const res = await request(app).delete(`/api/places/1/reviews/${reviewId}`).set(asUser);
    expect(res.status).toBe(204);

    // The 5-star review is gone; only Otto's 4 remains.
    expect(await ratingOf(1)).toEqual({ sum: 4, count: 1 });
  });
});

describe('POST /api/places/:id/reviews/:reviewId/report (IMP-023)', () => {
  let othersReview;
  beforeEach(async () => {
    const { rows } = await pool.query(
      "SELECT id FROM place_reviews WHERE place_id = 1 AND user_id = 'seed-other-uid'"
    );
    othersReview = rows[0].id;
  });

  test('requires authentication', async () => {
    const res = await request(app).post(`/api/places/1/reviews/${othersReview}/report`).send({});
    expect(res.status).toBe(401);
  });

  test('actually records a row — it used to fake success with a setTimeout', async () => {
    const res = await request(app)
      .post(`/api/places/1/reviews/${othersReview}/report`)
      .set(asUser)
      .send({ reason: 'spam' });
    expect(res.status).toBe(200);

    const { rows } = await pool.query('SELECT count(*)::int AS n FROM review_reports');
    expect(rows[0].n).toBe(1);
  });

  test('reporting a review that does not exist is 404', async () => {
    const res = await request(app)
      .post('/api/places/1/reviews/999999/report')
      .set(asUser)
      .send({ reason: 'spam' });
    expect(res.status).toBe(404);

    const { rows } = await pool.query('SELECT count(*)::int AS n FROM review_reports');
    expect(rows[0].n).toBe(0);
  });

  // Reporting your own review is refused. Without this the moderation queue can be seeded by its
  // own authors — a self-report is either a mistake or an attempt to make a queue look busy, and
  // neither is worth a row.
  test('you cannot report your own review', async () => {
    const { rows: own } = await pool.query(
      "SELECT id FROM place_reviews WHERE place_id = 1 AND user_id = 'seed-user-uid'"
    );
    const res = await request(app)
      .post(`/api/places/1/reviews/${own[0].id}/report`)
      .set(asUser)
      .send({ reason: 'spam' });
    expect(res.status).toBe(400);

    const { rows } = await pool.query('SELECT count(*)::int AS n FROM review_reports');
    expect(rows[0].n).toBe(0);
  });

  test('reporting the same review twice does not create a second row', async () => {
    const url = `/api/places/1/reviews/${othersReview}/report`;
    await request(app).post(url).set(asUser).send({ reason: 'spam' });
    await request(app).post(url).set(asUser).send({ reason: 'spam' });

    const { rows } = await pool.query('SELECT count(*)::int AS n FROM review_reports');
    expect(rows[0].n).toBe(1);
  });
});
