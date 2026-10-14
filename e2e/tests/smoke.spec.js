const { test, expect } = require('@playwright/test');

/**
 * The suite's own preconditions (IMP-094).
 *
 * Every other spec assumes a seeded database behind a real API behind a real Next server. If that
 * assumption is wrong, the rest of the suite fails in ways that look like product bugs. These check
 * the assumption directly, so a broken harness reports itself as a broken harness.
 */

test('the API is up and reports a live database', async ({ request }) => {
  const response = await request.get('http://127.0.0.1:5100/api/health');
  expect(response.ok()).toBeTruthy();
  expect(await response.json()).toMatchObject({ status: 'ok', database: true });
});

test('the seeded fixtures are the ones the assertions name', async ({ request }) => {
  // The specs refer to "Hampi" and "place 1" by name. If the seed ever changes, this fails here
  // rather than as a confusing selector timeout three files away.
  const response = await request.get('http://127.0.0.1:5100/api/places');
  const body = await response.json();
  expect(body.pagination.total).toBe(4);
  expect(body.data.map((place) => place.name).sort()).toEqual([
    'Badami',
    'Coorg',
    'Gokarna',
    'Hampi'
  ]);
});

test('the home page renders server-side and hydrates without errors', async ({ page }) => {
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(String(error)));

  await page.goto('/');
  await expect(page).toHaveTitle(/EasyTrip/i);

  // The home page's own data, not just its shell (IMP-129). `/` is `getStaticProps`, and its error
  // branch falls back to an empty catalogue with a 30s revalidate — so a run in which the API was
  // not yet answering produced a page that rendered, hydrated, titled itself correctly and
  // contained nothing. Every assertion above passed through that state. This one does not.
  await expect(page.getByText(/Hampi/i).first()).toBeVisible();

  // A hydration mismatch surfaces as a console error and nothing else — the page still renders,
  // which is why BUG-046 shipped twice. Asserting on the console is the only way to see it.
  expect(consoleErrors.filter((text) => /hydrat|did not match/i.test(text))).toEqual([]);
});
