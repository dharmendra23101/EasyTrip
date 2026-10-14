const request = require('supertest');

const app = require('../app');
const { createSchema, resetData, closeDb, resetRateLimits } = require('./helpers/testDb');
const { authHeader } = require('./helpers/firebaseMock');
const {
  suggestDayOrder,
  nearestNeighbourOrder,
  routeLengthKm
} = require('../src/services/routeOrderService');

/**
 * Route ordering for one day (`FV-026` stage a).
 *
 * The property under test is not "does it find the optimal tour" — it is not meant to, and the
 * item's kill criteria explicitly rule out turning this into a travelling-salesman project. It is:
 *
 *   **when a day is obviously badly ordered, does it say so and offer something obviously better;
 *   and when the order is not ours to change, does it decline instead of guessing?**
 *
 * The declining half is the half that matters more. A suggestion that fights the clock, or that
 * shuffles items it knows nothing about, is worse than no suggestion at all.
 */

const HAMPI = { latitude: 15.335, longitude: 76.46 };
const GOKARNA = { latitude: 14.55, longitude: 74.32 };
const BADAMI = { latitude: 15.918, longitude: 75.68 };
const BIJAPUR = { latitude: 16.83, longitude: 75.71 };

let nextId = 1;
const stop = (title, at, over = {}) => ({
  id: nextId++,
  place_id: null,
  title,
  start_time: null,
  end_time: null,
  position: 0,
  place_latitude: at?.latitude ?? null,
  place_longitude: at?.longitude ?? null,
  ...over
});

const day = (items) => ({
  id: 1,
  day_number: 1,
  items: items.map((item, index) => ({ ...item, position: index }))
});

beforeEach(() => {
  nextId = 1;
});

describe('the ordering itself', () => {
  it('measures a route, and refuses to measure one it cannot', () => {
    const points = [{ point: HAMPI }, { point: BADAMI }];
    expect(routeLengthKm(points)).toBeGreaterThan(50);
    expect(routeLengthKm([{ point: HAMPI }, { point: null }])).toBeNull();
  });

  it('keeps the first stop first', () => {
    // A day starts where the traveller already is. Choosing a different start would be the
    // optimiser overriding something the user decided by putting it first.
    const stops = [{ point: GOKARNA }, { point: BIJAPUR }, { point: HAMPI }, { point: BADAMI }];
    expect(nearestNeighbourOrder(stops)[0].point).toBe(GOKARNA);
  });

  it('improves a deliberately bad route', () => {
    // Gokarna -> Bijapur -> Hampi -> Badami crosses the state and comes back on itself.
    const crossing = [{ point: GOKARNA }, { point: BIJAPUR }, { point: HAMPI }, { point: BADAMI }];

    expect(routeLengthKm(nearestNeighbourOrder(crossing))).toBeLessThan(routeLengthKm(crossing));
  });

  it('is nearest-neighbour and nothing more, on purpose', () => {
    // A 2-opt pass was written and deleted after being measured: on four realistic day-sized
    // fixtures it gained 0, 0, 0 and 4 km on totals of 640-980 km — below WORTH_SUGGESTING_KM, so
    // even its one win would never have been shown to anybody. `FV-026`'s kill criteria name this
    // exact trade ("an exact solver catches marginally more for ten times the cost").
    //
    // Asserted rather than only commented, because the next person to reach for an optimiser
    // should find the measurement, not rediscover it.
    const service = require('../src/services/routeOrderService');
    expect(Object.keys(service)).not.toContain('twoOptImprove');
  });
});

