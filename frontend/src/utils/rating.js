/**
 * One rating resolver (IMP-073).
 *
 * `rating_sum / rating_count` was recomputed at **nine** call sites across five files, even though
 * the API has returned a computed `average_rating` since the Phase 4 query work:
 *
 *     CASE WHEN rating_count > 0
 *          THEN ROUND(rating_sum::NUMERIC / rating_count, 1)
 *          ELSE NULL END AS average_rating
 *
 * The frontend read it **zero** times. Two things follow from that.
 *
 * First, the rounding was being done twice and could disagree: SQL rounds to one decimal with
 * `ROUND()`; the client did `.toFixed(1)` on the raw quotient. `.toFixed` truncates-then-rounds a
 * binary float, so 4.25 → "4.3" in SQL (NUMERIC, half-up) but "4.25".toFixed(1) → "4.3" as well by
 * luck, while 8.245 → different answers. The values on screen were mostly right and not reliably so.
 *
 * Second, and worse, the **empty case had three different answers**: `null` in `PlaceCard` and
 * `ExploreMap`, the string `'New'` on the home page, and `0` on the detail page — so an unrated
 * place rendered as blank, as "New", or as a zero-star rating depending on where you looked. `0`
 * is the actively wrong one: it renders as if the place had been rated badly.
 *
 * `average_rating` is authoritative. `rating_sum`/`rating_count` remain the fallback for any payload
 * that predates the column, which keeps this safe against a stale cache or an older API.
 */

/**
 * Average rating as a number, or `null` when the place has no ratings.
 *
 * `null` rather than `0` deliberately: they are different facts, and conflating them is what put a
 * zero-star display on unrated places.
 *
 * Note `average_rating` arrives as a **string** — Postgres `NUMERIC` is serialised as text by `pg`
 * to avoid float precision loss — so it is parsed rather than used directly.
 *
 * @param {Object|null|undefined} place
 * @returns {Number|null}
 */
export const getAverageRating = (place) => {
  if (!place) return null;

  if (place.average_rating !== undefined && place.average_rating !== null) {
    const parsed = Number(place.average_rating);
    if (Number.isFinite(parsed)) return parsed;
  }

  // Fallback for payloads without the computed column.
  const count = Number(place.rating_count);
  const sum = Number(place.rating_sum);
  if (!Number.isFinite(count) || count <= 0 || !Number.isFinite(sum)) return null;

  return Math.round((sum / count) * 10) / 10;
};

/**
 * Average rating formatted for display, or `empty` when there are none.
 *
 * The caller chooses what "no ratings yet" looks like, because the three existing answers were each
 * right for their own context — a card shows nothing, the home carousel says "New". What they must
 * not do is disagree by accident, which is why the choice is a parameter rather than a copy.
 *
 * @param {Object|null|undefined} place
 * @param {*} [empty=null] - returned when the place has no ratings
 * @returns {String|*} e.g. "4.5"
 */
export const formatAverageRating = (place, empty = null) => {
  const average = getAverageRating(place);
  return average === null ? empty : average.toFixed(1);
};

/** Number of ratings, always a number. */
export const getRatingCount = (place) => {
  const count = Number(place?.rating_count);
  return Number.isFinite(count) && count > 0 ? count : 0;
};

/** True when the place has at least one rating. */
export const hasRating = (place) => getAverageRating(place) !== null;

/**
 * Star count for a 5-star display: the average rounded to the nearest whole star, 0 when unrated.
 * Centralised so a half-star policy, if one is ever wanted, changes in one place.
 */
export const getStarCount = (place) => {
  const average = getAverageRating(place);
  return average === null ? 0 : Math.round(average);
};
