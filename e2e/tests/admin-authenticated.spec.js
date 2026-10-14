const { test, expect } = require('@playwright/test');
const authEmulator = require('../auth-emulator');

/**
 * The authenticated admin boundary, with real Firebase tokens (`TD-020`, `ADR-028`).
 *
 * Every token here is minted by the Firebase Auth Emulator and verified by the **real**
 * `firebase-admin` `verifyIdToken()` — the same call, on the same code path, that production makes.
 * No middleware is stubbed, no signature check is disabled, and no production file knows this suite
 * exists. `auth-emulator.js` explains why that mattered enough to be worth the machinery.
 *
 * The property under test is the one `IMP-002` was opened for:
 *
 *     "the token says admin"  ≠  "the database says admin"
 *
 * `resolveAdminStatus` treats `users.is_admin` as the authority and a Firebase custom `admin` claim
 * as no more than a cache of it. A disagreement resolves to **not** admin. The `claimOnly` identity
 * below exists solely to prove that with a genuinely signed token.
 */

const state = authEmulator.readState();

// A skipped test states its reason in the report; a silently-absent one does not. If the emulator
// could not run, this suite must look unavailable rather than look green.
test.skip(
  !state.enabled,
  `Firebase Auth Emulator unavailable — ${state.reason || 'reason not recorded'}`
);

/**
 * Ask the Next server for a page **without following redirects**, and read the gate's own answer.
 *
 * Navigating with `page.goto` and asserting the final URL cannot distinguish "the server-side gate
 * denied this" from "the gate allowed it and the page's client-side `useEffect` guard bounced the
 * user afterwards". Those are very different security postures — the second means admin HTML was
 * already sent — and a mutation test proved the distinction matters: reintroducing the `IMP-002`
 * defect left a final-URL assertion green because defence in depth covered for it.
 *
 * So the gate is asked directly. `getServerSideProps` returning `{ redirect }` becomes a 307 with a
 * `location`, and that is the thing under test.
 */
const gateDecision = async (request, path, identity) => {
  const response = await request.get(`http://127.0.0.1:3100${path}`, {
    headers: identity ? { Cookie: `et_id_token=${state.tokens[identity].idToken}` } : {},
    maxRedirects: 0
  });
  return { status: response.status(), location: response.headers()['location'] ?? null };
};

/**
 * Sign in the way an admin does — the real form, the real SDK, the real emulator (`TD-024`).
 *
 * **The cookie alone is not a browser session, and two tests here were quietly relying on it being
 * one.** A helper that only did `addCookies` used to live here; it satisfied the *server*, because
 * `getServerSideProps` reads `et_id_token` and lets the request through. The **client** then mounts,
 * `useAuth()` finds no user, and the page's own `useEffect` guard redirects to `/login` — measured
 * at roughly five seconds. It is deleted rather than kept beside this one: two helpers named for the
 * same act, one of which produces a half-signed-in page, is how the wrong one gets picked.
 *
 * So `expect(page).toHaveURL(/\/admin$/)` was a race against that bounce. It resolves on the first
 * poll that matches, so it passed whenever the check landed inside the window and failed when it did
 * not, and `TD-024` changed the timing by putting an emulator round trip into auth resolution. It
 * failed once in a full run on 2026-08-31 and is recorded in `NOTES` §92.
 *
 * The fix is not a longer timeout or a narrower assertion — it is to actually sign in, which is the
 * thing this file could not do until Sprint 8.30 and the gap `TD-020` stayed open for.
 */
const signInThroughTheForm = async (page) => {
  await page.goto('/login');
  await page.locator('#email').fill('e2e-admin@easytrip.test');
  await page.locator('#password').fill('e2e-password');
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForURL('http://127.0.0.1:3100/', { timeout: 20_000 });
};

