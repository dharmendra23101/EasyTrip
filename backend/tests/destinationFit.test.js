const request = require('supertest');

const app = require('../app');
const { createSchema, resetData, closeDb, resetRateLimits, pool } = require('./helpers/testDb');
const { scoreFit, WEIGHTS } = require('../src/services/destinationFit');

/**
 * The explainable destination-fit score (`FV-028` stage d).
 *
 * **The arithmetic is the easy part and almost none of these tests are about it.** A weighted mean of
 * four comparisons is not where this can go wrong. What can go wrong is producing a confident number
 * out of an empty catalogue: a place with no months, no crowd level and no reviews scoring "72%
 * fit" - which looks like a measurement, reads like one, and is built from nothing.
 *
 * So the rules under test are:
 *
 *   1. **An unknown input is excluded, not neutralised.** Scoring a missing crowd level as 0.5 would
 *      pull every unmeasured place toward the middle and make it look averagely good. Unknown inputs
 *      leave the denominator and are named in `unavailable`.
 *   2. **The score never travels without its coverage**, and when nothing is known the score is
 *      `null` - not zero, and not fifty.
 *
 * `FP-012` also applies: this is a rule-based score and every factor that counted comes back with its
 * value, its weight and a sentence. "Shows its working" is the requirement, so the working is the
 * return value.
 */

const PLACE = 1;

/**
 * Badami, the only seeded place with **no reviews at all**.
 *
 * The endpoint tests below need a genuinely uncurated row, and `PLACE` is not one: Hampi carries two
 * seeded reviews, so its rating factor is available and it scores 0.875 rather than `null`. Reaching
 * for the default fixture made the first draft of these two tests assert the wrong thing about a
 * correctly working endpoint.
 */
const UNRATED = 4;

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

/** A place with every input curated, so a test can remove exactly one thing at a time. */
const COMPLETE = {
  best_months: [10, 11, 12],
  crowd_level: 'low',
  rating_sum: 45,
  rating_count: 10,
  themes: ['historical', 'nature']
};

const keys = (list) => list.map((entry) => entry.key).sort();

// ---------------------------------------------------------------------------
// Rule 1 — an unknown input is excluded, never scored as average
// ---------------------------------------------------------------------------
describe('what nobody has recorded does not become a middling score', () => {
  test('an entirely uncurated place has no score at all', async () => {
    // `null`, not 0 and not 0.5. This is the state of essentially the whole catalogue, so it is the
    // path a reader actually meets.
    const fit = scoreFit({}, { month: 6, interests: [] });

    expect(fit.score).toBeNull();
    expect(fit.coverage).toBe(0);
    expect(fit.factors).toEqual([]);
  });

  test('every missing input is named, so the absence is visible rather than implied', async () => {
    const fit = scoreFit({}, {});
    expect(keys(fit.unavailable)).toEqual(['crowd', 'interests', 'rating', 'season']);
    fit.unavailable.forEach((entry) => expect(entry.reason).toMatch(/\S/));
  });

  test('a missing crowd level does not drag a good place toward the middle', async () => {
    // The test that catches "score unknown as 0.5". With only the season known and it matching, the
    // answer is a confident 1 over a small coverage — not 0.7 over a large one.
    const fit = scoreFit({ best_months: [6] }, { month: 6 });

    expect(fit.score).toBe(1);
    expect(fit.coverage).toBeCloseTo(WEIGHTS.season, 5);
    expect(keys(fit.unavailable)).toEqual(['crowd', 'interests', 'rating']);
  });

  test('coverage is the share of evidence that existed, not the score', async () => {
    const complete = scoreFit(COMPLETE, { month: 11, interests: ['historical'] });
    expect(complete.coverage).toBeCloseTo(1, 5);

    const sparse = scoreFit({ crowd_level: 'high' }, {});
    expect(sparse.coverage).toBeCloseTo(WEIGHTS.crowd, 5);
    // Same arithmetic, wildly different standing behind it. A caller showing one without the other
    // is claiming a measurement.
    expect(sparse.score).toBeCloseTo(0.25, 5);
  });

  test('an unreviewed place is unrated, not badly rated', async () => {
    // Scoring rating_count = 0 as zero is how a new entry gets buried by its own newness.
    const fit = scoreFit({ rating_count: 0, rating_sum: 0, crowd_level: 'low' }, {});

    expect(keys(fit.unavailable)).toContain('rating');
    expect(fit.score).toBe(1);
  });

  test('a one-star place is scored, because that is a real review', async () => {
    const fit = scoreFit({ rating_count: 3, rating_sum: 3 }, {});
    expect(fit.score).toBe(0);
    expect(fit.coverage).toBeCloseTo(WEIGHTS.rating, 5);
  });
});

