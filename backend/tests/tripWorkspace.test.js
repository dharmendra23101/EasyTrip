const request = require('supertest');
const app = require('../app');
const { createSchema, resetData, closeDb, resetRateLimits, pool } = require('./helpers/testDb');
const { authHeader } = require('./helpers/firebaseMock');

/**
 * A trip's notes and checklist — `/api/auth/trips/:tripId/{notes,checklist}` (`FV-006` stage b).
 *
 * **The CRUD is not what is worth testing here.** These are two ordinary child collections; what
 * makes them worth a suite of their own is that, like `trip_days` and `trip_items`, **they carry no
 * uid at all**. They are owned *transitively*, through a join up to `trips`. Thirteen new endpoints
 * each have to make that join, and forgetting it in exactly one of them is the realistic failure —
 * so for every operation there is an assertion that a second user cannot perform it.
 *
 * The second theme is the 404-never-403 rule `tripController` established. Somebody else's note must
 * answer exactly as a note that does not exist: a 403 confirms the id is real, which turns
 * sequential ids into an enumeration oracle. Several tests below assert the *status code itself*
 * rather than merely "the request failed", because "failed" is satisfied by the leak.
 */

const USER = { uid: 'seed-user-uid' };
const OTHER = { uid: 'seed-other-uid' };

const asUser = { Authorization: authHeader(USER) };
const asOther = { Authorization: authHeader(OTHER) };

const makeTrip = async (headers = asUser) => {
  const res = await request(app)
    .post('/api/auth/trips')
    .set(headers)
    .send({ title: 'Karnataka in March' });
  expect(res.status).toBe(201);
  return res.body.trip;
};

const addNote = (trip, body, headers = asUser) =>
  request(app).post(`/api/auth/trips/${trip.id}/notes`).set(headers).send({ body });

