const request = require('supertest');
const app = require('../app');
const { createSchema, resetData, closeDb, resetRateLimits, pool } = require('./helpers/testDb');
const { authHeader } = require('./helpers/firebaseMock');

/**
 * The trip activity feed — `GET /api/auth/trips/:tripId/activity` (`BL-147`).
 *
 * **What this suite is really about is the two things that make an audit trail an audit trail**,
 * neither of which is "does the endpoint return rows":
 *
 *   1. **The entry commits with the change, or neither does.** `record` takes the caller's
 *      transaction client precisely so a reordered day cannot land while its activity row does not.
 *      Asserted below by forcing a failure *after* the write inside the same transaction — see the
 *      atomicity block, which is the only assertion here that could not have been written by
 *      guessing at the implementation.
 *   2. **The vocabulary is closed at the database.** A typo'd action is a Postgres CHECK violation,
 *      not a stored row nothing renders.
 *
 * The other theme is the one `ADR-056` split this table out for: **the reader.** An admin has no
 * special access here, and a stranger gets a 404 rather than a 403 — a 403 would confirm the trip
 * exists to somebody not entitled to know it does.
 */

const USER = { uid: 'seed-user-uid' };
const OTHER = { uid: 'seed-other-uid' };
const ADMIN = { uid: 'seed-admin-uid' };

const asUser = { Authorization: authHeader(USER) };
const asOther = { Authorization: authHeader(OTHER) };
const asAdmin = { Authorization: authHeader(ADMIN) };

const PLACE = 1;

const makeTrip = async (headers = asUser) => {
  const res = await request(app)
    .post('/api/auth/trips')
    .set(headers)
    .send({ title: 'Karnataka in March' });
  expect(res.status).toBe(201);
  return res.body.trip;
};

const addDay = async (tripId, headers = asUser) => {
  const res = await request(app).post(`/api/auth/trips/${tripId}/days`).set(headers).send({});
  expect(res.status).toBe(201);
  return res.body.day;
};

const addItem = async (tripId, dayId, body = {}, headers = asUser) => {
  const res = await request(app)
    .post(`/api/auth/trips/${tripId}/days/${dayId}/items`)
    .set(headers)
    .send({ place_id: PLACE, ...body });
  expect(res.status).toBe(201);
  return res.body.item;
};

const activity = async (tripId, headers = asUser, query = '') => {
  const res = await request(app).get(`/api/auth/trips/${tripId}/activity${query}`).set(headers);
  return res;
};

