const { test, expect } = require('@playwright/test');

/**
 * Two client-side contracts that only a browser can check (`TD-018`).
 *
 * Both were assertions in the retired `verify-5-*` scripts (`VERIFICATION_LEDGER` §5), parked
 * because they are *page-level*: neither a jsdom component test nor an API test can see them. The
 * first needs real `localStorage` surviving a real navigation; the second needs the stylesheet a
 * browser actually computed.
 */

const LIKES_KEY = 'easytrip_liked_places';

test.describe('liked places persist under a stable storage key', () => {
  /**
   * The regression this exists for: **a key rename loses every user's saved likes, silently.**
   *
   * `useHomeCarousel` hardcodes `'easytrip_liked_places'` in two places — the read effect and the
   * write effect. Renaming one and not the other breaks the round trip with no error anywhere: new
   * likes save, and nothing ever reads them back.
   */
  test('a like is written under the expected key, as a list of place ids', async ({ page }) => {
    await page.goto('/');

    const likeButton = page.getByRole('button', { name: /^Like / });
    await expect(likeButton).toBeVisible();
    await likeButton.click();

    const stored = await page.evaluate((key) => window.localStorage.getItem(key), LIKES_KEY);

    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored);
    // The value shape is part of the contract: `likedPlaces.includes(id)` is what the UI does, so
    // an object or a list of objects would break the toggle even with the key intact.
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    expect(typeof parsed[0]).toBe('number');
  });

  test('a stored like is read back after a reload — the half that silently breaks', async ({
    page
  }) => {
    // Writing is the easy half; the regression is the *read* effect quietly not running, which a
    // write-only assertion never notices.
    //
    // Every seeded place is marked liked rather than one, deliberately: the hero carousel
    // autoplays, so which place is on screen after a reload is not deterministic. With all four
    // liked, whichever one is showing must report the liked state — and the assertion no longer
    // depends on timing. (An earlier version of this test liked a single place and was flaky for
    // exactly that reason.)
    await page.goto('/');
    await page.evaluate(
      ([key, value]) => window.localStorage.setItem(key, value),
      [LIKES_KEY, JSON.stringify([1, 2, 3, 4])]
    );

    await page.reload();

    // `aria-pressed` mirrors component state, and component state here can only have come from
    // localStorage being read back on mount.
    const button = page.getByRole('button', { name: /^Remove .* from your likes/ });
    await expect(button).toBeVisible();
    await expect(button).toHaveAttribute('aria-pressed', 'true');

    // And the stored value was not clobbered by the write effect firing on mount with empty state.
    const after = await page.evaluate((key) => window.localStorage.getItem(key), LIKES_KEY);
    expect(JSON.parse(after)).toEqual([1, 2, 3, 4]);
  });

  test('unliking removes it again, so the key is not write-only', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /^Like / }).click();
    await page.getByRole('button', { name: /^Remove .* from your likes/ }).click();

    const stored = await page.evaluate((key) => window.localStorage.getItem(key), LIKES_KEY);
    expect(JSON.parse(stored)).toEqual([]);
  });

  test('it does not collide with the recent-searches key', async ({ page }) => {
    // Two features write to `localStorage` on the same origin. `useRecentSearches` owns
    // `recentSearches`; if either ever adopted the other's key, one feature would silently eat the
    // other's data — and both would still "work" in isolation.
    await page.goto('/');
    await page.getByRole('button', { name: /^Like / }).click();

    const keys = await page.evaluate(() => Object.keys(window.localStorage));
    expect(keys).toContain(LIKES_KEY);
    expect(new Set(keys).size).toBe(keys.length);

    const recent = await page.evaluate(() => window.localStorage.getItem('recentSearches'));
    expect(recent).not.toBe(await page.evaluate((k) => window.localStorage.getItem(k), LIKES_KEY));
  });
});

