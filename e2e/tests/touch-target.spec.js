const { test, expect } = require('@playwright/test');

/**
 * Target size, which the accessibility gate cannot see (`PE-022`).
 *
 * ---------------------------------------------------------------------------
 * Why a second accessibility file, next to `axe.spec.js`
 * ---------------------------------------------------------------------------
 * `axe-core` does not implement **WCAG 2.5.8 Target Size (Minimum)**, and that is a deliberate
 * decision on its part rather than a gap: three of the criterion's four exceptions — *inline*,
 * *essential*, and *user agent control* — need a human to decide whether they apply. A rule that
 * cannot tell a link inside a sentence from a button beside one would be wrong constantly.
 *
 * So the axe gate scanned six public routes on every run, passed, and said nothing about the fact
 * that the **hero carousel indicators were 12×12** on desktop and **8×8 on the touch layout** — a
 * ninth of the required area, on the control that moves the hero. Found by measuring, not by
 * reading: `getBoundingClientRect()` on every interactive element on every public route.
 *
 * The three failures this file was written against, all fixed in the same sprint:
 *
 *   | control | was | route |
 *   | --- | --- | --- |
 *   | carousel indicators ×4 | 12×12, and 8×8 on mobile | `/` |
 *   | "Report this review" | 16×16, once per review | `/places/1` |
 *   | "More destinations" | 20 px tall | `/` |
 *
 * Every fix grew the **target** and left the design alone — the dot inside the 24×24 button is
 * still 12×12 — which is what the success criterion asks for and is why none of it needed a visual
 * decision.
 *
 * ---------------------------------------------------------------------------
 * 24, not 44, and the difference is a standard rather than a preference
 * ---------------------------------------------------------------------------
 * **24×24 is WCAG 2.5.8, level AA.** It is the bar this project already holds itself to elsewhere,
 * it is objective, and a control below it fails for everyone rather than looking cramped.
 *
 * 44×44 is a different thing: WCAG 2.5.5 (level **AAA**) and the iOS/Android platform guidance that
 * `IMP-034` follows for primary actions. Gating at 44 here was measured first and rejected: **60+
 * controls sit between 24 and 44**, nearly all of them filter chips and dense admin rows where 24 is
 * the honest number. A gate that fails sixty times on day one is a gate somebody switches off.
 *
 * So this file enforces the AA floor for everyone, and `IMP-034`'s 44 px remains a design standard
 * for primary actions that `Button.jsx` encodes — see `BL-120`, which is where that gets adopted.
 *
 * ---------------------------------------------------------------------------
 * What counts as a control, and the one exception written down
 * ---------------------------------------------------------------------------
 * `<button>` and `role="button"`, visible, enabled, rendered. Anchors are **excluded**: most links
 * here genuinely are inline in prose, which is the criterion's own exception, and including them
 * would mean a waiver list longer than the rule.
 */

/** The same six the axe gate scans, for the same reason: they are what an anonymous browser reaches. */
const ROUTES = ['/', '/browse', '/places/1', '/login', '/signup', '/about'];

/** WCAG 2.5.8, level AA. */
const MINIMUM = 24;

/**
 * Measure every visible control, and return the ones under the minimum.
 *
 * Runs in the page rather than through locators because there are ~150 controls across these routes
 * and a round trip each would make this the slowest file in the suite.
 */
const undersizedControls = (page) =>
  page.evaluate((minimum) => {
    const results = [];
    for (const element of document.querySelectorAll('button, [role="button"]')) {
      const style = getComputedStyle(element);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      // A disabled control cannot be hit at all, so its size is not a target-size question.
      if (element.disabled) continue;

      const rect = element.getBoundingClientRect();
      // Zero-sized means "not rendered on this layout" — a mobile-only control on a desktop
      // viewport, or a panel that has not been opened. Absent is not undersized.
      if (rect.width === 0 || rect.height === 0) continue;

      if (rect.width >= minimum && rect.height >= minimum) continue;

      results.push({
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        // Accessible-ish name first, so a failure names something a reader can find in the UI.
        label:
          element.getAttribute('aria-label') ||
          (element.textContent || '').trim().slice(0, 40) ||
          '(no text)',
        classes: (element.className || '').toString().slice(0, 80)
      });
    }
    return results;
  }, MINIMUM);

test.describe('every control is big enough to hit (WCAG 2.5.8)', () => {
  for (const route of ROUTES) {
    test(`${route} has no control under ${MINIMUM}x${MINIMUM}`, async ({ page }) => {
      // Reduced motion for the same reason `axe.spec.js` asks for it: a control mid-transform is a
      // control mid-measurement. `whileHover={{ scale: 1.2 }}` on the carousel dots is exactly that.
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(route);
      await page.waitForLoadState('networkidle').catch(() => {});

      const undersized = await undersizedControls(page);

      expect(
        undersized,
        `Controls below the ${MINIMUM}px minimum on ${route}:\n` +
          undersized.map((c) => `  ${c.height}x${c.width} — ${c.label} — ${c.classes}`).join('\n')
      ).toEqual([]);
    });
  }

  test('the mobile layout is measured too, because that is where a target is a finger', async ({
    page
  }) => {
    // The desktop and mobile heroes are **separate components** with separately written indicator
    // dots, and the mobile copy was the worse of the two at 8x8. A viewport-agnostic sweep would
    // have found one and missed the other; this asserts the layout that renders under a thumb.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await page.waitForLoadState('networkidle').catch(() => {});

    const undersized = await undersizedControls(page);

    expect(
      undersized,
      'Controls below the minimum on / at a phone viewport:\n' +
        undersized.map((c) => `  ${c.height}x${c.width} — ${c.label} — ${c.classes}`).join('\n')
    ).toEqual([]);
  });
});
