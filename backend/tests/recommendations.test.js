const request = require('supertest');
const app = require('../app');
const { createSchema, resetData, closeDb, resetRateLimits, pool } = require('./helpers/testDb');
const { authHeader } = require('./helpers/firebaseMock');

/**
 * Personalised recommendations (`FV-019`).
 *
 * **The ranking is four lines of SQL. What is worth testing is the honesty around it**, and there
 * are three separate ways this feature could lie:
 *
 *   1. **Ranking by something incomparable.** `ADR-051` forbids sorting by the `FV-028` fit score,
 *      because that score travels with a `coverage` figure and two places measured over different
 *      evidence are not in an order. The signal here has to be the same question asked of every
 *      candidate.
 *   2. **Scoring an absence as a zero.** A place with *no themes recorded* would overlap nothing —
 *      and so would a place whose themes genuinely share nothing with yours. Ranking them alike is
 *      the exact error `ADR-051` names, in a new place. Untagged places are excluded and counted,
 *      not ranked last.
 *   3. **Answering a question nobody asked.** With nothing saved there is no preference to match, and
 *      returning popular places would be a *different feature* wearing this one's label.
 *
 * `FP-012` sits over all of it: this is a set intersection, and every recommendation returns the
 * themes that matched so a reader can check it.
 */

const USER = { uid: 'seed-user-uid' };
const OTHER = { uid: 'seed-other-uid' };
const asUser = { Authorization: authHeader(USER) };
const asOther = { Authorization: authHeader(OTHER) };

/** The seed has exactly four places — ids 1..4 (Hampi, Coorg, Gokarna, Badami). */
const get = (headers = asUser, qs = '') =>
  request(app).get(`/api/auth/recommendations${qs}`).set(headers);

/** Give a place a known theme set, so a test can control the overlap exactly. */
const setThemes = (placeId, themes) =>
  pool.query('UPDATE places SET themes = $1 WHERE id = $2', [themes, placeId]);

/** The wishlist is `POST /favorites` with the id in the body — `user_saved_places` is its table. */
const save = async (placeId, headers = asUser) => {
  const res = await request(app)
    .post('/api/auth/favorites')
    .set(headers)
    .send({ place_id: placeId });
  expect([200, 201]).toContain(res.status);
  return res;
};

beforeAll(async () => {
  await createSchema();
});
beforeEach(async () => {
  await resetData();
  resetRateLimits(app);
  // Every seeded place starts untagged, so each test states exactly the tags it depends on. Without
  // this the seed's own themes would decide the rankings and the tests would drift with the fixtures.
  await pool.query("UPDATE places SET themes = '{}'");
});
afterAll(async () => {
  await closeDb();
});

