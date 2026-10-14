const request = require('supertest');

// `mock`-prefixed so Jest's hoisted factory may close over it (see imageUpload.test.js).
const mockFetch = jest.fn();
global.fetch = (...args) => mockFetch(...args);

const app = require('../app');
const { createSchema, resetData, closeDb, resetRateLimits, pool } = require('./helpers/testDb');
const weatherService = require('../src/services/weatherService');

/**
 * Real weather — `GET /api/places/:id/weather` (`IMP-110`).
 *
 * **This feature exists to un-tell a lie.** The detail page used to render a hardcoded 24 °C
 * "Partly cloudy" as though it were a reading; `IMP-027` deleted it rather than leave invented data
 * on the page. So the assertion that matters most here is not "the forecast renders" — it is
 * **"nothing is ever invented"**: when the provider is down, when the shape is unfamiliar, when a
 * place has no coordinates, the response says so instead of producing a number.
 *
 * The upstream call is stubbed at `fetch`. Contacting Open-Meteo from a test would make the suite
 * depend on somebody else's uptime and on network access in CI, and it would assert their service
 * works — which is their test suite's job. What is worth testing is *our* handling of every answer
 * they can give.
 */

const PLACE = 1; // seeded with coordinates
// Place 2 is the seeded row with `latitude: null` — the fixture, not a guess. An earlier version
// of this file named place 5, which does not exist.
const NO_COORDS = 2;

const openMeteoPayload = (over = {}) => ({
  timezone: 'Asia/Kolkata',
  current: {
    time: '2026-03-01T09:00',
    temperature_2m: 27.4,
    apparent_temperature: 29.1,
    relative_humidity_2m: 62,
    precipitation: 0,
    weather_code: 2,
    wind_speed_10m: 11.3
  },
  daily: {
    time: ['2026-03-01', '2026-03-02'],
    weather_code: [2, 63],
    temperature_2m_max: [31.2, 28.8],
    temperature_2m_min: [19.4, 20.1],
    precipitation_sum: [0, 12.4]
  },
  ...over
});

const respondWith = (payload, ok = true, status = 200) => {
  mockFetch.mockResolvedValue({ ok, status, json: async () => payload });
};

beforeAll(async () => {
  await createSchema();
});
beforeEach(async () => {
  await resetData();
  resetRateLimits(app);
  mockFetch.mockReset();
  // The cache is process-local and would otherwise carry a forecast from one test into the next,
  // making assertion order matter.
  weatherService.clearCache();
  respondWith(openMeteoPayload());
});
afterAll(async () => {
  await closeDb();
});

describe('a real forecast, normalised', () => {
  test('the response carries the reading, not the provider’s raw payload', async () => {
    const res = await request(app).get(`/api/places/${PLACE}/weather`);

    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
    expect(res.body.current).toMatchObject({
      temperature_c: 27,
      feels_like_c: 29,
      humidity_pct: 62,
      condition: 'Partly cloudy',
      is_wet: false
    });
    // The provider's own field names must not leak into our contract; a client written against
    // `temperature_2m` would break the day we change providers.
    expect(res.body.current).not.toHaveProperty('temperature_2m');
    expect(res.body.source).toBe('Open-Meteo');
  });

  test('the daily forecast is mapped, and wet days are flagged', async () => {
    const res = await request(app).get(`/api/places/${PLACE}/weather`);

    expect(res.body.forecast).toHaveLength(2);
    expect(res.body.forecast[0]).toMatchObject({ date: '2026-03-01', is_wet: false });
    // Code 63 is rain. `is_wet` is the input `FV-027` dynamic replanning will read to decide
    // whether an outdoor item needs moving — computed once, server-side, not re-derived per caller.
    expect(res.body.forecast[1]).toMatchObject({
      date: '2026-03-02',
      condition: 'Rain',
      is_wet: true
    });
  });

  test('times come back in the place’s timezone, not the server’s', async () => {
    const res = await request(app).get(`/api/places/${PLACE}/weather`);

    // `timezone=auto` is requested precisely so "rain at 15:00" means three in the afternoon where
    // the traveller is standing — the BUG-044/046 class of failure, designed out.
    expect(res.body.timezone).toBe('Asia/Kolkata');
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('timezone=auto');
  });

  test('it asks for the place’s own coordinates', async () => {
    await request(app).get(`/api/places/${PLACE}/weather`);

    const place = await pool.query('SELECT latitude, longitude FROM places WHERE id = $1', [PLACE]);
    const requested = mockFetch.mock.calls[0][0];
    expect(requested).toContain(`latitude=${Number(place.rows[0].latitude).toFixed(4)}`);
    expect(requested).toContain(`longitude=${Number(place.rows[0].longitude).toFixed(4)}`);
  });
});

