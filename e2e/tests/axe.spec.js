const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const authEmulator = require('../auth-emulator');
const { PORTS } = require('../../playwright.config');

/**
 * The accessibility gate (`PE-022`).
 *
 * **Why this exists, and why now.** Sprint 6.17 ran `axe-core` across seven routes once, by hand,
 * with a throwaway spec that was deleted afterwards. Four routes came back clean. Twenty sprints
 * later, re-measuring found **one** clean route: three landmark violations and a heading skip had
 * accumulated on `/places/1`, and two sign-in pages had lost their `h1`.
 *
 * Nothing regressed loudly. Every one of those arrived in a change that looked right, passed 131
 * browser journeys, and was reviewed. **A one-off audit measures a day; a gate measures every day**,
 * and the gap between those two is exactly what this file closes. The defects it found on its first
 * run are fixed in the same sprint.
 *
 * ---------------------------------------------------------------------------
 * No new dependency
 * ---------------------------------------------------------------------------
 * `axe-core` is already in the frontend tree — `eslint-plugin-jsx-a11y` depends on it — so this
 * reads the bundle off disk and injects it. `@axe-core/playwright` would be a nicer API and a new
 * direct dependency for a wrapper around `axe.run()`, which `SESSION_PROTOCOL` §11.4b asks us not to
 * take without a reason.
 *
 * ---------------------------------------------------------------------------
 * What it gates on, and what it deliberately does not
 * ---------------------------------------------------------------------------
 * Everything `axe` reports, at **zero**, except the entries in `ACCEPTED` — each of which carries a
 * reason and a node count. That is the same shape as `check-secrets`' and `check-module-size`'s
 * waiver lists, and it is chosen over the easier alternatives on purpose:
 *
 *   - **Gating on `critical` only** passes today and would have caught none of the four defects
 *     above, all of which are `moderate` or `serious`.
 *   - **Disabling the `color-contrast` rule** would hide every future contrast regression to
 *     tolerate the present ones. The allowlist is per route *and* per rule, so a new contrast
 *     failure on a route that has none still fails.
 *
 * `FV-029`'s kill criterion applies to this file as much as to the feature it grew out of: *"it
 * becomes a compliance checkbox rather than a usable filter"*. A frozen allowlist that only ever
 * grows is that checkbox. The counts below are ceilings, and a route that improves should have its
 * ceiling lowered rather than left generous.
 */

const AXE = fs.readFileSync(
  path.join(__dirname, '../../frontend/node_modules/axe-core/axe.min.js'),
  'utf8'
);

/**
 * The routes an anonymous browser can reach.
 *
 * **`/saved`, `/profile` and `/trips` are not here because they redirect** — an anonymous browser is
 * sent to `/login`, so scanning them in this block measures the login page repeatedly and reports it
 * as coverage. The first draft of this file did exactly that, and the URL in the probe output is
 * what gave it away. They are covered by the signed-in block at the bottom, which asserts it landed
 * on the route it asked for precisely so that mistake cannot come back silently.
 */
const ROUTES = ['/', '/browse', '/places/1', '/login', '/signup', '/about'];

/**
 * Violations this project has looked at and is living with, per route.
 *
 * **It is empty, and that is new (Sprint 8.74).** It used to hold `/browse: 2` and `/places/1: 9`,
 * described as *"a design decision rather than a defect ... the palette is the product's ... a
 * visual choice the owner makes."* Phase 14 measured all eleven instead of restating that, and the
 * description turned out not to fit:
 *
 *   - **Ten of the eleven were one utility**, `text-gray-400`, on **plain white** — not muted text
 *     on a tinted panel. `#9ca3af` on `#ffffff` is **2.53:1** against a 4.5:1 requirement, and it
 *     is the same reading everywhere it appears, because it is the same two colours.
 *   - **The fix was already in the file.** Three lines above the failing low temperature,
 *     `PlaceWeather` uses `text-gray-500` for the weekday label — 4.83:1, passes, and visually the
 *     same decision. The palette was not being defended; one token was being used inconsistently.
 *   - **The eleventh was real and did need a choice**, and it was not the one the waiver implied.
 *     `text-yellow-500` at 1.91:1 was colouring *the average-rating numeral and its star together*.
 *     Darkening the yellow to pass (`yellow-700`, 4.92:1) would have turned a gold star olive to
 *     fix a problem the star does not have. The colour moved off the text instead; the star keeps
 *     the brand yellow and is marked decorative, which it is.
 *
 * So the ceiling is now **zero on every scanned route**, and this object stays empty. An entry
 * here needs a measured ratio and a reason next to it, so that "we did not look" cannot go on
 * wearing the words "we decided".
 */
