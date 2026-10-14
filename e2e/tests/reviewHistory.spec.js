const { test, expect } = require('@playwright/test');
const authEmulator = require('../auth-emulator');

/**
 * `GET /api/auth/reviews` through the real stack (`IMP-117`).
 *
 * `backend/tests/myReviews.test.js` pins twelve behaviours in-process with `firebase-admin` mocked.
 * What it cannot prove is that the endpoint answers correctly for a **real** token — signed by the
 * Auth Emulator, verified by the genuine `verifyIdToken()` (`ADR-028`).
 *
 * That matters more here than almost anywhere else in the API, because this endpoint deliberately
 * performs the correlation the public review endpoint exists to prevent: `IMP-021` anonymises
 * authors so nobody can gather one person's reviews across the site. This route gathers exactly
 * that, for exactly one person — so "the token decides who that person is" is the whole feature.
 */

const API = 'http://127.0.0.1:5100/api';
const state = authEmulator.readState();

test.skip(
  !state.enabled,
  `Firebase Auth Emulator unavailable — ${state.reason || 'reason not recorded'}`
);

const auth = (identity) => ({ Authorization: `Bearer ${state.tokens[identity].idToken}` });

/** Leave no rows behind: this suite shares a database with every other spec. */
const clear = async (request, identity) => {
  const res = await request.get(`${API}/auth/reviews`, { headers: auth(identity) });
  const { reviews } = await res.json();
  for (const review of reviews) {
    await request.delete(`${API}/places/${review.place_id}/reviews/${review.id}`, {
      headers: auth(identity)
    });
  }
};

test.beforeEach(async ({ request }) => {
  await clear(request, 'nonAdmin');
  await clear(request, 'admin');
});

test.describe('a review history belongs to one verified identity', () => {
  test('a review written with a real token comes back in that identity’s history', async ({
    request
  }) => {
    const posted = await request.post(`${API}/places/2/reviews`, {
      headers: auth('nonAdmin'),
      data: { rating: 5, comment: 'Written by the E2E user.' }
    });
    expect(posted.ok()).toBe(true);

    const res = await request.get(`${API}/auth/reviews`, { headers: auth('nonAdmin') });
    const { reviews } = await res.json();

    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({ place_id: 2, rating: 5 });
    // The place context the card renders — proving the join runs, not just the filter.
    expect(reviews[0].place_name).toEqual(expect.any(String));
  });

  test('a second real identity does not see it', async ({ request }) => {
    await request.post(`${API}/places/2/reviews`, {
      headers: auth('nonAdmin'),
      data: { rating: 5, comment: 'Mine.' }
    });

    const other = await request.get(`${API}/auth/reviews`, { headers: auth('admin') });
    expect((await other.json()).reviews).toEqual([]);
  });

  test('no token is a 401, not an empty history', async ({ request }) => {
    const res = await request.get(`${API}/auth/reviews`);
    expect(res.status()).toBe(401);
  });

  test('the response carries no Firebase uid', async ({ request }) => {
    await request.post(`${API}/places/2/reviews`, {
      headers: auth('nonAdmin'),
      data: { rating: 4, comment: 'No uid should appear here.' }
    });

    const res = await request.get(`${API}/auth/reviews`, { headers: auth('nonAdmin') });
    const body = JSON.stringify(await res.json());

    // `SECURITY_AUDIT` M7 removed uids from review payloads. A real uid is a real string here,
    // unlike the mocked suite where it is a fixture value.
    expect(body).not.toContain(state.tokens.nonAdmin.uid);
  });

  test('deleting through the place route empties the history', async ({ request }) => {
    await request.post(`${API}/places/2/reviews`, {
      headers: auth('nonAdmin'),
      data: { rating: 3, comment: 'Temporary.' }
    });

    const before = await request.get(`${API}/auth/reviews`, { headers: auth('nonAdmin') });
    const [review] = (await before.json()).reviews;

    const deleted = await request.delete(`${API}/places/2/reviews/${review.id}`, {
      headers: auth('nonAdmin')
    });
    expect(deleted.status()).toBe(204);

    const after = await request.get(`${API}/auth/reviews`, { headers: auth('nonAdmin') });
    expect((await after.json()).reviews).toEqual([]);
  });
});
