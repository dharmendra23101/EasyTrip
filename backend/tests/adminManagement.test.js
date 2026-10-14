const request = require('supertest');
const app = require('../app');
const { createSchema, resetData, closeDb, resetRateLimits, pool } = require('./helpers/testDb');
const {
  authHeader,
  registerFirebaseUser,
  resetFirebaseUsers,
  __mock
} = require('./helpers/firebaseMock');

/**
 * Granting and revoking admin — `GET/POST/DELETE /api/admin/admins`.
 *
 * **Why this had no coverage, and why that mattered.** `adminController.js` sat at 22.91%
 * statements and **0% branch**. `auth.test.js` hits `GET /api/admin/admins` a dozen times, but only
 * ever as a *gate probe* — does this identity get 200 or 403 — and never asserts what the endpoint
 * returns. `addAdmin` and `removeAdmin` had never executed at all, because the Firebase mock had no
 * `getUserByEmail`: every request died inside the mock before reaching the code under test.
 *
 * So the least-tested surface in the API was the one that decides **who is an admin**.
 *
 * **The invariant that is easiest to break and hardest to see.** A promotion writes two places: the
 * `users.is_admin` column *and* the Firebase custom claim. `authMiddleware` treats a claim that
 * disagrees with the column as "one side is stale" and **denies the request** — so a half-applied
 * change does not fail open, it locks the user out of a role they legitimately hold. And
 * `setCustomUserClaims` **replaces** the entire claim set, so any other claim a user carries is
 * destroyed unless it is explicitly merged back. Neither behaviour is visible in a response body.
 */

const asAdmin = { Authorization: authHeader({ uid: 'seed-admin-uid' }) };
const asUser = { Authorization: authHeader({ uid: 'seed-user-uid' }) };

const ADMIN_EMAIL = 'admin@easytrip.test';
const TRAVELLER_EMAIL = 'traveller@easytrip.test';
const NEWCOMER_EMAIL = 'newcomer@easytrip.test';

beforeAll(async () => {
  await createSchema();
});

beforeEach(async () => {
  await resetData();
  resetRateLimits(app);
  resetFirebaseUsers();
  // Both are module-level jest.fn()s shared by every test in the file, so call counts accumulate
  // across tests unless they are cleared here. An assertion like "Firebase was never consulted"
  // silently measures the whole file otherwise.
  __mock.setCustomUserClaims.mockClear();
  __mock.getUserByEmail.mockClear();
  __mock.setCustomUserClaims.mockResolvedValue(undefined);

  // Mirrors the seeded rows, so a test can name either the email or the uid.
  registerFirebaseUser({ uid: 'seed-admin-uid', email: ADMIN_EMAIL, displayName: 'Ada Admin' });
  registerFirebaseUser({
    uid: 'seed-user-uid',
    email: TRAVELLER_EMAIL,
    displayName: 'Tom Traveller'
  });
});

afterAll(async () => {
  await closeDb();
});

const isAdminInDb = async (uid) =>
  (await pool.query('SELECT is_admin FROM users WHERE firebase_uid = $1', [uid])).rows[0]?.is_admin;

const claimCallFor = (uid) =>
  __mock.setCustomUserClaims.mock.calls.find(([calledUid]) => calledUid === uid);

describe('who may manage admins', () => {
  test('a signed-in non-admin cannot promote anyone', async () => {
    const res = await request(app)
      .post('/api/admin/admins')
      .set(asUser)
      .send({ email: TRAVELLER_EMAIL });

    expect(res.status).toBe(403);
    // The status alone would not catch a handler that ran and then returned 403.
    expect(await isAdminInDb('seed-user-uid')).toBe(false);
    expect(__mock.setCustomUserClaims).not.toHaveBeenCalled();
  });

  test('an anonymous request cannot demote anyone', async () => {
    const res = await request(app).delete(`/api/admin/admins/${ADMIN_EMAIL}`);

    expect(res.status).toBe(401);
    expect(await isAdminInDb('seed-admin-uid')).toBe(true);
    expect(__mock.setCustomUserClaims).not.toHaveBeenCalled();
  });
});

