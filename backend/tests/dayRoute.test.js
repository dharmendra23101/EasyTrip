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
 * One day as a line on a map — `FV-026` stage (c), end to end.
 *
 * **The assertion that decides the design is the third one: the route follows the list.** A day
 * whose items are listed in an order its times do not agree with is drawn in *list* order, because
 * a map that silently re-sorted would hide the exact contradiction `FV-025` exists to report. Two
 * features quietly disagreeing about one day is worse than either being wrong.
 *
 * Everything else follows the discipline stage (b) set: a measured leg and an estimated leg are
 * never blended, each says which it is, and attribution is attached to measurements that actually
 * reached the output rather than to the request that went looking for them.
 *
 * The provider is stubbed at `fetch` for the reason `routing.test.js` gives — a real call would
 * spend a quota and assert *their* routing rather than our handling of it.
 */

const asUser = { Authorization: authHeader({ uid: 'seed-user-uid' }) };
const asOther = { Authorization: authHeader({ uid: 'seed-other-uid' }) };

const HAMPI = 1; // 15.335 N, 76.46 E
const COORG = 2; // no coordinates at all — the seeded place that cannot be drawn
const GOKARNA = 3; // 14.55 N, 74.32 E
const BADAMI = 4; // 15.918 N, 75.68 E

// Straight-line, measured once with `haversineKm` and written down rather than recomputed in the
// assertions: a test that calls the function under test to build its own expectation asserts only
// that the function is deterministic.
const HAMPI_BADAMI_KM = 105.7;
const BADAMI_GOKARNA_KM = 210.8;

const KEY = 'test-ors-key';

/**
 * An ORS matrix response for a chain of consecutive legs.
 *
 * Only the super-diagonal is ever read, so everything else is filled with a number large enough
 * that borrowing a cell by mistake would be obvious rather than plausible.
 */
const matrixOf = (kmPairs) => {
  const size = kmPairs.length + 1;
  const grid = (fill) =>
    Array.from({ length: size }, (_, row) =>
      Array.from({ length: size }, (_, column) => (row === column ? 0 : fill(row, column)))
    );

  return {
    distances: grid((row, column) => (column === row + 1 ? kmPairs[row].km : 9999)),
    durations: grid((row, column) => (column === row + 1 ? kmPairs[row].seconds : 999999))
  };
};

const respondWith = (payload, { ok = true, status = 200, remaining = '1999' } = {}) =>
  mockFetch.mockResolvedValue({
    ok,
    status,
    headers: { get: (name) => (name === 'x-ratelimit-remaining' ? remaining : null) },
    json: async () => payload
  });

const TWO_LEGS = [
  { km: 140.2, seconds: 9000 },
  { km: 260.5, seconds: 18000 }
];

const makeTrip = async (headers = asUser) => {
  const created = await request(app)
    .post('/api/auth/trips')
    .set(headers)
    .send({ title: 'Karnataka', start_date: '2026-03-01', end_date: '2026-03-01' })
    .expect(201);

  const workspace = await request(app)
    .get(`/api/auth/trips/${created.body.trip.id}`)
    .set(headers)
    .expect(200);

  return workspace.body.trip;
};

const addItem = (tripId, dayId, body, headers = asUser) =>
  request(app)
    .post(`/api/auth/trips/${tripId}/days/${dayId}/items`)
    .set(headers)
    .send(body)
    .expect(201);

const routeOf = (tripId, dayId, headers = asUser) =>
  request(app).get(`/api/auth/trips/${tripId}/days/${dayId}/route`).set(headers);

/** Hampi, then Badami, then Gokarna — three placed stops, no times. */
const threeStopDay = async () => {
  const trip = await makeTrip();
  const dayId = trip.days[0].id;
  await addItem(trip.id, dayId, { place_id: HAMPI, title: 'Hampi' });
  await addItem(trip.id, dayId, { place_id: BADAMI, title: 'Badami' });
  await addItem(trip.id, dayId, { place_id: GOKARNA, title: 'Gokarna' });
  return trip;
};

beforeAll(async () => {
  await createSchema();
});
beforeEach(async () => {
  await resetData();
  resetRateLimits(app);
  mockFetch.mockReset();
  routingService.clearCache();
});
afterEach(() => {
  delete process.env.OPENROUTESERVICE_API_KEY;
});
afterAll(async () => {
  await closeDb();
});

