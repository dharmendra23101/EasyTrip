const { test, expect } = require('@playwright/test');

/**
 * The place detail page (IMP-094).
 *
 * This page was 1,930 lines before Sprint 5.10 and carried two of the project's worst defects — the
 * non-functional review flow (C1) and a hydration mismatch (BUG-046). It is now 214 lines
 * delegating to a dozen components, each of which has unit coverage. What no unit test sees is the
 * assembled page: SSR, then hydration, then the client fetching reviews.
 */

test.describe('a place renders end to end', () => {
  test('shows the place and its seeded content', async ({ page }) => {
    await page.goto('/places/1');
    await expect(page.getByRole('heading', { name: /Hampi/i }).first()).toBeVisible();
  });

  test('a place that does not exist returns a real 404, not a soft one', async ({ page }) => {
    // `getStaticProps` returns `notFound: true`, which must produce an actual 404 *status* and the
    // custom 404 page. A soft 404 — 200 with an empty-looking page — is the SEO failure mode this
    // guards: crawlers index it as a real page.
    const response = await page.goto('/places/999999');

    expect(response.status()).toBe(404);
    await expect(page.getByRole('heading', { name: /couldn.t find that page/i })).toBeVisible();
    await expect(page.locator('body')).not.toContainText('Application error');
  });

  test('a non-numeric id is handled rather than reaching the database', async ({ page }) => {
    await page.goto('/places/not-a-number');
    await expect(page.locator('body')).not.toContainText('Application error');
  });
});

test.describe('the author-privacy contract holds in real HTML (IMP-021)', () => {
  test('no Firebase uid is present anywhere in the delivered page', async ({ page }) => {
    // The API suite asserts the JSON never carries a uid. This asserts the *page* does not either —
    // a uid could still reach the DOM through a prop, a `key`, a data attribute or a serialised
    // `__NEXT_DATA__` payload, none of which the API suite can see.
    await page.goto('/places/1');
    await expect(page.getByText('Otto Other').first()).toBeVisible();

    const html = await page.content();
    expect(html).not.toContain('seed-user-uid');
    expect(html).not.toContain('seed-other-uid');
    expect(html).not.toContain('seed-admin-uid');
  });

  test('the display name is shown as written', async ({ page }) => {
    // Names are deliberately NOT anonymised — only the uid is. A change that blanked the name would
    // pass a "no uid leaked" test while breaking the feature.
    await page.goto('/places/1');
    await expect(page.getByText('Otto Other').first()).toBeVisible();
  });
});

test.describe('ratings render the empty case correctly (BUG M-2)', () => {
  test('an unrated place does not display a zero rating', async ({ page }) => {
    // Badami is seeded with rating_sum 0 / rating_count 0. The bug rendered that as a zero-star
    // rating — a place nobody reviewed looking like a place everybody disliked. Asserted on the
    // rendered page because the bug was in the callers, not the helper.
    await page.goto('/places/4');
    await expect(page.getByRole('heading', { name: /Badami/i }).first()).toBeVisible();

    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(/\b0\.0\b/);
  });

  test('a rated place shows its server-computed average', async ({ page }) => {
    // Hampi is 9/2 = 4.5. If the page recomputed client-side it could disagree with what the API
    // sorted and filtered on.
    await page.goto('/places/1');
    await expect(page.getByText('4.5').first()).toBeVisible();
  });
});

test.describe('ODbL attribution for geocoded coordinates (IMP-127)', () => {
  // Fetched as raw HTML rather than driven through `page`, and that is the point: this page is
  // ISR-cached, so the notice has to be in what the server delivers. A licence notice that only
  // appears after hydration is absent for every crawler, every JS-less client, and every "view
  // source" — the same failure the empty `og:url` turned out to be (Sprint 8.1).
  test('the notice is in the server-delivered HTML for a geocoded place', async ({ request }) => {
    const html = await (await request.get('/places/1')).text();

    expect(html).toContain('Coordinates ©');
    expect(html).toContain('https://www.openstreetmap.org/copyright');
    expect(html).toContain('ODbL');
  });

  test('and is absent for a place whose coordinates nobody geocoded', async ({ request }) => {
    // Gokarna is seeded with real coordinates and no provenance. Crediting OpenStreetMap here
    // would be an invented claim rather than a licence fix.
    const html = await (await request.get('/places/3')).text();

    expect(html).not.toContain('Coordinates ©');
  });
});