const ACCEPTED = {};

// **Every route is now absent because every route is clean**, not because any is unchecked — all
// six are in `ROUTES` and all six are gated at zero.
//
// **`/` used to carry `{ 'color-contrast': 1 }` and that waiver was wrong** (`BUG-057`, fixed in
// Sprint 8.55). It was never describing the page. Both nodes it covered were caught *mid-fade*: the
// "Start Exploring" button is white on `bg-primary-600`, which passes at rest, and axe was measuring
// its background as `#99c8e1`, `#a4cee4`, `#78b6d7` — a different shade on every run, because
// `#0277b4` composited at partial opacity is a different colour every frame. The settled page has no
// contrast violations at all. `scan` now waits for the animation, and the ceiling is zero.
//
// The two that remained were real, and were stable all along: `text-yellow-500` at 1.91:1 and
// `text-gray-400` at 2.53:1 on `/browse`, measured identically across eight consecutive scans.
// **Both are fixed as of Sprint 8.74**, along with the nine `text-gray-400` nodes on `/places/1`
// that were the same two colours again. Re-measured three times per route after the change.
//
// **A note on how they were measured, because it repeated `BUG-057` exactly.** The probe written to
// collect the per-node colour pairs scanned all six routes in one test on one `page`, and copied
// this file's `settleAnimations` *without* the throw at the end. It duly reported two violations on
// `/` — a route gated at zero that had just passed a full suite run — with the background given as
// `#4a505b`, which is not a colour in this design. Same fade, same artefact, two sprints after the
// fix. The lesson is the one already in this file and it did not take: **a contrast reading taken
// before the page settles is a coin toss**, and any tool that measures one must be at least as
// strict as the gate, or its output is noise that looks like data.

/**
 * Fast-forward every running animation to its end state (`BUG-057`).
 *
 * ---------------------------------------------------------------------------
 * What was actually wrong, after two wrong answers
 * ---------------------------------------------------------------------------
 * `color-contrast` samples the colour that is *painted behind* the text at the instant it runs. An
 * element in the middle of an opacity fade is composited against whatever is under it, so its
 * background is **a different colour on every frame** — and the gate was sampling at a random point
 * in that fade.
 *
 * Measured on `/`, eight consecutive scans: **0, 1, 0, 2, 1, 0, 1, 1**, with the offending
 * background reported as `#99c8e1`, `#a4cee4`, `#8cc1dd`, `#84bddb`, `#78b6d7`, `#b7d8ea` — never
 * twice the same, all of them `bg-primary-600` (`#0277b4`) part-way through a fade to opaque. The
 * same eight scans after this function: **0, 0, 0, 0, 0, 0, 0, 0**.
 *
 * `BUG-057` had recorded two other causes and **both were wrong**, which is why they are named here
 * rather than quietly dropped:
 *
 *   - *"Unsettled images"* — the seeded Cloudinary URLs do 404, but `document.images` reported
 *     `complete` with `naturalWidth: 0` in **all ten** measurement runs, including the ones that
 *     came back clean. The images had finished failing before every single scan.
 *   - *"Shared database state"* — the flapping reproduces with `axe.spec.js` running **alone**, with
 *     nothing else having touched the catalogue.
 *
 * ---------------------------------------------------------------------------
 * Why `prefers-reduced-motion` was not enough, though the app honours it
 * ---------------------------------------------------------------------------
 * `_app.jsx` wraps the tree in `<MotionConfig reducedMotion="user">` (`IMP-082`) and this file
 * emulates the preference below, so that is not the gap. **framer-motion's `reducedMotion="user"`
 * suppresses transform and layout animations and deliberately keeps opacity ones**, on the reasoning
 * that a fade does not provoke vestibular symptoms. Correct for a reader; useless for a measurement,
 * because opacity is exactly the property that changes what `color-contrast` sees.
 *
 * `FeaturesSection` is the concrete case: `whileInView` with `staggerChildren: 0.2` over
 * `duration: 0.5`, so its button starts fading roughly 600 ms after the section scrolls into view and
 * is still fading 500 ms later — straddling exactly the window `networkidle` + `fonts.ready` +
 * 300 ms lands in.
 *
 * ---------------------------------------------------------------------------
 * Two passes, and a loud failure rather than a quiet one
 * ---------------------------------------------------------------------------
 * Twice, because a `whileInView` animation does not exist until its element intersects, so the first
 * pass can finish everything and a second animation still begin afterwards.
 *
 * Finite animations are fast-forwarded and infinite ones cancelled to their initial state — the same
 * rule Playwright applies for `screenshot({ animations: 'disabled' })`, adopted rather than invented.
 *
 * And if anything is still running after both passes this **throws**. A gate that cannot get a
 * settled page should say so; measuring anyway is what produced a waiver that described an animation
 * frame and then survived twenty sprints as a fact about the palette.
 */
