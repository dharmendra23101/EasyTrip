const request = require('supertest');
const app = require('../app');
const { createSchema, resetData, closeDb, resetRateLimits, pool } = require('./helpers/testDb');
const { authHeader } = require('./helpers/firebaseMock');

/**
 * Duplicating a trip (`FV-006` stage d, `PI-026`).
 *
 * **The copying is not the feature; deciding what does *not* copy is.** A naive "copy everything"
 * produces a document that is confidently wrong in four separate ways, so most of this suite asserts
 * absence:
 *
 *   - **Dates** are dropped — a duplicate is for a different time, and carrying them means the copy
 *     claims to happen on days that have already passed.
 *   - **The share token** is never copied. Two trips cannot hold one token, but the real reason is
 *     consent: the owner circulated a link to *that* trip.
 *   - **Notes** are not copied. A dated observation moved into a new trip is not stale, it is false.
 *   - **The checklist** *is* copied, with every box unticked. The labels are the reusable part; the
 *     ticks are about one journey.
 *
 * The rest is atomicity: a partially copied trip is worse than a failed copy, because it looks like
 * a trip.
 */

const USER = { uid: 'seed-user-uid' };
const OTHER = { uid: 'seed-other-uid' };
const asUser = { Authorization: authHeader(USER) };
const asOther = { Authorization: authHeader(OTHER) };

const PLACE = 1;

const makeTrip = async (headers = asUser, body = {}) => {
  const res = await request(app)
    .post('/api/auth/trips')
    .set(headers)
    .send({
      title: 'Karnataka in March',
      start_date: '2026-03-01',
      end_date: '2026-03-03',
      ...body
    });
  expect(res.status).toBe(201);
  return res.body.trip;
};

const workspace = async (tripId, headers = asUser) => {
  const res = await request(app).get(`/api/auth/trips/${tripId}`).set(headers);
  expect(res.status).toBe(200);
  return res.body.trip;
};

const duplicate = (tripId, body = {}, headers = asUser) =>
  request(app).post(`/api/auth/trips/${tripId}/duplicate`).set(headers).send(body);

/** A trip with something on every axis, so a test can check exactly one of them at a time. */
const makeFullTrip = async () => {
  const trip = await makeTrip();
  const loaded = await workspace(trip.id);

  await request(app)
    .post(`/api/auth/trips/${trip.id}/days/${loaded.days[0].id}/items`)
    .set(asUser)
    .send({ place_id: PLACE, title: 'Hampi at dawn', start_time: '06:30', notes: 'North gate' });
  await request(app)
    .post(`/api/auth/trips/${trip.id}/days/${loaded.days[1].id}/items`)
    .set(asUser)
    .send({ title: 'Lunch' });

  await request(app)
    .post(`/api/auth/trips/${trip.id}/notes`)
    .set(asUser)
    .send({ body: 'Hotel confirmed on the 14th' });

  const packed = await request(app)
    .post(`/api/auth/trips/${trip.id}/checklist`)
    .set(asUser)
    .send({ label: 'Passport' });
  await request(app)
    .patch(`/api/auth/trips/${trip.id}/checklist/${packed.body.item.id}`)
    .set(asUser)
    .send({ is_done: true });
  await request(app)
    .post(`/api/auth/trips/${trip.id}/checklist`)
    .set(asUser)
    .send({ label: 'Charger' });

  await request(app).post(`/api/auth/trips/${trip.id}/share`).set(asUser);

  return trip;
};

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