describe('when a day is worth reordering', () => {
  it('proposes a shorter order and shows the arithmetic', () => {
    // Gokarna -> Bijapur -> Hampi -> Badami crosses the state and comes back. The same four stops
    // in a sane order are far shorter.
    const result = suggestDayOrder(
      day([
        stop('Gokarna', GOKARNA),
        stop('Bijapur', BIJAPUR),
        stop('Hampi', HAMPI),
        stop('Badami', BADAMI)
      ])
    );

    expect(result.applicable).toBe(true);
    expect(result.suggested_km).toBeLessThan(result.current_km);
    expect(result.saving_km).toBeGreaterThan(0);
    // Both figures are present so the user can judge the proposal rather than trust it.
    expect(result.current_km).toBeGreaterThan(0);
    expect(result.estimated).toBe(true);
  });

  it('returns an order the existing reorder endpoint can take', () => {
    const result = suggestDayOrder(
      day([
        stop('Gokarna', GOKARNA),
        stop('Bijapur', BIJAPUR),
        stop('Hampi', HAMPI),
        stop('Badami', BADAMI)
      ])
    );

    // The whole day, exactly once each — a partial list is rejected by that endpoint, and rightly.
    expect(result.item_ids.slice().sort()).toEqual([1, 2, 3, 4]);
    expect(result.order).toHaveLength(4);
    expect(result.order[0]).toMatchObject({ to_position: 0 });
  });

  it('shows what moves, so the change can be reviewed before it happens', () => {
    const result = suggestDayOrder(
      day([
        stop('Gokarna', GOKARNA),
        stop('Bijapur', BIJAPUR),
        stop('Hampi', HAMPI),
        stop('Badami', BADAMI)
      ])
    );

    const moved = result.order.filter((entry) => entry.from_position !== entry.to_position);
    expect(moved.length).toBeGreaterThan(0);
    expect(moved[0]).toHaveProperty('title');
  });
});

