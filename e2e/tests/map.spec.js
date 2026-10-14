const { test, expect } = require('@playwright/test');

/**
 * The map's reported zoom is the map's real zoom (`BUG-045`).
 *
 * **Why this is an E2E test and not a unit test.** The property is an agreement between Leaflet's
 * internal state and React state, and the thing that breaks it is Leaflet clamping a requested zoom
 * during construction. Mocking Leaflet would assert the mock; jsdom cannot lay out tiles. The only
 * honest place to check "what the user sees matches what the map is doing" is a real browser.
 *
 * **Why it can be tested now, when the bug register said it could not.** `BUG-045` and `IMP-123`
 * both recorded that "the verification browser runs the page with `document.hidden === true`
 * permanently and `requestAnimationFrame` never fires — 0 frames in 500 ms, measured", which would
 * freeze Framer Motion at its `initial` opacity and stall Leaflet's animated zoom. That was
 * measured against the retired `verify-5-*` harness. Re-measured in **this** Playwright browser:
 * **24 frames in 500 ms, `document.hidden === false`**. The blocker was a property of a tool the
 * project no longer uses.
 *
 * Re-measuring it also disproved half the bug. "Clicking either custom zoom button leaves the
 * rendered tiles at z=6" does not reproduce: the tiles go 6 → 7 → 8. What survives is the initial
 * mismatch, which is what this file guards.
 */

/** The zoom level Leaflet is actually rendering, read from a tile URL (`/{z}/{x}/{y}.png`). */
const tileZoom = (page) =>
  page.evaluate(() => {
    const tile = document.querySelector('img.leaflet-tile');
    const match = tile && tile.src.match(/\/(\d+)\/\d+\/\d+\.png/);
    return match ? Number(match[1]) : null;
  });

/** The zoom level the overlay counter claims, from `MapControls`' `Z: n.n`. */
const displayedZoom = async (page) => {
  const match = (await page.evaluate(() => document.body.innerText)).match(/Z:\s*([\d.]+)/);
  return match ? Number(match[1]) : null;
};

const openMap = async (page) => {
  await page.goto('/browse');
  await page.getByRole('button', { name: /map/i }).first().click();
  await page.waitForSelector('img.leaflet-tile');
  // Tiles for the settled zoom level, not the ones mid-transition.
  await page.waitForTimeout(2500);
};

test.describe('the map reports the zoom it is actually at', () => {
  test('on first render, before anything has been zoomed', async ({ page }) => {
    // The regression itself. The map is asked for zoom 5 and clamped to `minZoom: 6`, so a counter
    // seeded from the prop says 5 over tiles at 6 — and stays wrong until the user happens to zoom.
    await openMap(page);

    const tiles = await tileZoom(page);
    const shown = await displayedZoom(page);

    expect(tiles).not.toBeNull();
    expect(shown).not.toBeNull();
    expect({ shown, tiles }).toEqual({ shown: tiles, tiles });
  });

  test('the initial zoom is the clamped one, or this test would pass for the wrong reason', async ({
    page
  }) => {
    // If Leaflet ever stopped clamping — `minZoom` lowered, or the default raised — the two values
    // would agree at 5 and the assertion above would hold while proving nothing about the bug.
    // Pinning the actual value keeps it honest.
    await openMap(page);
    expect(await tileZoom(page)).toBe(6);
  });

  test('and it keeps agreeing after zooming in', async ({ page }) => {
    // The `zoomend` path always worked; this is here so a fix that only patched the initial value
    // and broke the live sync would not pass.
    await openMap(page);

    await page
      .getByRole('button', { name: /zoom in/i })
      .first()
      .click();
    await page.waitForTimeout(2500);

    const tiles = await tileZoom(page);
    expect(tiles).toBe(7);
    expect(await displayedZoom(page)).toBe(tiles);
  });
});
