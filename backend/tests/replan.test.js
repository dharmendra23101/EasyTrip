const request = require('supertest');

const mockFetch = jest.fn();
global.fetch = (...args) => mockFetch(...args);

const app = require('../app');
const { createSchema, resetData, closeDb, resetRateLimits, pool } = require('./helpers/testDb');
const { authHeader } = require('./helpers/firebaseMock');
const weatherService = require('../src/services/weatherService');
const { suggestReplan } = require('../src/services/replanService');

/**
 * `FV-027` stage (b) — the replan, as a reviewable diff.
 *
 * **The assertions here are mostly about what it refuses to do**, and that is the point rather than
 * an accident. A replanner that moves things is easy; one a traveller will trust has to leave alone
 * everything it cannot justify touching, and *say so*. A wet day silently left unchanged is
 * indistinguishable from a broken feature.
 *
 * Two invariants carry the most weight:
 *
 * - **It never writes.** The endpoint is a `GET`, and the trip is re-read afterwards to prove it.
 *   Applying a proposal goes through `PUT /items/:itemId`, which gained the ability to move an item
 *   between days in Sprint 8.26 — until then these proposals could not be applied at all, and this
 *   file said otherwise (`trips.test.js` now covers the move, including its authorisation).
 * - **`FV-025` validates every candidate move** against the whole trip before it is offered. Today
 *   that filter never rejects anything, and the suite says so rather than implying otherwise: every
 *   item-level error needs a `start_time`, and only untimed items are ever moved. The service header
 *   records why it is kept anyway.
 */

const asUser = { Authorization: authHeader({ uid: 'seed-user-uid' }) };
const asOther = { Authorization: authHeader({ uid: 'seed-other-uid' }) };

const HAMPI = 1;
const GOKARNA = 3; // 250 km from Hampi — far enough to break a day

const WET = { code: 63, condition: 'Rain' };
const DRY = { code: 2, condition: 'Partly cloudy' };

/** A forecast where each named date is wet or dry, as the provider would return it. */
const forecastOf = (days) => ({
  timezone: 'Asia/Kolkata',
  current: { time: '2026-03-01T09:00', temperature_2m: 27, weather_code: 2 },
  daily: {
    time: days.map((d) => d.date),
    weather_code: days.map((d) => d.code),
    temperature_2m_max: days.map(() => 31),
    temperature_2m_min: days.map(() => 19),
    precipitation_sum: days.map((d) => (d.code === 63 ? 12.4 : 0)),
    sunrise: days.map((d) => `${d.date}T06:30`),
    sunset: days.map((d) => `${d.date}T18:30`)
  }
});

const respondWith = (payload) =>
  mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => payload });

const classify = (placeId, setting) =>
  pool.query('UPDATE places SET setting = $1 WHERE id = $2', [setting, placeId]);

