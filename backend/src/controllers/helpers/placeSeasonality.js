const { DEFAULT_CROWD_LEVEL } = require('../../constants/placeSeasonality');
const { isProvided, parseJsonField } = require('./writeFields');

/**
 * Assembling the seasonality half of a place write (`FV-028` stage a).
 *
 * The same shape as `placeAccessibility.js`, and for the same reason: five columns whose validity is
 * a property of the **row** rather than of any field, because `places_seasonality_is_attributed`
 * requires a source and a date for any claim.
 */

const SEASONALITY_KEYS = [
  'best_months',
  'crowd_level',
  'typical_visit_minutes',
  'seasonality_source',
  'seasonality_checked_on'
];

/**
 * Months, de-duplicated and sorted, or `[]`.
 *
 * The database deliberately does not forbid duplicates — a `CHECK` cannot contain the subquery that
 * would take to express, and `{1,1,2}` overlaps exactly the months `{1,2}` does. So this is where
 * tidiness happens, and it is tidiness rather than correctness.
 */
const normaliseMonths = (value) => {
  if (!Array.isArray(value)) return [];
  // **The range check is not belt-and-braces over the validator; without it this function invents a
  // month.** `Number(null)` is 0 and `Number.isInteger(0)` is true, so a null entry became month
  // zero -- which is not a month, which the validator never sees on a non-API write, and which
  // `places_best_months_are_months` then refuses with a 500. It also made the function
  // inconsistent with itself: it already dropped 4.5 and 'spring' silently.
  const months = value
    .map(Number)
    .filter((month) => Number.isInteger(month) && month >= 1 && month <= 12);
  return [...new Set(months)].sort((a, b) => a - b);
};

/** What a create should write: an uncurated row unless the caller said otherwise. */
const seasonalityForCreate = (body = {}) => ({
  best_months: normaliseMonths(body.best_months),
  crowd_level: isProvided(body.crowd_level) ? body.crowd_level : DEFAULT_CROWD_LEVEL,
  // `?? null` around the conversion, because `Number(null)` is **0** and zero is a value this
  // column's `CHECK` refuses. `isProvided(null)` is true on purpose — null is how a JSON caller
  // clears a column — so without this the helper turns "clear it" into "zero minutes".
  typical_visit_minutes: isProvided(body.typical_visit_minutes)
    ? body.typical_visit_minutes === null
      ? null
      : Number(body.typical_visit_minutes)
    : null,
  seasonality_source: isProvided(body.seasonality_source) ? body.seasonality_source : null,
  seasonality_checked_on: isProvided(body.seasonality_checked_on)
    ? body.seasonality_checked_on
    : null
});

/**
 * What an update should write — only the keys the caller actually sent.
 *
 * `best_months` is normalised when present, so an array arriving as JSON text from a multipart form
 * reaches the column as real numbers rather than as strings the driver would refuse.
 */
const seasonalityPatch = (body = {}) =>
  Object.fromEntries(
    SEASONALITY_KEYS.filter((key) => isProvided(body[key])).map((key) => [
      key,
      key === 'best_months'
        ? normaliseMonths(body[key])
        : key === 'typical_visit_minutes' && body[key] !== null
          ? Number(body[key])
          : body[key]
    ])
  );

/**
 * `best_months` as an array, however the request spelled it.
 *
 * Multipart sends it as JSON text and a JSON client sends a real array, so this normalises before
 * either write path sees it — one place rather than once per path, which is how the create and the
 * update come to disagree about what a form submitted.
 */
const seasonalityBody = (body = {}) => ({
  ...body,
  best_months: body.best_months === undefined ? undefined : parseJsonField(body.best_months, [])
});

module.exports = {
  SEASONALITY_KEYS,
  seasonalityBody,
  normaliseMonths,
  seasonalityForCreate,
  seasonalityPatch
};
