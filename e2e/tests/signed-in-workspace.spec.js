const { test, expect } = require('@playwright/test');
const authEmulator = require('../auth-emulator');
const { PORTS } = require('../../playwright.config');

/**
 * A real browser, really signed in, on a client-rendered page (`TD-024`).
 *
 * **What was missing, and why it was a hole rather than a gap.** `admin-authenticated.spec.js` puts
 * a real emulator token into the `et_id_token` cookie and asks the SSR gate for its verdict. That
 * proves the gate. It proves nothing on the other side of it, because the browser was never signed
 * in — `frontend/src/config/firebase.js` had no way to reach the emulator, so `useAuth()` saw no
 * user and every page behind it bounced to `/login`.
 *
 * So the trip workspace, the wishlist, the profile and the admin place form were covered by
 * component tests against mocked services and by API tests against real HTTP, **and by nothing in
 * between** — the layer where a form actually submits, a token is actually attached, and a value
 * actually comes back after a reload. `TD-023` shipped a defect exactly there: the classification
 * radio had 13 component assertions and 2 API ones, and `getPlaceById` still did not select the
 * column, because no test had ever set the value in a browser and read it back.
 *
 * Every token below is minted by the emulator from a **sign-in the browser performed itself**,
 * through the same `signInWithEmailAndPassword` call production runs, and verified by the real
 * `firebase-admin` on the server. Nothing is stubbed on either side.
 */

const state = authEmulator.readState();

// Stated, not silent — the same rule the other authenticated specs follow. An unavailable emulator
// must look unavailable in the report rather than looking like coverage.
test.skip(
  !state.enabled,
  `Firebase Auth Emulator unavailable — ${state.reason || 'reason not recorded'}`
);

// The `nonAdmin` identity from `auth-emulator.js`: a real account, provisioned in the emulator and
// in `users`, with no admin rights. Everything here is an ordinary signed-in traveller.
const IDENTITY = { email: 'e2e-user@easytrip.test', password: 'e2e-password' };

/**
 * Sign in the way a person does: the real form, the real SDK, the real emulator.
 *
 * Deliberately not `addCookies`. The cookie is a *mirror* that `onIdTokenChanged` writes for the SSR
 * gate (`AuthContext`), and setting it by hand produces a page the server treats as authenticated
 * and the client does not — the exact half-signed-in state that makes a client-rendered page
 * untestable, and the reason this file exists.
 */
const signIn = async (page) => {
  await page.goto('/login');
  await page.locator('#email').fill(IDENTITY.email);
  await page.locator('#password').fill(IDENTITY.password);
  await page.getByRole('button', { name: /^sign in$/i }).click();

  // Sign-in redirects to `/`. Waiting for that navigation means a failed sign-in fails *here*, with
  // the login page still on screen and its error message readable, rather than three assertions
  // later somewhere that looks unrelated.
  await page.waitForURL(`${PORTS.BASE_URL}/`, { timeout: 20_000 });
};

