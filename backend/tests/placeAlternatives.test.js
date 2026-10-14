const request = require('supertest');

const app = require('../app');
const { createSchema, resetData, closeDb, resetRateLimits, pool } = require('./helpers/testDb');

/**
 * Quieter places near a busy one (`FV-028` stage c).
 *
 * **"Less crowded" is a relation, not a property, and every test here follows from that.** It takes
 * two curated values to make the claim: if nobody has judged how busy the origin is, nothing can be
 * quieter *than it*, and if nobody has judged the candidate, it cannot be offered as quieter. Either
 * gap and the honest output is an empty list.
 *
 * That makes the endpoint silent for the whole catalogue on the day it ships - exactly as `FV-029`'s
 * filter was - and the tests pin the silence as deliberately as they pin the results, because the
 * tempting "fix" is to fall back to *any* low-crowd place nearby. That silently answers a different
 * question: "quiet" rather than "quieter than the one you are looking at".
 */

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

const ATTRIBUTED = `seasonality_source = 'editorial', seasonality_checked_on = CURRENT_DATE`;

/** Give a place a crowd level and a position, attributed so the CHECK constraint accepts it. */
const setCrowd = (id, level, { lat = 15.335, lon = 76.46 } = {}) =>
  pool.query(
    `UPDATE places SET crowd_level = $2, latitude = $3, longitude = $4, ${ATTRIBUTED} WHERE id = $1`,
    [id, level, lat, lon]
  );

/**
 * Coordinates only - no crowd level, no attribution.
 *
 * **Coorg is seeded with `latitude: null`**, on purpose, as the catalogue's "place with no
 * coordinates" fixture. That made two tests below pass for the wrong reason: the origin returned
 * early on its missing position and never reached the crowd-level check they were written to
 * exercise. Mutation `A1` - which makes an unjudged origin fall back to "any quiet place nearby" -
 * survived all eighteen assertions until this existed.
 */
const setCoords = (id, lat, lon) =>
  pool.query(`UPDATE places SET latitude = $2, longitude = $3 WHERE id = $1`, [id, lat, lon]);

const quieterThan = (id = PLACE) => request(app).get(`/api/places/${id}/quieter-nearby`);

const names = (response) => response.body.data.map((place) => place.name);

