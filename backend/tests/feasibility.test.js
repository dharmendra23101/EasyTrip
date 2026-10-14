const request = require('supertest');

const app = require('../app');
const { createSchema, resetData, closeDb, resetRateLimits, pool } = require('./helpers/testDb');
const { authHeader } = require('./helpers/firebaseMock');
const { haversineKm } = require('../src/services/geoDistance');
const {
  checkTrip,
  travelMinutesForKm,
  minutesOfDay,
  inclusiveDayCount,
  ASSUMPTIONS
} = require('../src/services/feasibilityService');

/**
 * The itinerary feasibility engine (`FV-025`, stages a and b).
 *
 * **What makes this suite different from every other one in this directory.** The engine is pure —
 * no database, no clock, no network — so most of what follows is a table of hand-built trips and
 * the verdict each must produce. That is deliberate: this component's entire value is that its
 * output can be *proved*, and it is also the scoring oracle for `AI-006`. A validator whose own
 * behaviour is only observed through an endpoint is a validator nobody can reason about.
 *
 * The endpoint tests at the bottom exist for the things purity cannot cover: ownership, the shape
 * that reaches a client, and the fact that the route is mounted at all.
 *
 * **The distances are real ones.** Hampi to Gokarna is ~250 km; Hampi to Hampi Bazaar is ~2 km. A
 * fixture with invented coordinates would still exercise the arithmetic, and would not tell anyone
 * reading it whether the thresholds are sane.
 */

const HAMPI = { latitude: 15.335, longitude: 76.46 };
const GOKARNA = { latitude: 14.55, longitude: 74.32 };
const BADAMI = { latitude: 15.918, longitude: 75.68 };
// ~2.4 km from Hampi — inside the same town, but far enough that the engine still checks it.
const HAMPI_BAZAAR = { latitude: 15.335, longitude: 76.482 };
// ~500 m — under `negligible_distance_km`, where "travel time" stops being a meaningful idea.
const HAMPI_NEXT_DOOR = { latitude: 15.3395, longitude: 76.46 };

let nextId = 1;
const item = (over = {}) => ({
  id: nextId++,
  place_id: null,
  title: 'Something',
  start_time: null,
  end_time: null,
  position: 0,
  place_latitude: null,
  place_longitude: null,
  ...over
});

/** An item at a place, with times, in one call — the shape most of these tests need. */
const stop = (title, at, start, end, over = {}) =>
  item({
    title,
    start_time: start,
    end_time: end,
    place_latitude: at.latitude,
    place_longitude: at.longitude,
    ...over
  });

const trip = (days, over = {}) => ({
  start_date: '2026-03-01',
  end_date: '2026-03-03',
  days: days.map((items, index) => ({ day_number: index + 1, items })),
  ...over
});

const codes = (result) => result.findings.map((f) => f.code);

beforeEach(() => {
  nextId = 1;
});

describe('the arithmetic, before the rules that use it', () => {
  it('measures a real distance', () => {
    // ~250 km. Asserted as a range because the point is that the function is a great-circle
    // distance, not that it reproduces one particular rounding.
    expect(haversineKm(HAMPI, GOKARNA)).toBeGreaterThan(230);
    expect(haversineKm(HAMPI, GOKARNA)).toBeLessThan(270);
  });

  it('returns null rather than zero when a coordinate is missing', () => {
    // Zero would mean "the same place", which silently approves a day nobody knows anything about.
    expect(haversineKm(HAMPI, null)).toBeNull();
    expect(haversineKm(HAMPI, { latitude: 15, longitude: null })).toBeNull();
    expect(haversineKm(HAMPI, { latitude: 'x', longitude: 'y' })).toBeNull();
  });

  it('turns a distance into minutes at the stated assumptions', () => {
    // 40 km straight line -> 52 km of road at 40 km/h -> 78 minutes.
    expect(travelMinutesForKm(40)).toBe(78);
    expect(ASSUMPTIONS.road_factor).toBe(1.3);
    expect(ASSUMPTIONS.average_speed_kmh).toBe(40);
  });

  it('parses the TIME strings node-pg actually returns', () => {
    expect(minutesOfDay('14:30:00')).toBe(870);
    expect(minutesOfDay('09:05')).toBe(545);
    expect(minutesOfDay('00:00:00')).toBe(0);
    expect(minutesOfDay(null)).toBeNull();
    expect(minutesOfDay('25:00:00')).toBeNull();
    expect(minutesOfDay('nonsense')).toBeNull();
  });

  it('counts trip days inclusively, because a one-day trip has one day', () => {
    expect(inclusiveDayCount('2026-03-01', '2026-03-03')).toBe(3);
    expect(inclusiveDayCount('2026-03-01', '2026-03-01')).toBe(1);
    expect(inclusiveDayCount(null, '2026-03-03')).toBeNull();
  });
});