test.describe('a real admin is allowed through', () => {
  test('the server-side gate lets the request through (200, no redirect)', async ({ request }) => {
    // The allow path. Until now every admin assertion in this suite proved a *denial*, which means
    // a gate that rejected everyone would have passed all of them.
    const { status, location } = await gateDecision(request, '/admin', 'admin');

    expect(status).toBe(200);
    expect(location).toBeNull();
  });

  test('and the page renders in a browser', async ({ page }) => {
    await signInThroughTheForm(page);
    await page.goto('/admin');

    await expect(page).toHaveURL(/\/admin$/);
    // The assertion that makes the first one mean something: the page is still there after the
    // client has had time to bounce it. Without a real session it reliably is not.
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await expect(page).not.toHaveURL(/\/login/);
  });

  test('the manage-places page renders the seeded catalogue', async ({ page }) => {
    // Proves the authenticated identity survives past the gate into a page that actually queries
    // the API — frontend and backend agreeing about who the caller is. Through a real sign-in, so
    // the catalogue it renders is fetched with a token the client itself holds.
    await signInThroughTheForm(page);
    await page.goto('/admin/managePlaces');

    await expect(page).toHaveURL(/managePlaces/);
    // `visible: true`, not `.first()`. The page renders a mobile list and a desktop table and hides
    // one by CSS, so the first match in DOM order is the hidden one — which only became reachable
    // once a real sign-in made the page fetch anything at all. Asserting on a hidden element would
    // be asserting that the markup exists rather than that an admin can see the catalogue.
    await expect(page.getByText('Hampi').filter({ visible: true }).first()).toBeVisible();
  });

  test('the API answers check-admin true for the same token', async ({ request }) => {
    // The gate and the API must agree — they share `resolveAdminStatus` precisely so they cannot
    // drift, and this asserts that from the outside.
    const response = await request.get('http://127.0.0.1:5100/api/auth/check-admin', {
      headers: { Authorization: `Bearer ${state.tokens.admin.idToken}` }
    });

    expect(response.ok()).toBeTruthy();
    expect(await response.json()).toMatchObject({ isAdmin: true });
  });
});

test.describe('a real, valid, NON-admin token is still refused', () => {
  test('the gate itself redirects home, not to login', async ({ request }) => {
    // The distinction matters: `/login` means "we do not know who you are", `/` means "we do and
    // you may not". Sending an authenticated user to a login page they have already satisfied is a
    // loop. This is the `HOME_REDIRECT` branch, which no previous test reached.
    //
    // Asserted on the gate's own response so no admin markup can have been sent.
    const { status, location } = await gateDecision(request, '/admin', 'nonAdmin');

    expect(status).toBe(307);
    expect(location).toBe('/');
  });

  test('the API answers check-admin false', async ({ request }) => {
    const response = await request.get('http://127.0.0.1:5100/api/auth/check-admin', {
      headers: { Authorization: `Bearer ${state.tokens.nonAdmin.idToken}` }
    });

    expect(response.ok()).toBeTruthy();
    expect(await response.json()).toMatchObject({ isAdmin: false });
  });

  test('a non-admin cannot delete a place', async ({ request }) => {
    // The gate is what stands between a signed-in traveller and the catalogue. Asserted against a
    // real token so it exercises verification, `loadDbUser` and `resolveAdminStatus` in order.
    const response = await request.delete('http://127.0.0.1:5100/api/admin/places/1', {
      headers: { Authorization: `Bearer ${state.tokens.nonAdmin.idToken}` }
    });

    expect([401, 403]).toContain(response.status());

    // And the place is still there — the assertion that would catch a gate that returns 403 after
    // having already done the work.
    const check = await request.get('http://127.0.0.1:5100/api/places/1');
    expect(check.ok()).toBeTruthy();
  });
});

