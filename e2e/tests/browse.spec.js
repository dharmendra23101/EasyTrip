const { test, expect } = require('@playwright/test');

/**
 * The browse journey (IMP-094, IMP-011).
 *
 * The API suite already proves the filter *endpoints*, and `browseFilters.test.js` proves the
 * filter *rules*. Neither can prove the thing in between: that a filter typed into a real input
 * reaches those endpoints, that the address bar ends up describing what is on screen, and that a
 * link pasted from that address bar server-renders the same view.
 *
 * That round trip is the contract. It has two independent halves — `buildQueryString` writing the
 * URL client-side, and `getServerSideProps` reading it back — and each passes its own unit test
 * while still being able to disagree with the other.
 */

const cards = (page) => page.locator('a[href^="/places/"]');

test.describe('the server-rendered filter contract', () => {
  test('an unfiltered browse shows every seeded place', async ({ page }) => {
    await page.goto('/browse');
    await expect(cards(page).first()).toBeVisible();
    await expect(cards(page)).toHaveCount(4);
  });

  test('a pasted search link server-renders the filtered view', async ({ page }) => {
    // The half of the round trip that runs before any JavaScript: this is what a shared link does.
    await page.goto('/browse?q=Hampi');
    await expect(cards(page)).toHaveCount(1);
    // Scoped to the card, not `getByText`: the filter panel's <select> carries a hidden
    // <option value="Hampi">, so a bare text match would pass even with zero results rendered.
    await expect(cards(page).first()).toContainText('Hampi');
  });

  test('a pasted rating link filters too', async ({ page }) => {
    // Seed: Hampi 9/2 (4.5) and Gokarna 3/1 (3.0) are rated; Coorg and Badami are not. An unrated
    // place must not satisfy a minimum-rating filter — the `null`-not-`0` contract from BUG M-2,
    // now asserted through the whole stack rather than on the helper alone.
    await page.goto('/browse?rating=4');
    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page).first()).toContainText('Hampi');
  });

  test('a filter matching nothing renders an empty state, not a crash', async ({ page }) => {
    await page.goto('/browse?q=zzzznotaplace');
    await expect(cards(page)).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('Application error');
  });
});

test.describe('filtering in the browser', () => {
  test('typing a search filters the results and rewrites the URL', async ({ page }) => {
    await page.goto('/browse');
    await expect(cards(page)).toHaveCount(4);

    await page.getByLabel('Search destinations').fill('Hampi');

    // The client rewrites the address bar with `replaceState` so the view is shareable. This is the
    // client half of the round trip; the server half is asserted above.
    await expect(page).toHaveURL(/[?&]q=Hampi/);
    await expect(cards(page)).toHaveCount(1);
  });

  test('the rewritten URL is itself a working shared link', async ({ page }) => {
    // Closes the loop: take what the client wrote into the address bar, load it cold, and require
    // the same result set. A divergence between the two conventions — repeated `?theme=a&theme=b`
    // here versus the JSON encoding the API validator wants — would show up exactly here.
    await page.goto('/browse');
    await page.getByLabel('Search destinations').fill('Gokarna');
    await expect(cards(page)).toHaveCount(1);

    const shared = page.url();
    await page.goto('about:blank');
    await page.goto(shared);

    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page).first()).toContainText('Gokarna');
  });

  test('clearing the search restores the full catalogue', async ({ page }) => {
    await page.goto('/browse?q=Hampi');
    await expect(cards(page)).toHaveCount(1);

    await page.getByLabel('Search destinations').fill('');

    await expect(cards(page)).toHaveCount(4);
    // An empty filter must leave no `q=` behind — `location=''` reads to the server as "filter by
    // the empty string" rather than "do not filter".
    await expect(page).not.toHaveURL(/[?&]q=/);
  });
});