const settleAnimations = async (page) => {
  for (let pass = 0; pass < 2; pass++) {
    await page.evaluate(() => {
      for (const animation of document.getAnimations()) {
        try {
          animation.finish();
        } catch {
          // Infinite: it has no end to jump to.
          animation.cancel();
        }
      }
    });
    // Let anything a completed animation triggered — an `onComplete` that sets state, a re-render —
    // reach the DOM before the next pass looks.
    await page.waitForTimeout(150);
  }

  const running = await page.evaluate(
    () => document.getAnimations().filter((animation) => animation.playState === 'running').length
  );
  if (running > 0) {
    throw new Error(
      `${running} animation(s) still running after two settle passes. A contrast reading taken ` +
        'here is a coin toss, which is the whole of BUG-057 — fix the page or teach this function ' +
        'about it, but do not record the number.'
    );
  }
};

const scan = async (page, route) => {
  // **Reduced motion.** It is what stopped the hero carousel, which used to advance every five
  // seconds so that each scan measured whichever slide happened to be up: `/` reported 1, 8, 4 and 8
  // violations across four identical runs until `useHomeCarousel` was taught to honour the request.
  //
  // It is also the right thing to measure. A reader who has asked the platform to stop moving things
  // is the reader most likely to be using assistive technology on this page.
  //
  // What it is **not** is sufficient on its own — see `settleAnimations`. This line was recorded as
  // "what makes this suite deterministic", and that sentence is why nobody looked further for
  // twenty sprints.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(route);
  // `domcontentloaded` is already done by `goto`; this waits for the client render that adds most of
  // the DOM axe cares about. Best-effort: a page with a long-poll would never reach `networkidle`.
  await page.waitForLoadState('networkidle').catch(() => {});

  // **Wait for the fonts, or the contrast results are noise.** `color-contrast` compares computed
  // colours against rendered text, and a node still showing a fallback face measures differently
  // from the same node once the webfont lands. Before this line `/` reported 1, 8, 4 and 8
  // violations across four identical scans; after it, 1, 1, 1 and 1.
  //
  // Fonts first, animations second: a webfont landing changes layout, and changed layout is what
  // brings a `whileInView` section into view and starts its animation.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);

  // The part `fonts.ready` could not do. Four sprints of this file's history are four attempts to
  // find the source of the same variance — the carousel (real, fixed), the fonts (real, fixed), then
  // images and database state (both measured, both wrong). §45 of `NOTES` warns about exactly this:
  // *a number attached to a claim makes it read as settled*, and `1, 1, 1, 1` did precisely that.
  await settleAnimations(page);

  await page.addScriptTag({ content: AXE });

  return page.evaluate(async () => {
    const result = await window.axe.run(document, { resultTypes: ['violations'] });
    return result.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      count: violation.nodes.length,
      // The first offending element, so a failure names something findable rather than a rule id.
      example: violation.nodes[0]?.html?.slice(0, 160) ?? ''
    }));
  });
};