describe('listing admins', () => {
  test('returns only users whose is_admin column is true', async () => {
    const res = await request(app).get('/api/admin/admins').set(asAdmin);

    expect(res.status).toBe(200);
    const emails = res.body.map((u) => u.email);
    expect(emails).toContain(ADMIN_EMAIL);
    expect(emails).not.toContain(TRAVELLER_EMAIL);
  });

  test('a promotion shows up in the list, and a demotion removes it', async () => {
    // The round trip, rather than trusting either endpoint in isolation.
    await request(app).post('/api/admin/admins').set(asAdmin).send({ email: TRAVELLER_EMAIL });
    let emails = (await request(app).get('/api/admin/admins').set(asAdmin)).body.map(
      (u) => u.email
    );
    expect(emails).toContain(TRAVELLER_EMAIL);

    await request(app).delete(`/api/admin/admins/${TRAVELLER_EMAIL}`).set(asAdmin);
    emails = (await request(app).get('/api/admin/admins').set(asAdmin)).body.map((u) => u.email);
    expect(emails).not.toContain(TRAVELLER_EMAIL);
  });
});

describe('promoting a user to admin', () => {
  test('an existing user is updated in place, not duplicated', async () => {
    const res = await request(app)
      .post('/api/admin/admins')
      .set(asAdmin)
      .send({ email: TRAVELLER_EMAIL });

    expect(res.status).toBe(200);
    expect(await isAdminInDb('seed-user-uid')).toBe(true);
    // `firebase_uid` is UNIQUE, so a stray INSERT would 500 — but a second row for the same person
    // is the failure this is really about, and asserting the count says so directly.
    const { rows } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM users WHERE firebase_uid = $1',
      ['seed-user-uid']
    );
    expect(rows[0].n).toBe(1);
  });

  test('a Firebase user with no database row is inserted as an admin', async () => {
    // The other branch of the same handler, and the one that runs when an admin promotes somebody
    // who has signed in to Firebase but never had a row written for them.
    registerFirebaseUser({ uid: 'newcomer-uid', email: NEWCOMER_EMAIL, displayName: 'Nina New' });

    const res = await request(app)
      .post('/api/admin/admins')
      .set(asAdmin)
      .send({ email: NEWCOMER_EMAIL });

    expect(res.status).toBe(200);
    const { rows } = await pool.query(
      'SELECT email, name, is_admin FROM users WHERE firebase_uid = $1',
      ['newcomer-uid']
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email: NEWCOMER_EMAIL, name: 'Nina New', is_admin: true });
  });

  test('the Firebase claim is set to true alongside the column', async () => {
    // The two-place write. A promotion that updates only the column leaves the claim saying
    // `admin: false`, which authMiddleware reads as a mismatch and denies — so the user is promoted
    // and locked out at the same time.
    await request(app).post('/api/admin/admins').set(asAdmin).send({ email: TRAVELLER_EMAIL });

    const call = claimCallFor('seed-user-uid');
    expect(call).toBeDefined();
    expect(call[1]).toMatchObject({ admin: true });
  });

  test('existing custom claims survive the promotion', async () => {
    // `setCustomUserClaims` REPLACES the whole set. Without the merge in `syncAdminClaim`, granting
    // admin silently destroys every other claim the user holds — invisible in the response, and
    // invisible until whatever depended on that claim stops working.
    registerFirebaseUser({
      uid: 'seed-user-uid',
      email: TRAVELLER_EMAIL,
      displayName: 'Tom Traveller',
      customClaims: { tier: 'gold', region: 'in' }
    });

    await request(app).post('/api/admin/admins').set(asAdmin).send({ email: TRAVELLER_EMAIL });

    expect(claimCallFor('seed-user-uid')[1]).toEqual({ tier: 'gold', region: 'in', admin: true });
  });

  test('an email that is not in Firebase is a 404 and writes nothing', async () => {
    const res = await request(app)
      .post('/api/admin/admins')
      .set(asAdmin)
      .send({ email: 'ghost@easytrip.test' });

    expect(res.status).toBe(404);
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM users WHERE email = $1', [
      'ghost@easytrip.test'
    ]);
    expect(rows[0].n).toBe(0);
    expect(__mock.setCustomUserClaims).not.toHaveBeenCalled();
  });

  test.each([
    ['a missing email', {}],
    ['an email that is not an address', { email: 'not-an-email' }],
    ['an email over the 254-character cap', { email: `${'a'.repeat(250)}@e.test` }]
  ])('%s is rejected before Firebase is consulted', async (_label, body) => {
    // The rejection comes from the **route validator**, not from `addAdmin`'s own `if (!email)`
    // guard: `body('email').trim().isEmail()` and `handleValidationErrors` are both mounted ahead
    // of the handler (`adminRoutes.js:14-26`). That makes the controller's guard unreachable
    // through the routed stack — the same shape `VERIFICATION_LEDGER` §6.1 enumerates for
    // `placeReviewController`, and the reason `adminController.js` will not reach 100% branch
    // coverage no matter how many requests this file makes.
    //
    // What is worth asserting is the ordering, not which line produced it: nothing may reach
    // Firebase or the database on a malformed request.
    const res = await request(app).post('/api/admin/admins').set(asAdmin).send(body);

    expect(res.status).toBe(400);
    expect(__mock.getUserByEmail).not.toHaveBeenCalled();
    expect(__mock.setCustomUserClaims).not.toHaveBeenCalled();
  });

  test('a claim failure is reported, and the response says the database already changed', async () => {
    // The documented half-applied state. The column is committed before the claim call, so the
    // caller must be told that a retry is required rather than shown a bare 500 — otherwise the
    // user is an admin in the database and denied by the middleware, with nothing explaining why.
    __mock.setCustomUserClaims.mockRejectedValueOnce(new Error('firebase is down'));

    const res = await request(app)
      .post('/api/admin/admins')
      .set(asAdmin)
      .send({ email: TRAVELLER_EMAIL });

    expect(res.status).toBe(500);
    expect(res.body.message).toMatch(/granted admin in the database/i);
    expect(res.body.message).toMatch(/retry/i);
    // And the database change really did stand, or the message is a lie.
    expect(await isAdminInDb('seed-user-uid')).toBe(true);
  });
});

