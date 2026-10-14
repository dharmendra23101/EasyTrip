const request = require('supertest');

// `mock`-prefixed so Jest's hoisted factory may close over it, and assigned here so this suite
// replaces the network guard in `tests/setup/env.js` — the seam that guard documents.
const mockFetch = jest.fn();
global.fetch = (...args) => mockFetch(...args);

const app = require('../app');
const { createSchema, resetData, closeDb, resetRateLimits } = require('./helpers/testDb');
const { authHeader } = require('./helpers/firebaseMock');
const routingService = require('../src/services/routingService');

/**
 * Real road distance — `FV-026` stage (b), end to end.
 *
 * **The feature's whole value is a number that stops being an estimate**, so the assertions are
 * about which number reaches the report and what it claims about itself. A routed leg that still
 * said `estimated: true` would be a lie the UI would faithfully render.
 *
 * **The one that would fail silently is the coordinate order.** OpenRouteService takes
 * `[longitude, latitude]`; every other coordinate in this repository is latitude first. Swapping
 * them does not error — it asks about a point in the Indian Ocean and gets a confident answer. So
 * the transmitted body is asserted directly, because no response-shaped assertion can catch it.
 *
 * The provider is stubbed at `fetch`. Calling the real one would spend a quota whose Matrix figure
 * the provider does not publish, and would assert *their* routing rather than our handling of it.
 */

const asUser = { Authorization: authHeader({ uid: 'seed-user-uid' }) };
const HAMPI = 1; // 15.335, 76.46
const BADAMI = 4; // 15.918, 75.68 — 105.7 km from Hampi in a straight line (measured, not guessed)
const GOKARNA = 3; // 14.55, 74.32 — a different pair, so a different cache key

const KEY = 'test-ors-key';

/** An ORS matrix response: `distances` in km, `durations` in seconds, both origin-major. */
const matrixOf = ({ km, seconds }) => ({
  distances: [
    [0, km],
    [km, 0]
  ],
  durations: [
    [0, seconds],
    [seconds, 0]
  ]
});

const respondWith = (payload, { ok = true, status = 200, remaining = '1999' } = {}) =>
  mockFetch.mockResolvedValue({
    ok,
    status,
    headers: { get: (name) => (name === 'x-ratelimit-remaining' ? remaining : null) },
    json: async () => payload
  });

const makeTrip = async () => {
  const created = await request(app)
    .post('/api/auth/trips')
    .set(asUser)
    .send({ title: 'Karnataka', start_date: '2026-03-01', end_date: '2026-03-01' })
    .expect(201);

  const workspace = await request(app)
    .get(`/api/auth/trips/${created.body.trip.id}`)
    .set(asUser)
    .expect(200);

  return workspace.body.trip;
};

const addItem = (tripId, dayId, body) =>
  request(app)
    .post(`/api/auth/trips/${tripId}/days/${dayId}/items`)
    .set(asUser)
    .send(body)
    .expect(201);

/** Hampi 09:00-10:00, then Badami at 10:30 — half an hour for a journey of over 100 km. */
const tightDay = async () => {
  const trip = await makeTrip();
  await addItem(trip.id, trip.days[0].id, {
    place_id: HAMPI,
    title: 'Hampi',
    start_time: '09:00',
    end_time: '10:00',
    position: 0
  });
  await addItem(trip.id, trip.days[0].id, {
    place_id: BADAMI,
    title: 'Badami',
    start_time: '10:30',
    end_time: '12:00',
    position: 1
  });
  return trip;
};

const travelFinding = async (tripId) => {
  const res = await request(app)
    .get(`/api/auth/trips/${tripId}/feasibility`)
    .set(asUser)
    .expect(200);

  return res.body.feasibility.findings.find((f) => f.code === 'insufficient_travel_time');
};

