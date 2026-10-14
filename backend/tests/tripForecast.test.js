const request = require('supertest');

// `mock`-prefixed so Jest's hoisted factory may close over it (see imageUpload.test.js). Assigning
// `global.fetch` here also replaces the network guard in `tests/setup/env.js`, which is the seam
// that guard documents: a suite that means to exercise a provider stubs it, and everything else is
// stopped from reaching one by accident.
const mockFetch = jest.fn();
global.fetch = (...args) => mockFetch(...args);

const app = require('../app');
const { createSchema, resetData, closeDb, resetRateLimits, pool } = require('./helpers/testDb');
const { authHeader } = require('./helpers/firebaseMock');
const weatherService = require('../src/services/weatherService');

/**
 * `FV-031` and `FV-027` stage (a) end to end — from `places.setting` to a warning in the report.
 *
 * **What this suite is for, and why it is separate from `feasibility.test.js`.** That file proves
 * the *rule*: given a day carrying a sunrise, which items are in the dark. It is a pure function
 * and it deserves pure tests. This file proves the *plumbing*, which is where the rule sat inert
 * for a sprint — the engine was correct and mutation-verified, and it never once fired in
 * production, because nothing put a sunrise on a day.
 *
 * So every assertion below goes through `GET /api/auth/trips/:id/feasibility`, against a trip built
 * through the real write path, and the only thing faked is Open-Meteo itself.
 *
 * **The one that matters most is day 2.** A trip's days are ordinals (`ADR-031`), so a day's
 * calendar date is `start_date + day_number - 1` — and an off-by-one there is invisible to every
 * other test, because it still returns *a* forecast for *a* day, and sunrise moves only a minute or
 * two per day, so the wrong day is usually still plausible. That test builds a forecast whose two
 * days disagree by 100 minutes and puts the identical item on both.
 */

const asUser = { Authorization: authHeader({ uid: 'seed-user-uid' }) };

// The seeded catalogue, by id. Coorg (2) is the row with no coordinates, used deliberately below.
const HAMPI = 1;
const COORG = 2;
const GOKARNA = 3;
// 105.7 km from Hampi, so a morning stop and an afternoon one are comfortably reachable. Gokarna is
// 250 km away and would trip `insufficient_travel_time` — a real finding, and noise in a fixture
// that is about rain.
const BADAMI = 4;

/**
 * An Open-Meteo payload carrying sunrise and sunset for named dates.
 *
 * `current` is present because `normalise` refuses a payload without it — this is the provider's
 * real shape rather than a convenient subset, and a fixture that skipped it would be exercising a
 * code path that cannot happen.
 */
const forecastOf = (days) => ({
  timezone: 'Asia/Kolkata',
  current: {
    time: '2026-03-01T09:00',
    temperature_2m: 27.4,
    weather_code: 2
  },
  daily: {
    time: days.map((d) => d.date),
    // 2 is "Partly cloudy" and dry; a day can override with a wet code (63 is rain).
    weather_code: days.map((d) => d.code ?? 2),
    temperature_2m_max: days.map(() => 31),
    temperature_2m_min: days.map(() => 19),
    precipitation_sum: days.map((d) => d.mm ?? 0),
    sunrise: days.map((d) => `${d.date}T${d.sunrise}`),
    sunset: days.map((d) => `${d.date}T${d.sunset}`)
  }
});

const respondWith = (payload) =>
  mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => payload });

/**
 * Classify a seeded place.
 *
 * Written straight to the column rather than through `PATCH /api/places/:id`: the write path's
 * validation of `setting` is already proved in `updatePlace.test.js`, and what this suite needs is
 * a fixture, not a second copy of that assertion.
 */
const classify = (placeId, setting) =>
  pool.query('UPDATE places SET setting = $1 WHERE id = $2', [setting, placeId]);