// ---------------------------------------------------------------------------
// With nothing saved there is nothing to say
// ---------------------------------------------------------------------------
describe('a traveller who has saved nothing has expressed no preference', () => {
  test('the answer is empty, and says what it was based on', async () => {
    const res = await get();

    expect(res.status).toBe(200);
    expect(res.body.recommendations).toEqual([]);
    expect(res.body.basis).toEqual({ saved_count: 0, profile: [] });
  });

  test('it does not fall back to popular places', async () => {
    // That would be a different feature — popularity — wearing this one's label. Several places have
    // seeded ratings, so a popularity fallback would be visible here.
    await setThemes(1, ['beach']);
    await setThemes(2, ['beach']);

    const res = await get();

    expect(res.body.recommendations).toEqual([]);
  });

  test('saving only untagged places still yields no profile', async () => {
    // The saves exist but carry no signal, so there is still nothing to match against.
    await save(1);

    const res = await get();

    expect(res.body.basis.saved_count).toBe(1);
    expect(res.body.basis.profile).toEqual([]);
    expect(res.body.recommendations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// An absence is never scored as a zero
// ---------------------------------------------------------------------------
describe('places nobody has tagged are excluded, not ranked last', () => {
  test('an untagged place never appears, however little competition there is', async () => {
    // Sharing nothing and having nothing recorded are different facts. Ranking them alike is the
    // error `ADR-051` exists to prevent.
    await setThemes(1, ['beach']);
    await save(1);
    await setThemes(2, ['beach']);
    // Place 3 stays untagged.

    const res = await get();

    const ids = res.body.recommendations.map((place) => place.id);
    expect(ids).toContain(2);
    expect(ids).not.toContain(3);
  });

  test('how many were excluded is reported, so the omission can be stated', async () => {
    // "We could not consider 42 places because nobody has tagged them" is a true sentence. Putting
    // those 42 at the bottom of a list is not.
    await setThemes(1, ['beach']);
    await save(1);
    await setThemes(2, ['beach']);

    const res = await get();

    const untagged = await pool.query(
      'SELECT COUNT(*)::int AS n FROM places WHERE cardinality(themes) = 0'
    );
    expect(res.body.excluded.no_themes_recorded).toBe(untagged.rows[0].n);
    expect(res.body.excluded.no_themes_recorded).toBeGreaterThan(0);
  });

  test('the count is reported even when there is nothing to recommend', async () => {
    // It is the honest half of an empty answer, so it must not be conditional on there being a list.
    const res = await get();
    expect(res.body.excluded.no_themes_recorded).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// The ranking, and the working behind it
// ---------------------------------------------------------------------------
describe('what you saved decides the order, and the answer shows its working', () => {
  test('a place sharing more of your themes outranks one sharing fewer', async () => {
    await setThemes(1, ['beach', 'nature']);
    await save(1);

    await setThemes(2, ['beach', 'nature']); // both
    await setThemes(3, ['beach']); // one

    const res = await get();

    expect(res.body.recommendations.map((place) => place.id)).toEqual([2, 3]);
    expect(res.body.recommendations[0].score).toBeGreaterThan(res.body.recommendations[1].score);
  });

  test('a theme on several saved places counts for more than one on a single place', async () => {
    // The weight is what carries "this says more about you". Both saves are tagged `beach` and only
    // one is `historical`, so the profile is beach:2, historical:1 — and a beach place must outrank
    // a historical one even though each shares exactly one theme.
    //
    // Arranged across four places rather than five because **the seed has exactly four** (Hampi,
    // Coorg, Gokarna, Badami). The first draft used id 5 and failed for that reason alone.
    await setThemes(1, ['beach', 'historical']);
    await setThemes(2, ['beach']);
    await save(1);
    await save(2);

    await setThemes(3, ['beach']); // shares the heavier theme
    await setThemes(4, ['historical']); // shares the lighter one

    const res = await get();

    expect(res.body.recommendations.map((place) => place.id)).toEqual([3, 4]);
    // 2/3 against 1/3 — the weights, not merely the count of shared themes.
    expect(res.body.recommendations[0].score).toBeGreaterThan(res.body.recommendations[1].score);
  });

  test('every recommendation names the themes that matched', async () => {
    // `FP-012`: an explanation nobody can check is decoration. The shared themes are the check.
    await setThemes(1, ['beach', 'nature']);
    await save(1);
    await setThemes(2, ['beach', 'mountain']);

    const res = await get();

    expect(res.body.recommendations[0].shared_themes).toEqual(['beach']);
    // And the place's own themes, so the reader can see what else it is.
    expect(res.body.recommendations[0].themes).toEqual(
      expect.arrayContaining(['beach', 'mountain'])
    );
  });

  test('the profile the answer was computed from is returned', async () => {
    await setThemes(1, ['beach', 'nature']);
    await setThemes(2, ['beach']);
    await save(1);
    await save(2);

    const res = await get();

    expect(res.body.basis.saved_count).toBe(2);
    expect(res.body.basis.profile).toEqual([
      { theme: 'beach', weight: 2 },
      { theme: 'nature', weight: 1 }
    ]);
  });

  test('the score is the share of your saved-theme weight the place covers', async () => {
    // Stated as arithmetic a reader can redo: profile is beach:1, nature:1 (total 2); a place with
    // both covers 2/2, a place with one covers 1/2.
    await setThemes(1, ['beach', 'nature']);
    await save(1);
    await setThemes(2, ['beach', 'nature']);
    await setThemes(3, ['nature']);

    const res = await get();

    const byId = Object.fromEntries(res.body.recommendations.map((p) => [p.id, p.score]));
    expect(byId[2]).toBe(1);
    expect(byId[3]).toBe(0.5);
  });

  test('a place sharing nothing is absent rather than last', async () => {
    // Overlap is required, not merely rewarded: sharing nothing is not a weak recommendation.
    await setThemes(1, ['beach']);
    await save(1);
    await setThemes(2, ['beach']);
    await setThemes(3, ['tech']);

    const res = await get();

    expect(res.body.recommendations.map((place) => place.id)).toEqual([2]);
  });

  test('what you have already saved is never recommended back to you', async () => {
    await setThemes(1, ['beach']);
    await setThemes(2, ['beach']);
    await save(1);
    await save(2);

    const res = await get();

    expect(res.body.recommendations).toEqual([]);
  });

  test('places tied on overlap are broken by rating, not by chance', async () => {
    /**
     * `ORDER BY score DESC` alone leaves ties to whatever order the planner happens to produce, and
     * on a four-row table that is stable enough that comparing two requests cannot see it — mutation
     * `R6` removed both tiebreaks and survived exactly that test. This asserts the **second sort
     * key** directly, which is deterministic.
     */
    await setThemes(1, ['beach']);
    await save(1);

    // Identical overlap, different standing.
    await setThemes(2, ['beach']);
    await setThemes(3, ['beach']);
    await pool.query('UPDATE places SET rating_sum = 5, rating_count = 1 WHERE id = 2');
    await pool.query('UPDATE places SET rating_sum = 50, rating_count = 10 WHERE id = 3');

    const res = await get();

    expect(res.body.recommendations.map((place) => place.id)).toEqual([3, 2]);
    expect(res.body.recommendations[0].score).toBe(res.body.recommendations[1].score);
  });

  test('the order is total, so two identical requests agree', async () => {
    // Two places with identical overlap must not swap between requests; `id` is the final tiebreak.
    await setThemes(1, ['beach']);
    await save(1);
    for (const id of [2, 3, 4]) await setThemes(id, ['beach']);

    const first = await get();
    const second = await get();

    expect(first.body.recommendations.map((p) => p.id)).toEqual(
      second.body.recommendations.map((p) => p.id)
    );
  });
});

// ---------------------------------------------------------------------------
// It is personal
// ---------------------------------------------------------------------------
describe('one traveller’s taste is not another’s', () => {
  test('two users with different saves get different answers', async () => {
    await setThemes(1, ['beach']);
    await setThemes(2, ['historical']);
    await setThemes(3, ['beach']);
    await setThemes(4, ['historical']);

    await save(1, asUser);
    await save(2, asOther);

    const mine = await get(asUser);
    const theirs = await get(asOther);

    expect(mine.body.recommendations.map((p) => p.id)).toEqual([3]);
    expect(theirs.body.recommendations.map((p) => p.id)).toEqual([4]);
  });

  test('it requires a token', async () => {
    const res = await request(app).get('/api/auth/recommendations');
    expect(res.status).toBe(401);
  });

  test('the limit is capped rather than trusted', async () => {
    // Unbounded, this would be "the whole catalogue, sorted".
    expect((await get(asUser, '?limit=25')).status).toBe(400);
    expect((await get(asUser, '?limit=0')).status).toBe(400);
    expect((await get(asUser, '?limit=abc')).status).toBe(400);
  });

  test('the limit is honoured', async () => {
    await setThemes(1, ['beach']);
    await save(1);
    for (const id of [2, 3, 4]) await setThemes(id, ['beach']);

    const res = await get(asUser, '?limit=2');

    expect(res.body.recommendations).toHaveLength(2);
  });
});
