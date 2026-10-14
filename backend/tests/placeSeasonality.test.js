const request = require('supertest');

const app = require('../app');
const { createSchema, resetData, closeDb, resetRateLimits, pool } = require('./helpers/testDb');
const { authHeader } = require('./helpers/firebaseMock');
const {
  normaliseMonths,
  seasonalityForCreate,
  seasonalityPatch
} = require('../src/controllers/helpers/placeSeasonality');

/**
 * When a place is worth visiting (`FV-028` stage a).
 *
 * **The defect this exists to fix is measurable, and it is asserted here directly.** The season
 * filter has always matched a regex of month names against the free-text
 * `custom_keys->>'Best Time to Visit'`, and a regex cannot tell a recommendation from a warning:
 *
 *     lower('Avoid April, it is unbearable') ~ 'april|may|june'   ->   TRUE
 *
 * So a place whose own note tells you to stay away in April was returned to somebody filtering for
 * April (`BUG-056`). The first test below reproduces that against the real database, and the one
 * after it shows curated months fixing it. Those two are the feature.
 *
 * **The fallback stays defective on purpose**, and there is a test pinning that too. Backfilling
 * months out of the same prose would be the identical guess wearing a schema, and `FV-028`'s kill
 * criterion is explicit: *a blank field is acceptable; an invented one is not.* An uncurated row
 * keeps the old behaviour, documented, rather than acquiring a fabricated answer.
 *
 * The rest is the honesty rule these columns share with `FV-029`: a claim carries a source and a
 * date or the database refuses the row, and an empty `best_months` asserts nothing at all.
 */

const asAdmin = { Authorization: authHeader({ uid: 'seed-admin-uid' }) };
const PLACE = 2;

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

const row = async (id = PLACE) =>
  (
    await pool.query(
      // `to_char` for the same reason `placeAccessibility.test.js` gives: node-pg turns a DATE into
      // a JS Date at local midnight, so a naive read is a day early anywhere east of UTC.
      `SELECT best_months, crowd_level, typical_visit_minutes, seasonality_source,
              to_char(seasonality_checked_on, 'YYYY-MM-DD') AS seasonality_checked_on
       FROM places WHERE id = $1`,
      [id]
    )
  ).rows[0];

/** A multipart edit, because the route runs through multer whether or not a file is attached. */
const edit = (fields, { headers = asAdmin, id = PLACE } = {}) => {
  const req = request(app).put(`/api/admin/places/${id}`).set(headers);
  Object.entries(fields).forEach(([key, value]) =>
    req.field(key, typeof value === 'string' ? value : JSON.stringify(value))
  );
  return req;
};

const ATTRIBUTION = { seasonality_source: 'editorial', seasonality_checked_on: '2026-08-01' };

const ids = (response) => response.body.data.map((place) => place.id);

// ---------------------------------------------------------------------------
// BUG-056 - the defect, reproduced, then fixed
// ---------------------------------------------------------------------------
describe('the prose filter cannot tell a recommendation from a warning', () => {
  beforeEach(async () => {
    await pool.query(
      `UPDATE places
          SET custom_keys = jsonb_build_object('Best Time to Visit', 'Avoid April, it is unbearable')
        WHERE id = $1`,
      [PLACE]
    );
  });

  test('a place that warns you off April is returned by the April filter', async () => {
    // Not a hypothetical. This is the shipped behaviour, asserted so the fix below has something to
    // be measured against - and so that deleting the curated branch fails loudly rather than
    // quietly restoring the bug.
    const response = await request(app).get('/api/places?date=summer');
    expect(response.status).toBe(200);
    expect(ids(response)).toContain(PLACE);
  });

  test('curated months exclude it, and the prose is not consulted at all', async () => {
    await edit({ best_months: [10, 11, 12], ...ATTRIBUTION }).expect(200);

    const summer = await request(app).get('/api/places?date=summer');
    expect(ids(summer)).not.toContain(PLACE);

    // The same row, same prose, still found by the filter its months actually match.
    const winter = await request(app).get('/api/places?date=winter');
    expect(ids(winter)).toContain(PLACE);
  });

  test('an uncurated row keeps the old, defective fallback rather than a guessed one', async () => {
    // Deliberate. The alternative is parsing 'Avoid April' into `{4}`, which is the same guess the
    // regex makes, with a schema's authority behind it.
    const place = await row();
    expect(place.best_months).toEqual([]);

    const response = await request(app).get('/api/places?date=summer');
    expect(ids(response)).toContain(PLACE);
  });
});