test.describe('the map stylesheet is scoped where it must be and global where it must not', () => {
  /**
   * The regression this exists for: **Leaflet builds its own DOM, outside React.**
   *
   * styled-jsx works by stamping a `jsx-<hash>` class onto elements React renders and prefixing
   * every scoped rule with it. Leaflet's markers, popups and controls never pass through React, so
   * they never get that class — which means a rule for `.marker-pin` written in the *scoped* block
   * matches nothing and every marker loses its styling.
   *
   * `mapStyles.js` therefore exports two blocks: `css` for the elements `ExploreMap` renders
   * itself, and `css.global` for Leaflet's. Swapping either is silent — the page renders, the CSS
   * is present, and the wrong things are styled. That is the class of failure `BUG-046` belonged
   * to, and it is invisible to every other layer of the test suite.
   */
  const openMap = async (page) => {
    await page.goto('/browse');
    await page.getByRole('button', { name: 'Map', exact: true }).click();
    // The map is a dynamic import; wait for its own wrapper rather than a fixed timeout.
    await expect(page.locator('.map-wrapper')).toBeVisible({ timeout: 20_000 });
  };

  /** Every CSS rule the browser actually parsed, as selector text. */
  const selectors = (page) =>
    page.evaluate(() =>
      Array.from(document.styleSheets)
        .flatMap((sheet) => {
          try {
            return Array.from(sheet.cssRules);
          } catch {
            return []; // cross-origin sheet
          }
        })
        .filter((rule) => rule.selectorText)
        .map((rule) => rule.selectorText)
    );

  test('the component block IS scoped — its rules carry a jsx class', async ({ page }) => {
    await openMap(page);
    const all = await selectors(page);

    const wrapperRules = all.filter((s) => s.includes('.map-wrapper'));
    expect(wrapperRules.length).toBeGreaterThan(0);
    // If this block were emitted globally, `.map-wrapper` would appear bare and leak onto any other
    // page that ever uses that class name.
    expect(wrapperRules.every((s) => /\.jsx-\w+/.test(s))).toBe(true);
  });

  test('the Leaflet block is NOT scoped — its rules must match DOM React never touched', async ({
    page
  }) => {
    await openMap(page);
    const all = await selectors(page);

    // `.marker-pin` and `.custom-marker-icon` are built by Leaflet, so they can never carry a
    // styled-jsx class. A scoped rule for them matches nothing and the markers render unstyled.
    for (const leafletClass of ['.marker-pin', '.custom-marker-icon']) {
      const rules = all.filter((s) => s.includes(leafletClass));
      expect(rules.length).toBeGreaterThan(0);
      expect(rules.some((s) => !/\.jsx-\w+/.test(s))).toBe(true);
    }
  });

  test('the two blocks are genuinely different, or one of the assertions above is vacuous', async ({
    page
  }) => {
    // Guarding the guards: if everything were emitted the same way, one of the two tests above
    // would be asserting nothing while still passing.
    await openMap(page);
    const all = await selectors(page);

    const scoped = all.filter((s) => /\.jsx-\w+/.test(s));
    const global = all.filter(
      (s) => /marker-pin|custom-marker-icon/.test(s) && !/\.jsx-\w+/.test(s)
    );

    expect(scoped.length).toBeGreaterThan(0);
    expect(global.length).toBeGreaterThan(0);
  });

  /**
   * `IMP-132` — the panels' rules must reach the panels' elements.
   *
   * Scoping is not one property but two, and the suite only had the first: a rule can carry a
   * `jsx-` class **and still match nothing**, if the element it addresses is rendered by a
   * different component. That is precisely what was wrong here — `MapControls` and `MapSidebar`
   * are separate components, their rules lived in `ExploreMap`'s sheet, and of 785 elements on the
   * page exactly **2** carried the scoping class. The stylesheet was present, correct, and inert.
   *
   * So this asserts the pairing rather than the rule: the element carries a scoping class, **and**
   * the declaration written for it actually computes.
   */
  test('the control panel’s own rules reach its own elements', async ({ page }) => {
    await openMap(page);

    const button = page.locator('.control-button').first();
    await expect(button).toBeVisible();

    const applied = await button.evaluate((el) => ({
      scoped: /jsx-/.test(el.className.baseVal ?? el.className ?? ''),
      // `window.` prefixed deliberately: the root ESLint config declares two browser globals for
      // spec files and no more, so that a typo'd identifier stays an error (`TD-021`).
      display: window.getComputedStyle(el).display
    }));

    expect(applied.scoped).toBe(true);
    // `display: flex` is `.control-button`'s own declaration. Before the split it computed
    // `inline-block` — the browser default for a button — because the rule never matched.
    expect(applied.display).toBe('flex');
  });

  /**
   * `IMP-133` — the rules addressed to elements styled-jsx *cannot* scope.
   *
   * styled-jsx stamps its class onto bare lowercase DOM tags only, so **`motion.div` and
   * `react-icons` components never receive it**. `IMP-132` moved each sheet into the component that
   * renders its markup, which fixed everything rendered as a plain tag — and left the panel's own
   * root (`motion.div.map-sidebar`), every list row (`motion.button.place-item`) and the icons
   * still matching nothing. They are now anchored with `:global()` under a parent that was
   * *measured* to be scoped.
   *
   * The values below are each declared in exactly one rule, so a regression cannot satisfy them by
   * accident: before the fix they computed the browser's defaults.
   */
  test('the sidebar’s root and rows are styled, though styled-jsx cannot scope either', async ({
    page
  }) => {
    await openMap(page);
    await page.click('.control-button.sidebar-toggle');

    const sidebar = page.locator('.map-sidebar');
    await expect(sidebar).toBeVisible();

    // `.map-sidebar` is the component's own root, so nothing scoped sits above it and its rule is
    // the one deliberate bare `:global()` in the sheet. This assertion is what keeps that honest.
    await expect(sidebar).toHaveCSS('width', '320px');

    // `.place-item` is a `motion.button`; `flex` is its own declaration and `inline-block` is what
    // a button computes without it.
    const row = page.locator('.place-item').first();
    await expect(row).toHaveCSS('display', 'flex');

    // An icon component, anchored under `.place-rating`.
    await expect(page.locator('.star-icon').first()).toHaveCSS('color', 'rgb(251, 191, 36)');
  });
});