// ---------------------------------------------------------------------------
// The invariant the whole module rests on
// ---------------------------------------------------------------------------
describe('score is null exactly when coverage is zero', () => {
  /**
   * Both survivors of the first mutation run land here, and one of them was a real defect.
   *
   * `D8` removed the `unknown` guard from `isCurated` and survived, because `CROWD_SCORES` has no
   * `unknown` key so the guard looked redundant. Probing it found something else: membership was
   * tested with `in`, which walks the prototype chain. `'constructor'` therefore passed, the lookup
   * returned a **function**, the weighted sum became `NaN`, and `JSON.stringify` renders `NaN` as
   * `null` - so the endpoint answered "we cannot score this place" while reporting a coverage of 0.2
   * and a counted factor. Not reachable through the `CHECK` constraint on the column; entirely
   * reachable through this exported function, whose contract says otherwise.
   */
  test('a crowd level inherited from Object.prototype is not a crowd level', () => {
    const fit = scoreFit({ crowd_level: 'constructor' }, {});

    expect(fit.score).toBeNull();
    expect(fit.coverage).toBe(0);
    expect(fit.factors).toEqual([]);
    expect(keys(fit.unavailable)).toContain('crowd');
  });

  test('every counted factor has a real number for a value, on any input', () => {
    // The general form of the bug above: a factor whose value is not finite poisons the sum and the
    // failure then hides inside JSON serialisation rather than showing up as an error.
    ['constructor', 'toString', 'hasOwnProperty', 'unknown', '', 'LOW'].forEach((level) => {
      const fit = scoreFit({ crowd_level: level }, {});

      fit.factors.forEach((factor) => expect(Number.isFinite(factor.value)).toBe(true));
      expect(fit.score === null || Number.isFinite(fit.score)).toBe(true);
      // The invariant itself, stated as one assertion rather than implied by the two above.
      expect(fit.score === null).toBe(fit.coverage === 0);
    });
  });

  test('blank interests are dropped by the scorer itself, not only by its caller', () => {
    // `D10` survived because `parseInterests` in the controller already strips blanks, so nothing
    // reached this filter. The controller is one caller of an exported function; a contract that
    // holds only because that caller is careful is not a contract.
    const fit = scoreFit({ themes: ['historical'] }, { interests: ['historical', '', null] });

    const interests = fit.factors.find((factor) => factor.key === 'interests');
    expect(interests.value).toBe(1);
    expect(interests.detail).toMatch(/Matches 1 of your 1/);
  });
});

// ---------------------------------------------------------------------------
// The individual comparisons
// ---------------------------------------------------------------------------
describe('season', () => {
  test('a month somebody recommended scores full marks', () => {
    const fit = scoreFit({ best_months: [10, 11, 12] }, { month: 11 });
    expect(fit.score).toBe(1);
  });

  test('a month nobody listed scores zero, and says it is not a verdict', () => {
    // The same distinction `MonthGrid` protects: not listed is not "avoid".
    const fit = scoreFit({ best_months: [10, 11, 12] }, { month: 6 });
    expect(fit.score).toBe(0);
    expect(fit.factors[0].detail).toMatch(/not the same as a bad month/i);
  });

  test('no month asked means season cannot be scored', () => {
    // Defaulting to "today" would answer a question the caller did not ask, and would make the same
    // place score differently in April.
    const fit = scoreFit({ best_months: [10] }, {});
    expect(keys(fit.unavailable)).toContain('season');
  });
});

describe('interests', () => {
  test('naming no interests is not a perfect match', () => {
    // The easy mistake: an empty request matching everything at 100%.
    const fit = scoreFit({ themes: ['historical'] }, { interests: [] });
    expect(keys(fit.unavailable)).toContain('interests');
  });

  test('a partial match is scored as the fraction it is', () => {
    const fit = scoreFit({ themes: ['historical'] }, { interests: ['historical', 'beach'] });
    expect(fit.score).toBeCloseTo(0.5, 5);
    expect(fit.factors[0].detail).toMatch(/Matches 1 of your 2/);
  });

  test('a place with no themes cannot be matched', () => {
    const fit = scoreFit({ themes: [] }, { interests: ['historical'] });
    expect(keys(fit.unavailable)).toContain('interests');
  });
});

