const request = require('supertest');
const app = require('../app');
const { createSchema, resetData, closeDb, resetRateLimits } = require('./helpers/testDb');
const { authHeader } = require('./helpers/firebaseMock');

/**
 * Trip expenses and their settlement (`FV-008`).
 *
 * `settlement.test.js` owns the arithmetic — it is pure, so it can be exhaustive without a database.
 * **What is left for this file is everything the arithmetic cannot see**, and it is where the real
 * risk is:
 *
 *   1. **Who may record, read and delete.** Reading is for anybody on the trip; recording follows
 *      the editor rule; deleting is the owner's *or the payer's*, which is neither predicate and is
 *      therefore the one most likely to be wrong.
 *   2. **Who an expense may involve.** A participant has to be somebody on the trip at the moment it
 *      is recorded — and must stay on the expense afterwards even if they leave, because an expense
 *      is a record of what happened rather than a view of current membership.
 *   3. **Mixed currencies.** The settlement refuses rather than converting. Inventing an exchange
 *      rate would put a fabricated number into a list of amounts people are expected to hand each
 *      other.
 *   4. **`BIGINT` arrives as a string.** node-pg hands `amount_minor` back as text, and a settlement
 *      built on `"1000" + "2000"` is `"10002000"`. That conversion happens in the controller and is
 *      only observable from here.
 */

const OWNER = { uid: 'seed-user-uid' };
const OTHER = { uid: 'seed-other-uid' };
const STRANGER = { uid: 'seed-admin-uid' };

const asOwner = { Authorization: authHeader(OWNER) };
const asOther = { Authorization: authHeader(OTHER) };
const asStranger = { Authorization: authHeader(STRANGER) };

const makeTrip = async () => {
  const created = await request(app)
    .post('/api/auth/trips')
    .set(asOwner)
    .send({ title: 'Karnataka in November' });
  expect(created.status).toBe(201);
  return created.body.trip;
};

const addPerson = (tripId, role = 'viewer') =>
  request(app)
    .post(`/api/auth/trips/${tripId}/collaborators`)
    .set(asOwner)
    .send({ email: 'other@easytrip.test', role });

const spend = (tripId, headers, body) =>
  request(app)
    .post(`/api/auth/trips/${tripId}/expenses`)
    .set(headers)
    .send({ description: 'Dinner', amount_minor: 9000, currency: 'INR', ...body });

const settlement = (tripId, headers = asOwner) =>
  request(app).get(`/api/auth/trips/${tripId}/settlement`).set(headers);

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
// Recording
// ---------------------------------------------------------------------------
describe('recording an expense follows the editor rule', () => {
  test('the owner can record one, and it defaults to everybody on the trip', async () => {
    const trip = await makeTrip();
    await addPerson(trip.id);

    const res = await spend(trip.id, asOwner);

    expect(res.status).toBe(201);
    expect(res.body.expense.paid_by).toBe(OWNER.uid);
    expect(res.body.expense.participants.sort()).toEqual([OTHER.uid, OWNER.uid].sort());
  });

  test('an editor can record one', async () => {
    const trip = await makeTrip();
    await addPerson(trip.id, 'editor');

    const res = await spend(trip.id, asOther);

    expect(res.status).toBe(201);
    expect(res.body.expense.paid_by).toBe(OTHER.uid);
  });

  test('a viewer cannot', async () => {
    const trip = await makeTrip();
    await addPerson(trip.id, 'viewer');

    expect((await spend(trip.id, asOther)).status).toBe(404);
  });

  test('a stranger cannot, and learns nothing', async () => {
    const trip = await makeTrip();

    expect((await spend(trip.id, asStranger)).status).toBe(404);
  });

  test('a participant who is not on the trip is refused, with a reason', async () => {
    const trip = await makeTrip();

    const res = await spend(trip.id, asOwner, { participants: [OWNER.uid, 'somebody-else'] });

    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/somebody who can see this trip/i);
  });

  test('a zero expense is refused', async () => {
    // Never a fact anybody meant to record, and it would sit in the ledger looking deliberate.
    const trip = await makeTrip();

    expect((await spend(trip.id, asOwner, { amount_minor: 0 })).status).toBe(400);
  });

  test('a refund is allowed, because a correction is not a fictional payment', async () => {
    const trip = await makeTrip();

    const res = await spend(trip.id, asOwner, { amount_minor: -2500, description: 'Refund' });

    expect(res.status).toBe(201);
    expect(Number(res.body.expense.amount_minor)).toBe(-2500);
  });

  test('a malformed currency is refused', async () => {
    const trip = await makeTrip();

    expect((await spend(trip.id, asOwner, { currency: 'RUPEES' })).status).toBe(400);
  });

  test('the currency is stored upper case however it was sent', async () => {
    const trip = await makeTrip();

    const res = await spend(trip.id, asOwner, { currency: 'inr' });

    expect(res.body.expense.currency).toBe('INR');
  });
});