// ---------------------------------------------------------------------------
// What carries over
// ---------------------------------------------------------------------------
describe('the plan is what gets duplicated', () => {
  test('the days and their stops come across, in order and intact', async () => {
    const trip = await makeFullTrip();

    const copy = await duplicate(trip.id);
    expect(copy.status).toBe(201);

    const copied = await workspace(copy.body.trip.id);
    const original = await workspace(trip.id);

    expect(copied.days).toHaveLength(original.days.length);
    expect(copied.days[0].items[0]).toMatchObject({
      title: 'Hampi at dawn',
      start_time: '06:30:00',
      notes: 'North gate',
      place_id: PLACE
    });
    expect(copied.days[1].items[0]).toMatchObject({ title: 'Lunch' });
  });

  test('a stop lands on the same day number it was on', async () => {
    // The join that makes this work is on `day_number`, which is unique per trip. If it were not,
    // the copy would multiply every item by the number of days sharing a number.
    const trip = await makeFullTrip();

    const copy = await duplicate(trip.id);
    const copied = await workspace(copy.body.trip.id);

    expect(copied.days.map((day) => day.items.map((item) => item.title))).toEqual([
      ['Hampi at dawn'],
      ['Lunch'],
      []
    ]);
  });

  test('the description comes across', async () => {
    const trip = await makeTrip(asUser, { description: 'Temples, then the coast.' });

    const copy = await duplicate(trip.id);

    expect(copy.body.trip.description).toBe('Temples, then the coast.');
  });

  test('it is titled so the two can be told apart in a list', async () => {
    const trip = await makeTrip();
    const copy = await duplicate(trip.id);
    expect(copy.body.trip.title).toBe('Copy of Karnataka in March');
  });

  test('a supplied title is used instead', async () => {
    const trip = await makeTrip();
    const copy = await duplicate(trip.id, { title: 'Karnataka in November' });
    expect(copy.body.trip.title).toBe('Karnataka in November');
  });

  test('a long title is truncated rather than failing the insert', async () => {
    // `trips.title` is VARCHAR(200), so "Copy of " + 200 characters is 208 and the insert would fail
    // on a trip whose only fault is a long name.
    const trip = await makeTrip(asUser, { title: 'x'.repeat(200) });

    const copy = await duplicate(trip.id);

    expect(copy.status).toBe(201);
    expect(copy.body.trip.title).toHaveLength(200);
    expect(copy.body.trip.title.startsWith('Copy of ')).toBe(true);
  });

  test('a blank supplied title is a 400, as it is when creating a trip', async () => {
    const trip = await makeTrip();
    expect((await duplicate(trip.id, { title: '   ' })).status).toBe(400);
    expect((await duplicate(trip.id, { title: 'x'.repeat(201) })).status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// What deliberately does not
// ---------------------------------------------------------------------------
describe('what a copy does not inherit', () => {
  test('the dates are dropped, because a copy is for a different time', async () => {
    // Carrying them means the copy claims to happen on days that have already passed, and the
    // workspace would render every day with a date the traveller never chose.
    const trip = await makeFullTrip();

    const copy = await duplicate(trip.id);

    expect(copy.body.trip.start_date).toBeNull();
    expect(copy.body.trip.end_date).toBeNull();
    // The *shape* survives — `day_number` is an ordinal, not a date.
    const copied = await workspace(copy.body.trip.id);
    expect(copied.days.map((day) => day.day_number)).toEqual([1, 2, 3]);
  });

  test('the share link is never copied', async () => {
    // Two trips cannot hold one token, but the reason that matters is consent: the owner circulated
    // a link to *that* trip, and a copy inheriting it would silently extend an audience they chose
    // for something else.
    const trip = await makeFullTrip();
    const originalToken = (await request(app).get(`/api/auth/trips/${trip.id}/share`).set(asUser))
      .body.share_token;
    expect(originalToken).toBeTruthy();

    const copy = await duplicate(trip.id);

    const copyShare = await request(app)
      .get(`/api/auth/trips/${copy.body.trip.id}/share`)
      .set(asUser);
    expect(copyShare.body.shared).toBe(false);
    expect(copyShare.body.share_token).toBeNull();

    // And the original's link still works and still points at the original.
    const shared = await request(app).get(`/api/trips/shared/${originalToken}`);
    expect(shared.body.trip.id).toBe(trip.id);
  });

  test('the notes are not copied, because a dated observation would become false', async () => {
    // "Hotel confirmed on the 14th" copied into a November trip asserts something that did not
    // happen. Not stale — false.
    const trip = await makeFullTrip();

    const copy = await duplicate(trip.id);

    const notes = await request(app).get(`/api/auth/trips/${copy.body.trip.id}/notes`).set(asUser);
    expect(notes.body.notes).toEqual([]);
    // The original still has its own.
    const originalNotes = await request(app).get(`/api/auth/trips/${trip.id}/notes`).set(asUser);
    expect(originalNotes.body.notes).toHaveLength(1);
  });

  test('a day note and a stop note DO come across, because they are part of the plan', async () => {
    /**
     * The other half of "notes are not copied", which is otherwise ambiguous across three tables.
     * `trip_notes` is a dated observation and is excluded. `trip_days.notes` and `trip_items.notes`
     * describe the shape of the itinerary - *"travel day, leave early"*, *"meet at the north gate"* -
     * and copy with it.
     */
    const trip = await makeFullTrip();
    const loaded = await workspace(trip.id);
    await pool.query('UPDATE trip_days SET notes = $1 WHERE id = $2', [
      'Travel day, leave early',
      loaded.days[0].id
    ]);

    const copy = await duplicate(trip.id);
    const copied = await workspace(copy.body.trip.id);

    expect(copied.days[0].notes).toBe('Travel day, leave early');
    expect(copied.days[0].items[0].notes).toBe('North gate');
  });

  test('a completed trip copies as a draft', async () => {
    const trip = await makeTrip();
    await request(app).put(`/api/auth/trips/${trip.id}`).set(asUser).send({ status: 'completed' });

    const copy = await duplicate(trip.id);

    expect(copy.body.trip.status).toBe('draft');
  });
});

// ---------------------------------------------------------------------------
// The checklist — the one thing that is copied on purpose
// ---------------------------------------------------------------------------
describe('the checklist is the reusable part, which is why "templates" is in the name', () => {
  test('the labels come across, in order', async () => {
    const trip = await makeFullTrip();

    const copy = await duplicate(trip.id);

    const checklist = await request(app)
      .get(`/api/auth/trips/${copy.body.trip.id}/checklist`)
      .set(asUser);
    expect(checklist.body.items.map((item) => item.label)).toEqual(['Passport', 'Charger']);
  });

  test('every box starts unticked, however the original stood', async () => {
    // The asymmetry that makes this a template rather than a photocopy: a copy claiming you have
    // already packed is worse than no list.
    const trip = await makeFullTrip();

    const copy = await duplicate(trip.id);

    const checklist = await request(app)
      .get(`/api/auth/trips/${copy.body.trip.id}/checklist`)
      .set(asUser);
    expect(checklist.body.items.map((item) => item.is_done)).toEqual([false, false]);

    // The original's tick is untouched.
    const original = await request(app).get(`/api/auth/trips/${trip.id}/checklist`).set(asUser);
    expect(original.body.items[0].is_done).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Ownership and atomicity
// ---------------------------------------------------------------------------
describe('only your own trips, and all of it or none of it', () => {
  test('another user cannot duplicate your trip, and is told it does not exist', async () => {
    const trip = await makeFullTrip();

    const res = await duplicate(trip.id, {}, asOther);

    expect(res.status).toBe(404);
    const theirs = await request(app).get('/api/auth/trips').set(asOther);
    expect(theirs.body.trips).toHaveLength(0);
  });

  test('a trip that does not exist is a 404', async () => {
    expect((await duplicate(999999)).status).toBe(404);
  });

  test('it requires a token', async () => {
    const trip = await makeTrip();
    const res = await request(app).post(`/api/auth/trips/${trip.id}/duplicate`).send({});
    expect(res.status).toBe(401);
  });

  test('the copy belongs to the caller, and the original is untouched', async () => {
    const trip = await makeFullTrip();

    const copy = await duplicate(trip.id);

    const owner = await pool.query('SELECT user_id FROM trips WHERE id = $1', [copy.body.trip.id]);
    expect(owner.rows[0].user_id).toBe(USER.uid);

    const original = await workspace(trip.id);
    expect(original.title).toBe('Karnataka in March');
    expect(original.start_date).toBe('2026-03-01');
    expect(original.days[0].items).toHaveLength(1);
  });

  test('duplicating twice gives two independent trips', async () => {
    // Editing a copy must not reach back into the original or into the other copy.
    const trip = await makeFullTrip();

    const first = await duplicate(trip.id);
    const second = await duplicate(trip.id);
    expect(first.body.trip.id).not.toBe(second.body.trip.id);

    const firstWorkspace = await workspace(first.body.trip.id);
    await request(app)
      .delete(`/api/auth/trips/${first.body.trip.id}/items/${firstWorkspace.days[0].items[0].id}`)
      .set(asUser);

    const secondWorkspace = await workspace(second.body.trip.id);
    expect(secondWorkspace.days[0].items).toHaveLength(1);
    const original = await workspace(trip.id);
    expect(original.days[0].items).toHaveLength(1);
  });

  test('an empty trip copies as an empty trip rather than failing', async () => {
    // A dateless trip gets one day and no items; the item and checklist inserts both select zero
    // rows, which must be a copy and not an error.
    const trip = await makeTrip(asUser, { start_date: null, end_date: null });

    const copy = await duplicate(trip.id);

    expect(copy.status).toBe(201);
    const copied = await workspace(copy.body.trip.id);
    expect(copied.days).toHaveLength(1);
    expect(copied.days[0].items).toEqual([]);
  });

  test('a failure part-way through leaves no trip behind at all', async () => {
    /**
     * The second half of this block's title, which nothing was testing — mutation `D10` replaced the
     * `ROLLBACK` in the catch with a `COMMIT` and survived every other assertion, because no test
     * ever made a statement fail mid-transaction.
     *
     * So one is made to fail, in the database, *after* the trip row has been inserted: a trigger that
     * refuses every `trip_items` insert. A half-copied trip is worse than a failed copy precisely
     * because it looks like a trip — it would appear in the list with its days and no stops.
     */
    const trip = await makeFullTrip();
    const before = await pool.query('SELECT count(*)::int AS n FROM trips WHERE user_id = $1', [
      USER.uid
    ]);

    await pool.query(
      `CREATE OR REPLACE FUNCTION tmp_refuse_items() RETURNS TRIGGER AS $$
       BEGIN RAISE EXCEPTION 'refused, for the rollback test'; END; $$ LANGUAGE plpgsql`
    );
    await pool.query(
      'CREATE TRIGGER tmp_refuse_items BEFORE INSERT ON trip_items FOR EACH ROW EXECUTE FUNCTION tmp_refuse_items()'
    );

    try {
      const res = await duplicate(trip.id);
      expect(res.status).toBe(500);

      const after = await pool.query('SELECT count(*)::int AS n FROM trips WHERE user_id = $1', [
        USER.uid
      ]);
      // Not one more. The trip row, its days and its checklist all go back.
      expect(after.rows[0].n).toBe(before.rows[0].n);
    } finally {
      // In a `finally`, or a failure here breaks every test that runs after it in this file.
      await pool.query('DROP TRIGGER IF EXISTS tmp_refuse_items ON trip_items');
      await pool.query('DROP FUNCTION IF EXISTS tmp_refuse_items()');
    }
  });

  test('deleting the original leaves the copy alone', async () => {
    // Nothing links them: the copy is a trip, not a reference to one.
    const trip = await makeFullTrip();
    const copy = await duplicate(trip.id);

    await request(app).delete(`/api/auth/trips/${trip.id}`).set(asUser);

    const copied = await workspace(copy.body.trip.id);
    expect(copied.days[0].items[0].title).toBe('Hampi at dawn');
  });
});
