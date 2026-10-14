const request = require('supertest');
const app = require('../app');
const { createSchema, resetData, closeDb, resetRateLimits, pool } = require('./helpers/testDb');
const { authHeader } = require('./helpers/firebaseMock');

/**
 * The profile endpoints — `GET/PUT /api/auth/profile` and the `checkAdmin` empty case.
 *
 * **Why this exists.** `authController.js` sat at 48.83%, and the uncovered half was not error
 * handling: `updateProfile` had **no test at all**, and `getProfile`'s provisioning branch — the one
 * that writes a row — had never run.
 *
 * `updateProfile` is where `IMP-008` was fixed, and its own comment describes the bug:
 *
 * > *"location and dob were accepted by the validator and then dropped here, so the profile form
 * > reported success while saving nothing."*
 *
 * That is the worst shape a bug can have — a 200 response, a form that clears, and nothing written.
 * It was fixed and then left with nothing holding it in place, which is the fourth time this
 * project has found a repaired defect with no regression test. Reintroducing it means deleting two
 * parameters from one query, and every existing assertion would stay green.
 */

const USER = { uid: 'seed-user-uid' };
const GHOST = { uid: 'ghost-uid' };

const asUser = { Authorization: authHeader(USER) };
const asGhost = { Authorization: authHeader(GHOST) };

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
 * Read a user row, with `dob` also rendered as a calendar string by Postgres.
 *
 * `dob` is a `DATE`, and node-pg parses it into a JS `Date` at **local** midnight. Asserting on
 * `.toISOString()` therefore fails by one day for anyone behind UTC and passes for anyone at or
 * ahead of it — which is `BUG-044`/`BUG-046` all over again, this time in the test rather than the
 * product. The first draft of this file had exactly that bug. `to_char` keeps the comparison inside
 * Postgres, where the value has no time zone to be shifted by.
 */
const rowFor = async (uid) =>
  (
    await pool.query(
      `SELECT firebase_uid, email, name, location, dob, to_char(dob, 'YYYY-MM-DD') AS dob_text,
              is_admin
         FROM users WHERE firebase_uid = $1`,
      [uid]
    )
  ).rows[0];

const putProfile = (body, headers = asUser) =>
  request(app).put('/api/auth/profile').set(headers).send(body);

