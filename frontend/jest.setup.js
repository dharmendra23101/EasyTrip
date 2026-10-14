/**
 * Runs before each test file (`setupFilesAfterEnv`).
 *
 * The DOM matchers only. The time zone is set earlier, in `jest.env.js` — see the note there for
 * why it cannot live here.
 */
import '@testing-library/jest-dom';

/**
 * jsdom implements no `IntersectionObserver`, and several components gate their content on one —
 * `PlaceCard` defers rendering until the card scrolls into view, `browse` uses `useInView` for its
 * infinite-scroll sentinel.
 *
 * This stand-in reports the element as intersecting **immediately**, which is the state a test
 * cares about: "given the card is on screen, what does it render". Anything asserting the *deferral*
 * itself would need to drive this deliberately, and should build its own observer rather than
 * loosen this one.
 */
class ImmediateIntersectionObserver {
  constructor(callback) {
    this.callback = callback;
  }

  observe(target) {
    this.callback([{ isIntersecting: true, intersectionRatio: 1, target }], this);
  }

  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

global.IntersectionObserver = ImmediateIntersectionObserver;

// Guarded, because this file runs for **every** suite and a bare `window.` reference makes the
// `node` test environment unusable project-wide — the whole file throws `window is not defined`
// before a single test loads. That is not hypothetical: `seoCrawlSurface.test.js` (`IMP-113`) has
// to run under `node`, since `resolveSiteUrl` branches on `typeof window` to decide whether the
// server-only `SITE_URL` is readable, and under jsdom that branch is unreachable.
//
// `global` already covers the jsdom case — in jsdom `global` and `window` are the same object — so
// the assignment below is belt-and-braces for any environment where they are not.
if (typeof window !== 'undefined') {
  window.IntersectionObserver = ImmediateIntersectionObserver;
}
