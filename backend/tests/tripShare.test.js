const request = require('supertest');
const app = require('../app');
const { createSchema, resetData, closeDb, resetRateLimits, pool } = require('./helpers/testDb');
const { authHeader } = require('./helpers/firebaseMock');
const { mintToken } = require('../src/models/tripShareModel');

/**
 * The read-only share link (`FV-009` stage c).
 *
 * **The token is a bearer credential in a URL**, which is a shape that leaks: browser history, a
 * `Referer` header, a screenshot in a group chat. So almost nothing here tests the happy path. What
 * is tested is the boundary:
 *
 *   1. **What the public endpoint returns**, exactly — because everything it returns is world-
 *      readable to anybody holding the link, and a column added to `trips` later must not become
 *      public by default.
 *   2. **That revocation is total and immediate**, and that re-sharing does not resurrect a dead
 *      link.
 *   3. **That an invalid, revoked and never-existing token are indistinguishable**, because telling
 *      them apart says whether a token was ever real.
 *
 * The one query in this codebase that reads a trip without a uid lives behind this endpoint, which
 * is why it has a model file to itself.
 */

const USER = { uid: 'seed-user-uid' };
const OTHER = { uid: 'seed-other-uid' };
const asUser = { Authorization: authHeader(USER) };
const asOther = { Authorization: authHeader(OTHER) };

const makeTrip = async (headers = asUser, body = {}) => {
  const res = await request(app)
    .post('/api/auth/trips')
    .set(headers)
    .send({
      title: 'Karnataka in March',
      start_date: '2026-03-01',
      end_date: '2026-03-02',
      ...body
    });
  expect(res.status).toBe(201);
  return res.body.trip;
};

const share = (trip, headers = asUser) =>
  request(app).post(`/api/auth/trips/${trip.id}/share`).set(headers);

