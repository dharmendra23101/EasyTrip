const { test, expect } = require('@playwright/test');

/**
 * Authorization boundaries, exercised through a real browser (IMP-094, IMP-001/002/003).
 *
 * **Why this is E2E and not an API test.** The API suite already proves `/api/auth/check-admin`
 * rejects an unverifiable token. What it cannot prove is that the *page* is protected: the admin
 * gate runs inside `getServerSideProps`, it reads a cookie a document request carries and the
 * Firebase SDK does not, and it decides between rendering, `/login` and `/`. That is three moving
 * parts — a cookie, a server-side fetch and a redirect — and none of them exists in an API test.
 *
 * This is also the highest-consequence thing in the codebase. The original audit found admin routes
 * that were protected only by a client-side `useEffect`, which is a suggestion rather than a gate:
 * the HTML had already been sent. A regression here does not look like a bug, it looks like a page
 * that loads.
 *
 * **No Firebase authentication is performed.** The suite drives the `et_id_token` cookie directly,
 * because that cookie *is* what the server-side gate reads — the real SDK would only be a slower
 * way of setting it. Every token used here is deliberately unverifiable, so these specs assert the
 * deny paths. The allow path needs a token `firebase-admin` will accept, which needs the Firebase
 * Auth Emulator; that is recorded as the next step in `e2e/README.md` rather than faked here.
 */

const ADMIN_PAGES = ['/admin', '/admin/managePlaces', '/admin/addPlace', '/admin/editPlace/1'];

test.describe('admin pages are gated server-side', () => {
  for (const path of ADMIN_PAGES) {
    test(`${path} redirects an anonymous visitor to /login`, async ({ page }) => {
      const response = await page.goto(path);

      await expect(page).toHaveURL(/\/login/);
      // The redirect must happen before any admin markup is sent. If the gate regressed to a
      // client-side guard, the admin HTML would arrive first and only then bounce — visible here
      // as admin content in the response body.
      expect(response.status()).toBeLessThan(400);
      await expect(page.locator('body')).not.toContainText('Manage Places');
    });
  }

  test('an unverifiable token is refused, not trusted', async ({ page, context }) => {
    // A forged cookie. `firebase-admin` cannot verify it, `/auth/check-admin` answers 401, and the
    // gate redirects. The failure mode this guards against is a gate that treats "the check errored"
    // as "let them through".
    await context.addCookies([
      {
        name: 'et_id_token',
        value: 'not.a.real.token',
        domain: '127.0.0.1',
        path: '/'
      }
    ]);

    await page.goto('/admin');
    await expect(page).toHaveURL(/\/login/);
  });

  test('a syntactically plausible but unsigned JWT is also refused', async ({ page, context }) => {
    // Shaped like a real token — three base64 segments, an `admin: true` claim — so it defeats any
    // check that merely looks at the shape. The signature is the thing that matters, and the claim
    // is not the authority: `users.is_admin` is (IMP-002/003).
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ uid: 'seed-admin-uid', admin: true, exp: 9999999999 })
    ).toString('base64url');

    await context.addCookies([
      {
        name: 'et_id_token',
        value: `${header}.${payload}.forged-signature`,
        domain: '127.0.0.1',
        path: '/'
      }
    ]);

    await page.goto('/admin');
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('the review boundary on a place page', () => {
  test('an anonymous visitor is invited to sign in, not shown a broken form', async ({ page }) => {
    // The C1 failure mode was the opposite of this: a form that rendered, accepted input and could
    // never submit. Showing the sign-in panel instead is the honest state.
    await page.goto('/places/1');

    await expect(page.getByText(/sign in to review/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /submit review/i })).toHaveCount(0);
  });

  test('the reviews themselves are still readable while signed out', async ({ page }) => {
    // Reviews are public; only writing them is gated. A gate that hid the content too would be a
    // regression in the opposite direction.
    await page.goto('/places/1');
    await expect(page.getByText('Otto Other').first()).toBeVisible();
  });
});