describe('an uncurated place is still findable', () => {
  test('a place with no months and no prose is not hidden from a season filter', async () => {
    // A missing annotation is not evidence of a bad season. Excluding these would empty the
    // catalogue for every season filter, which is how a correctness fix becomes a regression.
    await pool.query(`UPDATE places SET custom_keys = '{}'::jsonb WHERE id = $1`, [PLACE]);
    const response = await request(app).get('/api/places?date=monsoon');
    expect(ids(response)).toContain(PLACE);
  });
});

// ---------------------------------------------------------------------------
// The default, which is the whole catalogue on the day this ships
// ---------------------------------------------------------------------------
describe('an uncurated place asserts nothing', () => {
  test('empty months, unknown crowd level, no duration, no attribution', async () => {
    const place = await row();
    expect(place.best_months).toEqual([]);
    expect(place.crowd_level).toBe('unknown');
    expect(place.typical_visit_minutes).toBeNull();
    expect(place.seasonality_source).toBeNull();
    expect(place.seasonality_checked_on).toBeNull();
  });

  test('the API reports crowd_level as unknown rather than omitting it', async () => {
    // An absent key lets a client render "quiet" from nothing, which is the same harm by a
    // different route. `unknown` is not `low`.
    const response = await request(app).get(`/api/places/${PLACE}`);
    expect(response.status).toBe(200);
    expect(response.body.crowd_level).toBe('unknown');
    expect(response.body.best_months).toEqual([]);
  });

  test('a plain create with no seasonality at all succeeds', async () => {
    // **A regression pin.** The create path once ran `seasonalityForCreate` twice - the controller
    // normalised the body and the model normalised it again - and the helper was not idempotent:
    // the first pass emits `typical_visit_minutes: null`, and `isProvided(null)` is deliberately
    // true, so the second turned that null into `Number(null)`, zero, which the
    // `typical_visit_minutes > 0` constraint rightly refused. Every single create 500'd.
    const response = await request(app)
      .post('/api/admin/places')
      .set(asAdmin)
      .send({ name: 'Uncurated', location: 'Nowhere' });

    expect(response.status).toBe(201);
    expect(response.body.crowd_level).toBe('unknown');
    expect(response.body.typical_visit_minutes).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// A claim needs a source and a date, enforced where the API is not the only writer
// ---------------------------------------------------------------------------
describe('a seasonality claim carries its provenance', () => {
  test('months and attribution round-trip through the API', async () => {
    await edit({ best_months: [10, 11, 12, 1], crowd_level: 'high', ...ATTRIBUTION }).expect(200);

    const response = await request(app).get(`/api/places/${PLACE}`);
    expect(response.body.best_months).toEqual([1, 10, 11, 12]);
    expect(response.body.crowd_level).toBe('high');
    expect(response.body.seasonality_source).toBe('editorial');
    // The date the curator entered, not the day before it.
    expect(response.body.seasonality_checked_on).toBe('2026-08-01');
  });

  test('the database refuses a claim with no source, whoever writes it', async () => {
    // Asserted against the constraint rather than the route, because a seed script, a migration or
    // a psql session is as able to write this table as the API is.
    await expect(
      pool.query(`UPDATE places SET best_months = '{4,5}' WHERE id = $1`, [PLACE])
    ).rejects.toThrow(/places_seasonality_is_attributed/);
  });

  test('a crowd level alone is a claim too, and needs the same attribution', async () => {
    await expect(
      pool.query(`UPDATE places SET crowd_level = 'low' WHERE id = $1`, [PLACE])
    ).rejects.toThrow(/places_seasonality_is_attributed/);
  });

  test('a source with no date is not attribution', async () => {
    await expect(
      pool.query(
        `UPDATE places SET best_months = '{4}', seasonality_source = 'editorial' WHERE id = $1`,
        [PLACE]
      )
    ).rejects.toThrow(/places_seasonality_is_attributed/);
  });

  test('a check date in the future is refused', async () => {
    await expect(
      pool.query(
        `UPDATE places SET best_months = '{4}', seasonality_source = 'editorial',
                           seasonality_checked_on = CURRENT_DATE + 1 WHERE id = $1`,
        [PLACE]
      )
    ).rejects.toThrow(/places_seasonality_checked_on_not_future/);
  });

  test('month 13 is not a month', async () => {
    await expect(
      pool.query(
        `UPDATE places SET best_months = '{13}', seasonality_source = 'editorial',
                           seasonality_checked_on = CURRENT_DATE WHERE id = $1`,
        [PLACE]
      )
    ).rejects.toThrow(/places_best_months_are_months/);
  });

  test('a visit longer than a day is a trip, not a visit', async () => {
    await expect(
      pool.query(
        `UPDATE places SET typical_visit_minutes = 1441, seasonality_source = 'editorial',
                           seasonality_checked_on = CURRENT_DATE WHERE id = $1`,
        [PLACE]
      )
    ).rejects.toThrow(/places_typical_visit_is_plausible/);
  });

  test('a zero-minute visit is refused, because nobody visits for no time', async () => {
    await expect(
      pool.query(
        `UPDATE places SET typical_visit_minutes = 0, seasonality_source = 'editorial',
                           seasonality_checked_on = CURRENT_DATE WHERE id = $1`,
        [PLACE]
      )
    ).rejects.toThrow(/places_typical_visit_is_plausible/);
  });

  test('the API refuses an unattributed claim before the database has to', async () => {
    // A 400 rather than a 500. The constraint is the backstop, not the error message a curator
    // should ever see.
    const response = await edit({ best_months: [4, 5] });
    expect(response.status).toBe(400);
  });

  test('clearing the months back to empty needs no attribution', async () => {
    await edit({ best_months: [4], ...ATTRIBUTION }).expect(200);
    await edit({ best_months: [] }).expect(200);

    const place = await row();
    expect(place.best_months).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The helpers, unit-tested where the shape is easier to see than through HTTP
// ---------------------------------------------------------------------------
describe('normalising the months a request sent', () => {
  test('duplicates collapse and the result is sorted', () => {
    // The database deliberately does not forbid duplicates - a CHECK cannot hold the subquery that
    // would take - so tidiness happens here, and it is tidiness rather than correctness.
    expect(normaliseMonths([12, 1, 1, 3])).toEqual([1, 3, 12]);
  });

  test('numeric strings from a multipart form become numbers', () => {
    expect(normaliseMonths(['4', '5'])).toEqual([4, 5]);
  });

  test('anything that is not a month is dropped rather than coerced', () => {
    expect(normaliseMonths(['spring', null, 4.5, 6])).toEqual([6]);
  });

  test('a non-array is an empty array, not a crash', () => {
    expect(normaliseMonths(undefined)).toEqual([]);
    expect(normaliseMonths('4')).toEqual([]);
  });
});

describe('the create helper is safe to apply to its own output', () => {
  test('an explicit null duration stays null instead of becoming zero', () => {
    // The exact regression above, pinned at the unit it happened in. `Number(null)` is 0 and 0 is a
    // value this column refuses, so a helper that converts blindly turns "clear it" into a 500.
    expect(seasonalityForCreate({ typical_visit_minutes: null }).typical_visit_minutes).toBeNull();
  });

  test('applying it twice gives what applying it once gave', () => {
    const once = seasonalityForCreate({});
    expect(seasonalityForCreate(once)).toEqual(once);
  });

  test('an absent key is an uncurated column, not a missing one', () => {
    expect(seasonalityForCreate({})).toEqual({
      best_months: [],
      crowd_level: 'unknown',
      typical_visit_minutes: null,
      seasonality_source: null,
      seasonality_checked_on: null
    });
  });
});

describe('the patch helper writes only what the caller sent', () => {
  test('an untouched field is absent rather than reset to its default', () => {
    // The `BUG-055` rule applied to these five columns: an untouched `<select>` submits `''`, and a
    // patch that read that as a value would silently blank a curated crowd level.
    expect(seasonalityPatch({ crowd_level: '', best_months: [4] })).toEqual({ best_months: [4] });
  });

  test('an explicit null duration is a clear, and survives as null', () => {
    expect(seasonalityPatch({ typical_visit_minutes: null })).toEqual({
      typical_visit_minutes: null
    });
  });
});
