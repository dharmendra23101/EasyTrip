import { PLACE_SECTIONS, visiblePlaceSections } from '../src/utils/placeDetail';
import { hasAccessibilityInfo } from '../src/constants/placeAccessibility';

/**
 * Which sections a place actually has (`BL-139`).
 *
 * **The bug this closes never failed anything.** The table of contents was handed the full
 * `PLACE_SECTIONS` list whether or not the sections existed, so a place with no images has always
 * carried a "Photo Gallery" link that scrolls nowhere. Nothing threw, nothing logged, and the link
 * simply did not work — which is exactly why it survived from Phase 5 to now.
 *
 * It also had a second cost that only showed up later: it is what kept `FV-029`'s panel out of the
 * contents. That section is absent far more often than the gallery — today, for the entire
 * catalogue — so registering it under the old behaviour would have turned one rare dead link into a
 * universal one.
 *
 * The rule these tests hold is **one predicate, two consumers**: the same condition decides whether
 * the markup renders and whether the contents lists it. Two copies of that condition is how a dead
 * anchor appears.
 */

const ids = (sections) => sections.map((section) => section.id);

describe('a place with everything', () => {
  test('lists every registered section, in the order the article renders them', () => {
    const sections = visiblePlaceSections({
      hasImages: true,
      hasAccessibility: true,
      hasSeasonality: true
    });

    expect(ids(sections)).toEqual([
      'about',
      'details',
      'when',
      'access',
      'gallery',
      'reviews',
      'related'
    ]);
    // The assertion that caught `FV-028` registering a section without teaching this test about it:
    // "everything" has to mean every registered section, or the case quietly stops covering the
    // newest one.
    expect(sections).toHaveLength(PLACE_SECTIONS.length);
  });
});

describe('a place missing a section does not link to it', () => {
  test('no images means no gallery entry', () => {
    // The original defect, asserted directly.
    expect(ids(visiblePlaceSections({ hasImages: false, hasAccessibility: true }))).not.toContain(
      'gallery'
    );
  });

  test('nothing recorded about access means no access entry', () => {
    expect(ids(visiblePlaceSections({ hasImages: true, hasAccessibility: false }))).not.toContain(
      'access'
    );
  });

  test('nothing curated about when to go means no "When To Go" entry', () => {
    // `FV-028`, absent for the entire catalogue on the day it ships — exactly as `access` was.
    expect(ids(visiblePlaceSections({ hasImages: true, hasSeasonality: false }))).not.toContain(
      'when'
    );
  });

  test('the catalogue as it stands today — neither — still lists four real sections', () => {
    // Every seeded place is unsurveyed, and most have no gallery. This is the common case, not the
    // edge one, which is what makes the dead links worth fixing rather than tolerating.
    expect(ids(visiblePlaceSections({ hasImages: false, hasAccessibility: false }))).toEqual([
      'about',
      'details',
      'reviews',
      'related'
    ]);
  });

  test('the unconditional sections are never filtered out', () => {
    // `about`, `details`, `reviews` and `related` always render, so no combination of flags may
    // drop them — a filter that over-reached would hide navigation rather than fix it.
    for (const hasImages of [true, false]) {
      for (const hasAccessibility of [true, false]) {
        for (const hasSeasonality of [true, false]) {
          expect(
            ids(visiblePlaceSections({ hasImages, hasAccessibility, hasSeasonality }))
          ).toEqual(expect.arrayContaining(['about', 'details', 'reviews', 'related']));
        }
      }
    }
  });

  test('missing flags are treated as missing sections, not as present ones', () => {
    // A caller that has not loaded a place yet passes `undefined`. Listing a section on that basis
    // is the dead link again, so absence must read as absent.
    expect(ids(visiblePlaceSections({}))).toEqual(['about', 'details', 'reviews', 'related']);
  });
});

describe('the predicate the article and the contents share', () => {
  // If these two ever disagree the anchor comes back, so the condition lives in one place and both
  // consumers import it.
  test.each([
    [{ step_free_access: 'yes' }, true],
    [{ accessible_restroom: 'no' }, true],
    [{ accessibility_notes: 'The lift was out of order.' }, true],
    [{ step_free_access: 'unknown', accessible_restroom: 'unknown' }, false],
    [{ step_free_access: 'unknown', accessibility_notes: '' }, false],
    [{}, false]
  ])('hasAccessibilityInfo(%o) === %p', (place, expected) => {
    expect(hasAccessibilityInfo(place)).toBe(expected);
  });

  test('a missing place is not a place with information', () => {
    expect(hasAccessibilityInfo(undefined)).toBe(false);
    expect(hasAccessibilityInfo(null)).toBe(false);
  });

  test('a note alone earns the section, because it is often the useful part', () => {
    // "Step-free to the courtyard; the sanctum is up eleven steps" is worth more than either
    // enumerated answer, and it asserts nothing, so it needs no survey to be worth showing.
    expect(hasAccessibilityInfo({ accessibility_notes: 'Ramp at the side entrance.' })).toBe(true);
  });
});