describe('a plan that can be executed is left alone', () => {
  it('finds nothing wrong with a realistic day', () => {
    const result = checkTrip(
      trip([
        [
          stop('Virupaksha Temple', HAMPI, '08:00:00', '10:00:00', { position: 0, place_id: 1 }),
          stop('Hampi Bazaar', HAMPI_BAZAAR, '10:30:00', '12:00:00', { position: 1, place_id: 5 })
        ]
      ])
    );

    expect(result.feasible).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.counts).toEqual({ errors: 0, warnings: 0 });
  });

  it('says nothing about items with no times, which is most of a draft', () => {
    const result = checkTrip(
      trip([[item({ title: 'Somewhere' }), item({ title: 'Somewhere else', position: 1 })]])
    );
    expect(result.feasible).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it('returns its assumptions, so a caller can say "estimated" truthfully', () => {
    const result = checkTrip(trip([[]]));
    expect(result.assumptions).toEqual(ASSUMPTIONS);
  });
});

describe('stage (a) — time and date bounds', () => {
  it('flags a day the trip no longer has', () => {
    // The workspace builds day slots from the dates. Shorten the trip and the extra days remain.
    const result = checkTrip(trip([[], [], [], []]));
    expect(codes(result)).toEqual(['day_outside_trip_dates']);
    expect(result.feasible).toBe(false);
    expect(result.findings[0].day_number).toBe(4);
  });

  it('checks nothing about bounds when the trip has no dates', () => {
    const result = checkTrip(trip([[], [], [], []], { start_date: null, end_date: null }));
    expect(codes(result)).toEqual([]);
  });

  it('flags two items claiming the same minutes', () => {
    const result = checkTrip(
      trip([
        [
          stop('Fort', HAMPI, '09:00:00', '12:00:00'),
          stop('Museum', HAMPI, '11:00:00', '13:00:00', { position: 1 })
        ]
      ])
    );
    expect(codes(result)).toContain('items_overlap');
    expect(result.findings[0].overlap_minutes).toBe(60);
    expect(result.feasible).toBe(false);
  });

  it('does not treat a back-to-back handover as an overlap', () => {
    const result = checkTrip(
      trip([
        [
          stop('Fort', HAMPI, '09:00:00', '12:00:00'),
          stop('Lunch', HAMPI, '12:00:00', '13:00:00', { position: 1 })
        ]
      ])
    );
    expect(codes(result)).toEqual([]);
  });

  it('flags a plan whose order its own times do not follow', () => {
    // Not an overlap — these are an hour apart. The list is simply in an order nobody can walk,
    // which drag-and-drop makes easy to produce and hard to notice.
    const result = checkTrip(
      trip([
        [
          stop('Afternoon thing', HAMPI, '15:00:00', '16:00:00', { position: 0 }),
          stop('Morning thing', HAMPI, '09:00:00', '10:00:00', { position: 1 })
        ]
      ])
    );
    expect(codes(result)).toContain('order_disagrees_with_times');
    // A warning: the plan is executable, it just reads wrongly.
    expect(result.feasible).toBe(true);
  });
});

describe('stage (b) — travel time', () => {
  it('flags a gap smaller than the journey', () => {
    // Hampi -> Gokarna is ~250 km straight line, ~325 km of road, ~8 hours. Half an hour is not it.
    const result = checkTrip(
      trip([
        [
          stop('Hampi ruins', HAMPI, '08:00:00', '12:00:00'),
          stop('Gokarna beach', GOKARNA, '12:30:00', '18:00:00', { position: 1 })
        ]
      ])
    );

    const found = result.findings.find((f) => f.code === 'insufficient_travel_time');
    expect(found).toBeDefined();
    expect(found.available_minutes).toBe(30);
    expect(found.estimated_travel_minutes).toBeGreaterThan(400);
    expect(result.feasible).toBe(false);
  });

  it('labels the finding as an estimate, because it is one', () => {
    // EasyTrip has no routing provider. A travel-time warning that looks like a measurement is
    // fabricated data with a validator's authority (Article III).
    const result = checkTrip(
      trip([
        [
          stop('Hampi', HAMPI, '08:00:00', '09:00:00'),
          stop('Gokarna', GOKARNA, '09:30:00', '10:00:00', { position: 1 })
        ]
      ])
    );
    expect(result.findings[0].estimated).toBe(true);
    expect(result.findings[0]).toHaveProperty('straight_line_km');
  });

  it('accepts a gap that is genuinely long enough', () => {
    const result = checkTrip(
      trip([
        [
          stop('Hampi', HAMPI, '06:00:00', '07:00:00'),
          stop('Gokarna', GOKARNA, '18:00:00', '20:00:00', { position: 1 })
        ]
      ])
    );
    expect(codes(result)).not.toContain('insufficient_travel_time');
  });

  it('ignores a walk across the street', () => {
    // Under `negligible_distance_km`, with **no gap at all** — so the only thing that can keep this
    // quiet is the floor. An earlier version of this test used a 2.4 km hop with a five-minute gap
    // and passed because five minutes happened to be enough; removing the floor entirely left it
    // green. A test that survives the deletion of the thing it names is not testing it.
    const result = checkTrip(
      trip([
        [
          stop('Temple', HAMPI, '09:00:00', '10:00:00'),
          stop('The cafe opposite', HAMPI_NEXT_DOOR, '10:00:00', '11:00:00', { position: 1 })
        ]
      ])
    );
    expect(codes(result)).not.toContain('insufficient_travel_time');
  });

  it('still checks a short hop that is not negligible', () => {
    // 2.4 km across town needs ~5 minutes at the stated assumptions. One minute is not it — and a
    // validator that waves through every short leg is how a day fills up with impossible gaps.
    const result = checkTrip(
      trip([
        [
          stop('Temple', HAMPI, '09:00:00', '10:00:00'),
          stop('Bazaar', HAMPI_BAZAAR, '10:01:00', '11:00:00', { position: 1 })
        ]
      ])
    );
    expect(codes(result)).toContain('insufficient_travel_time');
  });

  it('cannot check what it does not know, and does not pretend otherwise', () => {
    const result = checkTrip(
      trip([
        [
          stop('Hampi', HAMPI, '08:00:00', '09:00:00'),
          item({ title: 'A note with no place', start_time: '09:05:00', position: 1 })
        ]
      ])
    );
    expect(codes(result)).toEqual([]);
  });

  it('departs from the previous start when it has no end time', () => {
    const result = checkTrip(
      trip([
        [
          stop('Hampi', HAMPI, '08:00:00', null),
          stop('Gokarna', GOKARNA, '08:30:00', null, { position: 1 })
        ]
      ])
    );
    expect(codes(result)).toContain('insufficient_travel_time');
    expect(result.findings[0].available_minutes).toBe(30);
  });
});

describe('stage (b) — geographic sanity', () => {
  it('flags a day that ping-pongs across the region', () => {
    // Gokarna -> Hampi -> Badami is ~250 + ~90 km. Hampi -> Badami -> Gokarna is ~90 + ~180.
    // Same three stops, a much shorter day.
    const result = checkTrip(
      trip([
        [
          stop('Gokarna', GOKARNA, null, null, { position: 0 }),
          stop('Hampi', HAMPI, null, null, { position: 1 }),
          stop('Badami', BADAMI, null, null, { position: 2 }),
          stop('Gokarna again', GOKARNA, null, null, { position: 3 })
        ]
      ])
    );

    const found = result.findings.find((f) => f.code === 'day_backtracks');
    expect(found).toBeDefined();
    expect(found.planned_km).toBeGreaterThan(found.clustered_km);
    expect(found.estimated).toBe(true);
    // A warning, not an error: a traveller is allowed to want an inefficient day.
    expect(result.feasible).toBe(true);
  });

  it('leaves a tight cluster alone even if the order is imperfect', () => {
    const result = checkTrip(
      trip([
        [
          stop('A', HAMPI, null, null, { position: 0 }),
          stop('B', HAMPI_BAZAAR, null, null, { position: 1 }),
          stop('C', HAMPI, null, null, { position: 2 })
        ]
      ])
    );
    expect(codes(result)).not.toContain('day_backtracks');
  });

  it('says nothing about a day of two stops, where order cannot be wrong', () => {
    const result = checkTrip(
      trip([
        [
          stop('Gokarna', GOKARNA, null, null, { position: 0 }),
          stop('Hampi', HAMPI, null, null, { position: 1 })
        ]
      ])
    );
    expect(codes(result)).not.toContain('day_backtracks');
  });
});

describe('duplicates', () => {
  it('flags the same place twice in a day', () => {
    const result = checkTrip(
      trip([
        [
          stop('Morning at the fort', HAMPI, null, null, { place_id: 7, position: 0 }),
          stop('Evening at the fort', HAMPI, null, null, { place_id: 7, position: 1 })
        ]
      ])
    );
    expect(codes(result)).toContain('place_repeated_in_day');
    expect(result.feasible).toBe(true);
  });

  it('allows the same place on different days', () => {
    const result = checkTrip(
      trip([
        [stop('Day one', HAMPI, null, null, { place_id: 7 })],
        [stop('Day two', HAMPI, null, null, { place_id: 7 })]
      ])
    );
    expect(codes(result)).not.toContain('place_repeated_in_day');
  });

  it('does not treat two untethered items as duplicates', () => {
    const result = checkTrip(
      trip([[item({ title: 'Lunch' }), item({ title: 'Lunch', position: 1 })]])
    );
    expect(codes(result)).toEqual([]);
  });
});

describe('feasible means executable, not tidy', () => {
  it('stays feasible when only warnings are present', () => {
    const result = checkTrip(
      trip([
        [
          stop('Fort', HAMPI, null, null, { place_id: 7, position: 0 }),
          stop('Fort again', HAMPI, null, null, { place_id: 7, position: 1 })
        ]
      ])
    );
    expect(result.counts.warnings).toBeGreaterThan(0);
    expect(result.counts.errors).toBe(0);
    expect(result.feasible).toBe(true);
  });

  it('is not feasible as soon as one error appears', () => {
    const result = checkTrip(
      trip([
        [
          stop('Hampi', HAMPI, '08:00:00', '09:00:00'),
          stop('Gokarna', GOKARNA, '09:15:00', '10:00:00', { position: 1 })
        ]
      ])
    );
    expect(result.counts.errors).toBeGreaterThan(0);
    expect(result.feasible).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The endpoint — ownership, mounting, and the shape a client receives
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

/**
 * A trip, plus the workspace read that carries its day ids.
 *
 * `POST /trips` returns the trip row alone — the days it creates in the same transaction are not in
 * the response — so a caller that needs a day id fetches the workspace. Worth knowing rather than
 * working around: it is why the UI loads the workspace after creating a trip.
 */
const seedTrip = async () => {
  const created = await request(app)
    .post('/api/auth/trips')
    .set(asUser)
    .send({ title: 'Karnataka', start_date: '2026-03-01', end_date: '2026-03-02' })
    .expect(201);

  const workspace = await request(app)
    .get(`/api/auth/trips/${created.body.trip.id}`)
    .set(asUser)
    .expect(200);

  return workspace.body.trip;
};

describe('GET /api/auth/trips/:tripId/feasibility', () => {
  it('reports on an empty trip without inventing problems', async () => {
    const created = await seedTrip();

    const res = await request(app)
      .get(`/api/auth/trips/${created.id}/feasibility`)
      .set(asUser)
      .expect(200);

    expect(res.body.feasibility.feasible).toBe(true);
    expect(res.body.feasibility.findings).toEqual([]);
    expect(res.body.feasibility.assumptions.average_speed_kmh).toBe(40);
  });

  it('reports a real problem built through the real API', async () => {
    // End to end through the write path, so the engine is fed by the columns the workspace
    // actually stores rather than by a fixture that agrees with it.
    const created = await seedTrip();
    const dayId = created.days[0].id;

    await request(app)
      .post(`/api/auth/trips/${created.id}/days/${dayId}/items`)
      .set(asUser)
      .send({ place_id: 1, title: 'Hampi', start_time: '08:00', end_time: '09:00', position: 0 })
      .expect(201);
    await request(app)
      .post(`/api/auth/trips/${created.id}/days/${dayId}/items`)
      .set(asUser)
      .send({ place_id: 3, title: 'Gokarna', start_time: '09:30', end_time: '12:00', position: 1 })
      .expect(201);

    const res = await request(app)
      .get(`/api/auth/trips/${created.id}/feasibility`)
      .set(asUser)
      .expect(200);

    expect(res.body.feasibility.feasible).toBe(false);
    expect(res.body.feasibility.findings.map((f) => f.code)).toContain('insufficient_travel_time');
  });

  test('a day past the trip’s own dates is reported — which it never used to be', async () => {
    // `BUG-051`, and the reason it hid for so long: `checkDayBounds` is proved several times over
    // by the pure tests above, which hand it `'2026-03-01'`. The database hands it a JavaScript
    // `Date`, `inclusiveDayCount` returned `null` for that, and the whole check quietly did
    // nothing — **this finding had never once been emitted by the API**.
    //
    // A test at this level is the only one that could have caught it, because the defect is not in
    // the rule, it is in the shape of what the rule is fed. `tripModel` now reads the dates as
    // text; this asserts the consequence rather than the query.
    const created = await seedTrip(); // 2026-03-01 to 2026-03-02 — two days

    await request(app).post(`/api/auth/trips/${created.id}/days`).set(asUser).expect(201);

    const res = await request(app)
      .get(`/api/auth/trips/${created.id}/feasibility`)
      .set(asUser)
      .expect(200);

    const bounds = res.body.feasibility.findings.find((f) => f.code === 'day_outside_trip_dates');
    expect(bounds).toBeTruthy();
    expect(bounds.day_number).toBe(3);
    expect(bounds.trip_day_count).toBe(2);
    // An error, not a warning: a day the trip does not have cannot be executed.
    expect(res.body.feasibility.feasible).toBe(false);
  });

  it('is a 404 for somebody else’s trip, not a 403', async () => {
    // The same rule the rest of the workspace follows: a trip you do not own does not exist.
    const created = await seedTrip();

    await request(app).get(`/api/auth/trips/${created.id}/feasibility`).set(asOther).expect(404);
  });

  it('needs a token', async () => {
    const created = await seedTrip();
    await request(app).get(`/api/auth/trips/${created.id}/feasibility`).expect(401);
  });

  it('rejects a non-numeric trip id before it reaches the database', async () => {
    await request(app).get('/api/auth/trips/not-a-number/feasibility').set(asUser).expect(400);
  });

  it('is a 404 for a trip that does not exist', async () => {
    await request(app).get('/api/auth/trips/999999/feasibility').set(asUser).expect(404);
  });
});

describe('the engine reads what the database really returns', () => {
  it('handles TIME and DECIMAL as node-pg hands them over', async () => {
    // The failure this guards: `start_time` arrives as '08:00:00' and coordinates as strings.
    // A parser written against JavaScript numbers passes every pure test above and finds nothing
    // at all here.
    const created = await seedTrip();
    const dayId = created.days[0].id;
    await request(app)
      .post(`/api/auth/trips/${created.id}/days/${dayId}/items`)
      .set(asUser)
      .send({ place_id: 1, title: 'Hampi', start_time: '08:00', end_time: '09:00', position: 0 });

    const row = await pool.query(
      'SELECT start_time FROM trip_items WHERE trip_day_id = $1 LIMIT 1',
      [dayId]
    );
    expect(typeof row.rows[0].start_time).toBe('string');
    expect(minutesOfDay(row.rows[0].start_time)).toBe(480);
  });
});

describe('FV-031 — an outdoor stop scheduled in the dark', () => {
  /**
   * Hampi, 15.335N. The sun sets around 18:05 in mid-December and around 18:50 in mid-June, so a
   * 19:30 finish is after dark in both — the honest seasonal boundary is the *start*: an 06:30
   * start is before a 06:42 December sunrise and after a 05:55 June one.
   *
   * Both figures come from the provider for that coordinate; the engine never computes them.
   */
  const dayWith = (sunrise, sunset, items) => ({
    day_number: 1,
    sunrise,
    sunset,
    items
  });

  const outdoorItem = (overrides) => ({
    id: 1,
    title: 'Sunrise at Matanga Hill',
    place_setting: 'outdoor',
    position: 0,
    ...overrides
  });

  const codes = (trip) => checkTrip(trip).findings.map((f) => f.code);

  test('the same 06:30 start is flagged in December and clean in June', () => {
    const december = {
      start_date: '2026-12-14',
      end_date: '2026-12-14',
      days: [
        dayWith('2026-12-14T06:42', '2026-12-14T18:05', [
          outdoorItem({ start_time: '06:30', end_time: '08:00' })
        ])
      ]
    };
    const june = {
      start_date: '2026-06-14',
      end_date: '2026-06-14',
      days: [
        dayWith('2026-06-14T05:55', '2026-06-14T18:50', [
          outdoorItem({ start_time: '06:30', end_time: '08:00' })
        ])
      ]
    };

    // Identical plan, identical coordinates, opposite verdicts — decided by the day's own sunrise.
    expect(codes(december)).toContain('outdoor_item_in_darkness');
    expect(codes(june)).not.toContain('outdoor_item_in_darkness');
  });

  test('an outdoor visit that runs past sunset is flagged on its end, not its start', () => {
    const trip = {
      start_date: '2026-12-14',
      end_date: '2026-12-14',
      days: [
        dayWith('2026-12-14T06:42', '2026-12-14T18:05', [
          outdoorItem({ title: 'Sunset point', start_time: '17:00', end_time: '19:30' })
        ])
      ]
    };
    const finding = checkTrip(trip).findings.find((f) => f.code === 'outdoor_item_in_darkness');

    expect(finding).toBeTruthy();
    expect(finding.message).toMatch(/after sunset/);
    // A warning, not an error: a night market is a thing people want.
    expect(finding.severity).toBe('warning');
    expect(checkTrip(trip).feasible).toBe(true);
  });

  test('unknown and mixed produce nothing, because neither is evidence', () => {
    // `unknown` is the default for the whole catalogue until somebody classifies it, and `mixed` is
    // a fort with a museum in it. Warning about either would be a guess with a validator's
    // authority — the defect `IMP-027` exists for.
    for (const setting of ['unknown', 'mixed', 'indoor', null, undefined]) {
      const trip = {
        start_date: '2026-12-14',
        end_date: '2026-12-14',
        days: [
          dayWith('2026-12-14T06:42', '2026-12-14T18:05', [
            outdoorItem({ place_setting: setting, start_time: '05:00', end_time: '05:30' })
          ])
        ]
      };
      expect(codes(trip)).not.toContain('outdoor_item_in_darkness');
    }
  });

  test('no sunrise/sunset means no finding, rather than an assumed one', () => {
    // Beyond the provider's seven-day horizon there is no reading. An absent reading has to produce
    // an absent finding — the same rule the weather panel follows when it states an absence.
    const trip = {
      start_date: '2026-12-14',
      end_date: '2026-12-14',
      days: [dayWith(null, null, [outdoorItem({ start_time: '03:00', end_time: '04:00' })])]
    };
    expect(codes(trip)).not.toContain('outdoor_item_in_darkness');
  });

  test('an item with no time cannot be in the dark', () => {
    const trip = {
      start_date: '2026-12-14',
      end_date: '2026-12-14',
      days: [
        dayWith('2026-12-14T06:42', '2026-12-14T18:05', [
          outdoorItem({ start_time: null, end_time: null })
        ])
      ]
    };
    expect(codes(trip)).not.toContain('outdoor_item_in_darkness');
  });
});

describe('FV-027 stage (a) — the refusals, as pure functions', () => {
  const RAIN = { is_wet: true, condition: 'Rain', precipitation_mm: 12.4 };

  // No default for `weather`: a default parameter treats an explicitly-passed `undefined` as
  // absent, so the "no reading" case below would have been handed rain and passed for the wrong
  // reason. It did, on the first run — which is why it is spelled out rather than tidied away.
  const dayWith = (weather, items) => ({
    start_date: '2026-03-01',
    end_date: '2026-03-01',
    days: [{ day_number: 1, weather, items }]
  });

  const outdoorStop = (over = {}) => ({
    id: 1,
    title: 'Boulders',
    place_setting: 'outdoor',
    position: 0,
    start_time: null,
    end_time: null,
    ...over
  });

  const codes = (trip) => checkTrip(trip).findings.map((f) => f.code);

  test('unknown, mixed and indoor are not evidence of anything', () => {
    // `unknown` is the catalogue's default until somebody classifies it, and `mixed` is a fort with
    // a museum in it. Warning about either would be a guess with a validator's authority — which is
    // the defect `IMP-027` exists for, and the same refusal `checkDaylight` makes.
    for (const setting of ['unknown', 'mixed', 'indoor', null, undefined]) {
      expect(codes(dayWith(RAIN, [outdoorStop({ place_setting: setting })]))).not.toContain(
        'outdoor_day_likely_wet'
      );
    }
  });

  test('no reading means no finding, rather than an assumed one', () => {
    // Past the provider's seven-day horizon there is no forecast entry, so no `weather` is
    // attached. Silence is the only honest answer, and it must not be mistaken for a dry day.
    for (const weather of [undefined, null, {}, { is_wet: false, condition: 'Clear sky' }]) {
      expect(codes(dayWith(weather, [outdoorStop()]))).not.toContain('outdoor_day_likely_wet');
    }
  });

  test('a wet day is a warning, so the trip stays possible', () => {
    const report = checkTrip(dayWith(RAIN, [outdoorStop()]));
    const found = report.findings.find((f) => f.code === 'outdoor_day_likely_wet');

    expect(found.severity).toBe('warning');
    expect(report.feasible).toBe(true);
    // Nothing attached a source here, and the finding says so rather than borrowing one.
    expect(found.source).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Stops that conflict with what the traveller needs (`FV-029` stage d)
// ---------------------------------------------------------------------------
describe('the traveller’s own access needs', () => {
  /** A one-day trip with a single stop whose place carries the given accessibility answers. */
  const tripWithStop = (over = {}) => ({
    start_date: null,
    end_date: null,
    days: [
      {
        day_number: 1,
        items: [
          item({
            title: 'The Fort',
            place_id: 1,
            place_step_free_access: 'unknown',
            place_accessible_restroom: 'unknown',
            place_accessibility_source: 'site_visit',
            place_accessibility_checked_on: '2026-08-01',
            ...over
          })
        ]
      }
    ]
  });

  const codes = (result) => result.findings.map((f) => f.code);

  describe('a traveller who has stated nothing', () => {
    test.each(['yes', 'no', 'partial', 'unknown'])(
      'sees no access finding against a %s stop',
      (answer) => {
        // The default for every row in `users`. Somebody who has not told us they need step-free
        // access must not be shown findings about it — they did not ask, and a warning they cannot
        // act on is noise that teaches them to skim.
        const result = checkTrip(tripWithStop({ place_step_free_access: answer }));
        expect(codes(result)).toEqual([]);
      }
    );

    test('and `requirements` may be omitted entirely, as every existing caller does', () => {
      expect(checkTrip(tripWithStop({ place_step_free_access: 'no' })).findings).toEqual([]);
    });
  });

  describe('a traveller who needs step-free access', () => {
    const needs = { requires_step_free: true, requires_accessible_restroom: false };

    test('a verified "no" is an error, because it is a locked door', () => {
      const result = checkTrip(tripWithStop({ place_step_free_access: 'no' }), needs);

      expect(codes(result)).toEqual(['stop_not_step_free']);
      expect(result.findings[0].severity).toBe('error');
      // An error, so the plan is reported as not executable — for this traveller it is not.
      expect(result.feasible).toBe(false);
      expect(result.findings[0].message).toContain('The Fort');
    });

    test('"partial" is a warning, because only a human can read the notes', () => {
      // "A ramp to the courtyard, eleven steps to the sanctum" is fine for one traveller and
      // impossible for another. The engine has no business deciding which.
      const result = checkTrip(tripWithStop({ place_step_free_access: 'partial' }), needs);

      expect(codes(result)).toEqual(['stop_partly_step_free']);
      expect(result.findings[0].severity).toBe('warning');
      expect(result.feasible).toBe(true);
    });

    test('"yes" produces nothing at all', () => {
      expect(checkTrip(tripWithStop({ place_step_free_access: 'yes' }), needs).findings).toEqual(
        []
      );
    });

    test('**"unknown" is silent**, which is the whole design', () => {
      // Almost the entire catalogue is unsurveyed. Warning "to be safe" would put a finding on
      // nearly every stop — training the traveller who most needs these to dismiss them, and doing
      // it by asserting something nobody checked. `FV-029`'s kill criterion forbids exactly that.
      const result = checkTrip(tripWithStop({ place_step_free_access: 'unknown' }), needs);
      expect(result.findings).toEqual([]);
      expect(result.feasible).toBe(true);
    });

    test('a stop with no place at all is silent too', () => {
      // "Lunch somewhere" is not a place and has nothing to check.
      const result = checkTrip(
        tripWithStop({
          place_id: null,
          place_step_free_access: undefined,
          place_accessible_restroom: undefined
        }),
        needs
      );
      expect(result.findings).toEqual([]);
    });

    test('the finding carries who checked and when', () => {
      // The same rule the badge follows. A warning that reaches the traveller as a screenshot has
      // to say who checked and when, or it is the bare assertion this item forbids.
      //
      // `checked_by` rather than `source`, and the distinction is load-bearing: `source` already
      // means "the provider whose data produced this finding" and the panel renders it as the words
      // *"Forecast from …"*. Reusing it would have shipped "Forecast from site_visit".
      const result = checkTrip(tripWithStop({ place_step_free_access: 'no' }), needs);

      expect(result.findings[0]).toMatchObject({
        checked_by: 'site_visit',
        checked_on: '2026-08-01',
        day_number: 1
      });
      expect(result.findings[0].item_ids).toHaveLength(1);
      // Never `source`: that key drives a forecast attribution one component over.
      expect(result.findings[0].source).toBeUndefined();
    });
  });

  describe('a traveller who needs an accessible restroom', () => {
    const needs = { requires_step_free: false, requires_accessible_restroom: true };

    test.each([
      ['no', 'warning'],
      ['partial', 'warning']
    ])('a %s restroom is a %s, not an error', (answer, severity) => {
      // A restroom decides how long somebody can comfortably stay; step-free access decides whether
      // they get in at all. Calling both errors would be easier and would flatten a distinction the
      // person reading this actually needs.
      const result = checkTrip(tripWithStop({ place_accessible_restroom: answer }), needs);

      expect(codes(result)).toEqual(['stop_without_accessible_restroom']);
      expect(result.findings[0].severity).toBe(severity);
      expect(result.feasible).toBe(true);
    });

    test('a step-free problem is not reported to somebody who did not ask about it', () => {
      const result = checkTrip(tripWithStop({ place_step_free_access: 'no' }), needs);
      expect(result.findings).toEqual([]);
    });
  });

  describe('both needs at once', () => {
    const needs = { requires_step_free: true, requires_accessible_restroom: true };

    test('one stop can produce two findings, and the trip is not feasible', () => {
      const result = checkTrip(
        tripWithStop({ place_step_free_access: 'no', place_accessible_restroom: 'no' }),
        needs
      );

      expect(codes(result).sort()).toEqual([
        'stop_not_step_free',
        'stop_without_accessible_restroom'
      ]);
      expect(result.feasible).toBe(false);
      expect(result.counts).toMatchObject({ errors: 1, warnings: 1 });
    });
  });
});

describe('the access needs reach the engine through the real stack', () => {
  // The pure tests above prove the rule. This proves the wiring: the profile column, the workspace
  // projection that carries a place's answers onto an item, and the controller that reads the
  // caller's own needs. Three separate pieces, each of which can be correct while the chain is not.
  const surveyPlace = async (id, answers) => {
    const req = request(app)
      .put(`/api/admin/places/${id}`)
      .set({ Authorization: authHeader({ uid: 'seed-admin-uid' }) });
    Object.entries({
      accessibility_source: 'site_visit',
      accessibility_checked_on: '2026-08-01',
      ...answers
    }).forEach(([key, value]) => req.field(key, String(value)));
    await req.expect(200);
  };

  const tripWithPlace = async (placeId) => {
    const trip = await seedTrip();
    await request(app)
      .post(`/api/auth/trips/${trip.id}/days/${trip.days[0].id}/items`)
      .set(asUser)
      .send({ place_id: placeId, title: 'The Fort', position: 0 })
      .expect(201);
    return trip;
  };

  const feasibilityOf = async (tripId) =>
    (await request(app).get(`/api/auth/trips/${tripId}/feasibility`).set(asUser).expect(200)).body
      .feasibility;

  test('a traveller who has stated nothing sees no access finding', async () => {
    await surveyPlace(1, { step_free_access: 'no' });
    const trip = await tripWithPlace(1);

    const feasibility = await feasibilityOf(trip.id);
    expect(feasibility.findings.map((f) => f.code)).not.toContain('stop_not_step_free');
  });

  test('stating the requirement makes the same trip report the same stop', async () => {
    // The whole chain, changed by one field on the profile and nothing else.
    await surveyPlace(1, { step_free_access: 'no' });
    const trip = await tripWithPlace(1);

    await request(app)
      .put('/api/auth/profile')
      .set(asUser)
      .send({ name: 'Tom Traveller', requires_step_free: true })
      .expect(200);

    const feasibility = await feasibilityOf(trip.id);
    const found = feasibility.findings.find((f) => f.code === 'stop_not_step_free');

    expect(found).toBeTruthy();
    expect(found.severity).toBe('error');
    expect(feasibility.feasible).toBe(false);
    // Provenance survives the round trip, including the date as a string rather than a Date a day
    // out — the same defect `placeModel` and `placeListModel` each needed `to_char` for.
    expect(found).toMatchObject({ checked_by: 'site_visit', checked_on: '2026-08-01' });
  });

  test('an unsurveyed place stays silent even for a traveller who needs it', async () => {
    // Place 4 is seeded and never surveyed. This is the state the real catalogue is in, so it is
    // the case that decides whether the feature is usable or is a wall of warnings.
    const trip = await tripWithPlace(4);
    await request(app)
      .put('/api/auth/profile')
      .set(asUser)
      .send({ name: 'Tom Traveller', requires_step_free: true })
      .expect(200);

    const feasibility = await feasibilityOf(trip.id);
    expect(feasibility.findings.map((f) => f.code)).not.toContain('stop_not_step_free');
    expect(feasibility.feasible).toBe(true);
  });

  test('one traveller’s needs never affect another’s report', async () => {
    await surveyPlace(1, { step_free_access: 'no' });
    await request(app)
      .put('/api/auth/profile')
      .set(asUser)
      .send({ name: 'Tom Traveller', requires_step_free: true })
      .expect(200);

    // A second identity with its own trip containing the same place.
    const asOther = { Authorization: authHeader({ uid: 'seed-other-uid' }) };
    const created = await request(app)
      .post('/api/auth/trips')
      .set(asOther)
      .send({ title: 'Someone else' })
      .expect(201);
    const workspace = await request(app)
      .get(`/api/auth/trips/${created.body.trip.id}`)
      .set(asOther)
      .expect(200);
    await request(app)
      .post(`/api/auth/trips/${created.body.trip.id}/days/${workspace.body.trip.days[0].id}/items`)
      .set(asOther)
      .send({ place_id: 1, title: 'The Fort', position: 0 })
      .expect(201);

    const other = (
      await request(app)
        .get(`/api/auth/trips/${created.body.trip.id}/feasibility`)
        .set(asOther)
        .expect(200)
    ).body.feasibility;

    expect(other.findings.map((f) => f.code)).not.toContain('stop_not_step_free');
    expect(other.feasible).toBe(true);
  });
});