describe('the route is the day as it is listed', () => {
  test('stops come back in list order, with the leg between each pair', async () => {
    const trip = await threeStopDay();

    const res = await routeOf(trip.id, trip.days[0].id).expect(200);
    const { route } = res.body;

    expect(route.drawable).toBe(true);
    expect(route.day_number).toBe(1);
    expect(route.stops.map((stop) => stop.title)).toEqual(['Hampi', 'Badami', 'Gokarna']);
    expect(route.legs).toHaveLength(2);
    expect(route.legs[0].from_item_id).toBe(route.stops[0].item_id);
    expect(route.legs[0].to_item_id).toBe(route.stops[1].item_id);
  });

  test('every stop carries the coordinates the line is drawn through', async () => {
    const trip = await threeStopDay();

    const { route } = (await routeOf(trip.id, trip.days[0].id).expect(200)).body;

    // Numbers, not the strings node-pg hands `DECIMAL` over as: `L.polyline` given strings draws
    // nothing and throws nothing, which is the failure that looks like an empty map.
    expect(typeof route.stops[0].latitude).toBe('number');
    expect(typeof route.stops[0].longitude).toBe('number');
    expect(route.stops[0].latitude).toBeCloseTo(15.335, 3);
    expect(route.stops[0].longitude).toBeCloseTo(76.46, 3);
  });

  test('a day whose times disagree with its list is drawn in LIST order', async () => {
    // The decision this whole file is built around. `FV-025` reports the contradiction as
    // `order_disagrees_with_times`; a map that quietly re-sorted would hide the thing being
    // reported, and the user would never see the mistake they actually made.
    const trip = await makeTrip();
    const dayId = trip.days[0].id;
    await addItem(trip.id, dayId, { place_id: HAMPI, title: 'Hampi', start_time: '16:00' });
    await addItem(trip.id, dayId, { place_id: BADAMI, title: 'Badami', start_time: '09:00' });

    const { route } = (await routeOf(trip.id, dayId).expect(200)).body;

    expect(route.stops.map((stop) => stop.title)).toEqual(['Hampi', 'Badami']);
    // And the time is carried through, so the drawing can show the disagreement rather than
    // silently resolve it.
    expect(route.stops.map((stop) => stop.start_time)).toEqual(['16:00', '09:00']);
  });

  test('reordering the day reorders the route', async () => {
    const trip = await threeStopDay();
    const dayId = trip.days[0].id;
    const before = (await routeOf(trip.id, dayId).expect(200)).body.route;
    const reversed = [...before.stops].reverse().map((stop) => stop.item_id);

    await request(app)
      .put(`/api/auth/trips/${trip.id}/days/${dayId}/items/order`)
      .set(asUser)
      .send({ item_ids: reversed })
      .expect(200);

    const after = (await routeOf(trip.id, dayId).expect(200)).body.route;
    expect(after.stops.map((stop) => stop.title)).toEqual(['Gokarna', 'Badami', 'Hampi']);
  });
});

