/**
 * When a place is worth visiting (`FV-028` stage a).
 *
 * The reasoning, and the `CHECK` constraints that enforce it, are in
 * `migrations/014_place_seasonality.sql`. Two things every consumer has to know:
 *
 * **An empty `best_months` means nobody has curated it.** It is not "no good months" — that would be
 * a claim about the place — and reading it as one would turn an unedited catalogue into a catalogue
 * that discourages every trip.
 *
 * **`crowd_level` defaults to `unknown` and asserts nothing**, exactly as `places.setting` and the
 * `FV-029` columns do. `unknown` is not `low`.
 */

/** How busy a place typically is. Same shape as every other curated vocabulary in this schema. */
const CROWD_LEVELS = ['low', 'moderate', 'high', 'unknown'];

const DEFAULT_CROWD_LEVEL = 'unknown';

/**
 * Where a seasonality claim came from.
 *
 * `editorial` is the extra one `FV-029` does not have, and it is the honest common case here: this
 * is guidance a curator writes from research, not something anybody measured on site. Naming it is
 * better than dressing it up as `third_party`.
 */
const SEASONALITY_SOURCES = ['operator', 'site_visit', 'third_party', 'editorial'];

/** The three seasons the browse filter offers, as the months they actually mean. */
const SEASON_MONTHS = {
  summer: [4, 5, 6],
  monsoon: [7, 8, 9],
  winter: [10, 11, 12, 1, 2, 3]
};

/** True when somebody has actually curated this row's seasonality. */
const isCurated = (row) =>
  (row?.best_months?.length ?? 0) > 0 ||
  (row?.crowd_level && row.crowd_level !== DEFAULT_CROWD_LEVEL) ||
  row?.typical_visit_minutes != null;

module.exports = {
  CROWD_LEVELS,
  DEFAULT_CROWD_LEVEL,
  SEASONALITY_SOURCES,
  SEASON_MONTHS,
  isCurated
};