test.describe('a signed admin CLAIM does not beat the database (IMP-002)', () => {
  /**
   * `claimOnly` carries a genuine, correctly-signed token whose payload contains `admin: true`,
   * set through the real Admin SDK — while its `users.is_admin` row is `false`.
   *
   * This is the exact shape of the original defect: the system trusted what the caller's token
   * asserted about itself. A token is evidence of *identity*; the database is the authority on
   * *privilege*. Nothing else in the suite can prove that distinction, because forging a claim
   * requires a token that genuinely verifies.
   */
  test('the gate refuses a token that claims admin while the database says otherwise', async ({
    request
  }) => {
    // Asserted on the gate's response rather than the final URL. A final-URL assertion passes even
    // with the defect reintroduced, because the page's client-side guard bounces the user after the
    // admin HTML has already been served — which is the failure, not the fix.
    const { status, location } = await gateDecision(request, '/admin', 'claimOnly');

    expect(status).toBe(307);
    expect(location).toBe('/');
  });

  test('check-admin reports false despite the admin claim', async ({ request }) => {
    const response = await request.get('http://127.0.0.1:5100/api/auth/check-admin', {
      headers: { Authorization: `Bearer ${state.tokens.claimOnly.idToken}` }
    });

    expect(response.ok()).toBeTruthy();
    expect(await response.json()).toMatchObject({ isAdmin: false });
  });

  test('the claim really is present in the token, or this suite proves nothing', async () => {
    // Guarding the guard. If `setCustomUserClaims` silently failed, the three assertions above
    // would pass for the boring reason that the token is an ordinary non-admin one.
    const [, payload] = state.tokens.claimOnly.idToken.split('.');
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));

    expect(decoded.admin).toBe(true);
    expect(decoded.user_id || decoded.sub).toBe(state.tokens.claimOnly.uid);
  });
});

/**
 * The limit of what this environment can prove — stated, not glossed.
 *
 * `FIREBASE_AUTH_EMULATOR_HOST` makes `firebase-admin` **skip signature verification**. That is the
 * documented behaviour and the whole reason the emulator can issue usable tokens at all. It means
 * this suite cannot test signature verification itself: a payload tampered with while keeping a
 * valid `aud`/`iss`/`exp` is *accepted* here and would be *rejected* in production.
 *
 * That was discovered by writing exactly that test and watching it fail. The assertion was wrong,
 * not the application — so the assertion was replaced rather than the code weakened, and the gap is
 * recorded here where the next reader meets it.
 *
 * **What is still genuinely verified under emulator mode**, and therefore worth asserting:
 * token structure, `aud`/`iss` matching the project, expiry — and every DB-backed authorization
 * decision, which is where this project's actual defects lived.
 *
 * Signature verification is covered instead by `auth-boundary.spec.js` (malformed and unsigned
 * tokens are rejected) and by the production guard in `env.js` that stops
 * `FIREBASE_AUTH_EMULATOR_HOST` reaching a real deployment. See `SECURITY_AUDIT` §12.2.
 */
test.describe('what the emulator still checks', () => {
  test('a token minted for a different project is rejected', async ({ request }) => {
    // `aud`/`iss` are validated even in emulator mode, so this exercises a real branch of
    // `verifyIdToken` rather than the application's own logic.
    const [header, payload, signature] = state.tokens.admin.idToken.split('.');
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const foreign = Buffer.from(
      JSON.stringify({
        ...decoded,
        aud: 'some-other-project',
        iss: 'https://securetoken.google.com/some-other-project'
      })
    ).toString('base64url');

    const response = await request.get('http://127.0.0.1:5100/api/auth/check-admin', {
      headers: { Authorization: `Bearer ${header}.${foreign}.${signature}` }
    });

    expect(response.status()).toBe(401);
  });

  test('an expired token is rejected', async ({ request }) => {
    const [header, payload, signature] = state.tokens.admin.idToken.split('.');
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const expired = Buffer.from(
      JSON.stringify({ ...decoded, exp: 1000000000, iat: 999999000 })
    ).toString('base64url');

    const response = await request.get('http://127.0.0.1:5100/api/auth/check-admin', {
      headers: { Authorization: `Bearer ${header}.${expired}.${signature}` }
    });

    expect(response.status()).toBe(401);
  });
});