// ---------------------------------------------------------------------------
// The claim, when both ends are known
// ---------------------------------------------------------------------------
describe('a crowded place with a quieter neighbour', () => {
  beforeEach(async () => {
    await setCrowd(PLACE, 'high');
    // ~8 km away, and genuinely quieter.
    await setCrowd(1, 'low', { lat: 15.4, lon: 76.46 });
  });

  test('the quieter neighbour is offered', async () => {
    const response = await quieterThan();
    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].crowd_level).toBe('low');
  });

  test('the distance travels with the suggestion', async () => {
    // A suggestion without a distance is not actionable: "quieter" is only useful next to "and it is
    // 8 km away". Rounded in SQL so every client shows the same number.
    const response = await quieterThan();
    const distance = Number(response.body.data[0].distance_km);
    expect(distance).toBeGreaterThan(0);
    expect(distance).toBeLessThan(20);
  });

  test('the suggestion carries its own provenance', async () => {
    // The crowd level being shown is a claim like any other, and it is being shown on a page about a
    // different place - where it is even easier to read as fact.
    const response = await quieterThan();
    expect(response.body.data[0].seasonality_source).toBe('editorial');
    expect(response.body.data[0].seasonality_checked_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('the origin never suggests itself', async () => {
    const response = await quieterThan();
    expect(response.body.data.map((place) => place.id)).not.toContain(PLACE);
  });
});

// ---------------------------------------------------------------------------
// The silences, each of which is a deliberate refusal to guess
// ---------------------------------------------------------------------------
describe('an unjudged origin has nothing to be quieter than', () => {
  test('an uncurated place returns an empty list, not every quiet place nearby', async () => {
    // The most important test here. Falling back to "any low-crowd place nearby" would look like a
    // working feature and would answer a question nobody asked - the user is not looking for a quiet
    // place, they are looking for a quieter version of *this* one.
    //
    // The origin is positioned first and deliberately left unjudged, so the ONLY reason for an empty
    // answer is its unknown crowd level. Without this line the seed's null coordinates supply that
    // empty answer instead, and the assertion holds no matter what the crowd rule does.
    await setCoords(PLACE, 15.335, 76.46);
    await setCrowd(1, 'low', { lat: 15.4, lon: 76.46 });
    // PLACE keeps the default 'unknown' crowd level.

    const response = await quieterThan();
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
  });

  test('the whole seeded catalogue is silent, which is the state this ships in', async () => {
    // Positioned for the same reason: this asserts that nothing is suggested because nobody has
    // judged any crowd level, not because one row happens to lack coordinates.
    await setCoords(PLACE, 15.335, 76.46);
    const response = await quieterThan();
    expect(response.body.data).toEqual([]);
  });
});

describe('an unjudged candidate is never offered', () => {
  test('"unknown" is not "low", here as everywhere else in this schema', async () => {
    // It may well be quieter. Nobody has looked, and suggesting it would manufacture the one claim
    // this feature exists to make honestly.
    await setCrowd(PLACE, 'high');
    await setCoords(1, 15.4, 76.46);

    const response = await quieterThan();
    expect(response.body.data).toEqual([]);
  });
});

describe('quieter means strictly quieter', () => {
  test('an equally busy neighbour is not an alternative', async () => {
    // The same experience with a different name. Offering it as an improvement is the small
    // dishonesty that makes the whole panel untrustworthy.
    await setCrowd(PLACE, 'moderate');
    await setCrowd(1, 'moderate', { lat: 15.4, lon: 76.46 });

    const response = await quieterThan();
    expect(response.body.data).toEqual([]);
  });

  test('a busier neighbour is certainly not an alternative', async () => {
    await setCrowd(PLACE, 'moderate');
    await setCrowd(1, 'high', { lat: 15.4, lon: 76.46 });

    const response = await quieterThan();
    expect(response.body.data).toEqual([]);
  });

  test('moderate is offered to a crowded place, and low is offered first', async () => {
    // Ordered by how much quieter, then by how close. A moderate place 2 km away is still a worse
    // answer to "somewhere less crowded" than a quiet one 40 km away.
    await setCrowd(PLACE, 'high');
    await setCrowd(1, 'moderate', { lat: 15.35, lon: 76.46 });
    await setCrowd(3, 'low', { lat: 15.7, lon: 76.46 });

    const response = await quieterThan();
    expect(response.body.data[0].crowd_level).toBe('low');
    expect(names(response)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Geography
// ---------------------------------------------------------------------------
describe('nearby means nearby', () => {
  test('a quieter place on the other side of the country is not suggested', async () => {
    await setCrowd(PLACE, 'high');
    // Roughly Ladakh, ~2,000 km from Hampi. Quieter, and not an alternative to anything.
    await setCrowd(1, 'low', { lat: 34.15, lon: 77.57 });

    const response = await quieterThan();
    expect(response.body.data).toEqual([]);
  });

  test('a place with no coordinates cannot be suggested', async () => {
    await setCrowd(PLACE, 'high');
    // `coordinates_source` has to go too: `places_coordinates_source_needs_coordinates` refuses a
    // recorded geocoder with nothing to show for it, which is the constraint behaving correctly.
    await pool.query(
      `UPDATE places SET crowd_level = 'low', latitude = NULL, longitude = NULL,
                         coordinates_source = NULL, ${ATTRIBUTED}
        WHERE id = 1`
    );

    const response = await quieterThan();
    expect(response.body.data).toEqual([]);
  });

  test('an origin with no coordinates asks an unanswerable question', async () => {
    await pool.query(
      `UPDATE places SET crowd_level = 'high', latitude = NULL, longitude = NULL,
                         coordinates_source = NULL, ${ATTRIBUTED}
        WHERE id = $1`,
      [PLACE]
    );
    await setCrowd(1, 'low', { lat: 15.4, lon: 76.46 });

    const response = await quieterThan();
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
  });

  test('a candidate at the identical position does not blow up the distance maths', async () => {
    // `acos` is undefined outside [-1, 1] and the dot product reaches 1.0000000000000002 through
    // ordinary rounding when two points coincide. Without the clamp this is a 500, on the one input
    // guaranteed to occur. Asserted rather than trusted.
    await setCrowd(PLACE, 'high', { lat: 15.335, lon: 76.46 });
    await setCrowd(1, 'low', { lat: 15.335, lon: 76.46 });

    const response = await quieterThan();
    expect(response.status).toBe(200);
    expect(Number(response.body.data[0].distance_km)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The route itself
// ---------------------------------------------------------------------------
describe('the endpoint', () => {
  test('is public â€” no token needed to be told where is quieter', async () => {
    await setCrowd(PLACE, 'high');
    await setCrowd(1, 'low', { lat: 15.4, lon: 76.46 });

    const response = await quieterThan();
    expect(response.status).toBe(200);
  });

  test('rejects an id that is not one', async () => {
    const response = await request(app).get('/api/places/not-a-number/quieter-nearby');
    expect(response.status).toBe(400);
  });

  test('a place that does not exist is an empty answer, not a 500', async () => {
    const response = await quieterThan(999999);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
  });

  test('the payload never leaks a uid', async () => {
    await setCrowd(PLACE, 'high');
    await setCrowd(1, 'low', { lat: 15.4, lon: 76.46 });

    const response = await quieterThan();
    expect(JSON.stringify(response.body)).not.toContain('seed-admin-uid');
  });
});
