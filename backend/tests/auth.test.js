const request = require('supertest');
const app = require('../app');
const { createSchema, resetData, closeDb, resetRateLimits, pool } = require('./helpers/testDb');
const { authHeader, INVALID, EXPIRED } = require('./helpers/firebaseMock');

/**
 * The auth boundary (IMP-092, locking in IMP-001/002/003).
 *
 * These are the checks that made the original audit's headline finding possible: the app used to
 * trust an `AdminX` request header and an `X-User` identity supplied by the client. Nothing in a
 * build, a lint run or a type checker notices if that comes back. A test does.
 */

const ADMIN = { uid: 'seed-admin-uid', email: 'admin@easytrip.test' };
const USER = { uid: 'seed-user-uid', email: 'traveller@easytrip.test' };

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

describe('an admin route with no usable identity', () => {
  const cases = [
    ['no Authorization header at all', {}],
    ['an empty bearer token', { Authorization: 'Bearer ' }],
    ['a token the SDK rejects as malformed', { Authorization: `Bearer ${INVALID}` }],
    ['an expired token', { Authorization: `Bearer ${EXPIRED}` }],
    [
      'a bearer token carrying no uid',
      { Authorization: `Bearer ${Buffer.from('{}').toString('base64')}` }
    ]
  ];

  test.each(cases)('rejects with 401: %s', async (_label, headers) => {
    const res = await request(app).get('/api/admin/admins').set(headers);
    expect(res.status).toBe(401);
  });

  test('never leaks whether the token was merely wrong or genuinely expired', async () => {
    const bad = await request(app)
      .get('/api/admin/admins')
      .set({ Authorization: `Bearer ${INVALID}` });
    const old = await request(app)
      .get('/api/admin/admins')
      .set({ Authorization: `Bearer ${EXPIRED}` });
    expect(bad.body.message).toBe(old.body.message);
  });
});

describe('client-supplied identity is not trusted (IMP-001/002)', () => {
  test('an AdminX header does not grant admin', async () => {
    const res = await request(app).get('/api/admin/admins').set({ AdminX: 'true' });
    expect(res.status).toBe(401);
  });

  test('an X-User header does not establish identity', async () => {
    const res = await request(app).get('/api/admin/admins').set({ 'X-User': 'seed-admin-uid' });
    expect(res.status).toBe(401);
  });

  test('a valid NON-admin token cannot reach an admin route', async () => {
    const res = await request(app)
      .get('/api/admin/admins')
      .set({ Authorization: authHeader(USER) });
    expect(res.status).toBe(403);
  });

  test('a forged admin CLAIM on a non-admin user does not grant admin', async () => {
    // The database says this user is not an admin. The token says it is. `users.is_admin` is the
    // authority and a disagreement must resolve to NOT admin — otherwise anyone who could mint a
    // claim could self-promote.
    const res = await request(app)
      .get('/api/admin/admins')
      .set({ Authorization: authHeader({ ...USER, admin: true }) });
    expect(res.status).toBe(403);
  });
});

describe('a genuine admin', () => {
  test('reaches an admin route', async () => {
    const res = await request(app)
      .get('/api/admin/admins')
      .set({ Authorization: authHeader(ADMIN) });
    expect(res.status).toBe(200);
  });

  test('loses access the moment the database says so, without the token changing', async () => {
    const header = { Authorization: authHeader(ADMIN) };
    expect((await request(app).get('/api/admin/admins').set(header)).status).toBe(200);

    await pool.query("UPDATE users SET is_admin = FALSE WHERE firebase_uid = 'seed-admin-uid'");

    // Same token, same request. The gate re-reads the database every time rather than trusting
    // anything cached in the token, so a revoked admin is locked out immediately.
    expect((await request(app).get('/api/admin/admins').set(header)).status).toBe(403);
  });
});