describe('when the order is not ours to change', () => {
  it('declines a day that has times on it', () => {
    // The clock already decides the order. Rearranging the list would contradict it — and
    // `FV-025` would immediately flag the result as `order_disagrees_with_times`. Two features
    // fighting over one list is worse than one of them declining.
    const result = suggestDayOrder(
      day([
        stop('Gokarna', GOKARNA, { start_time: '08:00:00' }),
        stop('Bijapur', BIJAPUR),
        stop('Hampi', HAMPI),
        stop('Badami', BADAMI)
      ])
    );

    expect(result.applicable).toBe(false);
    expect(result.reason).toBe('day_is_scheduled');
    expect(result.detail).toMatch(/times/i);
  });

  it('declines a day with fewer than three stops', () => {
    const result = suggestDayOrder(day([stop('Hampi', HAMPI), stop('Badami', BADAMI)]));
    expect(result.reason).toBe('not_enough_stops');
  });

  it('declines when some items have no coordinates', () => {
    // Reordering a subset would interleave placed and unplaced items arbitrarily, moving things
    // the optimiser knows nothing about.
    const result = suggestDayOrder(
      day([
        stop('Gokarna', GOKARNA),
        stop('Lunch somewhere', null),
        stop('Hampi', HAMPI),
        stop('Badami', BADAMI)
      ])
    );
    expect(result.reason).toBe('some_items_have_no_place');
  });

  it('declines when the day is already sensible', () => {
    // Hampi -> Badami -> Bijapur runs north in a line; the only alternative doubles back.
    //
    // This fixture started as Gokarna -> Hampi -> Badami, which *looks* sensible on a list and is
    // not: Gokarna -> Badami -> Hampi is about 60 km shorter, and the optimiser said so. The test
    // was wrong and the code was right, which is the outcome worth having from a fixture chosen by
    // eye — and the reason the fixtures here are real places at real coordinates.
    const result = suggestDayOrder(
      day([stop('Hampi', HAMPI), stop('Badami', BADAMI), stop('Bijapur', BIJAPUR)])
    );
    expect(result.applicable).toBe(false);
    expect(['already_in_a_sensible_order', 'saving_too_small']).toContain(result.reason);
  });

  it('declines when the saving is inside the error bars', () => {
    // Two stops a few hundred metres apart, in the "wrong" order. Technically shorter the other
    // way; meaninglessly so, given the distances are straight-line estimates. Suggesting it would
    // train people to ignore the suggestions that matter.
    const near = { latitude: 15.336, longitude: 76.461 };
    const nearer = { latitude: 15.3355, longitude: 76.4605 };
    const result = suggestDayOrder(day([stop('A', HAMPI), stop('C', near), stop('B', nearer)]));

    expect(result.applicable).toBe(false);
    expect(['saving_too_small', 'already_in_a_sensible_order']).toContain(result.reason);
  });

  it('never returns an order when it declines — on either decline path', () => {
    // The shape matters: a caller that reads `item_ids` without checking `applicable` must get
    // `undefined` rather than a half-formed order it could apply.
    //
    // **Both** paths, because they are different code. The early declines return through one
    // helper; "already sensible" and "saving too small" return through a second literal further
    // down, and a mutation that leaked an order from that one survived a test which only covered
    // the first.
    const alreadySensible = suggestDayOrder(
      day([stop('Hampi', HAMPI), stop('Badami', BADAMI), stop('Bijapur', BIJAPUR)])
    );
    expect(alreadySensible.applicable).toBe(false);
    expect(alreadySensible.item_ids).toBeUndefined();
    expect(alreadySensible.order).toBeUndefined();

    const result = suggestDayOrder(day([stop('Hampi', HAMPI), stop('Badami', BADAMI)]));
    expect(result.item_ids).toBeUndefined();
    expect(result.order).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The endpoint
// ---------------------------------------------------------------------------

const asUser = { Authorization: authHeader({ uid: 'seed-user-uid' }) };
const asOther = { Authorization: authHeader({ uid: 'seed-other-uid' }) };

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

const seedTrip = async () => {
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

describe('GET /api/auth/trips/:tripId/days/:dayId/route-suggestion', () => {
  it('suggests a reorder for a badly ordered day, end to end', async () => {
    const trip = await seedTrip();
    const dayId = trip.days[0].id;

    // Seeded places: 1 Hampi, 3 Gokarna, 4 Badami. Coorg (2) has no coordinates by design.
    for (const [index, placeId] of [3, 1, 4].entries()) {
      await request(app)
        .post(`/api/auth/trips/${trip.id}/days/${dayId}/items`)
        .set(asUser)
        .send({ place_id: placeId, title: `Stop ${index}`, position: index })
        .expect(201);
    }

    const res = await request(app)
      .get(`/api/auth/trips/${trip.id}/days/${dayId}/route-suggestion`)
      .set(asUser)
      .expect(200);

    // Gokarna -> Hampi -> Badami is already sensible, so the honest answer here is "no change".
    expect(res.body.suggestion).toHaveProperty('applicable');
    expect(res.body.suggestion.estimated).toBe(true);
  });

  it('reads coordinates as node-pg returns them', async () => {
    // `places.latitude` is DECIMAL, which arrives as a string. A distance function written against
    // numbers passes every pure test above and measures nothing at all here.
    const trip = await seedTrip();
    const dayId = trip.days[0].id;

    for (const [index, placeId] of [3, 4, 1].entries()) {
      await request(app)
        .post(`/api/auth/trips/${trip.id}/days/${dayId}/items`)
        .set(asUser)
        .send({ place_id: placeId, title: `Stop ${index}`, position: index })
        .expect(201);
    }

    const res = await request(app)
      .get(`/api/auth/trips/${trip.id}/days/${dayId}/route-suggestion`)
      .set(asUser)
      .expect(200);

    // Whatever the verdict, it must not be "distances unavailable" — that is what a string/number
    // mix-up looks like from the outside.
    expect(res.body.suggestion.reason).not.toBe('distances_unavailable');
  });

  it('is a 404 for somebody else’s trip', async () => {
    const trip = await seedTrip();
    await request(app)
      .get(`/api/auth/trips/${trip.id}/days/${trip.days[0].id}/route-suggestion`)
      .set(asOther)
      .expect(404);
  });

  it('is a 404 for a day that belongs to another trip', async () => {
    // The day id is only meaningful within its trip. Looking it up globally is how a nested
    // resource leaks across owners.
    const mine = await seedTrip();
    const other = await seedTrip();

    await request(app)
      .get(`/api/auth/trips/${mine.id}/days/${other.days[0].id}/route-suggestion`)
      .set(asUser)
      .expect(404);
  });

  it('needs a token', async () => {
    const trip = await seedTrip();
    await request(app)
      .get(`/api/auth/trips/${trip.id}/days/${trip.days[0].id}/route-suggestion`)
      .expect(401);
  });

  it('rejects a non-numeric day id before it reaches the database', async () => {
    const trip = await seedTrip();
    await request(app)
      .get(`/api/auth/trips/${trip.id}/days/not-a-number/route-suggestion`)
      .set(asUser)
      .expect(400);
  });
});