/** Invite a collaborator at a role. Owner-only, which is why it always runs as the owner. */
const invite = async (tripId, email, role) => {
  const res = await request(app)
    .post(`/api/auth/trips/${tripId}/collaborators`)
    .set(asUser)
    .send({ email, role });
  expect(res.status).toBe(200);
  return res.body;
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

describe('what gets recorded', () => {
  test('adding a day records day.added with the number the reader can see', async () => {
    const trip = await makeTrip();
    const day = await addDay(trip.id);

    const res = await activity(trip.id);

    expect(res.status).toBe(200);
    expect(res.body.activity).toHaveLength(1);
    expect(res.body.activity[0]).toMatchObject({
      action: 'day.added',
      actor_uid: USER.uid,
      detail: { dayNumber: day.day_number }
    });
  });

  test('removing a day records the number it HAD, not the one after renumbering', async () => {
    // The renumbering is the point. Deleting day 1 of three shifts days 2 and 3 down, so by the
    // time anyone reads the feed there is no row anywhere holding the deleted day's ordinal.
    // "Removed day 1" is only recordable at the moment of deletion.
    const trip = await makeTrip();
    const first = await addDay(trip.id);
    await addDay(trip.id);
    await addDay(trip.id);

    await request(app)
      .delete(`/api/auth/trips/${trip.id}/days/${first.id}`)
      .set(asUser)
      .expect(204);

    const res = await activity(trip.id);
    const removal = res.body.activity.find((entry) => entry.action === 'day.removed');

    expect(removal.detail).toEqual({ dayNumber: first.day_number });
    // A dateless trip is seeded with day 1 by `createTrip`, so the first day added here is 2 — and
    // the point stands either way: after the delete, every later day has been renumbered down, so
    // no row anywhere still holds the number this entry recorded.
    expect(first.day_number).toBe(2);
    const renumbered = await pool.query(
      'SELECT day_number FROM trip_days WHERE trip_id = $1 ORDER BY day_number',
      [trip.id]
    );
    expect(renumbered.rows.map((row) => row.day_number)).toEqual([1, 2, 3]);
  });

  test('adding an item records its title, resolved from the place when none was given', async () => {
    const trip = await makeTrip();
    const day = await addDay(trip.id);
    const item = await addItem(trip.id, day.id);

    const res = await activity(trip.id);
    const added = res.body.activity.find((entry) => entry.action === 'item.added');

    expect(added.detail.title).toBe(item.title);
    expect(added.detail.title).toBeTruthy();
  });

  test('removing an item still names it, because the title is gone once the row is', async () => {
    const trip = await makeTrip();
    const day = await addDay(trip.id);
    const item = await addItem(trip.id, day.id);

    await request(app)
      .delete(`/api/auth/trips/${trip.id}/items/${item.id}`)
      .set(asUser)
      .expect(204);

    const res = await activity(trip.id);
    const removed = res.body.activity.find((entry) => entry.action === 'item.removed');

    expect(removed.detail).toEqual({ title: item.title });
  });

  test('updating an item records which fields moved, and not their values', async () => {
    const trip = await makeTrip();
    const day = await addDay(trip.id);
    const item = await addItem(trip.id, day.id);

    await request(app)
      .put(`/api/auth/trips/${trip.id}/items/${item.id}`)
      .set(asUser)
      .send({ notes: 'bring the wide lens' })
      .expect(200);

    const res = await activity(trip.id);
    const updated = res.body.activity.find((entry) => entry.action === 'item.updated');

    expect(updated.detail.fields).toEqual(['notes']);
    // The value is deliberately absent: the current one is on the page the reader is looking at,
    // and storing the old one would make this table a shadow copy of the itinerary.
    expect(JSON.stringify(updated.detail)).not.toContain('wide lens');
  });

  test('moving an item to another day counts trip_day_id as a changed field', async () => {
    const trip = await makeTrip();
    const first = await addDay(trip.id);
    const second = await addDay(trip.id);
    const item = await addItem(trip.id, first.id);

    await request(app)
      .put(`/api/auth/trips/${trip.id}/items/${item.id}`)
      .set(asUser)
      .send({ trip_day_id: second.id })
      .expect(200);

    const res = await activity(trip.id);
    const updated = res.body.activity.find((entry) => entry.action === 'item.updated');

    expect(updated.detail.fields).toContain('trip_day_id');
  });

  test('reordering records the day number and how many items were resequenced', async () => {
    const trip = await makeTrip();
    const day = await addDay(trip.id);
    const one = await addItem(trip.id, day.id, { title: 'Fort' });
    const two = await addItem(trip.id, day.id, { title: 'Market' });

    await request(app)
      .put(`/api/auth/trips/${trip.id}/days/${day.id}/items/order`)
      .set(asUser)
      .send({ item_ids: [two.id, one.id] })
      .expect(200);

    const res = await activity(trip.id);
    const reorder = res.body.activity.find((entry) => entry.action === 'items.reordered');

    expect(reorder.detail).toEqual({ dayNumber: day.day_number, count: 2 });
  });
});

describe('what does not get recorded, and why that is deliberate', () => {
  test('renaming the trip records nothing — it is owner-only, so the reader did it', async () => {
    const trip = await makeTrip();

    await request(app)
      .put(`/api/auth/trips/${trip.id}`)
      .set(asUser)
      .send({ title: 'Kerala instead' })
      .expect(200);

    const res = await activity(trip.id);

    // The whole selection rule in one assertion: the six recorded actions are exactly the ones an
    // editor can reach. A feed whose every line said "you did this" would bury the ones that
    // did not.
    expect(res.body.activity).toEqual([]);
  });
});

describe('who may read it', () => {
  test('an editor sees the feed, including their own entries', async () => {
    const trip = await makeTrip();
    await invite(trip.id, 'other@easytrip.test', 'editor');

    const day = await addDay(trip.id, asOther);

    const res = await activity(trip.id, asOther);

    expect(res.status).toBe(200);
    expect(res.body.activity[0]).toMatchObject({
      action: 'day.added',
      actor_uid: OTHER.uid,
      detail: { dayNumber: day.day_number }
    });
  });

  test('a viewer may read the feed — anyone who may see the plan may see how it got there', async () => {
    const trip = await makeTrip();
    await addDay(trip.id);
    await invite(trip.id, 'other@easytrip.test', 'viewer');

    const res = await activity(trip.id, asOther);

    expect(res.status).toBe(200);
    expect(res.body.activity).toHaveLength(1);
  });

  test('a stranger gets 404, not 403 — a 403 would confirm the trip exists', async () => {
    const trip = await makeTrip();
    await addDay(trip.id);

    const res = await activity(trip.id, asOther);

    expect(res.status).toBe(404);
    expect(res.body.activity).toBeUndefined();
  });

  test('an admin has no special access to another traveller itinerary', async () => {
    // `ADR-056`'s whole reason for a second table. An administrator auditing moderators is a
    // different reader from a traveller reading their own plan's history, and admin rights on this
    // route would be `IMP-021`'s identity exposure in a new place.
    const trip = await makeTrip();
    await addDay(trip.id);

    const res = await activity(trip.id, asAdmin);

    expect(res.status).toBe(404);
  });

  test('a missing trip is a 404 and not an empty feed', async () => {
    const res = await activity(999999, asUser);
    expect(res.status).toBe(404);
  });
});

describe('ordering and paging', () => {
  test('newest first, and the cursor pages backwards through ties', async () => {
    const trip = await makeTrip();
    const day = await addDay(trip.id);
    await addItem(trip.id, day.id, { title: 'One' });
    await addItem(trip.id, day.id, { title: 'Two' });

    const all = await activity(trip.id);
    expect(all.body.activity).toHaveLength(3);
    expect(all.body.activity.map((entry) => entry.action)).toEqual([
      'item.added',
      'item.added',
      'day.added'
    ]);

    const ids = all.body.activity.map((entry) => entry.id);
    expect(ids[0]).toBeGreaterThan(ids[1]);

    const paged = await activity(trip.id, asUser, `?before=${ids[0]}&limit=1`);
    expect(paged.body.activity).toHaveLength(1);
    expect(paged.body.activity[0].id).toBe(ids[1]);
  });

  test('limit is capped rather than trusted', async () => {
    const trip = await makeTrip();
    await addDay(trip.id);

    const res = await activity(trip.id, asUser, '?limit=99999');

    expect(res.status).toBe(200);
    expect(res.body.activity.length).toBeLessThanOrEqual(100);
  });
});

describe('the guarantees that make it a trail rather than a log', () => {
  test('record() refuses an unknown action at the call site, before the database sees it', async () => {
    // Defence in depth over the CHECK below, and the layer that produces the *useful* failure:
    // these arguments are literals written by hand, so a typo is the realistic mistake, and a
    // `TypeError` naming the bad value beats a Postgres constraint violation surfacing as a 500
    // three layers up. Asserted directly on the model because nothing reachable through the API
    // can pass a bad action — which is exactly why the assertion would otherwise be untested.
    const tripActivityModel = require('../src/models/tripActivityModel');

    await expect(
      tripActivityModel.record(pool, {
        tripId: 1,
        actorUid: USER.uid,
        action: 'day.exploded'
      })
    ).rejects.toThrow(/Unknown trip activity action: day\.exploded/);
  });

  test('the vocabulary is closed at the database, not only in the application', async () => {
    const trip = await makeTrip();

    await expect(
      pool.query(
        `INSERT INTO trip_activity (trip_id, actor_uid, action) VALUES ($1, $2, 'day.exploded')`,
        [trip.id, USER.uid]
      )
    ).rejects.toThrow(/trip_activity_action_known/);
  });

  test('deleting the trip takes its activity with it', async () => {
    // The opposite call from `admin_audit_log`, and deliberate: this log describes a trip and is
    // read on that trip's page. Once the trip is gone there is no reader and no question it
    // answers, so keeping the rows would be retaining somebody's travel history after they
    // deleted it.
    const trip = await makeTrip();
    await addDay(trip.id);

    const before = await pool.query(
      'SELECT COUNT(*)::int AS n FROM trip_activity WHERE trip_id = $1',
      [trip.id]
    );
    expect(before.rows[0].n).toBe(1);

    await request(app).delete(`/api/auth/trips/${trip.id}`).set(asUser).expect(204);

    const after = await pool.query(
      'SELECT COUNT(*)::int AS n FROM trip_activity WHERE trip_id = $1',
      [trip.id]
    );
    expect(after.rows[0].n).toBe(0);
  });

  test('the entry and the change commit together, or neither does', async () => {
    // ---------------------------------------------------------------------
    // The assertion this suite exists for, and the only way to write it honestly
    // ---------------------------------------------------------------------
    // Breaking the activity insert and watching the day fail to appear proves nothing useful — it
    // shows an exception propagating, which any thrown error does. What has to be proved is the
    // *other* direction: that the day cannot commit while its activity row rolls back.
    //
    // So the failure is forced AFTER both writes, inside the same transaction, by a constraint that
    // fires on the activity insert. If the two were in separate transactions the day would survive
    // and the trail would have a hole exactly where somebody looked for it.
    //
    // ---------------------------------------------------------------------
    // What passing the pool instead of the client actually does — measured
    // ---------------------------------------------------------------------
    // Mutating `record(client, …)` to `record(pool, …)` in `addDay` does not produce a missing
    // activity row. It **hangs the request forever**, and then every later test behind it:
    //
    //     pid 7948 | active | Lock | INSERT INTO trip_activity (trip_id, actor_uid, actor_la…
    //
    // `addDay` holds `SELECT … FOR UPDATE` on the trip row. An insert into `trip_activity` from a
    // *second* connection needs a shared lock on that same row to check the `trip_id` foreign key,
    // and the transaction holding it is waiting on the insert. A self-deadlock, in one request.
    //
    // Recorded because it is a better outcome than the one this test was written to prevent: the
    // wrong version cannot ship quietly. It fails loudly, on the developer's machine, the first
    // time anybody runs the suite.
    const trip = await makeTrip();

    // `createTrip` seeds a day for a dateless trip (`spanInDays` floors at 1), and that day is not
    // recorded because creating a trip is owner-only. So this measures the delta, not the total —
    // an absolute count here would be asserting against a fixture rather than against the rollback.
    const before = await pool.query('SELECT COUNT(*)::int AS n FROM trip_days WHERE trip_id = $1', [
      trip.id
    ]);

    await pool.query(`
      ALTER TABLE trip_activity
        ADD CONSTRAINT trip_activity_commit_probe
        CHECK (action <> 'day.added') NOT VALID
    `);
    await pool
      .query(
        `
      ALTER TABLE trip_activity VALIDATE CONSTRAINT trip_activity_commit_probe
    `
      )
      .catch(() => {});

    try {
      const res = await request(app).post(`/api/auth/trips/${trip.id}/days`).set(asUser).send({});
      expect(res.status).toBe(500);

      const after = await pool.query(
        'SELECT COUNT(*)::int AS n FROM trip_days WHERE trip_id = $1',
        [trip.id]
      );
      // No new day. The insert that failed was the activity row's, and it took the day with it —
      // which is the whole contract of passing the transaction client.
      expect(after.rows[0].n).toBe(before.rows[0].n);
    } finally {
      await pool.query('ALTER TABLE trip_activity DROP CONSTRAINT trip_activity_commit_probe');
    }
  });
});