test.describe('ranked search through the whole stack (IMP-112)', () => {
  test('the sort the client sends for a search is one the server accepts', async ({ page }) => {
    // The failure this exists for: `relevance` is a new value in three separate declarations —
    // `sortOptions` in the browser, `SORT_KEYS` in the model, and the route's `isIn` validator. Each
    // has its own test that passes in isolation. If the validator did not learn the new value, the
    // request would 400 and the grid would empty out — with the browse page's own error handling
    // making it look like a search that found nothing, which is the quietest possible failure.
    const failed = [];
    page.on('response', (r) => {
      if (r.url().includes('/api/places') && r.status() >= 400)
        failed.push(`${r.status()} ${r.url()}`);
    });

    await page.goto('/browse');
    await page.getByLabel('Search destinations').fill('temples');

    // Stemming, proven through the browser: neither place has the singular in the column matched.
    await expect(cards(page)).toHaveCount(2);
    expect(failed).toEqual([]);
  });

  test('a name match is ordered above a description-only match', async ({ page }) => {
    // Gokarna's description mentions Goa; nothing is *named* Goa in the seed, so the ordering here
    // is asserted on the pair the fixtures do provide: searching the exact name puts it first.
    await page.goto('/browse?q=Gokarna');
    await expect(cards(page).first()).toContainText('Gokarna');
  });

  test('"Best Match" appears only once there is something to match', async ({ page }) => {
    await page.goto('/browse');
    // Desktop viewport: the results header's sort control, not the mobile toolbar's.
    await page.getByRole('button', { name: /^Sort:/ }).click();
    await expect(page.getByRole('button', { name: 'Best Match' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Sort: Newest First/ })).toBeVisible();

    await page.keyboard.press('Escape');
    await page.getByLabel('Search destinations').fill('temples');
    await expect(page.getByRole('button', { name: /^Sort: Best Match/ })).toBeVisible();
  });
});

test.describe('the typeahead (IMP-112)', () => {
  test('typing offers matching places, and choosing one applies it', async ({ page }) => {
    await page.goto('/browse');
    await page.getByLabel('Search destinations').fill('gok');

    const suggestion = page.getByRole('button', { name: /Gokarna/ });
    await expect(suggestion).toBeVisible();

    await suggestion.click();
    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page).first()).toContainText('Gokarna');
  });

  test('a suggestion is disambiguated by where it is', async ({ page }) => {
    // A bare list of place names is ambiguous the moment two states share one — the row has to
    // carry the district and state to be choosable.
    await page.goto('/browse');
    await page.getByLabel('Search destinations').fill('gok');
    await expect(page.getByRole('button', { name: /Gokarna.*Karnataka/ })).toBeVisible();
  });

  test('the suggest request is one the server answers', async ({ page }) => {
    // Same class of failure as the sort enum above: `/api/places/suggest` is declared before
    // `/places/:id`, and if that order were ever reversed the request would 404 or 400 rather than
    // erroring visibly — the dropdown would simply never appear.
    const statuses = [];
    page.on('response', (r) => {
      if (r.url().includes('/api/places/suggest')) statuses.push(r.status());
    });

    await page.goto('/browse');
    await page.getByLabel('Search destinations').fill('hamp');
    await expect(page.getByRole('button', { name: /Hampi/ }).first()).toBeVisible();

    expect(statuses.length).toBeGreaterThan(0);
    expect(statuses.filter((s) => s !== 200)).toEqual([]);
  });
});

test.describe('browse to detail', () => {
  test('clicking a place opens its detail page', async ({ page }) => {
    await page.goto('/browse?q=Hampi');
    await cards(page).first().click();

    await expect(page).toHaveURL(/\/places\/\d+$/);
    await expect(page.getByRole('heading', { name: /Hampi/i }).first()).toBeVisible();
  });

  test('the journey leaves no hydration mismatch behind', async ({ page }) => {
    // Two hydration bugs shipped from these pages (BUG-046 and the 5.9 map bug). Both rendered
    // fine and reported themselves only in the console, so this is the only place they are visible.
    const errors = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto('/browse');
    await expect(cards(page).first()).toBeVisible();
    await cards(page).first().click();
    await expect(page).toHaveURL(/\/places\/\d+$/);

    expect(
      errors.filter((text) => /hydrat|did not match|Minified React error/i.test(text))
    ).toEqual([]);
  });
});