describe('revoking admin', () => {
  test('the column is set to false and the claim is cleared', async () => {
    const res = await request(app).delete(`/api/admin/admins/${ADMIN_EMAIL}`).set(asAdmin);

    expect(res.status).toBe(200);
    expect(await isAdminInDb('seed-admin-uid')).toBe(false);
    expect(claimCallFor('seed-admin-uid')[1]).toMatchObject({ admin: false });
  });

  test('other claims survive the demotion too', async () => {
    registerFirebaseUser({
      uid: 'seed-admin-uid',
      email: ADMIN_EMAIL,
      displayName: 'Ada Admin',
      customClaims: { tier: 'gold' }
    });

    await request(app).delete(`/api/admin/admins/${ADMIN_EMAIL}`).set(asAdmin);

    expect(claimCallFor('seed-admin-uid')[1]).toEqual({ tier: 'gold', admin: false });
  });

  test('an email that is not in Firebase is a 404', async () => {
    const res = await request(app).delete('/api/admin/admins/ghost@easytrip.test').set(asAdmin);

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/firebase/i);
    expect(__mock.setCustomUserClaims).not.toHaveBeenCalled();
  });

  test('a Firebase user with no database row is a 404, not a silent success', async () => {
    // The two 404s are different failures and the messages distinguish them: one means "no such
    // person", the other means "known person, nothing to demote".
    registerFirebaseUser({ uid: 'newcomer-uid', email: NEWCOMER_EMAIL });

    const res = await request(app).delete(`/api/admin/admins/${NEWCOMER_EMAIL}`).set(asAdmin);

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/database/i);
    expect(__mock.setCustomUserClaims).not.toHaveBeenCalled();
  });

  test('a claim failure is reported, and the response says access is already denied', async () => {
    // The mirror of the promotion case, and the asymmetry is deliberate: a stale `admin: true`
    // claim against `is_admin = false` is denied by the middleware, so the demotion has already
    // taken effect. The retry is to stop a later re-promotion reading as a mismatch.
    __mock.setCustomUserClaims.mockRejectedValueOnce(new Error('firebase is down'));

    const res = await request(app).delete(`/api/admin/admins/${ADMIN_EMAIL}`).set(asAdmin);

    expect(res.status).toBe(500);
    expect(res.body.message).toMatch(/already denied/i);
    expect(await isAdminInDb('seed-admin-uid')).toBe(false);
  });
});
