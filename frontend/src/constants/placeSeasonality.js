/**
 * When a place is worth visiting, as an admin has to choose between the answers (`FV-028` stage a).
 *
 * **These lists are duplicated on purpose and guarded because of it.** The authority is
 * `backend/src/constants/placeSeasonality.js`, which also backs the `CHECK` constraints on the
 * columns; the frontend cannot import across the tier boundary, so
 * `scripts/check-theme-vocabulary.mjs` asserts the lists are identical and in the same order — the
 * same arrangement the theme ids, `PLACE_SETTINGS` and the `FV-029` vocabularies use.
 *
 * **The honesty rule is the same one `FV-029` established, at lower stakes.** A wrong month costs a
 * disappointing trip rather than a wasted journey, but a crowd level from 2019 is displayed exactly
 * as confidently as one from last week, so a claim carries a source and a date or the database
 * refuses the row.
 *
 * **Empty `best_months` means nobody has curated it.** It is not "no good months" — that would be a
 * claim about the place — and every consumer here treats it as "say nothing".
 */

export const CROWD_LEVELS = ['low', 'moderate', 'high', 'unknown'];

export const DEFAULT_CROWD_LEVEL = 'unknown';

export const SEASONALITY_SOURCES = ['operator', 'site_visit', 'third_party', 'editorial'];

/** The three seasons the browse filter offers, as the months they actually mean. */
export const SEASON_MONTHS = {
  summer: [4, 5, 6],
  monsoon: [7, 8, 9],
  winter: [10, 11, 12, 1, 2, 3]
};

/**
 * Month numbers and their names.
 *
 * Hard-coded rather than derived from `Intl` or `toLocaleString`, because these are the labels on a
 * set of checkboxes an admin ticks and they must not change with the browser's locale — a form
 * whose controls are named differently for different curators is a form two people disagree about.
 */
export const MONTHS = [
  { value: 1, label: 'January', short: 'Jan' },
  { value: 2, label: 'February', short: 'Feb' },
  { value: 3, label: 'March', short: 'Mar' },
  { value: 4, label: 'April', short: 'Apr' },
  { value: 5, label: 'May', short: 'May' },
  { value: 6, label: 'June', short: 'Jun' },
  { value: 7, label: 'July', short: 'Jul' },
  { value: 8, label: 'August', short: 'Aug' },
  { value: 9, label: 'September', short: 'Sep' },
  { value: 10, label: 'October', short: 'Oct' },
  { value: 11, label: 'November', short: 'Nov' },
  { value: 12, label: 'December', short: 'Dec' }
];

/** What each crowd level commits the place to, in the words needed at the moment of choosing. */
export const CROWD_LEVEL_OPTIONS = [
  {
    value: 'low',
    label: 'Quiet',
    description: 'You will usually have space. Only choose this if somebody has seen it.'
  },
  {
    value: 'moderate',
    label: 'Steady',
    description: 'Busy at peak hours, fine outside them.'
  },
  {
    value: 'high',
    label: 'Crowded',
    description: 'Queues and pressure at most times. A useful warning, not a criticism.'
  },
  {
    value: 'unknown',
    label: 'Not assessed',
    description:
      'Nobody has judged this. Nothing is shown to travellers — a safe answer, not a missing one.'
  }
];

/**
 * Who says so.
 *
 * `editorial` is the extra one `FV-029` does not have, and it is the honest common case here: this
 * is guidance a curator writes from research, not something anybody measured on site. Naming it
 * plainly is better than dressing it up as `third_party`.
 */
export const SEASONALITY_SOURCE_OPTIONS = [
  {
    value: 'operator',
    label: 'The place says so',
    description: 'Published by the site or its operator.'
  },
  {
    value: 'editorial',
    label: 'We researched it',
    description: 'A curator worked it out from published sources. The usual answer — say so.'
  },
  {
    value: 'third_party',
    label: 'A third party',
    description: 'A tourism board, a guidebook, a government dataset.'
  },
  {
    value: 'site_visit',
    label: 'Somebody went and looked',
    description: 'The strongest answer we can hold.'
  }
];

