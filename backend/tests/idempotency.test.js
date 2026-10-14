const request = require('supertest');
const app = require('../app');
const { createSchema, resetData, closeDb, resetRateLimits, pool } = require('./helpers/testDb');
const { authHeader } = require('./helpers/firebaseMock');

/**
 * Idempotency keys (`PE-007`).
 *
 * **The property is "a retry does not create a second thing"**, and the only way to test that is to
 * send the request twice and count the rows. Everything else here is about the ways a naive
 * implementation gets it almost right:
 *
 *   1. **Opt-in.** No header means no behaviour change, which is what makes this safe to put in
 *      front of every mutation at once.
 *   2. **Scoped to the caller.** Two people picking the same key string is not a collision anybody
 *      should have to think about.
 *   3. **A key is a promise about one request.** Reusing it for a different body is a client bug and
 *      must not silently return the earlier answer — that is a cache, not idempotency.
 *   4. **Failures release the key.** Storing a 500 turns one bad moment into a permanent one.
 */

const OWNER = { uid: 'seed-user-uid' };
const OTHER = { uid: 'seed-other-uid' };
const asOwner = { Authorization: authHeader(OWNER) };
const asOther = { Authorization: authHeader(OTHER) };

const createTrip = (headers, key, title = 'Karnataka in November') => {
  const call = request(app).post('/api/auth/trips').set(headers);
  if (key) call.set('Idempotency-Key', key);
  return call.send({ title });
};

const dayCount = async (tripId) => {
  const result = await pool.query('SELECT COUNT(*)::int AS n FROM trip_days WHERE trip_id = $1', [
    tripId
  ]);
  return result.rows[0].n;
};

const tripCount = async () => {
  const result = await pool.query('SELECT COUNT(*)::int AS n FROM trips');
  return result.rows[0].n;
};

beforeAll(async () => {
  await createSchema();
});
beforeEach(async () => {
  await resetData();
  resetRateLimits(app);
  await pool.query('TRUNCATE idempotency_keys RESTART IDENTITY');
});
afterAll(async () => {
  await closeDb();
});

describe('a retried write does not create a second thing', () => {
  test('the same key twice creates one trip and answers alike', async () => {
    const first = await createTrip(asOwner, 'key-1');
    const second = await createTrip(asOwner, 'key-1');

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.trip.id).toBe(first.body.trip.id);
    expect(await tripCount()).toBe(1);
  });

  test('without a key, the same request twice creates two — the behaviour that has not changed', async () => {
    // This is the control. If it ever fails, the middleware has stopped being opt-in and every
    // existing client's behaviour has quietly changed.
    await createTrip(asOwner);
    await createTrip(asOwner);

    expect(await tripCount()).toBe(2);
  });

  test('different keys create different trips', async () => {
    await createTrip(asOwner, 'key-a');
    await createTrip(asOwner, 'key-b');

    expect(await tripCount()).toBe(2);
  });
});

describe('a key belongs to the caller who chose it', () => {
  test('two people using the same string both get their own trip', async () => {
    // A key is an arbitrary client-invented string. A global unique constraint would let one
    // caller's key deny another's request, which is a denial-of-service with extra steps.
    const mine = await createTrip(asOwner, 'shared-string');
    const theirs = await createTrip(asOther, 'shared-string');

    expect(mine.status).toBe(201);
    expect(theirs.status).toBe(201);
    expect(theirs.body.trip.id).not.toBe(mine.body.trip.id);
    expect(await tripCount()).toBe(2);
  });
});

describe('a key is a promise about one request, not a cache', () => {
  test('reusing a key with a different body is refused, not answered from the store', async () => {
    await createTrip(asOwner, 'key-2', 'Karnataka in November');

    const different = await createTrip(asOwner, 'key-2', 'Somewhere else entirely');

    expect(different.status).toBe(422);
    expect(different.body.message).toMatch(/already used for a different request/i);
    // And crucially it did not create the second trip either.
    expect(await tripCount()).toBe(1);
  });

  test('the replay is the stored response, byte for byte', async () => {
    const first = await createTrip(asOwner, 'key-3');
    const replay = await createTrip(asOwner, 'key-3');

    expect(replay.body).toEqual(first.body);
  });

  test('an over-long key is refused before anything is written', async () => {
    const res = await createTrip(asOwner, 'k'.repeat(256));

    expect(res.status).toBe(400);
    expect(await tripCount()).toBe(0);
  });
});

describe('a failure releases the key', () => {
  test('a rejected request can be retried with the same key', async () => {
    // The whole point: a 400 must not be remembered. If it were, a client that fixed its request
    // and retried with the same key would be handed the original failure forever.
    const invalid = await request(app)
      .post('/api/auth/trips')
      .set(asOwner)
      .set('Idempotency-Key', 'key-4')
      .send({ title: '' });
    expect(invalid.status).toBe(400);

    const fixed = await createTrip(asOwner, 'key-4');

    expect(fixed.status).toBe(201);
    expect(await tripCount()).toBe(1);
  });

  test('nothing is left behind for a failed request', async () => {
    await request(app)
      .post('/api/auth/trips')
      .set(asOwner)
      .set('Idempotency-Key', 'key-5')
      .send({ title: '' });

    const stored = await pool.query('SELECT COUNT(*)::int AS n FROM idempotency_keys');
    expect(stored.rows[0].n).toBe(0);
  });
});

describe('it covers the writes that matter, not only trip creation', () => {
  test('adding a day twice with one key adds one day', async () => {
    const trip = (await createTrip(asOwner, 'trip-key')).body.trip;

    const call = () =>
      request(app)
        .post(`/api/auth/trips/${trip.id}/days`)
        .set(asOwner)
        .set('Idempotency-Key', 'day-key')
        .send({});

    // Measured as a delta, because **a new trip already has a day** — the first draft of this test
    // asserted an absolute count of 1 and failed at 2, and the idempotency was working perfectly.
    // An absolute count here is an assertion about `createTrip`, not about retrying.
    const before = await dayCount(trip.id);
    const first = await call();
    const second = await call();
    const after = await dayCount(trip.id);

    expect(second.body.day.id).toBe(first.body.day.id);
    expect(after - before).toBe(1);
  });

  test('recording an expense twice with one key records one', async () => {
    const trip = (await createTrip(asOwner, 'trip-key-2')).body.trip;

    const call = () =>
      request(app)
        .post(`/api/auth/trips/${trip.id}/expenses`)
        .set(asOwner)
        .set('Idempotency-Key', 'expense-key')
        .send({ description: 'Dinner', amount_minor: 9000, currency: 'INR' });

    const first = await call();
    const second = await call();

    expect(first.status).toBe(201);
    expect(second.body.expense.id).toBe(first.body.expense.id);

    const rows = await pool.query(
      'SELECT COUNT(*)::int AS n FROM trip_expenses WHERE trip_id = $1',
      [trip.id]
    );
    expect(rows.rows[0].n).toBe(1);
  });
});