describe('updating a profile actually persists what was sent (IMP-008)', () => {
  test('name, location and date of birth are all written', async () => {
    // The exact regression: two of these three used to be accepted and discarded.
    const res = await putProfile({
      name: 'Tom Traveller',
      location: 'Bengaluru',
      dob: '1994-03-17'
    });

    expect(res.status).toBe(200);
    const row = await rowFor('seed-user-uid');
    expect(row.name).toBe('Tom Traveller');
    expect(row.location).toBe('Bengaluru');
    expect(row.dob_text).toBe('1994-03-17');
  });

  test('the response reports back what was stored, not what was sent', async () => {
    // A handler that echoed the request body would pass the assertion above only because the
    // database happened to agree. This one reads from the RETURNING clause.
    const res = await putProfile({ name: 'Renamed', location: 'Mysuru', dob: '1990-01-02' });

    expect(res.body).toMatchObject({ name: 'Renamed', location: 'Mysuru' });
    expect(res.body.firebase_uid).toBe('seed-user-uid');
  });

  test('a cleared location and date of birth become NULL, not empty strings', async () => {
    // `''` is what an emptied form field sends, and a DATE column rejects it outright — so writing
    // it through would 500 on the one action a user takes to remove information about themselves.
    await putProfile({ name: 'Tom Traveller', location: 'Bengaluru', dob: '1994-03-17' });

    const res = await putProfile({ name: 'Tom Traveller', location: '', dob: '' });

    expect(res.status).toBe(200);
    const row = await rowFor('seed-user-uid');
    expect(row.location).toBeNull();
    expect(row.dob).toBeNull();
  });

  test('omitting the optional fields entirely also clears them rather than erroring', async () => {
    await putProfile({ name: 'Tom Traveller', location: 'Bengaluru', dob: '1994-03-17' });

    const res = await putProfile({ name: 'Tom Traveller' });

    expect(res.status).toBe(200);
    const row = await rowFor('seed-user-uid');
    expect(row.location).toBeNull();
    expect(row.dob).toBeNull();
  });

  test('a caller can only update their own row, whatever they put in the body', async () => {
    // Identity comes from the verified token; there is no id parameter by design. A body field
    // claiming otherwise must not redirect the write.
    const before = await rowFor('seed-admin-uid');

    await putProfile({
      name: 'Impersonator',
      firebase_uid: 'seed-admin-uid',
      email: 'admin@easytrip.test'
    });

    const after = await rowFor('seed-admin-uid');
    expect(after.name).toBe(before.name);
    expect(after.email).toBe(before.email);
    expect((await rowFor('seed-user-uid')).name).toBe('Impersonator');
  });

  test('a token whose uid has no row is a 404, not a silent no-op', async () => {
    const res = await putProfile({ name: 'Nobody' }, asGhost);
    expect(res.status).toBe(404);
  });

  test('an anonymous request is refused and writes nothing', async () => {
    const before = await rowFor('seed-user-uid');
    const res = await request(app).put('/api/auth/profile').send({ name: 'Anonymous' });

    expect(res.status).toBe(401);
    expect((await rowFor('seed-user-uid')).name).toBe(before.name);
  });

  test.each([
    ['an empty name', { name: '' }],
    ['a whitespace-only name', { name: '   ' }],
    ['a name over 100 characters', { name: 'x'.repeat(101) }],
    ['a location over 120 characters', { name: 'Tom', location: 'y'.repeat(121) }]
  ])('%s is rejected without touching the row', async (_label, body) => {
    const before = await rowFor('seed-user-uid');
    const res = await putProfile(body);

    expect(res.status).toBe(400);
    expect((await rowFor('seed-user-uid')).name).toBe(before.name);
  });
});

describe('reading a profile provisions a row when Firebase knows the user and the database does not', () => {
  test('the row is created and returned', async () => {
    // Reachable in production: Firebase sign-up succeeds, and the first authenticated request
    // arrives before anything has written a users row. Never exercised until now.
    expect(await rowFor('ghost-uid')).toBeUndefined();

    const res = await request(app).get('/api/auth/profile').set(asGhost);

    expect(res.status).toBe(200);
    expect(res.body.firebase_uid).toBe('ghost-uid');
    const row = await rowFor('ghost-uid');
    expect(row).toBeDefined();
    expect(row.email).toBe('ghost-uid@easytrip.test');
  });

  test('a provisioned user is never created as an admin', async () => {
    // The INSERT hardcodes `false`. If it ever became `$4` bound to something request-derived,
    // self-provisioning would be a privilege escalation with no gate in front of it.
    await request(app).get('/api/auth/profile').set(asGhost);
    expect((await rowFor('ghost-uid')).is_admin).toBe(false);
  });

  test('a second read returns the same row rather than inserting again', async () => {
    await request(app).get('/api/auth/profile').set(asGhost);
    await request(app).get('/api/auth/profile').set(asGhost);

    const { rows } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM users WHERE firebase_uid = $1',
      ['ghost-uid']
    );
    expect(rows[0].n).toBe(1);
  });

  test('the profile payload carries the fields the form seeds itself from', async () => {
    // `USER_COLUMNS` exists because the list was duplicated three times and a column missing from
    // one copy silently blanked that field in the form. Both read paths must return all of them.
    await putProfile({ name: 'Tom Traveller', location: 'Bengaluru', dob: '1994-03-17' });
    const res = await request(app).get('/api/auth/profile').set(asUser);

    for (const field of ['id', 'firebase_uid', 'email', 'name', 'location', 'dob', 'is_admin']) {
      expect({ field, present: field in res.body }).toEqual({ field, present: true });
    }
  });
});