beforeAll(async () => {
  await createSchema();
});
beforeEach(async () => {
  await resetData();
  resetRateLimits(app);
  mockFetch.mockReset();
  routingService.clearCache();
  process.env.OPENROUTESERVICE_API_KEY = KEY;
});
afterEach(() => {
  delete process.env.OPENROUTESERVICE_API_KEY;
});
afterAll(async () => {
  await closeDb();
});

describe('with a key, the estimate becomes a measurement', () => {
  test('a routed leg reports road distance and stops calling itself an estimate', async () => {
    // 140 km of road for a 105.7 km straight line — a detour index of 1.33 where `ASSUMPTIONS`
    // guesses 1.3. Close here, and nowhere near it in the hills, which is the case `FV-026`'s kill
    // criteria single out.
    respondWith(matrixOf({ km: 140.2, seconds: 9000 }));

    const trip = await tightDay();
    const found = await travelFinding(trip.id);

    expect(found).toBeTruthy();
    expect(found.estimated).toBe(false);
    expect(found.road_km).toBe(140.2);
    expect(found.estimated_travel_minutes).toBe(150);
    expect(found.message).toMatch(/140 km by road/);
    expect(found.message).not.toMatch(/about/);
    // CC-BY 4.0 on the results, so attribution travels with the finding rather than sitting in a
    // footer the screenshot loses.
    expect(found.source).toBe('OpenRouteService');
  });

  test('the straight-line distance is still reported beside it', async () => {
    // Both numbers, because the difference between them is the argument for the provider — and a
    // reader comparing a report from before this feature to one after needs the old figure present.
    respondWith(matrixOf({ km: 140.2, seconds: 9000 }));

    const trip = await tightDay();
    const found = await travelFinding(trip.id);

    expect(found.straight_line_km).toBeCloseTo(105.7, 0);
    expect(found.road_km).toBe(140.2);
  });

  test('coordinates are transmitted longitude first', async () => {
    // The bug that cannot be caught downstream: swapped coordinates return a confident distance to
    // open water. Asserted against the transmitted body, which is the only place it is visible.
    respondWith(matrixOf({ km: 140.2, seconds: 9000 }));

    const trip = await tightDay();
    await travelFinding(trip.id);

    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse(options.body);

    // Hampi is 15.335 N, 76.46 E. Longitude is the larger number here, and it must come first.
    expect(body.locations[0][0]).toBeCloseTo(76.46, 2);
    expect(body.locations[0][1]).toBeCloseTo(15.335, 2);
    // Numbers, not the strings node-pg hands `DECIMAL` over as.
    expect(typeof body.locations[0][0]).toBe('number');
    expect(body.units).toBe('km');
  });

  test('the key travels in a header, never in the URL', async () => {
    // A query-string credential is captured by every proxy and access log between here and there.
    respondWith(matrixOf({ km: 140.2, seconds: 9000 }));

    const trip = await tightDay();
    await travelFinding(trip.id);

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).not.toContain(KEY);
    expect(options.headers.Authorization).toBe(KEY);
  });

  test('one request per day, not one per leg', async () => {
    respondWith(matrixOf({ km: 140.2, seconds: 9000 }));

    const trip = await tightDay();
    await travelFinding(trip.id);

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe('what it refuses to do', () => {
  test('with no key configured it never contacts anybody', async () => {
    // The state the repository ships in. This is the entire cost of the feature until somebody
    // registers, and it must be zero.
    delete process.env.OPENROUTESERVICE_API_KEY;

    const trip = await tightDay();
    const found = await travelFinding(trip.id);

    expect(mockFetch).not.toHaveBeenCalled();
    // And the report is exactly what it was before this feature existed.
    expect(found).toBeTruthy();
    expect(found.estimated).toBe(true);
    expect(found.message).toMatch(/about \d+ km/);
    expect(found).not.toHaveProperty('road_km');
  });

  test('a provider outage costs the better number and nothing else', async () => {
    mockFetch.mockRejectedValue(new Error('provider down'));

    const trip = await tightDay();
    const found = await travelFinding(trip.id);

    expect(found).toBeTruthy();
    expect(found.estimated).toBe(true);
    expect(found.estimated_travel_minutes).toBeGreaterThan(0);
  });

  test('an unrecognised shape is not guessed at', async () => {
    respondWith({ nonsense: true });

    const trip = await tightDay();
    expect((await travelFinding(trip.id)).estimated).toBe(true);
  });

  test('a leg the provider cannot route keeps its estimate', async () => {
    // `null` in the matrix means "no route" — an island, a gap in the network. Reading it as a
    // number would report a 0 km drive and silently delete a real warning.
    respondWith({
      distances: [
        [0, null],
        [null, 0]
      ],
      durations: [
        [0, null],
        [null, 0]
      ]
    });

    const trip = await tightDay();
    const found = await travelFinding(trip.id);

    expect(found.estimated).toBe(true);
    expect(found).not.toHaveProperty('road_km');
  });

  test('once the quota is spent it stops asking until the reset', async () => {
    // The design that follows from the Matrix quota being unpublished: read the allowance instead
    // of assuming one. A run of 403s is a worse way to discover a ceiling.
    respondWith(matrixOf({ km: 140.2, seconds: 9000 }), { remaining: '0' });

    const first = await tightDay();
    await travelFinding(first.id);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // A *different* pair, so this is a cache miss and the only thing that can stop it is the
    // exhaustion flag. Using the same pair would have proved the cache works and nothing else —
    // the first version of this test did exactly that.
    const second = await makeTrip();
    await addItem(second.id, second.days[0].id, {
      place_id: HAMPI,
      title: 'Hampi',
      start_time: '09:00',
      end_time: '10:00',
      position: 0
    });
    await addItem(second.id, second.days[0].id, {
      place_id: GOKARNA,
      title: 'Gokarna',
      start_time: '10:30',
      end_time: '12:00',
      position: 1
    });

    const found = await travelFinding(second.id);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(found.estimated).toBe(true);
  });

  test('but a cached answer is still served after the quota is spent', async () => {
    // The other half, and the reason the cache is consulted first: a stored distance costs no
    // allowance, so refusing to return one would spend the outage on nothing.
    respondWith(matrixOf({ km: 140.2, seconds: 9000 }), { remaining: '0' });

    const first = await tightDay();
    expect((await travelFinding(first.id)).estimated).toBe(false);

    const again = await tightDay();
    const found = await travelFinding(again.id);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(found.estimated).toBe(false);
    expect(found.road_km).toBe(140.2);
  });
});

describe('the client refuses on its own, not because a caller remembered to ask', () => {
  /**
   * `attachRoadLegs` checks `isConfigured()` before it does anything, which shadows every guard
   * inside `getMatrix` when the module is exercised through a trip. That was found by a mutation
   * that survived: deleting the key check inside `getMatrix` broke nothing, because nothing reached
   * it.
   *
   * `getMatrix` is a **public export**, and `FV-027` stage (b) will call it directly for the full
   * matrix rather than the diagonal. Its contract has to hold on its own terms.
   */
  const points = [
    [76.46, 15.335],
    [75.68, 15.918]
  ];

  test('no key means no request, whoever asks', async () => {
    delete process.env.OPENROUTESERVICE_API_KEY;

    expect(await routingService.getMatrix(points)).toBeNull();
    expect(routingService.isConfigured()).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('fewer than two points is not a matrix', async () => {
    expect(await routingService.getMatrix([points[0]])).toBeNull();
    expect(await routingService.getMatrix([])).toBeNull();
    expect(await routingService.getMatrix(null)).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('more points than a day can hold is refused rather than sent', async () => {
    // The provider's per-request ceiling is 3,500 locations, so this is not about their limit — it
    // is about a caller having passed something that is not a day, which is worth refusing loudly
    // rather than spending an unpublished quota on.
    const tooMany = Array.from({ length: 51 }, (_, i) => [76 + i / 1000, 15 + i / 1000]);

    expect(await routingService.getMatrix(tooMany)).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
