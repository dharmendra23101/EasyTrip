const { test, expect } = require('@playwright/test');

/**
 * The server-rendered pages, read by a client that does not run JavaScript (`IMP-123`).
 *
 * **The defect this guards.** `IMP-040` moved the home page and `/places/[id]` to `getStaticProps`
 * + ISR and `/browse` to `getServerSideProps`, so their content ships in the HTML. Framer Motion
 * then writes each `motion.*` element's `initial` prop into that same HTML as an inline
 * `opacity: 0`, and only animates to `opacity: 1` once `requestAnimationFrame` runs on the client.
 * The content is in the response body **and then hidden by the response body.** 89 such props
 * across 32 components, measured in Sprint 6.13.
 *
 * So the page was server-rendered for readers who cannot run the script that reveals it.
 *
 * **Why this file rather than an assertion on the HTML.** A `page.content()` check would show the
 * `opacity: 0` and prove nothing about whether a reader sees the text — that depends on the
 * cascade, on `!important`, and on whether the override reaches the right elements. The only honest
 * question is *"with scripting off, is the article visible?"*, and the only thing that can answer it
 * is a browser with scripting off.
 *
 * `javaScriptEnabled: false` also means React never hydrates, so what these tests see is exactly
 * the server's output rendered by a real engine — which is the closest this suite gets to what a
 * non-rendering consumer of the page reads.
 */

test.use({ javaScriptEnabled: false });

/**
 * Visible in the sense that matters: painted, not merely present in the DOM.
 *
 * `window.getComputedStyle` rather than the bare global, deliberately. A spec file is two runtimes
 * in one file — the body is Node, the `evaluate` callback is the browser — and the root lint config
 * declares only `window` and `document` so that a typo'd identifier stays an error rather than
 * resolving against one of the browser env's thousand globals. Qualifying the call says which
 * runtime this line belongs to and costs the config nothing.
 */
const expectReadable = async (locator) => {
  await expect(locator).toBeVisible();
  const opacity = await locator.evaluate((node) => window.getComputedStyle(node).opacity);
  expect(Number(opacity)).toBeGreaterThan(0.99);
};

test.describe('a place page is readable with scripting off', () => {
  test('the heading, the article and the sidebar are all painted', async ({ page }) => {
    await page.goto('/places/1');

    await expectReadable(page.getByRole('heading', { name: /Hampi/i }).first());
    // The description is the body of the article — the thing IMP-040 server-rendered the page for.
    await expectReadable(page.getByText(/ruined capital of Vijayanagara/i).first());
  });

  test('nothing in the served article is left at zero opacity', async ({ page }) => {
    await page.goto('/places/1');

    // Counts computed style rather than the inline attribute: the inline `opacity: 0` is still
    // there and is *supposed* to be — what must not survive is its effect.
    const hidden = await page.evaluate(
      () =>
        [...document.querySelectorAll('main *')].filter((node) => {
          const style = window.getComputedStyle(node);
          return (
            Number(style.opacity) < 0.99 && node.offsetParent !== null && node.textContent.trim()
          );
        }).length
    );

    expect(hidden).toBe(0);
  });

  test('and nothing is left displaced by an entrance offset', async ({ page }) => {
    await page.goto('/places/1');

    // `initial={{ opacity: 0, y: 20 }}` serialises a `translateY(20px)` beside the opacity.
    // Revealing the element without resetting it leaves the article permanently 20px out of
    // place, with no animation coming to put it back — visible, and subtly wrong.
    //
    // Scoped to exactly the elements the override targets, so a deliberate CSS transform
    // elsewhere on the page is not caught by a test about Framer's serialised initial state.
    const displaced = await page.evaluate(
      () =>
        [...document.querySelectorAll('[style*="opacity:0"], [style*="opacity: 0"]')].filter(
          (node) => window.getComputedStyle(node).transform !== 'none'
        ).length
    );

    expect(displaced).toBe(0);
  });
});

test.describe('the catalogue pages are readable with scripting off', () => {
  test('the home page paints its hero', async ({ page }) => {
    await page.goto('/');

    // The h1 rather than the carousel. `/` is `getStaticProps`, and this suite deliberately starts
    // the Next server independently of the API (see playwright.config.js), so the first render can
    // legitimately catch a fetch failure and fall back to an empty catalogue with a 30s revalidate.
    // Asserting on carousel content here would be asserting on that race. The hero is a
    // `motion.*` element either way, which is what this file is actually about.
    await expectReadable(page.getByRole('heading', { level: 1 }).first());
  });

  test('browse renders its cards rather than an empty grid', async ({ page }) => {
    // /browse is getServerSideProps, so a card set exists in the HTML. Without the override it is
    // a page of invisible cards, which reads to a human as "no results".
    await page.goto('/browse');

    // By role, not by text. `getByText(/Hampi/i)` matched the `<option>` inside the Location
    // filter — legitimately hidden, and a false failure that says nothing about the cards.
    await expectReadable(page.getByRole('heading', { name: 'Gokarna', level: 3 }).first());
    await expectReadable(page.getByRole('heading', { name: 'Badami', level: 3 }).first());
  });
});

test.describe('the override reveals content without revealing overlays', () => {
  test('no dialog, dropdown or lightbox is painted on load', async ({ page }) => {
    // The failure mode of a blanket `opacity: 1 !important`: something that is invisible *on
    // purpose* becomes visible. Overlays here are conditionally rendered by React state, so with
    // scripting off they should not be in the document at all — asserted rather than assumed,
    // because a component that renders its overlay always and hides it with `initial` would be
    // revealed by this fix and nobody would notice until a user saw it.
    await page.goto('/places/1');

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('[aria-modal="true"]')).toHaveCount(0);
    await expect(page.locator('[aria-expanded="true"]')).toHaveCount(0);
  });

  test('the rule is in the served HTML, inside noscript', async ({ request }) => {
    // It has to be inline in the document: a stylesheet request is itself something a degraded
    // client may not make, and a rule that arrives after the paint is a rule that did not help.
    const html = await (await request.get('/places/1')).text();

    // Matched loosely on the tag because Next emits its own `<noscript data-next-hide-fouc>` for
    // the FOUC guard, and pinning the exact markup would break on a framework detail rather than
    // on the behaviour. What must be true is that the rule ships, inside a noscript, in the body.
    expect(html).toMatch(/<noscript[^>]*>\s*<style[^>]*>[^<]*opacity:\s*1\s*!important/);
  });
});