const addItem = (trip, label, headers = asUser) =>
  request(app).post(`/api/auth/trips/${trip.id}/checklist`).set(headers).send({ label });

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
// The boundary — a child row with no uid of its own
// ---------------------------------------------------------------------------
describe('a note belongs to a trip, and a trip belongs to one person', () => {
  test('another user cannot read the notes on your trip, and is told it does not exist', async () => {
    const trip = await makeTrip();
    await addNote(trip, 'Booked the hotel');

    const res = await request(app).get(`/api/auth/trips/${trip.id}/notes`).set(asOther);

    // 404 and not 403. A 403 would confirm the trip id is real.
    expect(res.status).toBe(404);
    expect(res.body.notes).toBeUndefined();
  });

  test('another user cannot write a note onto your trip', async () => {
    const trip = await makeTrip();

    const res = await addNote(trip, 'I was here', asOther);

    expect(res.status).toBe(404);
    // The write must not have happened, which the status alone does not prove.
    const rows = await pool.query('SELECT count(*)::int AS n FROM trip_notes WHERE trip_id = $1', [
      trip.id
    ]);
    expect(rows.rows[0].n).toBe(0);
  });

  test('another user cannot edit or delete your note', async () => {
    const trip = await makeTrip();
    const created = await addNote(trip, 'Booked the hotel');
    const noteId = created.body.note.id;

    const edit = await request(app)
      .put(`/api/auth/trips/${trip.id}/notes/${noteId}`)
      .set(asOther)
      .send({ body: 'Rewritten by somebody else' });
    const remove = await request(app)
      .delete(`/api/auth/trips/${trip.id}/notes/${noteId}`)
      .set(asOther);

    expect(edit.status).toBe(404);
    expect(remove.status).toBe(404);

    // The note is untouched — asserted from the database, not from the API that just refused.
    const row = await pool.query('SELECT body FROM trip_notes WHERE id = $1', [noteId]);
    expect(row.rows[0].body).toBe('Booked the hotel');
  });

  test('a note id from another trip cannot be reached through your own trip', async () => {
    // The attack the `(id, trip_id)` pair exists to stop: prove ownership of *a* trip, then address
    // a child row by an id that belongs to a different one.
    const mine = await makeTrip();
    const theirs = await makeTrip(asOther);
    const theirNote = await addNote(theirs, 'Their private note', asOther);

    const res = await request(app)
      .put(`/api/auth/trips/${mine.id}/notes/${theirNote.body.note.id}`)
      .set(asUser)
      .send({ body: 'Overwritten' });

    expect(res.status).toBe(404);
    const row = await pool.query('SELECT body FROM trip_notes WHERE id = $1', [
      theirNote.body.note.id
    ]);
    expect(row.rows[0].body).toBe('Their private note');
  });

  test('the same holds for every checklist write', async () => {
    const mine = await makeTrip();
    const theirs = await makeTrip(asOther);
    const theirItem = await addItem(theirs, 'Pack the charger', asOther);
    const itemId = theirItem.body.item.id;

    const patch = await request(app)
      .patch(`/api/auth/trips/${mine.id}/checklist/${itemId}`)
      .set(asUser)
      .send({ is_done: true });
    const remove = await request(app)
      .delete(`/api/auth/trips/${mine.id}/checklist/${itemId}`)
      .set(asUser);
    const reorder = await request(app)
      .put(`/api/auth/trips/${mine.id}/checklist/order`)
      .set(asUser)
      .send({ item_ids: [itemId] });

    expect(patch.status).toBe(404);
    expect(remove.status).toBe(404);
    expect(reorder.status).toBe(404);

    const row = await pool.query('SELECT label, is_done FROM trip_checklist_items WHERE id = $1', [
      itemId
    ]);
    expect(row.rows[0]).toEqual({ label: 'Pack the charger', is_done: false });
  });

  test('every endpoint requires a token', async () => {
    const trip = await makeTrip();

    const responses = await Promise.all([
      request(app).get(`/api/auth/trips/${trip.id}/notes`),
      request(app).post(`/api/auth/trips/${trip.id}/notes`).send({ body: 'x' }),
      request(app).put(`/api/auth/trips/${trip.id}/notes/1`).send({ body: 'x' }),
      request(app).delete(`/api/auth/trips/${trip.id}/notes/1`),
      request(app).get(`/api/auth/trips/${trip.id}/checklist`),
      request(app).post(`/api/auth/trips/${trip.id}/checklist`).send({ label: 'x' }),
      request(app).patch(`/api/auth/trips/${trip.id}/checklist/1`).send({ is_done: true }),
      request(app).delete(`/api/auth/trips/${trip.id}/checklist/1`),
      request(app).put(`/api/auth/trips/${trip.id}/checklist/order`).send({ item_ids: [] })
    ]);

    responses.forEach((res) => expect(res.status).toBe(401));
  });
});

