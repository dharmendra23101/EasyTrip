const { test, expect } = require('@playwright/test');

/**
 * Hindi, in a real browser (`IMP-114`).
 *
 * **Everything else about the locale feature is proved against a mocked router.** Thirteen component
 * assertions cover the dictionary, the fallback ladder, the switcher and the `lang` attribute — and
 * every one of them mocks `next/router`, which means **nothing had ever loaded a Hindi page**. The
 * routing itself (`next.config.js`'s `i18n` block) is the one part unit tests structurally cannot
 * reach, and it is also the part most able to break every URL in the product at once.
 *
 * So these assertions are deliberately about the things only a server can answer:
 *
 * - `/hi` is served rather than 404ing,
 * - the served HTML carries `lang="hi"` — the attribute a screen reader believes,
 * - the default locale stays **unprefixed**, so no existing URL moved,
 * - and `Accept-Language: hi` does **not** redirect, because `localeDetection` is off by decision.
 */

const BASE = 'http://127.0.0.1:3100';

test.describe('locale routing, as the server actually serves it', () => {
  test('a Hindi page is served, and renders Hindi', async ({ page }) => {
    await page.goto(`${BASE}/hi/login`);

    // The navbar is the translated surface. "लॉग इन" is `nav.login`.
    await expect(page.locator('nav').getByText('लॉग इन').first()).toBeVisible();
  });

  test('the served HTML declares the language it is in', async ({ request }) => {
    // Asserted against the *served* markup rather than the DOM, because `lang` is written by
    // `_document` at render time and this is the only layer that can prove it arrived.
    const response = await request.get(`${BASE}/hi/login`);
    const html = await response.text();

    expect(response.status()).toBe(200);
    expect(html).toContain('lang="hi"');
  });

  test('English stays unprefixed, so no existing URL moved', async ({ request }) => {
    // The property that made adding `i18n` safe: Next leaves the default locale unprefixed, so
    // every link, bookmark and test that existed before still resolves unchanged.
    const english = await request.get(`${BASE}/login`);
    expect(english.status()).toBe(200);
    expect(await english.text()).toContain('lang="en"');
  });

  test('`/en/...` is also served — an alias Next never generates, asserted rather than assumed', async ({
    request
  }) => {
    // This test asserted the opposite first, and was wrong. Next **does** serve the prefixed
    // default locale; it simply never *emits* such a link, and with `localeDetection: false` it
    // never redirects to one either. So `/en/login` and `/login` are the same page at two URLs.
    //
    // Recorded as behaviour rather than quietly "fixed", because the consequence is real but small:
    // it is a duplicate URL, and the only pages with a canonical tag today are place pages
    // (`PlaceSeoHead`). Nothing links to `/en/...`, nothing in `sitemap.xml` emits it, and a crawler
    // reaches it only if somebody types it — see `KNOWN_LIMITATIONS.md`.
    const prefixed = await request.get(`${BASE}/en/login`, { maxRedirects: 0 });

    expect(prefixed.status()).toBe(200);
    expect(await prefixed.text()).toContain('lang="en"');
  });

  test('a Hindi-speaking browser is not redirected, because the choice is the reader’s', async ({
    request
  }) => {
    // `localeDetection: false` is a product decision, not a default: the dictionary is deliberately
    // allowed to be partial, so auto-redirecting on `Accept-Language` would send exactly the readers
    // most likely to notice it is partial. This is the assertion that stops somebody "fixing" that.
    const response = await request.get(`${BASE}/login`, {
      headers: { 'Accept-Language': 'hi-IN,hi;q=0.9' },
      maxRedirects: 0
    });

    expect(response.status()).toBe(200);
    expect(await response.text()).toContain('lang="en"');
  });

  test('the switcher moves between them, keeping the page', async ({ page }) => {
    await page.goto(`${BASE}/login`);

    const switcher = page.getByRole('combobox', { name: /language|भाषा/i });
    await expect(switcher).toBeVisible();
    await switcher.selectOption('hi');

    // Same page, different locale — switching language must not cost the reader their place.
    await expect(page).toHaveURL(/\/hi\/login/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
  });

  test('the catalogue stays English, and that is the documented boundary', async ({ page }) => {
    // `KNOWN_LIMITATIONS.md` records this rather than hiding it: the chrome is translated and the
    // place data is not, because the data is English rows in Postgres. Asserting it means the
    // boundary is a decision somebody can find, not a gap somebody discovers.
    await page.goto(`${BASE}/hi/browse`);

    // A card link, not a bare text match. `browse.spec.js` already documents why: the filter
    // `<select>` contains `<option value="Hampi">`, so `getByText('Hampi')` resolves to a hidden
    // option and passes with **zero results rendered**. This test walked into that trap on its
    // first run despite the warning sitting in a sibling file.
    //
    // `*=` rather than `^=`, and that is the second thing this test learned: under locale routing
    // Next rewrites every `<Link>` to carry the prefix, so the card points at `/hi/places/1`.
    // Addressed by id, not by position: the third thing this test learned is that the default
    // browse order puts Badami first, so `.first()` was asserting the wrong card. Place 1 is Hampi
    // in the seed, and `smoke.spec.js` guards that fixture.
    //
    // The `/hi/` prefix in the selector is itself the assertion that navigation stays inside the
    // locale — a Hindi reader clicking through does not fall back to English halfway.
    const card = page.locator('a[href="/hi/places/1"]');

    await expect(card).toContainText('Hampi');
  });
});