/** How a source reads beside the claim, on the page a traveller sees. */
export const SEASONALITY_SOURCE_LABELS = {
  operator: 'the place itself',
  editorial: 'our own research',
  third_party: 'a third party',
  site_visit: 'a site visit'
};

export const CROWD_LEVEL_LABELS = {
  low: 'Usually quiet',
  moderate: 'Steady',
  high: 'Usually crowded'
};

/** True when somebody has actually judged the crowd level — never test for a value by hand. */
export const isCrowdClaimed = (level) =>
  typeof level === 'string' && CROWD_LEVELS.includes(level) && level !== DEFAULT_CROWD_LEVEL;

/**
 * Does this place have anything to say about when to go?
 *
 * One predicate with two consumers, and they must not disagree: `PlaceSeasonality` renders nothing
 * when it is false, and the table of contents must not list a section that is not there. Two copies
 * of this condition is precisely how the dead gallery anchor `BL-139` fixed came about.
 */
export const hasSeasonalityInfo = (place) =>
  (place?.best_months?.length ?? 0) > 0 ||
  isCrowdClaimed(place?.crowd_level) ||
  place?.typical_visit_minutes != null;

/**
 * A run of months as a phrase a person would say.
 *
 * `[10,11,12,1,2]` is "October to February", not "October, November, December, January, February",
 * and the wrap across the year is the whole reason this exists — a naive sort renders that same run
 * as "January, February, October to December", which reads as two separate seasons.
 */
export const describeMonths = (months) => {
  const present = MONTHS.filter((month) => months?.includes(month.value)).map((m) => m.value);
  if (present.length === 0) return '';
  if (present.length === 12) return 'All year';

  // Rotate so the list starts at the beginning of a run rather than at January, which is what makes
  // a December-to-February season read as one span.
  const start = present.findIndex((month) => !present.includes(month === 1 ? 12 : month - 1));
  const ordered = start <= 0 ? present : [...present.slice(start), ...present.slice(0, start)];

  const runs = [];
  for (const month of ordered) {
    const last = runs[runs.length - 1];
    const previous = month === 1 ? 12 : month - 1;
    if (last && last[last.length - 1] === previous) last.push(month);
    else runs.push([month]);
  }

  // **Longest run first.** A place good from October to February *and also* in July has two real
  // runs, and emitting them in calendar order from the first gap leads with "July" — which buries
  // the actual season behind an aside. `sort` is stable, so equal-length runs keep the order the
  // rotation gave them and the output is deterministic.
  runs.sort((a, b) => b.length - a.length);

  const name = (value) => MONTHS.find((month) => month.value === value).label;
  return runs
    .map((run) =>
      run.length === 1 ? name(run[0]) : `${name(run[0])} to ${name(run[run.length - 1])}`
    )
    .join(', ');
};

/** A duration in minutes as a phrase, because "90 minutes" is not how anybody plans a day. */
export const describeDuration = (minutes) => {
  if (minutes == null) return '';
  if (minutes < 60) return `About ${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const hourText = `${hours} hour${hours === 1 ? '' : 's'}`;
  return rest === 0 ? `About ${hourText}` : `About ${hourText} ${rest} minutes`;
};

/**
 * What is wrong with this survey, or `null`.
 *
 * The same rule `places_seasonality_is_attributed` enforces, restated in the browser so the admin
 * learns it **while filling the form** rather than as a 400 after pressing save. The database is
 * still what makes it true; this only decides when to say so.
 */
export const seasonalityProblem = ({
  best_months: bestMonths,
  crowd_level: crowdLevel,
  typical_visit_minutes: visitMinutes,
  seasonality_source: source,
  seasonality_checked_on: checkedOn
} = {}) => {
  const claims =
    (bestMonths?.length ?? 0) > 0 ||
    isCrowdClaimed(crowdLevel) ||
    (visitMinutes !== undefined && visitMinutes !== null && visitMinutes !== '');
  if (!claims) return null;

  if (!source)
    return 'Say where this came from — a seasonality answer without a source cannot be shown.';
  if (!checkedOn)
    return 'Give the date this was last checked. Seasons change and places get popular.';
  if (checkedOn > new Date().toISOString().slice(0, 10)) return 'That date is in the future.';
  return null;
};