const makeTrip = async (dates) => {
  const created = await request(app)
    .post('/api/auth/trips')
    .set(asUser)
    .send({ title: 'Karnataka', ...dates })
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

const feasibilityOf = async (tripId) => {
  const res = await request(app)
    .get(`/api/auth/trips/${tripId}/feasibility`)
    .set(asUser)
    .expect(200);

  return res.body.feasibility;
};

const darknessFindings = (report) =>
  report.findings.filter((f) => f.code === 'outdoor_item_in_darkness');

const wetFindings = (report) => report.findings.filter((f) => f.code === 'outdoor_day_likely_wet');

beforeAll(async () => {
  await createSchema();
});
beforeEach(async () => {
  await resetData();
  resetRateLimits(app);
  mockFetch.mockReset();
  // The service caches on coordinates for fifteen minutes, so without this a later test would be
  // answered by an earlier test's forecast and never reach the stub at all.
  weatherService.clearCache();
});
afterAll(async () => {
  await closeDb();
});

describe('the rule reaches production', () => {
  test('an outdoor stop before sunrise becomes a warning in the report', async () => {
    await classify(HAMPI, 'outdoor');
    respondWith(forecastOf([{ date: '2026-03-01', sunrise: '06:42', sunset: '18:05' }]));

    const trip = await makeTrip({ start_date: '2026-03-01', end_date: '2026-03-01' });
    await addItem(trip.id, trip.days[0].id, {
      place_id: HAMPI,
      title: 'Sunrise at Matanga Hill',
      start_time: '06:00',
      end_time: '08:00',
      position: 0
    });

    const report = await feasibilityOf(trip.id);
    const [found] = darknessFindings(report);

    expect(found).toBeTruthy();
    expect(found.severity).toBe('warning');
    // A warning describes an awkward plan, not an impossible one.
    expect(report.feasible).toBe(true);
    expect(found.day_number).toBe(1);
    expect(found.sunrise).toBe('2026-03-01T06:42');
    expect(found.message).toMatch(/before sunrise at 06:42/);
    // Attribution travels with the finding: Open-Meteo is CC-BY, and a warning is the unit that
    // gets screenshotted (`EXTERNAL_APIS.md`).
    expect(found.source).toBe('Open-Meteo');
  });

  test('day 2 is judged against day 2, not day 1', async () => {
    // The forecast disagrees with itself by 100 minutes across the two days, so an off-by-one in
    // `start_date + day_number - 1` cannot produce this result in either direction.
    await classify(HAMPI, 'outdoor');
    respondWith(
      forecastOf([
        { date: '2026-03-01', sunrise: '05:00', sunset: '18:05' },
        { date: '2026-03-02', sunrise: '06:40', sunset: '18:06' }
      ])
    );

    const trip = await makeTrip({ start_date: '2026-03-01', end_date: '2026-03-02' });
    for (const day of trip.days) {
      await addItem(trip.id, day.id, {
        place_id: HAMPI,
        title: 'Boulders at first light',
        start_time: '06:00',
        end_time: '08:00',
        position: 0
      });
    }

    const found = darknessFindings(await feasibilityOf(trip.id));

    // 06:00 is after the 1st's sunrise and before the 2nd's, so exactly one day is dark — and it
    // is the second one.
    expect(found).toHaveLength(1);
    expect(found[0].day_number).toBe(2);
    expect(found[0].sunrise).toBe('2026-03-02T06:40');
  });

  test('an outdoor visit running past sunset is flagged on its end', async () => {
    await classify(HAMPI, 'outdoor');
    respondWith(forecastOf([{ date: '2026-03-01', sunrise: '06:42', sunset: '18:05' }]));

    const trip = await makeTrip({ start_date: '2026-03-01', end_date: '2026-03-01' });
    await addItem(trip.id, trip.days[0].id, {
      place_id: HAMPI,
      title: 'Sunset point',
      start_time: '17:00',
      end_time: '19:30',
      position: 0
    });

    const [found] = darknessFindings(await feasibilityOf(trip.id));

    expect(found).toBeTruthy();
    expect(found.message).toMatch(/after sunset at 18:05/);
  });
});

describe('what the wiring refuses to do', () => {
  test('a trip beyond the forecast horizon gets no reading, and so no finding', async () => {
    // Open-Meteo returns seven days from today. A trip further out matches no entry, so the check
    // has nothing to say — the only honest answer, and also a silent one. This test is what stops
    // that silence being mistaken for "we looked, and it was fine".
    await classify(HAMPI, 'outdoor');
    respondWith(forecastOf([{ date: '2026-03-01', sunrise: '06:42', sunset: '18:05' }]));

    const trip = await makeTrip({ start_date: '2027-09-14', end_date: '2027-09-14' });
    await addItem(trip.id, trip.days[0].id, {
      place_id: HAMPI,
      title: 'Long-range plan',
      start_time: '05:00',
      end_time: '06:00',
      position: 0
    });

    const report = await feasibilityOf(trip.id);

    expect(mockFetch).toHaveBeenCalled();
    // Neither rule speaks, because neither has a reading — not because the plan is fine.
    expect(darknessFindings(report)).toEqual([]);
    expect(wetFindings(report)).toEqual([]);
  });

  test('a day with nothing outdoor on it never asks the provider', async () => {
    // The catalogue is `unknown` until somebody classifies it, so this is the common case rather
    // than an edge one, and it has to cost zero requests.
    const trip = await makeTrip({ start_date: '2026-03-01', end_date: '2026-03-01' });
    await addItem(trip.id, trip.days[0].id, {
      place_id: HAMPI,
      title: 'Unclassified stop',
      start_time: '05:00',
      end_time: '06:00',
      position: 0
    });

    const report = await feasibilityOf(trip.id);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(darknessFindings(report)).toEqual([]);
  });

  test('an outdoor item with no time is still looked up, and still cannot be in the dark', async () => {
    // The gate widened for `FV-027`: rain does not need a clock. Daylight still does, so this asks
    // the provider and produces no *darkness* finding — the two rules read the same lookup and
    // disagree about it independently.
    await classify(HAMPI, 'outdoor');
    respondWith(forecastOf([{ date: '2026-03-01', sunrise: '06:42', sunset: '18:05' }]));

    const trip = await makeTrip({ start_date: '2026-03-01', end_date: '2026-03-01' });
    await addItem(trip.id, trip.days[0].id, {
      place_id: HAMPI,
      title: 'Sometime that day',
      position: 0
    });

    const report = await feasibilityOf(trip.id);

    expect(mockFetch).toHaveBeenCalled();
    expect(darknessFindings(report)).toEqual([]);
  });

  test('the provider going down leaves the rest of the report standing', async () => {
    // Every other check is arithmetic on the plan and needs no weather at all. An outage must cost
    // the daylight finding and nothing else — least of all a 500 on a report that is still useful.
    await classify(HAMPI, 'outdoor');
    mockFetch.mockRejectedValue(new Error('provider down'));

    const trip = await makeTrip({ start_date: '2026-03-01', end_date: '2026-03-01' });
    await addItem(trip.id, trip.days[0].id, {
      place_id: HAMPI,
      title: 'Hampi',
      start_time: '05:00',
      end_time: '06:00',
      position: 0
    });
    await addItem(trip.id, trip.days[0].id, {
      place_id: GOKARNA,
      title: 'Gokarna',
      start_time: '06:30',
      end_time: '09:00',
      position: 1
    });

    const report = await feasibilityOf(trip.id);

    expect(darknessFindings(report)).toEqual([]);
    // ~250 km in thirty minutes: the travel check still fires, so the outage cost exactly one
    // thing.
    expect(report.findings.map((f) => f.code)).toContain('insufficient_travel_time');
  });

  test('even the weather service breaking its own contract is survivable', async () => {
    // The test above proves `getWeather`'s promise never to throw — a rejected `fetch` is caught
    // inside it and becomes `null`. It therefore never reaches the guard in `attachForecast`, and
    // an untested guard is indistinguishable from a decorative one. This makes the service itself
    // throw, which is the only way to execute that path: a docstring saying "never throws" is not
    // a mechanism, and the cost of being wrong about it is a 500 on a report that needs no
    // weather.
    await classify(HAMPI, 'outdoor');
    const broken = jest
      .spyOn(weatherService, 'getWeather')
      .mockRejectedValue(new Error('contract broken'));

    const trip = await makeTrip({ start_date: '2026-03-01', end_date: '2026-03-01' });
    await addItem(trip.id, trip.days[0].id, {
      place_id: HAMPI,
      title: 'Hampi',
      start_time: '05:00',
      end_time: '06:00',
      position: 0
    });

    const report = await feasibilityOf(trip.id);

    expect(broken).toHaveBeenCalled();
    expect(darknessFindings(report)).toEqual([]);
    expect(report.feasible).toBe(true);
    broken.mockRestore();
  });
});

describe('which coordinates the day is judged against', () => {
  test('the day’s first stop supplies them, whatever its setting', async () => {
    // Deliberately not "the first outdoor stop": tying the choice to `setting` would mean that
    // re-classifying one place could change which forecast a different day was judged against, and
    // a finding has to be reproducible from the plan alone.
    await classify(HAMPI, 'outdoor');
    respondWith(forecastOf([{ date: '2026-03-01', sunrise: '06:42', sunset: '18:05' }]));

    const trip = await makeTrip({ start_date: '2026-03-01', end_date: '2026-03-01' });
    await addItem(trip.id, trip.days[0].id, {
      place_id: GOKARNA,
      title: 'Gokarna first',
      start_time: '05:00',
      end_time: '05:30',
      position: 0
    });
    await addItem(trip.id, trip.days[0].id, {
      place_id: HAMPI,
      title: 'Hampi after',
      start_time: '06:00',
      end_time: '08:00',
      position: 1
    });

    await feasibilityOf(trip.id);

    const [url] = mockFetch.mock.calls[0];
    // Gokarna's coordinates, not Hampi's.
    expect(url).toContain('latitude=14.5500');
    expect(url).toContain('longitude=74.3200');
  });

  test('a day whose stops have no coordinates is not looked up', async () => {
    // Coorg is the seeded row with `latitude: null`. There is nothing to ask about.
    await classify(COORG, 'outdoor');

    const trip = await makeTrip({ start_date: '2026-03-01', end_date: '2026-03-01' });
    await addItem(trip.id, trip.days[0].id, {
      place_id: COORG,
      title: 'Coorg',
      start_time: '05:00',
      end_time: '06:00',
      position: 0
    });

    await feasibilityOf(trip.id);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('FV-027 stage (a) — an outdoor day the forecast says will be wet', () => {
  const RAIN = { code: 63, mm: 12.4 };

  test('a wet day with outdoor stops is warned about once, not once per stop', async () => {
    // Three soaked stops on one day are one problem with one answer. Three warnings saying the
    // same thing is how a panel teaches people to skim it.
    await classify(HAMPI, 'outdoor');
    await classify(BADAMI, 'outdoor');
    respondWith(forecastOf([{ date: '2026-03-01', sunrise: '06:42', sunset: '18:05', ...RAIN }]));

    const trip = await makeTrip({ start_date: '2026-03-01', end_date: '2026-03-01' });
    await addItem(trip.id, trip.days[0].id, {
      place_id: HAMPI,
      title: 'Boulders',
      start_time: '09:00',
      end_time: '11:00',
      position: 0
    });
    await addItem(trip.id, trip.days[0].id, {
      place_id: BADAMI,
      title: 'Cave temples',
      start_time: '15:00',
      end_time: '17:00',
      position: 1
    });

    const report = await feasibilityOf(trip.id);
    const found = wetFindings(report);

    expect(found).toHaveLength(1);
    expect(found[0].item_ids).toHaveLength(2);
    expect(found[0].condition).toBe('Rain');
    expect(found[0].precipitation_mm).toBe(12.4);
    expect(found[0].message).toMatch(/2 stops are outdoors/);
    // Rain is a reason to rethink a day, not a reason it cannot happen.
    expect(found[0].severity).toBe('warning');
    expect(report.feasible).toBe(true);
    expect(found[0].source).toBe('Open-Meteo');
  });

  test('a dry day says nothing at all', async () => {
    await classify(HAMPI, 'outdoor');
    respondWith(forecastOf([{ date: '2026-03-01', sunrise: '06:42', sunset: '18:05' }]));

    const trip = await makeTrip({ start_date: '2026-03-01', end_date: '2026-03-01' });
    await addItem(trip.id, trip.days[0].id, {
      place_id: HAMPI,
      title: 'Boulders',
      start_time: '09:00',
      end_time: '11:00',
      position: 0
    });

    expect(wetFindings(await feasibilityOf(trip.id))).toEqual([]);
  });

  test('only the outdoor stops are named, though the whole day is wet', async () => {
    // The rain falls on the museum too. It is not evidence of a problem there, and listing it
    // would make the finding's own item list untrustworthy.
    await classify(HAMPI, 'outdoor');
    await classify(BADAMI, 'indoor');
    respondWith(forecastOf([{ date: '2026-03-01', sunrise: '06:42', sunset: '18:05', ...RAIN }]));

    const trip = await makeTrip({ start_date: '2026-03-01', end_date: '2026-03-01' });
    const outdoor = await addItem(trip.id, trip.days[0].id, {
      place_id: HAMPI,
      title: 'Boulders',
      start_time: '09:00',
      end_time: '11:00',
      position: 0
    });
    await addItem(trip.id, trip.days[0].id, {
      place_id: BADAMI,
      title: 'Museum',
      start_time: '15:00',
      end_time: '17:00',
      position: 1
    });

    const [found] = wetFindings(await feasibilityOf(trip.id));

    expect(found.item_ids).toEqual([outdoor.body.item.id]);
    expect(found.message).toMatch(/one stop is outdoors/);
  });

  test('rain does not need a clock', async () => {
    // The difference from `FV-031` that decided the lookup gate. An untimed outdoor stop cannot be
    // in the dark — there is no hour to compare — but it is still outdoors in the rain, and most
    // of a half-built plan is untimed.
    await classify(HAMPI, 'outdoor');
    respondWith(forecastOf([{ date: '2026-03-01', sunrise: '06:42', sunset: '18:05', ...RAIN }]));

    const trip = await makeTrip({ start_date: '2026-03-01', end_date: '2026-03-01' });
    await addItem(trip.id, trip.days[0].id, {
      place_id: HAMPI,
      title: 'Boulders, sometime',
      position: 0
    });

    const report = await feasibilityOf(trip.id);

    expect(wetFindings(report)).toHaveLength(1);
    expect(darknessFindings(report)).toEqual([]);
  });
});