// ---------------------------------------------------------------------------
// Reading and deleting
// ---------------------------------------------------------------------------
describe('reading is for everybody on the trip; deleting is narrower', () => {
  test('a viewer can see what has been spent', async () => {
    // Being able to read the plan and not the bill would be an odd line to draw, and the amounts
    // are about them.
    const trip = await makeTrip();
    await addPerson(trip.id, 'viewer');
    await spend(trip.id, asOwner);

    const res = await request(app).get(`/api/auth/trips/${trip.id}/expenses`).set(asOther);

    expect(res.status).toBe(200);
    expect(res.body.expenses).toHaveLength(1);
    expect(res.body.expenses[0].participants).toHaveLength(2);
  });

  test('a stranger cannot', async () => {
    const trip = await makeTrip();

    expect(
      (await request(app).get(`/api/auth/trips/${trip.id}/expenses`).set(asStranger)).status
    ).toBe(404);
  });

  test('the payer can delete what they recorded', async () => {
    const trip = await makeTrip();
    await addPerson(trip.id, 'editor');
    const recorded = await spend(trip.id, asOther);

    const res = await request(app)
      .delete(`/api/auth/trips/${trip.id}/expenses/${recorded.body.expense.id}`)
      .set(asOther);

    expect(res.status).toBe(204);
  });

  test('the owner can delete somebody else’s', async () => {
    const trip = await makeTrip();
    await addPerson(trip.id, 'editor');
    const recorded = await spend(trip.id, asOther);

    const res = await request(app)
      .delete(`/api/auth/trips/${trip.id}/expenses/${recorded.body.expense.id}`)
      .set(asOwner);

    expect(res.status).toBe(204);
  });

  test('an editor cannot erase what somebody else paid for', async () => {
    // The rule that is neither `editableBy` nor ownership, and therefore the one worth asserting.
    const trip = await makeTrip();
    await addPerson(trip.id, 'editor');
    const recorded = await spend(trip.id, asOwner);

    const res = await request(app)
      .delete(`/api/auth/trips/${trip.id}/expenses/${recorded.body.expense.id}`)
      .set(asOther);

    expect(res.status).toBe(404);
  });

  test('deleting the trip takes its expenses with it', async () => {
    const trip = await makeTrip();
    await spend(trip.id, asOwner);

    await request(app).delete(`/api/auth/trips/${trip.id}`).set(asOwner).expect(204);

    expect((await settlement(trip.id)).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Settlement
// ---------------------------------------------------------------------------
describe('the settlement is derived, and refuses what it cannot know', () => {
  test('one dinner between two people is one transfer', async () => {
    const trip = await makeTrip();
    await addPerson(trip.id);
    await spend(trip.id, asOwner, { amount_minor: 10000 });

    const res = await settlement(trip.id);

    expect(res.status).toBe(200);
    expect(res.body.transfers).toEqual([{ from: OTHER.uid, to: OWNER.uid, amount_minor: 5000 }]);
    expect(res.body.currency).toBe('INR');
  });

  test('the amounts are numbers, not concatenated strings', async () => {
    // `amount_minor` is a BIGINT and node-pg returns those as text. Two expenses of 1000 and 2000
    // settle to 1500 owed — or to something absurd if the conversion is missing.
    const trip = await makeTrip();
    await addPerson(trip.id);
    await spend(trip.id, asOwner, { amount_minor: 1000 });
    await spend(trip.id, asOwner, { amount_minor: 2000 });

    const res = await settlement(trip.id);

    expect(res.body.transfers[0].amount_minor).toBe(1500);
    expect(typeof res.body.transfers[0].amount_minor).toBe('number');
  });

  test('mixed currencies are refused, and the message names them', async () => {
    const trip = await makeTrip();
    await spend(trip.id, asOwner, { currency: 'INR' });
    await spend(trip.id, asOwner, { currency: 'USD' });

    const res = await settlement(trip.id);

    expect(res.status).toBe(422);
    expect(res.body.currencies).toEqual(['INR', 'USD']);
    expect(res.body.message).toMatch(/does not convert/i);
  });

  test('nothing spent settles to nothing, rather than erroring', async () => {
    const trip = await makeTrip();

    const res = await settlement(trip.id);

    expect(res.status).toBe(200);
    expect(res.body.transfers).toEqual([]);
    expect(res.body.expense_count).toBe(0);
    expect(res.body.currency).toBeNull();
  });

  test('it never claims to be optimal', async () => {
    const trip = await makeTrip();
    await spend(trip.id, asOwner);

    expect((await settlement(trip.id)).body.optimal).toBe(false);
  });

  test('a viewer can read the settlement; a stranger cannot', async () => {
    const trip = await makeTrip();
    await addPerson(trip.id, 'viewer');
    await spend(trip.id, asOwner);

    expect((await settlement(trip.id, asOther)).status).toBe(200);
    expect((await settlement(trip.id, asStranger)).status).toBe(404);
  });

  test('somebody who left still owes for the dinner they were at', async () => {
    // The expense is a record of what happened. Removing their access must not rewrite it, which is
    // why `019` deliberately does not constrain participants to current membership.
    const trip = await makeTrip();
    await addPerson(trip.id);
    await spend(trip.id, asOwner, { amount_minor: 10000 });

    await request(app)
      .delete(`/api/auth/trips/${trip.id}/collaborators/${OTHER.uid}`)
      .set(asOwner)
      .expect(204);

    const res = await settlement(trip.id);

    expect(res.body.transfers).toEqual([{ from: OTHER.uid, to: OWNER.uid, amount_minor: 5000 }]);
  });

  test('every expense endpoint requires a token', async () => {
    const trip = await makeTrip();

    expect((await request(app).get(`/api/auth/trips/${trip.id}/expenses`)).status).toBe(401);
    expect((await request(app).get(`/api/auth/trips/${trip.id}/settlement`)).status).toBe(401);
    expect(
      (
        await request(app)
          .post(`/api/auth/trips/${trip.id}/expenses`)
          .send({ description: 'x', amount_minor: 1, currency: 'INR' })
      ).status
    ).toBe(401);
  });
});