/** A three-day trip: day 1 wet, day 2 dry, day 3 dry. */
const threeDayTrip = async () => {
  const created = await request(app)
    .post('/api/auth/trips')
    .set(asUser)
    .send({ title: 'Karnataka', start_date: '2026-03-01', end_date: '2026-03-03' })
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

const replanOf = async (tripId) => {
  const res = await request(app)
    .get(`/api/auth/trips/${tripId}/replan-suggestion`)
    .set(asUser)
    .expect(200);

  return res.body.replan;
};

beforeAll(async () => {
  await createSchema();
});
beforeEach(async () => {
  await resetData();
  resetRateLimits(app);
  mockFetch.mockReset();
  weatherService.clearCache();
  await classify(HAMPI, 'outdoor');
  respondWith(
    forecastOf([
      { date: '2026-03-01', ...WET },
      { date: '2026-03-02', ...DRY },
      { date: '2026-03-03', ...DRY }
    ])
  );
});
afterAll(async () => {
  await closeDb();
});

describe('it proposes, with the evidence attached', () => {
  test('an untimed outdoor stop on a wet day is offered a drier one', async () => {
    const trip = await threeDayTrip();
    const added = await addItem(trip.id, trip.days[0].id, {
      place_id: HAMPI,
      title: 'Boulders',
      position: 0
    });

    const { proposals, declined } = await replanOf(trip.id);

    expect(declined).toEqual([]);
    expect(proposals).toHaveLength(1);
    expect(proposals[0].item_id).toBe(added.body.item.id);
    expect(proposals[0].from_day_number).toBe(1);
    // The row id travels with the ordinal, so the client can apply the move without mapping one
    // back to the other.
    expect(proposals[0].to_day_id).toBe(trip.days[1].id);
    // Day 2 and day 3 are both dry; the nearer one wins, because moving a stop three days is a
    // bigger change to a plan somebody reasoned about than moving it one.
    expect(proposals[0].to_day_number).toBe(2);
  });

  test('every proposal cites what it is moving away from and toward', async () => {
    // A proposal that cannot say why is a proposal nobody should accept — and the citation is what
    // stage (b) inherits from stage (a) rather than inventing.
    const trip = await threeDayTrip();
    await addItem(trip.id, trip.days[0].id, { place_id: HAMPI, title: 'Boulders', position: 0 });

    const { proposals } = await replanOf(trip.id);

    expect(proposals[0].because.from_condition).toBe('Rain');
    expect(proposals[0].because.to_condition).toBe('Partly cloudy');
    expect(proposals[0].because.from_precipitation_mm).toBe(12.4);
    expect(proposals[0].because.source).toBe('Open-Meteo');
    expect(proposals[0].message).toMatch(/Day 1 is forecast rain/i);
  });
});

describe('what it refuses to move, and says so', () => {
  test('an item with a start time is left alone, and the reason is reported', async () => {
    // `trip_items` has no `pinned` column and this deliberately does not add one. A start time is
    // the strongest signal the schema carries that a human chose this hour on this day.
    const trip = await threeDayTrip();
    await addItem(trip.id, trip.days[0].id, {
      place_id: HAMPI,
      title: 'Sunset point',
      start_time: '17:00',
      end_time: '18:00',
      position: 0
    });

    const { proposals, declined } = await replanOf(trip.id);

    expect(proposals).toEqual([]);
    expect(declined).toHaveLength(1);
    expect(declined[0].reason).toBe('scheduled_at_a_fixed_time');
    // Reported, not silent: a wet day left unchanged with no explanation reads as a broken feature.
    expect(declined[0].message).toMatch(/scheduled at 17:00/);
  });

  test('a day with no forecast is never a destination', async () => {
    // Beyond the provider's horizon there is no reading, and an absence of rain in the data is not
    // evidence of a dry day. Only day 1 has one here, and it is the wet one.
    respondWith(forecastOf([{ date: '2026-03-01', ...WET }]));

    const trip = await threeDayTrip();
    await addItem(trip.id, trip.days[0].id, { place_id: HAMPI, title: 'Boulders', position: 0 });

    const { proposals, declined } = await replanOf(trip.id);

    expect(proposals).toEqual([]);
    expect(declined[0].reason).toBe('no_day_known_to_be_dry');
  });

  test('an already-broken destination day does not block the move, and that is correct', async () => {
    // The first version of this test asserted the opposite, and was wrong in an instructive way.
    //
    // `checkTrip` is run over every candidate move and the move is rejected if it adds an error.
    // But **every item-level error requires a `start_time`** — overlaps, order-versus-clock,
    // travel time — and only *untimed* items are ever moved. An untimed stop has no clock to
    // conflict with, so it cannot make any day worse, however broken that day already is.
    //
    // So the honest assertion is this one: days 2 and 3 are already impossible (250 km in five
    // minutes), and the proposal is offered anyway, because moving an untimed stop onto them
    // changes nothing about why they are broken.
    await classify(GOKARNA, 'indoor');
    const trip = await threeDayTrip();

    await addItem(trip.id, trip.days[0].id, { place_id: HAMPI, title: 'Boulders', position: 0 });
    for (const day of [trip.days[1], trip.days[2]]) {
      await addItem(trip.id, day.id, {
        place_id: HAMPI,
        title: 'Hampi again',
        start_time: '09:00',
        end_time: '17:55',
        position: 0
      });
      await addItem(trip.id, day.id, {
        place_id: GOKARNA,
        title: 'Gokarna',
        start_time: '18:00',
        end_time: '19:00',
        position: 1
      });
    }

    const { proposals, declined } = await replanOf(trip.id);

    expect(declined).toEqual([]);
    expect(proposals).toHaveLength(1);
    expect(proposals[0].to_day_number).toBe(2);
  });

  test('a stop that is not outdoors is never proposed', async () => {
    // Rain falls on the museum too. It is not evidence of a problem there, and `unknown` — the
    // catalogue's default — is not evidence of anything at all.
    for (const setting of ['indoor', 'mixed', 'unknown']) {
      await classify(HAMPI, setting);
      const trip = await threeDayTrip();
      await addItem(trip.id, trip.days[0].id, { place_id: HAMPI, title: 'Museum', position: 0 });

      const { proposals, declined, considered } = await replanOf(trip.id);

      expect(proposals).toEqual([]);
      expect(declined).toEqual([]);
      expect(considered).toBe(0);
    }
  });

  test('a dry trip has nothing to say', async () => {
    respondWith(
      forecastOf([
        { date: '2026-03-01', ...DRY },
        { date: '2026-03-02', ...DRY },
        { date: '2026-03-03', ...DRY }
      ])
    );

    const trip = await threeDayTrip();
    await addItem(trip.id, trip.days[0].id, { place_id: HAMPI, title: 'Boulders', position: 0 });

    const { proposals, declined, considered } = await replanOf(trip.id);
    expect({ proposals, declined, considered }).toEqual({
      proposals: [],
      declined: [],
      considered: 0
    });
  });
});

describe('it is a read, and it is yours alone', () => {
  test('asking for a proposal changes nothing', async () => {
    // The kill criterion this feature would die on: silently rewriting somebody's trip is worse
    // than not having the feature. So the plan is compared before and after.
    const trip = await threeDayTrip();
    await addItem(trip.id, trip.days[0].id, { place_id: HAMPI, title: 'Boulders', position: 0 });

    const before = await request(app).get(`/api/auth/trips/${trip.id}`).set(asUser).expect(200);
    await replanOf(trip.id);
    const after = await request(app).get(`/api/auth/trips/${trip.id}`).set(asUser).expect(200);

    expect(after.body.trip.days).toEqual(before.body.trip.days);
  });

  test('somebody else’s trip is a 404, not a 403', async () => {
    const trip = await threeDayTrip();
    await request(app).get(`/api/auth/trips/${trip.id}/replan-suggestion`).set(asOther).expect(404);
  });

  test('it needs a token, and a numeric id', async () => {
    const trip = await threeDayTrip();
    await request(app).get(`/api/auth/trips/${trip.id}/replan-suggestion`).expect(401);
    await request(app)
      .get('/api/auth/trips/not-a-number/replan-suggestion')
      .set(asUser)
      .expect(400);
  });
});

describe('the rule holds on its own, not because the caller filtered first', () => {
  /**
   * `attachReplanContext` only looks up a forecast for **outdoor** stops, which shadows every
   * setting check inside `suggestReplan` when the service is exercised through the endpoint. A
   * mutation found it: deleting the `outdoor` filter here broke nothing, because a museum never had
   * a forecast to be judged against in the first place.
   *
   * That is not an equivalent mutant — `suggestReplan` is a pure exported function, and the whole
   * argument for keeping the engine pure is that its behaviour can be reasoned about from its
   * input. So it is fed one directly.
   */
  const wet = { is_wet: true, condition: 'Rain', precipitation_mm: 12.4, source: 'Open-Meteo' };
  const dry = { is_wet: false, condition: 'Clear sky', precipitation_mm: 0, source: 'Open-Meteo' };

  const tripWith = (setting) => ({
    start_date: '2026-03-01',
    end_date: '2026-03-02',
    day_dates: { 1: '2026-03-01', 2: '2026-03-02' },
    // A forecast exists for the item whatever its setting — which is precisely the situation the
    // endpoint can never produce, and precisely the one that proves the filter is real.
    item_forecasts: { 7: { '2026-03-01': wet, '2026-03-02': dry } },
    days: [
      {
        day_number: 1,
        items: [
          {
            id: 7,
            title: 'Museum',
            place_setting: setting,
            position: 0,
            start_time: null,
            end_time: null
          }
        ]
      },
      { day_number: 2, items: [] }
    ]
  });

  test('only an outdoor stop is ever considered, given the same forecast', () => {
    for (const setting of ['indoor', 'mixed', 'unknown', null, undefined]) {
      const result = suggestReplan(tripWith(setting));
      expect(result.considered).toBe(0);
      expect(result.proposals).toEqual([]);
      expect(result.declined).toEqual([]);
    }
  });

  test('and an outdoor one is, which is what makes the check above meaningful', () => {
    // Without this, the assertion above would pass against a service that proposes nothing at all.
    const result = suggestReplan(tripWith('outdoor'));

    expect(result.considered).toBe(1);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].to_day_number).toBe(2);
  });

  test('an empty day is a perfectly good destination', () => {
    // Day 2 holds nothing, so it has no coordinates and no day-level reading of its own. The
    // day-shaped model this replaced could never have offered it — and "move it to the free day"
    // is the most obvious suggestion the feature can make.
    const result = suggestReplan(tripWith('outdoor'));

    expect(result.proposals[0].to_day_number).toBe(2);
    expect(result.proposals[0].because.to_condition).toBe('Clear sky');
  });
});
