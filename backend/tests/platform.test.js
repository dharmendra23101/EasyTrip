const request = require('supertest');
const app = require('../app');
const { createSchema, resetData, closeDb, resetRateLimits, pool } = require('./helpers/testDb');
const { authHeader } = require('./helpers/firebaseMock');

/**
 * The cross-cutting surface: health, profile, newsletter, and the response hardening that applies
 * to every route (IMP-092).
 */

const USER = { uid: 'seed-user-uid', email: 'traveller@easytrip.test', name: 'Tom Traveller' };
const ADMIN = { uid: 'seed-admin-uid', email: 'admin@easytrip.test' };

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

describe('GET /api/health', () => {
  test('reports healthy when the database is reachable', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
  });

  test('does not leak connection details', async () => {
    const body = JSON.stringify((await request(app).get('/api/health')).body);
    expect(body).not.toMatch(/password|postgresql:\/\/|127\.0\.0\.1:\d+/i);
  });
});

describe('GET /api/auth/check-admin', () => {
  test('401 without a token', async () => {
    expect((await request(app).get('/api/auth/check-admin')).status).toBe(401);
  });

  test('reports false for an ordinary user and true for an admin', async () => {
    const asUser = await request(app)
      .get('/api/auth/check-admin')
      .set({ Authorization: authHeader(USER) });
    const asAdmin = await request(app)
      .get('/api/auth/check-admin')
      .set({ Authorization: authHeader(ADMIN) });
    expect(asUser.status).toBe(200);
    expect(asAdmin.status).toBe(200);
    expect(JSON.stringify(asUser.body)).toContain('false');
    expect(JSON.stringify(asAdmin.body)).toContain('true');
  });

  test('agrees with the admin gate — one rule, two callers', async () => {
    // This endpoint is what the four /admin/* page gates trust. If it and the API gate could
    // disagree, a user could load an admin page whose every request then 403s.
    const header = { Authorization: authHeader(ADMIN) };
    expect((await request(app).get('/api/admin/admins').set(header)).status).toBe(200);

    await pool.query("UPDATE users SET is_admin = FALSE WHERE firebase_uid = 'seed-admin-uid'");

    const check = await request(app).get('/api/auth/check-admin').set(header);
    const gate = await request(app).get('/api/admin/admins').set(header);
    expect(JSON.stringify(check.body)).toContain('false');
    expect(gate.status).toBe(403);
  });
});

describe('GET /api/auth/profile', () => {
  test('401 without a token', async () => {
    expect((await request(app).get('/api/auth/profile')).status).toBe(401);
  });

  test('returns the caller’s own profile', async () => {
    const res = await request(app)
      .get('/api/auth/profile')
      .set({ Authorization: authHeader(USER) });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).toContain('traveller@easytrip.test');
  });

  test('a caller cannot read another user’s profile by asking for one', async () => {
    // There is no id parameter by design; identity comes from the token. Passing one must not
    // change whose profile comes back.
    const res = await request(app)
      .get('/api/auth/profile?firebase_uid=seed-admin-uid')
      .set({ Authorization: authHeader(USER) });
    expect(JSON.stringify(res.body)).not.toContain('admin@easytrip.test');
  });
});

describe('POST /api/newsletter', () => {
  test('accepts a valid address', async () => {
    const res = await request(app).post('/api/newsletter').send({ email: 'reader@example.com' });
    expect([200, 201]).toContain(res.status);

    const { rows } = await pool.query('SELECT count(*)::int AS n FROM newsletter_subscribers');
    expect(rows[0].n).toBe(1);
  });

  test.each([['not-an-email'], [''], ['@example.com'], ['a@'.repeat(200)]])(
    'rejects %p',
    async (email) => {
      const res = await request(app).post('/api/newsletter').send({ email });
      expect(res.status).toBe(400);
    }
  );

  test('subscribing twice does not create a duplicate', async () => {
    await request(app).post('/api/newsletter').send({ email: 'reader@example.com' });
    await request(app).post('/api/newsletter').send({ email: 'reader@example.com' });
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM newsletter_subscribers');
    expect(rows[0].n).toBe(1);
  });
});

describe('response hardening applies to every route', () => {
  test('helmet headers are present', async () => {
    const res = await request(app).get('/api/places');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers).toHaveProperty('x-frame-options');
  });

  test('the Express fingerprint is suppressed', async () => {
    const res = await request(app).get('/api/places');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  test('an unknown route 404s as JSON rather than an HTML stack page', async () => {
    const res = await request(app).get('/api/no-such-route');
    expect(res.status).toBe(404);
    expect(res.text).not.toMatch(/<pre>|at Object|node_modules/);
  });

  test('a malformed JSON body is a 400, not a stack trace', async () => {
    const res = await request(app)
      .post('/api/newsletter')
      .set('Content-Type', 'application/json')
      .send('{"email": ');
    expect(res.status).toBe(400);
    expect(res.text).not.toMatch(/at Object|node_modules/);
  });
});