describe('check-admin when the caller has no database row', () => {
  test('answers false rather than failing', async () => {
    // `resolveAdminStatus` returns no user, and the endpoint is the sole authority behind four
    // server-side page gates — so this must be a definite "no", not a 500 that a gate might
    // interpret loosely.
    const res = await request(app).get('/api/auth/check-admin').set(asGhost);

    expect(res.status).toBe(200);
    expect(res.body.isAdmin).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// What a traveller needs, as opposed to what a place offers (`FV-029` stage c)
// ---------------------------------------------------------------------------
describe('stated access needs', () => {
  const profile = async () =>
    (
      await pool.query(
        'SELECT requires_step_free, requires_accessible_restroom FROM users WHERE firebase_uid = $1',
        [USER.uid]
      )
    ).rows[0];

  const save = (body) => request(app).put('/api/auth/profile').set(asUser).send(body);

  test('every existing traveller starts with no stated requirement', async () => {
    // `FALSE`, not `NULL`, and it is the only safe default: a `TRUE` default would give every
    // traveller in the catalogue warnings they never asked for, and teaching people to dismiss
    // accessibility warnings is worse than not showing them.
    expect(await profile()).toEqual({
      requires_step_free: false,
      requires_accessible_restroom: false
    });
  });

  test('the profile route returns them, so a client can render what it will send back', async () => {
    const response = await request(app).get('/api/auth/profile').set(asUser);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      requires_step_free: false,
      requires_accessible_restroom: false
    });
  });

  test('a traveller can state a requirement', async () => {
    await save({ name: 'Tom Traveller', requires_step_free: true }).expect(200);
    expect(await profile()).toMatchObject({ requires_step_free: true });
  });

  test('and can take it back, which is why false is a real value here', async () => {
    // The assertion that pins `optional({ values: 'null' })`. Under `values: 'falsy'` — which every
    // other optional rule on this route uses — `false` is indistinguishable from an absent key, so
    // a requirement could be set and never removed.
    await save({ name: 'Tom Traveller', requires_step_free: true }).expect(200);
    await save({ name: 'Tom Traveller', requires_step_free: false }).expect(200);
    expect(await profile()).toMatchObject({ requires_step_free: false });
  });

  test('a client that does not know about the fields cannot reset them', async () => {
    // The profile form submits itself whole, so an absent key means "this client has not heard of
    // the field" rather than "clear it". `COALESCE` is deliberately the opposite of what
    // `updatePlace` does, for the opposite reason (`BUG-048`): a place patch is sparse by design.
    await save({ name: 'Tom Traveller', requires_accessible_restroom: true }).expect(200);
    await save({ name: 'Renamed', location: 'Bengaluru' }).expect(200);

    expect(await profile()).toMatchObject({ requires_accessible_restroom: true });
  });

  test('the two needs are independent', async () => {
    await save({
      name: 'Tom Traveller',
      requires_step_free: true,
      requires_accessible_restroom: false
    }).expect(200);

    expect(await profile()).toEqual({
      requires_step_free: true,
      requires_accessible_restroom: false
    });
  });

  test.each(['maybe', 2, 'sometimes'])('%p is rejected rather than coerced', async (value) => {
    const response = await save({ name: 'Tom Traveller', requires_step_free: value });
    expect(response.status).toBe(400);
    expect(await profile()).toMatchObject({ requires_step_free: false });
  });

  test('it is not exposed on any public route', async () => {
    // Health-adjacent personal data, handled exactly as `dob` is (migration 002). A place page
    // carries reviews written by this user, so it is the realistic place for a leak.
    await save({ name: 'Tom Traveller', requires_step_free: true }).expect(200);

    const place = await request(app).get('/api/places/1');
    expect(place.status).toBe(200);
    expect(JSON.stringify(place.body)).not.toContain('requires_step_free');

    const list = await request(app).get('/api/places');
    expect(JSON.stringify(list.body)).not.toContain('requires_step_free');
  });

  test('another traveller cannot read or write them', async () => {
    await save({ name: 'Tom Traveller', requires_step_free: true }).expect(200);

    const other = await request(app).get('/api/auth/profile').set(asGhost);
    expect(other.status).toBe(200);
    // The ghost is provisioned on first read and gets its own row, not this one's.
    expect(other.body.requires_step_free).toBe(false);
    expect(await profile()).toMatchObject({ requires_step_free: true });
  });
});