test.describe('every public route passes axe, except what we have written down', () => {
  for (const route of ROUTES) {
    test(`${route} has no unaccepted violations`, async ({ page }) => {
      const violations = await scan(page, route);
      const accepted = ACCEPTED[route] || {};

      const unexpected = violations.filter((v) => !(v.id in accepted));
      expect(
        unexpected,
        `Unaccepted accessibility violations on ${route}:\n` +
          unexpected.map((v) => `  ${v.id} (${v.impact}, ${v.count}) — ${v.example}`).join('\n')
      ).toEqual([]);

      // An accepted rule may not get worse. Without this the allowlist would tolerate a route going
      // from two contrast failures to two hundred, which is not what "we looked at this" meant.
      for (const violation of violations) {
        expect(
          violation.count,
          `${route}: ${violation.id} grew past its accepted ceiling`
        ).toBeLessThanOrEqual(accepted[violation.id]);
      }
    });
  }

  test('the allowlist does not name routes or rules that are already clean', async ({ page }) => {
    // A waiver for something that no longer fails is a lie about the codebase, and it is the way a
    // list like this rots: every entry stays forever because nobody re-checks. `check-module-size`
    // reported its own stale waiver in Sprint 8.9, which is where this assertion comes from.
    const stale = [];

    for (const route of Object.keys(ACCEPTED)) {
      const violations = await scan(page, route);
      for (const rule of Object.keys(ACCEPTED[route])) {
        if (!violations.some((v) => v.id === rule)) stale.push(`${route} → ${rule}`);
      }
    }

    expect(stale, `Accepted violations that no longer occur:\n  ${stale.join('\n  ')}`).toEqual([]);
  });
});

/**
 * The routes only a signed-in traveller can reach (`BL-144`).
 *
 * **These were the gate's own documented gap.** An anonymous browser is redirected from every one of
 * them to `/login`, so the public block above cannot cover them — scanning them there measured the
 * login page repeatedly and would have reported it as coverage. That is what the first draft did.
 *
 * Reaching them at all needs a browser that can sign in, which this project could not do until
 * `TD-024` (Sprint 8.30). So this is the second thing that change bought, after the workspace
 * journeys: **the half of the product behind authentication is now scannable, and it is the half a
 * traveller spends the most time in.**
 */
const AUTH_STATE = authEmulator.readState();

const AUTH_ROUTES = ['/saved', '/profile', '/trips'];

/** Same shape and same rules as `ACCEPTED`. Measured, not guessed. */
const ACCEPTED_AUTH = {};

test.describe('the signed-in routes pass too', () => {
  test.skip(
    !AUTH_STATE.enabled,
    `Firebase Auth Emulator unavailable — ${AUTH_STATE.reason || 'reason not recorded'}`
  );

  const signIn = async (page) => {
    await page.goto('/login');
    await page.locator('#email').fill('e2e-user@easytrip.test');
    await page.locator('#password').fill('e2e-password');
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await page.waitForURL(`${PORTS.BASE_URL}/`, { timeout: 20_000 });
  };

  for (const route of AUTH_ROUTES) {
    test(`${route} has no unaccepted violations`, async ({ page }) => {
      await signIn(page);
      const violations = await scan(page, route);

      // The redirect check the public block learned the hard way: a route that bounced us to
      // `/login` would otherwise be scanned as if it were the page under test, and pass.
      expect(
        new URL(page.url()).pathname,
        `${route} redirected — the scan measured another page`
      ).toBe(route);

      const accepted = ACCEPTED_AUTH[route] || {};
      const unexpected = violations.filter((v) => !(v.id in accepted));
      expect(
        unexpected,
        `Unaccepted accessibility violations on ${route}: ` +
          unexpected.map((v) => `${v.id} (${v.impact}, ${v.count}) — ${v.example}`).join(' | ')
      ).toEqual([]);

      for (const violation of violations) {
        expect(
          violation.count,
          `${route}: ${violation.id} grew past its accepted ceiling`
        ).toBeLessThanOrEqual(accepted[violation.id]);
      }
    });
  }
});