describe('crowd', () => {
  test('quieter scores higher, and unknown is not a level', () => {
    expect(scoreFit({ crowd_level: 'low' }, {}).score).toBe(1);
    expect(scoreFit({ crowd_level: 'high' }, {}).score).toBeCloseTo(0.25, 5);
    expect(keys(scoreFit({ crowd_level: 'unknown' }, {}).unavailable)).toContain('crowd');
  });
});

// ---------------------------------------------------------------------------
// It shows its working — FP-012
// ---------------------------------------------------------------------------
describe('the working is the return value, not a debug log', () => {
  test('every counted factor carries its value, weight and a sentence', () => {
    const fit = scoreFit(COMPLETE, { month: 11, interests: ['historical'] });

    expect(fit.factors).toHaveLength(4);
    fit.factors.forEach((factor) => {
      expect(typeof factor.value).toBe('number');
      expect(typeof factor.weight).toBe('number');
      expect(factor.detail).toMatch(/\S/);
      expect(factor.label).toMatch(/\S/);
    });
  });

  test('the weights sum to one, so coverage is a readable fraction', () => {
    const total = Object.values(WEIGHTS).reduce((sum, weight) => sum + weight, 0);
    expect(total).toBeCloseTo(1, 5);
  });

  test('the score is the weighted mean of exactly the factors it reports', () => {
    // Recomputed from the returned working. If the two ever disagree the explanation is decorative,
    // which is worse than no explanation at all.
    const fit = scoreFit(COMPLETE, { month: 6, interests: ['historical', 'beach'] });

    const recomputed =
      fit.factors.reduce((sum, factor) => sum + factor.value * factor.weight, 0) / fit.coverage;
    expect(fit.score).toBeCloseTo(recomputed, 10);
  });
});

// ---------------------------------------------------------------------------
// The endpoint
// ---------------------------------------------------------------------------
describe('GET /api/places/:id/fit', () => {
  test('is public, and returns a null score for an uncurated place', async () => {
    const response = await request(app).get(`/api/places/${UNRATED}/fit?month=6`);

    expect(response.status).toBe(200);
    expect(response.body.data.score).toBeNull();
    expect(response.body.data.coverage).toBe(0);
  });

  test('scores a curated place and shows the working', async () => {
    await pool.query(
      `UPDATE places
          SET best_months = '{10,11,12}', crowd_level = 'low',
              seasonality_source = 'editorial', seasonality_checked_on = CURRENT_DATE
        WHERE id = $1`,
      [UNRATED]
    );

    // Curated on exactly two axes and reviewed on none, so the reported factors are exactly the two
    // that were knowable - which is the assertion, rather than the score.
    const response = await request(app).get(`/api/places/${UNRATED}/fit?month=11`);

    expect(response.status).toBe(200);
    expect(response.body.data.score).toBe(1);
    expect(response.body.data.factors.map((factor) => factor.key).sort()).toEqual([
      'crowd',
      'season'
    ]);
  });

  test('the weights travel with the answer, so a UI need not keep its own copy', async () => {
    const response = await request(app).get(`/api/places/${PLACE}/fit`);
    expect(response.body.data.weights).toEqual(WEIGHTS);
  });

  test('an impossible month is a 400, not a clamped answer', async () => {
    // Clamping 13 to 12 would answer a different question convincingly.
    const response = await request(app).get(`/api/places/${PLACE}/fit?month=13`);
    expect(response.status).toBe(400);
  });

  test('blank entries in the interest list are not counted against the match', async () => {
    // `?interests=historical,,` asks about one interest. Counting the blanks would divide by three.
    await pool.query(`UPDATE places SET themes = '{historical}' WHERE id = $1`, [PLACE]);

    const response = await request(app).get(`/api/places/${PLACE}/fit?interests=historical,,`);
    const interests = response.body.data.factors.find((factor) => factor.key === 'interests');
    expect(interests.value).toBe(1);
  });

  test('a place that does not exist is a 404', async () => {
    const response = await request(app).get('/api/places/999999/fit');
    expect(response.status).toBe(404);
  });

  test('rejects an id that is not one', async () => {
    const response = await request(app).get('/api/places/not-a-number/fit');
    expect(response.status).toBe(400);
  });
});