// ---------------------------------------------------------------------------
// "No notes" and "no such trip" are different answers
// ---------------------------------------------------------------------------
describe('an unknown trip is not an empty trip', () => {
  test('a trip with no notes returns an empty list', async () => {
    const trip = await makeTrip();

    const res = await request(app).get(`/api/auth/trips/${trip.id}/notes`).set(asUser);

    expect(res.status).toBe(200);
    expect(res.body.notes).toEqual([]);
  });

  test('a trip that does not exist is a 404, not an empty list', async () => {
    // The distinction the handler checks ownership *first* to preserve. An empty list would tell a
    // caller the trip exists and is simply bare.
    const notes = await request(app).get('/api/auth/trips/999999/notes').set(asUser);
    const checklist = await request(app).get('/api/auth/trips/999999/checklist').set(asUser);

    expect(notes.status).toBe(404);
    expect(checklist.status).toBe(404);
  });

  test('a trip id that is not a number is a 400', async () => {
    const res = await request(app).get('/api/auth/trips/not-a-number/notes').set(asUser);
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------
describe('notes', () => {
  test('a note is created, read back, edited and deleted', async () => {
    const trip = await makeTrip();

    const created = await addNote(trip, 'Booked the hotel');
    expect(created.status).toBe(201);
    expect(created.body.note.body).toBe('Booked the hotel');

    const edited = await request(app)
      .put(`/api/auth/trips/${trip.id}/notes/${created.body.note.id}`)
      .set(asUser)
      .send({ body: 'Booked the hotel, room 3' });
    expect(edited.body.note.body).toBe('Booked the hotel, room 3');

    const removed = await request(app)
      .delete(`/api/auth/trips/${trip.id}/notes/${created.body.note.id}`)
      .set(asUser);
    expect(removed.status).toBe(204);

    const after = await request(app).get(`/api/auth/trips/${trip.id}/notes`).set(asUser);
    expect(after.body.notes).toEqual([]);
  });

  test('newest first, with the id breaking a tie', async () => {
    // Two notes written in the same millisecond must still have a total order, or the same
    // unchanged data can come back in a different order on the next read.
    const trip = await makeTrip();
    await pool.query(
      `INSERT INTO trip_notes (trip_id, body, created_at)
       VALUES ($1, 'first', '2026-01-01T10:00:00Z'),
              ($1, 'same-time A', '2026-01-02T10:00:00Z'),
              ($1, 'same-time B', '2026-01-02T10:00:00Z')`,
      [trip.id]
    );

    const res = await request(app).get(`/api/auth/trips/${trip.id}/notes`).set(asUser);

    expect(res.body.notes.map((note) => note.body)).toEqual([
      'same-time B',
      'same-time A',
      'first'
    ]);
  });

  test('a blank note is a 400, not a 500 from the CHECK constraint', async () => {
    // The column refuses whitespace too, but it would refuse it with a driver error. The validator
    // is what makes it a 400 that names the field.
    const trip = await makeTrip();

    const blank = await addNote(trip, '   ');
    const empty = await addNote(trip, '');
    const missing = await request(app)
      .post(`/api/auth/trips/${trip.id}/notes`)
      .set(asUser)
      .send({});

    expect(blank.status).toBe(400);
    expect(empty.status).toBe(400);
    expect(missing.status).toBe(400);
  });

  test('a note is trimmed before it is stored', async () => {
    const trip = await makeTrip();

    const created = await addNote(trip, '  Booked the hotel  ');

    expect(created.body.note.body).toBe('Booked the hotel');
  });

  test('an oversized note is refused', async () => {
    const trip = await makeTrip();
    const res = await addNote(trip, 'x'.repeat(5001));
    expect(res.status).toBe(400);
  });

  test('deleting the trip deletes its notes', async () => {
    // ON DELETE CASCADE, unlike `trip_items.place_id`'s SET NULL. A note has no life outside its
    // trip; an itinerary line survives losing its place because it still has a title of its own.
    const trip = await makeTrip();
    await addNote(trip, 'Booked the hotel');

    await request(app).delete(`/api/auth/trips/${trip.id}`).set(asUser);

    const rows = await pool.query('SELECT count(*)::int AS n FROM trip_notes WHERE trip_id = $1', [
      trip.id
    ]);
    expect(rows.rows[0].n).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Checklist
// ---------------------------------------------------------------------------
describe('checklist', () => {
  test('items append in the order they were added', async () => {
    const trip = await makeTrip();
    await addItem(trip, 'Passport');
    await addItem(trip, 'Charger');
    await addItem(trip, 'Tickets');

    const res = await request(app).get(`/api/auth/trips/${trip.id}/checklist`).set(asUser);

    expect(res.body.items.map((item) => item.label)).toEqual(['Passport', 'Charger', 'Tickets']);
    expect(res.body.items.map((item) => item.position)).toEqual([0, 1, 2]);
  });

  test('a new item starts undone', async () => {
    const trip = await makeTrip();
    const created = await addItem(trip, 'Passport');
    expect(created.body.item.is_done).toBe(false);
  });

  test('ticking a box does not blank the label beside it', async () => {
    // The reason this is PATCH and the model builds its SET from what actually arrived. A PUT that
    // defaulted the missing label to null would empty it on every tick.
    const trip = await makeTrip();
    const created = await addItem(trip, 'Passport');

    const res = await request(app)
      .patch(`/api/auth/trips/${trip.id}/checklist/${created.body.item.id}`)
      .set(asUser)
      .send({ is_done: true });

    expect(res.status).toBe(200);
    expect(res.body.item).toMatchObject({ label: 'Passport', is_done: true });
  });

  test('a label can be renamed without touching the tick', async () => {
    const trip = await makeTrip();
    const created = await addItem(trip, 'Passport');
    await request(app)
      .patch(`/api/auth/trips/${trip.id}/checklist/${created.body.item.id}`)
      .set(asUser)
      .send({ is_done: true });

    const res = await request(app)
      .patch(`/api/auth/trips/${trip.id}/checklist/${created.body.item.id}`)
      .set(asUser)
      .send({ label: 'Passport and visa' });

    expect(res.body.item).toMatchObject({ label: 'Passport and visa', is_done: true });
  });

  test('is_done must be a boolean, not anything truthy', async () => {
    // `"maybe"` coerced to `true` is a checklist that ticks itself.
    const trip = await makeTrip();
    const created = await addItem(trip, 'Passport');

    const res = await request(app)
      .patch(`/api/auth/trips/${trip.id}/checklist/${created.body.item.id}`)
      .set(asUser)
      .send({ is_done: 'maybe' });

    expect(res.status).toBe(400);
  });

  test('a blank or oversized label is a 400', async () => {
    const trip = await makeTrip();

    expect((await addItem(trip, '   ')).status).toBe(400);
    expect((await addItem(trip, '')).status).toBe(400);
    expect((await addItem(trip, 'x'.repeat(201))).status).toBe(400);
  });

  test('reordering rewrites every position', async () => {
    const trip = await makeTrip();
    const a = await addItem(trip, 'Passport');
    const b = await addItem(trip, 'Charger');
    const c = await addItem(trip, 'Tickets');

    const res = await request(app)
      .put(`/api/auth/trips/${trip.id}/checklist/order`)
      .set(asUser)
      .send({ item_ids: [c.body.item.id, a.body.item.id, b.body.item.id] });

    expect(res.status).toBe(200);
    expect(res.body.items.map((item) => item.label)).toEqual(['Tickets', 'Passport', 'Charger']);
    expect(res.body.items.map((item) => item.position)).toEqual([0, 1, 2]);
  });

  test('a reorder naming an id from another trip renumbers nothing at all', async () => {
    // A partial reorder is worse than a refused one: the list it leaves is neither the old order
    // nor the requested one. Asserted from the database, because the response is a 404.
    const trip = await makeTrip();
    const a = await addItem(trip, 'Passport');
    const b = await addItem(trip, 'Charger');

    const theirs = await makeTrip(asOther);
    const theirItem = await addItem(theirs, 'Not yours', asOther);

    const res = await request(app)
      .put(`/api/auth/trips/${trip.id}/checklist/order`)
      .set(asUser)
      .send({ item_ids: [b.body.item.id, a.body.item.id, theirItem.body.item.id] });

    expect(res.status).toBe(404);
    const rows = await pool.query(
      'SELECT label, position FROM trip_checklist_items WHERE trip_id = $1 ORDER BY position, id',
      [trip.id]
    );
    expect(rows.rows).toEqual([
      { label: 'Passport', position: 0 },
      { label: 'Charger', position: 1 }
    ]);
  });

  test('a reorder must contain integers', async () => {
    const trip = await makeTrip();
    const res = await request(app)
      .put(`/api/auth/trips/${trip.id}/checklist/order`)
      .set(asUser)
      .send({ item_ids: ['not-an-id'] });

    expect(res.status).toBe(400);
  });

  test('"order" is not read as an item id', async () => {
    // `/checklist/order` is declared before `/checklist/:itemId`. Reversed, Express would hand
    // "order" to the PATCH handler as an id — the `BUG C2` shadowing class.
    const trip = await makeTrip();

    const res = await request(app)
      .put(`/api/auth/trips/${trip.id}/checklist/order`)
      .set(asUser)
      .send({ item_ids: [] });

    expect(res.status).toBe(200);
  });

  test('deleting the trip deletes its checklist', async () => {
    const trip = await makeTrip();
    await addItem(trip, 'Passport');

    await request(app).delete(`/api/auth/trips/${trip.id}`).set(asUser);

    const rows = await pool.query(
      'SELECT count(*)::int AS n FROM trip_checklist_items WHERE trip_id = $1',
      [trip.id]
    );
    expect(rows.rows[0].n).toBe(0);
  });
});
