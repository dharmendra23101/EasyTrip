const { test, expect } = require('@playwright/test');
const authEmulator = require('../auth-emulator');

/**
 * The wishlist through the real stack (`IMP-108`, `ADR-030`).
 *
 * **Why this exists on top of `backend/tests/savedPlaces.test.js`.** That suite drives the Express
 * app in-process with `firebase-admin` mocked, which is the right instrument for the 25 behaviours
 * it pins. What it cannot prove is that the endpoints work when the token is a **real** one — signed
 * by the Firebase Auth Emulator and verified by the genuine `verifyIdToken()` on the genuine code
 * path, against a genuine Postgres, behind the real rate limiters (`ADR-028`).
 *
 * That distinction is not academic here. The wishlist's entire privacy model is *"the owner is
 * whoever the verified token says they are"*, so the one thing worth re-proving end to end is that
 * two different real identities get two different wishlists.
 *
 * **What is deliberately not here: a browser journey.** The heart buttons call the API with a token
 * from the Firebase **client** SDK, and signing that SDK in inside Playwright is the open remainder
 * of `TD-020` — the cookie this suite's admin specs set reaches the SSR gate, not `auth.currentUser`.
 * Asserting on a browser heart today would mean asserting on the signed-*out* localStorage path,
 * which `client-contracts.spec.js` already covers properly. Faking a browser session to make a test
 * look end-to-end would prove less than this does, not more.
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
  const current = await request.get(`${API}/auth/favorites`, { headers: auth(identity) });
  const { placeIds } = await current.json();
  for (const placeId of placeIds) {
    await request.delete(`${API}/auth/favorites/${placeId}`, { headers: auth(identity) });
  }
};

test.beforeEach(async ({ request }) => {
  await clear(request, 'nonAdmin');
  await clear(request, 'admin');
});

test.describe('a wishlist belongs to one verified identity', () => {
  test('a place saved with a real token comes back for that identity', async ({ request }) => {
    const saved = await request.post(`${API}/auth/favorites`, {
      headers: auth('nonAdmin'),
      data: { place_id: 1 }
    });
    expect(saved.status()).toBe(200);

    const read = await request.get(`${API}/auth/favorites`, { headers: auth('nonAdmin') });
    const body = await read.json();

    expect(body.placeIds).toEqual([1]);
    expect(body.places[0]).toMatchObject({ id: 1 });
    expect(body.places[0].name).toEqual(expect.any(String));
  });

  test('a second real identity sees an empty wishlist, not the first one’s', async ({
    request
  }) => {
    // The assertion the whole feature rests on, with two genuinely different signed tokens rather
    // than two mock payloads.
    await request.post(`${API}/auth/favorites`, {
      headers: auth('nonAdmin'),
      data: { place_id: 2 }
    });

    const other = await request.get(`${API}/auth/favorites`, { headers: auth('admin') });
    const body = await other.json();

    expect(body.placeIds).toEqual([]);
    expect(body.places).toEqual([]);
  });

  test('one identity cannot delete another’s saved place', async ({ request }) => {
    await request.post(`${API}/auth/favorites`, {
      headers: auth('nonAdmin'),
      data: { place_id: 3 }
    });

    const attempt = await request.delete(`${API}/auth/favorites/3`, { headers: auth('admin') });
    expect(attempt.status()).toBe(200);
    expect((await attempt.json()).removed).toBe(false);

    // Still there. An admin token is deliberately used as the attacker here: elevated privilege
    // elsewhere in the app must not imply access to somebody's personal list.
    const owner = await request.get(`${API}/auth/favorites`, { headers: auth('nonAdmin') });
    expect((await owner.json()).placeIds).toEqual([3]);
  });

  test('no token at all is a 401, not an empty list', async ({ request }) => {
    const response = await request.get(`${API}/auth/favorites`);
    expect(response.status()).toBe(401);
  });

  test('a token that is not a token is a 401', async ({ request }) => {
    const response = await request.get(`${API}/auth/favorites`, {
      headers: { Authorization: 'Bearer not-a-real-token' }
    });
    // The real `verifyIdToken` rejects this — the in-process suite proves the same thing against a
    // mock that was told to. Only one of the two proves the signature is actually checked.
    expect(response.status()).toBe(401);
  });
});

test.describe('the saved state survives, which is the whole point of IMP-108', () => {
  test('a save made in one request is still there in a later, independent one', async ({
    request
  }) => {
    // "Persistence across reload", asserted where persistence actually lives. The heart used to be
    // `useState(false)` on the detail page — this is the assertion that fails against that.
    await request.post(`${API}/auth/favorites`, {
      headers: auth('nonAdmin'),
      data: { place_id: 4 }
    });

    const later = await request.get(`${API}/auth/favorites`, { headers: auth('nonAdmin') });
    expect((await later.json()).placeIds).toContain(4);
  });

  test('saving twice through the real stack is still one entry', async ({ request }) => {
    await request.post(`${API}/auth/favorites`, {
      headers: auth('nonAdmin'),
      data: { place_id: 1 }
    });
    const again = await request.post(`${API}/auth/favorites`, {
      headers: auth('nonAdmin'),
      data: { place_id: 1 }
    });

    expect(again.status()).toBe(200);
    expect((await again.json()).created).toBe(false);

    const read = await request.get(`${API}/auth/favorites`, { headers: auth('nonAdmin') });
    expect((await read.json()).placeIds).toEqual([1]);
  });

  test('the saved-places page is not reachable without signing in', async ({ page }) => {
    // The page renders somebody's personal list, so an anonymous visitor must not land on it. The
    // page-level assertion is worth having on top of the API 401: a client-side guard that only
    // *fetches* correctly would still paint the chrome of a private page first.
    await page.goto('/saved');

    await expect(page).toHaveURL(/\/login/);
  });

  test('saving a place that does not exist is a 404 and stores nothing', async ({ request }) => {
    const response = await request.post(`${API}/auth/favorites`, {
      headers: auth('nonAdmin'),
      data: { place_id: 999999 }
    });

    expect(response.status()).toBe(404);
    const read = await request.get(`${API}/auth/favorites`, { headers: auth('nonAdmin') });
    expect((await read.json()).placeIds).toEqual([]);
  });
});
