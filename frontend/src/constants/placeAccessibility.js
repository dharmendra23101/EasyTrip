/**
 * Accessibility answers, as an admin has to choose between them (`FV-029` stage a).
 *
 * **These lists are duplicated on purpose and guarded because of it.** The authority is
 * `backend/src/constants/placeAccessibility.js`, which also backs the `CHECK` constraints on the
 * columns; the frontend cannot import across the tier boundary, so
 * `scripts/check-theme-vocabulary.mjs` asserts the lists are identical and in the same order. Same
 * arrangement as the theme ids and `PLACE_SETTINGS`, and it exists because the seed once drifted to
 * two values that were never themes with nothing to notice.
 *
 * **The descriptions matter more here than anywhere else in the admin.** This is the one control in
 * the product where a careless answer can strand somebody, and an admin choosing between four words
 * with no guidance will round to whichever feels generous. So each option says what it commits the
 * place to, and `unknown` is described as a real answer rather than a blank — because it is, and
 * because an admin nudged out of it produces exactly the data this feature cannot use.
 */

export const ACCESS_LEVELS = ['yes', 'no', 'partial', 'unknown'];

export const DEFAULT_ACCESS_LEVEL = 'unknown';

export const ACCESSIBILITY_SOURCES = ['operator', 'site_visit', 'third_party'];

/** What each answer commits the place to, in the words needed at the moment of choosing. */
export const ACCESS_LEVEL_OPTIONS = [
  {
    value: 'yes',
    label: 'Yes',
    description: 'Verified as accessible. Only choose this if somebody has confirmed it.'
  },
  {
    value: 'partial',
    label: 'Partly',
    description: 'True of some of the site and not the rest — say which in the notes below.'
  },
  {
    value: 'no',
    label: 'No',
    description: 'Verified as not accessible. Also a useful answer: it saves a wasted journey.'
  },
  {
    value: 'unknown',
    label: 'Not surveyed',
    description:
      'Nobody has checked. Nothing is shown to travellers — this is a safe answer, not a missing one.'
  }
];

/**
 * Who says so. Ordered weakest to strongest deliberately.
 *
 * `operator` is a claim by an interested party and is recorded rather than trusted; showing that
 * ordering to the admin is the honest framing and the one that makes a site visit feel worth doing.
 */
export const ACCESSIBILITY_SOURCE_OPTIONS = [
  {
    value: 'operator',
    label: 'The place says so',
    description: 'Published by the site or its operator.'
  },
  {
    value: 'site_visit',
    label: 'Somebody went and looked',
    description: 'The strongest answer we can hold.'
  },
  {
    value: 'third_party',
    label: 'A third party',
    description: 'A tourism board, an accessibility organisation, a government dataset.'
  }
];

/** True when a row actually says something about this axis — never test for `'no'` by hand. */
export const isClaimed = (level) =>
  typeof level === 'string' && ACCESS_LEVELS.includes(level) && level !== DEFAULT_ACCESS_LEVEL;

/**
 * Does this place have anything to say about getting in?
 *
 * One predicate with two consumers, and they must not disagree: `PlaceAccessibility` renders nothing
 * when it is false, and the table of contents must not list a section that is not there (`BL-139`).
 * Two copies of this condition is precisely how a dead anchor appears.
 *
 * Notes count. *"The lift was out of order in August"* asserts nothing about either axis and is
 * still worth a section — it is often the most useful thing on the page.
 */
export const hasAccessibilityInfo = (place) =>
  isClaimed(place?.step_free_access) ||
  isClaimed(place?.accessible_restroom) ||
  Boolean(place?.accessibility_notes);

/**
 * What is wrong with this survey, or `null`.
 *
 * The same rule `places_accessibility_is_attributed` enforces, restated in the browser so the admin
 * learns it **while filling the form** rather than as a 400 after pressing save. The database is
 * still what makes it true; this only decides when to say so.
 */
export const surveyProblem = ({
  step_free_access: stepFree,
  accessible_restroom: restroom,
  accessibility_source: source,
  accessibility_checked_on: checkedOn
} = {}) => {
  if (!isClaimed(stepFree) && !isClaimed(restroom)) return null;
  if (!source)
    return 'Say where this came from — an accessibility answer without a source cannot be shown.';
  if (!checkedOn)
    return 'Give the date somebody last checked. An undated answer cannot be trusted later.';
  if (checkedOn > new Date().toISOString().slice(0, 10)) return 'That date is in the future.';
  return null;
};