test.describe('a browser that has actually signed in', () => {
  test('reaches the trip workspace instead of being bounced to /login', async ({ page }) => {
    await signIn(page);
    await page.goto('/trips');

    // `/trips` renders nothing until `useAuth()` resolves, then either the page or a redirect. This
    // heading is the client-side branch going the way no cookie-only journey could make it go.
    await expect(page.getByRole('heading', { name: 'My trips', level: 1 })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/trips');
  });

  test('the wishlist too, so this is a property of signing in and not of one page', async ({
    page
  }) => {
    await signIn(page);
    await page.goto('/saved');

    await expect(page.getByRole('heading', { name: 'Saved places', level: 1 })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/saved');
  });

  test('the identity the API sees is the one the browser signed in as', async ({
    page,
    context,
    request
  }) => {
    await signIn(page);

    // The token the SDK itself obtained, read from the mirror `AuthContext` writes — not one minted
    // by the harness. This is the assertion that fails if the emulator were wired to a different
    // project: the token would carry the wrong audience and `verifyIdToken` would reject it.
    const cookie = (await context.cookies()).find((entry) => entry.name === 'et_id_token');
    expect(cookie, 'signing in should mirror the ID token into et_id_token').toBeTruthy();

    const response = await request.get(`${PORTS.API_URL}/auth/profile`, {
      headers: { Authorization: `Bearer ${cookie.value}` }
    });

    expect(response.status()).toBe(200);
    expect(JSON.stringify(await response.json())).toContain(IDENTITY.email);
  });

  test('a trip created through the form survives a reload', async ({ page }) => {
    await signIn(page);
    await page.goto('/trips');

    // Unique to this run: the suite shares one database and `trips.spec.js` writes to it too.
    const title = `Browser trip ${Date.now()}`;

    await page.getByRole('button', { name: /new trip/i }).click();
    await page.locator('#trip-title').fill(title);
    await page.getByRole('button', { name: 'Create trip' }).click();

    // Creating navigates into the trip, and that URL is the first evidence the POST carried a token
    // the server accepted — an unauthenticated write would have surfaced an error and stayed put.
    await page.waitForURL(/\/trips\/\d+$/, { timeout: 20_000 });
    const workspaceUrl = page.url();
    await expect(page.getByText(title)).toBeVisible();

    // The round trip `TD-024` was opened for. A value that renders once could have come from the
    // form's own state; a value still there after the page is thrown away and rebuilt from the API
    // came from the database.
    await page.reload();
    await expect(page.getByText(title)).toBeVisible();
    expect(page.url()).toBe(workspaceUrl);
  });
});

/**
 * The day drawn on a map (`FV-026` stage c), through the whole stack.
 *
 * The panel's own logic is covered by 18 component assertions against a stubbed map. What those
 * cannot reach is everything between them and the database: the endpoint, `dayRouteService`'s
 * ordering, the service call, the hook, and a Leaflet instance that only exists in a real browser.
 *
 * The fixture is chosen to exercise the honest-refusal path as well as the happy one. Coorg is
 * seeded **with null coordinates**, so a day holding it produces a route with a stop the map cannot
 * draw — and `unmapped` is the field that has to say so. A journey with three mappable stops would
 * have proved the drawing and not the admission.
 */
test.describe('a day, drawn', () => {
  const auth = { Authorization: `Bearer ${state.tokens?.nonAdmin?.idToken}` };

  /** Leave no rows behind: every spec in this suite shares one database. */
  const clearTrips = async (request) => {
    const listed = await request.get(`${PORTS.API_URL}/auth/trips`, { headers: auth });
    if (!listed.ok()) return;
    const { trips = [] } = await listed.json();
    for (const trip of trips) {
      await request.delete(`${PORTS.API_URL}/auth/trips/${trip.id}`, { headers: auth });
    }
  };

  test.beforeEach(async ({ request }) => clearTrips(request));
  test.afterAll(async ({ request }) => clearTrips(request));

  test('the stops, the distance between them, and the one it could not place', async ({
    page,
    request
  }) => {
    // Set up through the API and assert through the browser. The write path already has its own
    // coverage in `trips.spec.js`; what is under test here is the reading and the drawing.
    const created = await request.post(`${PORTS.API_URL}/auth/trips`, {
      headers: auth,
      data: { title: 'Drawn day' }
    });
    expect(created.status()).toBe(201);
    const { trip } = await created.json();

    const workspace = await request.get(`${PORTS.API_URL}/auth/trips/${trip.id}`, {
      headers: auth
    });
    const dayId = (await workspace.json()).trip.days[0].id;

    // Hampi (15.335, 76.46) and Gokarna (14.55, 74.32) are ~250 km apart; Coorg is seeded with no
    // coordinates at all, which is the case `unmapped` exists for.
    for (const [position, place] of [
      [0, { place_id: 1, title: 'Hampi ruins' }],
      [1, { place_id: 2, title: 'Coorg, unplaceable' }],
      [2, { place_id: 3, title: 'Gokarna beach' }]
    ]) {
      const added = await request.post(
        `${PORTS.API_URL}/auth/trips/${trip.id}/days/${dayId}/items`,
        { headers: auth, data: { ...place, position } }
      );
      expect(added.status()).toBe(201);
    }

    await signIn(page);
    await page.goto(`/trips/${trip.id}`);

    // Scoped to the region rather than the page, and that is the point of the region existing.
    // Every day renders the same heading and the same button text, so an unscoped `getByText` for a
    // stop name matches twice — once in the day's item list, once in the route panel — which is a
    // real ambiguity for a screen reader before it is an inconvenience for a test.
    const panel = page.getByRole('region', { name: 'Day 1 on a map' });
    await expect(panel.getByRole('button', { name: /draw day 1/i })).toBeVisible();

    // Nothing is drawn until it is asked for — six days on page load would be six routing lookups
    // behind a panel the reader may never scroll to.
    await expect(panel.getByText(/km, about/)).toHaveCount(0);

    await panel.getByRole('button', { name: /draw day 1/i }).click();

    // The two mappable stops, in the order the day lists them, with a real distance between them.
    await expect(panel.getByText('Hampi ruins')).toBeVisible();
    await expect(panel.getByText('Gokarna beach')).toBeVisible();
    await expect(panel.getByText(/across 2 stops/)).toBeVisible();
    await expect(panel.getByText(/km, about \d+ min/).first()).toBeVisible();

    // The admission. A stop silently absent from a drawing is indistinguishable from a feature that
    // did not notice it.
    await expect(panel.getByText(/not linked to a place with coordinates/i)).toBeVisible();
    await expect(panel.getByText(/Coorg, unplaceable/)).toBeVisible();

    // With no OPENROUTESERVICE_API_KEY in this environment, every leg must be labelled an estimate
    // and the assumptions named. A measured claim here would mean the client called a provider the
    // suite never configured.
    await expect(panel.getByText(/\(estimated\)/).first()).toBeVisible();
    await expect(panel.getByText(/40 km\/h/)).toBeVisible();
    await expect(panel.getByText(/OpenRouteService/)).toHaveCount(0);

    // The map itself: `aria-hidden`, so it is addressed by test id rather than by role — which is
    // the accessibility design working, not a workaround for it.
    await expect(page.getByTestId('day-route-map-1')).toBeVisible();
    await expect(page.locator('.leaflet-container')).toBeVisible();
  });
});