const readShared = (token) => request(app).get(`/api/trips/shared/${token}`);

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
// The token itself
// ---------------------------------------------------------------------------
describe('the token is a credential, and is built like one', () => {
  test('43 base64url characters — 256 bits, so guessing is not a threat model', () => {
    const token = mintToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // Not plain base64: `+` and `/` do not survive a URL, and the column's CHECK refuses them.
    expect(token).not.toMatch(/[+/=]/);
  });

  test('two tokens are never the same', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => mintToken()));
    expect(tokens.size).toBe(200);
  });

  test('it decodes to 32 bytes — the entropy is real, not just the length', () => {
    // Shape and uniqueness are both satisfied by a token with four random bytes padded out to 43
    // characters, and by one drawn from `Math.random`. Mutations `S1` and `S2` are exactly those and
    // survived every other assertion here: **nothing was testing the property the token exists for.**
    expect(Buffer.from(mintToken(), 'base64url')).toHaveLength(32);
  });

  test('every byte of it varies, so none of it is padding or a seeded sequence', () => {
    // The assertion that catches a padded token. Across 200 draws of genuinely random bytes, the
    // chance that any one position never changes is (1/256)^199 — so a constant position means that
    // part of the token is not random, whatever its length says.
    const draws = Array.from({ length: 200 }, () => Buffer.from(mintToken(), 'base64url'));

    for (let position = 0; position < 32; position += 1) {
      const values = new Set(draws.map((bytes) => bytes[position]));
      expect({ position, distinct: values.size > 1 }).toEqual({ position, distinct: true });
    }
  });

  test('it uses the whole base64url alphabet, which a base36 PRNG cannot', () => {
    // `Math.random().toString(36)` yields only [0-9a-z]. Random bytes produce upper case too, and
    // this is the cheapest direct statement that the source is not a number generator.
    const sample = Array.from({ length: 50 }, () => mintToken()).join('');
    expect(sample).toMatch(/[A-Z]/);
  });

  test('the database refuses a token that is not base64url', async () => {
    // The constraint is in the schema rather than only in this model, so a second caller cannot
    // reintroduce a plain-base64 token later.
    const trip = await makeTrip();

    await expect(
      pool.query('UPDATE trips SET share_token = $1, shared_at = NOW() WHERE id = $2', [
        'a+b/c'.padEnd(43, 'x'),
        trip.id
      ])
    ).rejects.toThrow();
  });

  test('a token and its date move together', async () => {
    // `shared_at` without a token would be a leftover date from a revoked link.
    const trip = await makeTrip();

    await expect(
      pool.query('UPDATE trips SET share_token = $1 WHERE id = $2', [mintToken(), trip.id])
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// What the public endpoint returns — the part that is world-readable
// ---------------------------------------------------------------------------
describe('what a share link shows', () => {
  test('the plan: title, dates, days and stops', async () => {
    const trip = await makeTrip();
    const workspace = await request(app).get(`/api/auth/trips/${trip.id}`).set(asUser);
    const dayId = workspace.body.trip.days[0].id;
    await request(app)
      .post(`/api/auth/trips/${trip.id}/days/${dayId}/items`)
      .set(asUser)
      .send({ title: 'Hampi at dawn', start_time: '06:30', notes: 'Meet at the north gate' });

    const token = (await share(trip)).body.share_token;
    const res = await readShared(token);

    expect(res.status).toBe(200);
    expect(res.body.trip.title).toBe('Karnataka in March');
    expect(res.body.trip.start_date).toBe('2026-03-01');
    expect(res.body.trip.days[0].items[0]).toMatchObject({
      title: 'Hampi at dawn',
      // A note on a stop is part of the itinerary — useless to withhold from somebody being sent it.
      notes: 'Meet at the north gate'
    });
  });

  test('never the owner: no uid appears anywhere in the response', async () => {
    // A public endpoint returning an owner's uid hands out the identifier every other table keys on.
    const trip = await makeTrip();
    const token = (await share(trip)).body.share_token;

    const res = await readShared(token);

    expect(JSON.stringify(res.body)).not.toContain(USER.uid);
    expect(res.body.trip.user_id).toBeUndefined();
  });

  test('never the share token itself, so a screenshot of the page does not re-share it', async () => {
    const trip = await makeTrip();
    const token = (await share(trip)).body.share_token;

    const res = await readShared(token);

    expect(JSON.stringify(res.body)).not.toContain(token);
  });

  test('not the trip notes, and not the checklist', async () => {
    // The boundary this feature turns on. `trip_notes` is where a booking reference lives and the
    // checklist is a packing list: sharing a plan and handing over a hotel confirmation number are
    // different acts, and only one of them was asked for.
    const trip = await makeTrip();
    await request(app)
      .post(`/api/auth/trips/${trip.id}/notes`)
      .set(asUser)
      .send({ body: 'Hotel confirmation XY123' });
    await request(app)
      .post(`/api/auth/trips/${trip.id}/checklist`)
      .set(asUser)
      .send({ label: 'Passport' });

    const token = (await share(trip)).body.share_token;
    const res = await readShared(token);

    const body = JSON.stringify(res.body);
    expect(body).not.toContain('XY123');
    expect(body).not.toContain('Passport');
    expect(res.body.trip.notes).toBeUndefined();
    expect(res.body.trip.checklist).toBeUndefined();
  });

  test('the exact set of trip fields, so a new column is not public by default', async () => {
    // The failure mode of `SELECT *` on a public endpoint is silent and retroactive: add a column to
    // `trips` and it is world-readable from the next deploy. This asserts the allow-list.
    const trip = await makeTrip();
    const token = (await share(trip)).body.share_token;

    const res = await readShared(token);

    expect(Object.keys(res.body.trip).sort()).toEqual(
      ['days', 'description', 'end_date', 'id', 'start_date', 'status', 'title'].sort()
    );
  });

  test('it says not to index it', async () => {
    // A share link is somebody's holiday plans. The page sets a meta tag too; this header covers the
    // JSON being fetched or linked directly, which a meta tag cannot.
    const trip = await makeTrip();
    const token = (await share(trip)).body.share_token;

    const res = await readShared(token);

    expect(res.headers['x-robots-tag']).toMatch(/noindex/);
    // No shared cache may hold it, or a revoked link could still be served from one.
    expect(res.headers['cache-control']).toMatch(/no-store/);
  });
});

// ---------------------------------------------------------------------------
// Revocation
// ---------------------------------------------------------------------------
describe('revoking ends every copy of the link at once', () => {
  test('a revoked token stops working immediately', async () => {
    const trip = await makeTrip();
    const token = (await share(trip)).body.share_token;
    expect((await readShared(token)).status).toBe(200);

    const revoked = await request(app).delete(`/api/auth/trips/${trip.id}/share`).set(asUser);

    expect(revoked.status).toBe(204);
    expect((await readShared(token)).status).toBe(404);
  });

  test('re-sharing mints a new token and does not resurrect the old one', async () => {
    // The reason the column is nullable rather than a boolean beside a permanent token: the token's
    // absence *is* the revocation, so there is nothing to switch back on.
    const trip = await makeTrip();
    const first = (await share(trip)).body.share_token;
    await request(app).delete(`/api/auth/trips/${trip.id}/share`).set(asUser);

    const second = (await share(trip)).body.share_token;

    expect(second).not.toBe(first);
    expect((await readShared(first)).status).toBe(404);
    expect((await readShared(second)).status).toBe(200);
  });

  test('sharing again rotates the token, which is how a leaked link is killed', async () => {
    // Rotation is the same action as sharing on purpose: somebody who thinks a link has spread
    // further than they meant should not have to find a separate control while worried.
    const trip = await makeTrip();
    const first = (await share(trip)).body.share_token;

    const second = (await share(trip)).body.share_token;

    expect(second).not.toBe(first);
    expect((await readShared(first)).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// What a bad token gets
// ---------------------------------------------------------------------------
describe('an invalid link says nothing about whether it was ever real', () => {
  test('revoked, mistyped and never-existing are the same answer', async () => {
    const trip = await makeTrip();
    const revokedToken = (await share(trip)).body.share_token;
    await request(app).delete(`/api/auth/trips/${trip.id}/share`).set(asUser);

    const revoked = await readShared(revokedToken);
    const neverExisted = await readShared(mintToken());

    expect(revoked.status).toBe(404);
    expect(neverExisted.status).toBe(404);
    expect(revoked.body).toEqual(neverExisted.body);
  });

  test('a malformed token is a 400 before it reaches the database', async () => {
    expect((await readShared('too-short')).status).toBe(400);
    expect((await readShared('a'.repeat(44))).status).toBe(400);
    // Plain base64 characters are refused by the same pattern the column's CHECK uses.
    expect((await readShared(`${'a'.repeat(42)}+`)).status).toBe(400);
  });

  test('an unshared trip is not readable by its id', async () => {
    // The public route takes a token and nothing else — there is no id-shaped way in.
    const trip = await makeTrip();
    const res = await request(app).get(`/api/trips/shared/${trip.id}`);
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// The owner's half
// ---------------------------------------------------------------------------
describe('only the owner can share, revoke or see the link', () => {
  test('another user cannot share your trip, and is told it does not exist', async () => {
    const trip = await makeTrip();

    const res = await share(trip, asOther);

    expect(res.status).toBe(404);
    const row = await pool.query('SELECT share_token FROM trips WHERE id = $1', [trip.id]);
    expect(row.rows[0].share_token).toBeNull();
  });

  test('another user cannot revoke your link', async () => {
    const trip = await makeTrip();
    const token = (await share(trip)).body.share_token;

    const res = await request(app).delete(`/api/auth/trips/${trip.id}/share`).set(asOther);

    expect(res.status).toBe(404);
    // Still live — the status alone does not prove the write did not happen.
    expect((await readShared(token)).status).toBe(200);
  });

  test('another user cannot read the link off your trip', async () => {
    const trip = await makeTrip();
    await share(trip);

    const res = await request(app).get(`/api/auth/trips/${trip.id}/share`).set(asOther);

    expect(res.status).toBe(404);
  });

  test('the owner is told whether it is shared, and when', async () => {
    const trip = await makeTrip();

    const before = await request(app).get(`/api/auth/trips/${trip.id}/share`).set(asUser);
    expect(before.body).toMatchObject({ shared: false, share_token: null });

    await share(trip);
    const after = await request(app).get(`/api/auth/trips/${trip.id}/share`).set(asUser);

    expect(after.body.shared).toBe(true);
    expect(after.body.share_token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(after.body.shared_at).toBeTruthy();
  });

  test('every owner endpoint requires a token', async () => {
    const trip = await makeTrip();

    const responses = await Promise.all([
      request(app).get(`/api/auth/trips/${trip.id}/share`),
      request(app).post(`/api/auth/trips/${trip.id}/share`),
      request(app).delete(`/api/auth/trips/${trip.id}/share`)
    ]);

    responses.forEach((res) => expect(res.status).toBe(401));
  });

  test('deleting the trip takes the link with it', async () => {
    const trip = await makeTrip();
    const token = (await share(trip)).body.share_token;

    await request(app).delete(`/api/auth/trips/${trip.id}`).set(asUser);

    expect((await readShared(token)).status).toBe(404);
  });
});