describe('nothing is ever invented', () => {
  test('a provider outage reports unavailable rather than a number', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNRESET'));

    const res = await request(app).get(`/api/places/${PLACE}/weather`);

    // 200, not 502: the page renders fine without a forecast, and an error status would make every
    // caller treat somebody else's bad afternoon as a failed request.
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(false);
    expect(res.body.reason).toBe('provider_unavailable');
    expect(res.body).not.toHaveProperty('current');
  });

  test('a non-200 from the provider is not parsed as a reading', async () => {
    respondWith({ error: true }, false, 429);

    const res = await request(app).get(`/api/places/${PLACE}/weather`);

    expect(res.body.available).toBe(false);
    expect(res.body).not.toHaveProperty('current');
  });

  test('an unrecognised payload shape is refused, not guessed at', async () => {
    // The failure that would otherwise ship `NaN °C` to a user: a 200 whose body is not what we
    // expect. Reading `undefined` and rounding it is how a fabricated-looking number appears.
    respondWith({ current: { temperature_2m: 'warm' } });

    const res = await request(app).get(`/api/places/${PLACE}/weather`);

    expect(res.body.available).toBe(false);
    expect(JSON.stringify(res.body)).not.toContain('NaN');
  });

  test('an unmapped WMO code is reported as unknown, not described', async () => {
    respondWith(
      openMeteoPayload({ current: { ...openMeteoPayload().current, weather_code: 123 } })
    );

    const res = await request(app).get(`/api/places/${PLACE}/weather`);

    expect(res.body.current.condition).toBe('Unknown conditions');
  });

  test('a place with no coordinates says so, and never calls the provider', async () => {
    const res = await request(app).get(`/api/places/${NO_COORDS}/weather`);

    expect(res.status).toBe(200);
    expect(res.body.available).toBe(false);
    expect(res.body.reason).toBe('no_coordinates');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('a place that does not exist is a 404, and never calls the provider', async () => {
    const res = await request(app).get('/api/places/999999/weather');

    expect(res.status).toBe(404);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('a malformed place id is a 400 from the validator', async () => {
    const res = await request(app).get('/api/places/not-a-number/weather');
    expect(res.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('the caller cannot choose what the server fetches', () => {
  test('coordinates in the query string are ignored', async () => {
    // The endpoint is keyed on the place row, never on caller input. A `?lat=&lon=` variant would
    // be an open proxy to a third party at our rate limit and from our IP — the same defect the
    // image proxy was deleted for in Sprint 6.16.
    await request(app).get(`/api/places/${PLACE}/weather?latitude=51.5&longitude=-0.12`);

    const requested = mockFetch.mock.calls[0][0];
    expect(requested).not.toContain('51.5');
    expect(requested).not.toContain('-0.12');
    expect(requested.startsWith('https://api.open-meteo.com/')).toBe(true);
  });
});

describe('caching', () => {
  test('a second request for the same place does not hit the provider again', async () => {
    const first = await request(app).get(`/api/places/${PLACE}/weather`);
    const second = await request(app).get(`/api/places/${PLACE}/weather`);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(first.body.cached).toBe(false);
    expect(second.body.cached).toBe(true);
    expect(second.body.current).toEqual(first.body.current);
  });

  test('two places close together share one upstream call', async () => {
    // Coordinates are rounded to ~1 km before becoming a cache key: two spots in one town share a
    // forecast, and full DECIMAL precision would fetch the same answer twice.
    await pool.query('UPDATE places SET latitude = 15.3350, longitude = 76.4600 WHERE id = 1');
    await pool.query('UPDATE places SET latitude = 15.3352, longitude = 76.4601 WHERE id = 2');

    await request(app).get('/api/places/1/weather');
    await request(app).get('/api/places/2/weather');

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test('distant places do not share a forecast', async () => {
    await pool.query('UPDATE places SET latitude = 15.3350, longitude = 76.4600 WHERE id = 1');
    await pool.query('UPDATE places SET latitude = 28.6139, longitude = 77.2090 WHERE id = 2');

    await request(app).get('/api/places/1/weather');
    await request(app).get('/api/places/2/weather');

    // The guard against a cache key so coarse that Delhi reports Hampi's weather.
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  test('a failed lookup is not cached, so the next request retries', async () => {
    mockFetch.mockRejectedValueOnce(new Error('timeout'));
    const failed = await request(app).get(`/api/places/${PLACE}/weather`);
    expect(failed.body.available).toBe(false);

    respondWith(openMeteoPayload());
    const retried = await request(app).get(`/api/places/${PLACE}/weather`);

    // Caching a failure would make one bad moment last fifteen minutes for every visitor.
    expect(retried.body.available).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  test('the response is cacheable downstream too', async () => {
    const res = await request(app).get(`/api/places/${PLACE}/weather`);
    expect(res.headers['cache-control']).toMatch(/max-age=\d+/);
    expect(res.headers['cache-control']).toContain('stale-while-revalidate');
  });
});

describe('the request the provider actually receives', () => {
  test('it is bounded by a timeout, so a hung provider cannot hold a connection', async () => {
    await request(app).get(`/api/places/${PLACE}/weather`);

    const [, options] = mockFetch.mock.calls[0];
    expect(options.signal).toBeDefined();
  });

  test('it asks for seven days, not an unbounded horizon', async () => {
    await request(app).get(`/api/places/${PLACE}/weather`);

    // Beyond about a week the numbers get worse without the UI saying so, which would be a
    // quieter version of the same dishonesty this feature replaced.
    expect(mockFetch.mock.calls[0][0]).toContain('forecast_days=7');
  });
});