describe('without a routing key, which is how the repository ships', () => {
  test('legs are estimated, and say so', async () => {
    const trip = await threeStopDay();

    const { route } = (await routeOf(trip.id, trip.days[0].id).expect(200)).body;

    expect(route.estimated).toBe(true);
    expect(route.legs.every((leg) => leg.estimated)).toBe(true);
    // The straight line inflated by the road factor, not the straight line itself.
    expect(route.legs[0].km).toBeCloseTo(HAMPI_BADAMI_KM * 1.3, 0);
    expect(route.legs[0].straight_line_km).toBeCloseTo(HAMPI_BADAMI_KM, 0);
    expect(route.assumptions.road_factor).toBe(1.3);
  });

  test('nothing is attributed to a provider that was never asked', async () => {
    const trip = await threeStopDay();

    const { route } = (await routeOf(trip.id, trip.days[0].id).expect(200)).body;

    expect(route.source).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('the totals are the legs added up', async () => {
    const trip = await threeStopDay();

    const { route } = (await routeOf(trip.id, trip.days[0].id).expect(200)).body;

    expect(route.total_km).toBeCloseTo((HAMPI_BADAMI_KM + BADAMI_GOKARNA_KM) * 1.3, 0);
    expect(route.total_minutes).toBe(route.legs[0].minutes + route.legs[1].minutes);
  });
});

describe('with a routing key, the drawing carries measurements', () => {
  beforeEach(() => {
    process.env.OPENROUTESERVICE_API_KEY = KEY;
  });

  test('a measured leg stops calling itself an estimate, and keeps the straight line beside it', async () => {
    respondWith(matrixOf(TWO_LEGS));

    const trip = await threeStopDay();
    const { route } = (await routeOf(trip.id, trip.days[0].id).expect(200)).body;

    expect(route.estimated).toBe(false);
    expect(route.legs[0].estimated).toBe(false);
    expect(route.legs[0].km).toBe(140.2);
    expect(route.legs[0].minutes).toBe(150);
    // The difference between the two numbers is the entire argument for having a provider.
    expect(route.legs[0].straight_line_km).toBeCloseTo(HAMPI_BADAMI_KM, 0);
    expect(route.source).toBe('OpenRouteService');
  });

  test('coordinates are transmitted longitude first, in the order the day is listed', async () => {
    // The bug that cannot be caught downstream: swapped coordinates ask about open water and get a
    // confident answer. Asserted against the transmitted body, the only place it is visible.
    respondWith(matrixOf(TWO_LEGS));

    const trip = await threeStopDay();
    await routeOf(trip.id, trip.days[0].id).expect(200);

    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse(options.body);

    expect(body.locations).toHaveLength(3);
    // Hampi is 15.335 N, 76.46 E. Longitude is the larger number, and it must come first.
    expect(body.locations[0][0]).toBeCloseTo(76.46, 2);
    expect(body.locations[0][1]).toBeCloseTo(15.335, 2);
    expect(typeof body.locations[0][0]).toBe('number');
    // Badami second, because the day lists it second.
    expect(body.locations[1][0]).toBeCloseTo(75.68, 2);
  });

  test('one request for the whole day, not one per leg', async () => {
    respondWith(matrixOf(TWO_LEGS));

    const trip = await threeStopDay();
    await routeOf(trip.id, trip.days[0].id).expect(200);

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test('a pair the provider cannot route keeps its estimate, and the day says it is estimated', async () => {
    // A real possibility rather than a contrived one: an island, or a gap in the network. The leg
    // that could not be measured must not borrow the number from a leg that could.
    respondWith({
      distances: [
        [0, 140.2, 9999],
        [140.2, 0, null],
        [9999, null, 0]
      ],
      durations: [
        [0, 9000, 999999],
        [9000, 0, null],
        [999999, null, 0]
      ]
    });

    const trip = await threeStopDay();
    const { route } = (await routeOf(trip.id, trip.days[0].id).expect(200)).body;

    expect(route.legs[0].estimated).toBe(false);
    expect(route.legs[0].km).toBe(140.2);
    expect(route.legs[1].estimated).toBe(true);
    expect(route.legs[1].km).toBeCloseTo(BADAMI_GOKARNA_KM * 1.3, 0);
    // One measured leg is not a measured day.
    expect(route.estimated).toBe(true);
    // But the measurement that did arrive is still the provider's, so it is still attributed.
    expect(route.source).toBe('OpenRouteService');
  });

  test('an unplaced item does not shift the measurement onto a pair that is not on the map', async () => {
    // The failure this guards is silent in both directions. What gets drawn and what gets measured
    // are chosen by the same predicate; if they ever diverge, the matrix is asked about one
    // sequence and the legs are looked up under another, so every leg quietly falls back to an
    // estimate while the map still looks right.
    respondWith(matrixOf([{ km: 140.2, seconds: 9000 }]));

    const trip = await makeTrip();
    const dayId = trip.days[0].id;
    await addItem(trip.id, dayId, { place_id: HAMPI, title: 'Hampi' });
    await addItem(trip.id, dayId, { title: 'Find lunch' });
    await addItem(trip.id, dayId, { place_id: BADAMI, title: 'Badami' });

    const { route } = (await routeOf(trip.id, dayId).expect(200)).body;

    // Two locations asked about, not three: the unplaced item is not a point.
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.locations).toHaveLength(2);
    // And the answer landed on the leg that is actually drawn.
    expect(route.legs).toHaveLength(1);
    expect(route.legs[0].estimated).toBe(false);
    expect(route.legs[0].km).toBe(140.2);
  });

  test('a provider outage costs the measurement, never the drawing', async () => {
    mockFetch.mockRejectedValue(new Error('network is down'));

    const trip = await threeStopDay();
    const { route } = (await routeOf(trip.id, trip.days[0].id).expect(200)).body;

    expect(route.drawable).toBe(true);
    expect(route.estimated).toBe(true);
    expect(route.source).toBeNull();
  });
});

describe('what it declines to draw, and what it admits to leaving out', () => {
  test('an empty day is not drawable, and says which kind of empty it is', async () => {
    const trip = await makeTrip();

    const { route } = (await routeOf(trip.id, trip.days[0].id).expect(200)).body;

    expect(route.drawable).toBe(false);
    expect(route.reason).toBe('day_is_empty');
    expect(route.detail).toMatch(/Nothing is planned/i);
  });

  test('a day of unplaced items is a different refusal from an empty one', async () => {
    // Worth its own code: "you have not planned anything" and "none of what you planned has a
    // location" need different things done about them.
    const trip = await makeTrip();
    await addItem(trip.id, trip.days[0].id, { title: 'Lunch somewhere' });
    await addItem(trip.id, trip.days[0].id, { place_id: COORG, title: 'Coorg' });

    const { route } = (await routeOf(trip.id, trip.days[0].id).expect(200)).body;

    expect(route.drawable).toBe(false);
    expect(route.reason).toBe('no_mapped_stops');
  });

  test('one placed stop is drawn as a pin rather than refused', async () => {
    const trip = await makeTrip();
    await addItem(trip.id, trip.days[0].id, { place_id: HAMPI, title: 'Hampi' });

    const { route } = (await routeOf(trip.id, trip.days[0].id).expect(200)).body;

    expect(route.drawable).toBe(true);
    expect(route.stops).toHaveLength(1);
    expect(route.legs).toEqual([]);
    expect(route.total_km).toBe(0);
    // No leg was measured, so nothing here may present itself as a measurement.
    expect(route.estimated).toBe(true);
    expect(route.source).toBeNull();
  });

  test('items with no coordinates are named, not silently dropped', async () => {
    // An item missing from the drawing with no explanation is indistinguishable from a feature
    // that did not notice it.
    const trip = await makeTrip();
    const dayId = trip.days[0].id;
    await addItem(trip.id, dayId, { place_id: HAMPI, title: 'Hampi' });
    await addItem(trip.id, dayId, { title: 'Find lunch' });
    await addItem(trip.id, dayId, { place_id: BADAMI, title: 'Badami' });

    const { route } = (await routeOf(trip.id, dayId).expect(200)).body;

    expect(route.stops.map((stop) => stop.title)).toEqual(['Hampi', 'Badami']);
    expect(route.unmapped).toEqual([{ item_id: expect.any(Number), title: 'Find lunch' }]);
    // And the leg skips over it rather than stopping at it.
    expect(route.legs).toHaveLength(1);
    expect(route.legs[0].straight_line_km).toBeCloseTo(HAMPI_BADAMI_KM, 0);
  });
});

describe('it is reached through the trip that owns it', () => {
  test('a day belonging to somebody else is a 404, not a route', async () => {
    const trip = await threeStopDay();

    await routeOf(trip.id, trip.days[0].id, asOther).expect(404);
  });

  test('a day id belonging to a different trip is a 404', async () => {
    const mine = await threeStopDay();
    const other = await makeTrip();

    await routeOf(other.id, mine.days[0].id).expect(404);
  });

  test('without a token it is a 401', async () => {
    const trip = await threeStopDay();

    await request(app).get(`/api/auth/trips/${trip.id}/days/${trip.days[0].id}/route`).expect(401);
  });

  test('a non-numeric day id is rejected before anything is loaded', async () => {
    const trip = await threeStopDay();

    await request(app)
      .get(`/api/auth/trips/${trip.id}/days/not-a-day/route`)
      .set(asUser)
      .expect(400);
  });
});
