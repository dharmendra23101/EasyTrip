const pool = require('../config/db');

/**
 * The server-persisted wishlist (`IMP-108`, `ADR-030`).
 *
 * Every function here takes the caller's Firebase uid as its first argument, and there is no
 * variant that does not. That is deliberate: a `listSavedPlaces(placeId)` or a
 * `removeSavedPlace(id)` keyed on the row's own primary key would be one refactor away from an
 * endpoint that reads somebody else's wishlist, because the uid would become optional at the call
 * site before it became optional in anyone's mind. Scoping is a property of the query, not of the
 * handler that happens to call it today.
 */

/**
 * The columns a saved-place card renders.
 *
 * Deliberately narrower than `placeModel`'s `LIST_COLUMNS`: a wishlist entry is a link back to the
 * place, so `description`, `tags` and `custom_keys` are not shipped. If the wishlist page ever
 * grows a snippet, widen this — but widening it now would ship bytes nothing reads, which is the
 * habit `IMP-038`'s projection work exists to break.
 */
const SAVED_PLACE_COLUMNS = `
  places.id, places.name, places.location, places.district, places.state,
  places.latitude, places.longitude, places.primary_image_url, places.themes,
  places.rating_count, places.rating_sum`;

// Same expression `placeModel` uses, so an unrated place is `null` here too rather than a zero
// that renders as a zero-star rating (`IMP-073`).
const RATING_EXPR = `
  CASE
    WHEN places.rating_count > 0 THEN ROUND(places.rating_sum::NUMERIC / places.rating_count, 1)
    ELSE NULL
  END AS average_rating`;

/**
 * Newest first, and **total**.
 *
 * The `id DESC` tiebreak is not decoration. `created_at` is a timestamp, two saves in the same
 * millisecond are reachable from a script or an impatient double-click, and without a tiebreak
 * Postgres may return either order — which makes an ordering assertion flaky rather than wrong.
 * `placeModel`'s `SORT_ORDERS` ends every entry in `places.id` for exactly this reason.
 */
const SAVED_ORDER = 'user_saved_places.created_at DESC, user_saved_places.id DESC';

/** Every place this user has saved, newest first, shaped like a card. */
const listSavedPlaces = async (userId) => {
  const result = await pool.query(
    `SELECT ${SAVED_PLACE_COLUMNS}, ${RATING_EXPR},
            user_saved_places.created_at AS saved_at
     FROM user_saved_places
     JOIN places ON places.id = user_saved_places.place_id
     WHERE user_saved_places.user_id = $1
     ORDER BY ${SAVED_ORDER}`,
    [userId]
  );

  return result.rows;
};

/** Just the ids — what the heart buttons need, without the join. */
const listSavedPlaceIds = async (userId) => {
  const result = await pool.query(
    `SELECT place_id FROM user_saved_places
     WHERE user_id = $1
     ORDER BY ${SAVED_ORDER}`,
    [userId]
  );

  return result.rows.map((row) => row.place_id);
};

/**
 * Save a place. Idempotent.
 *
 * `ON CONFLICT DO NOTHING` rather than an existence check, because an existence check followed by
 * an insert is a race between two tabs that the UNIQUE constraint would then turn into a 500. The
 * conflict is the normal path for a toggle, not an exceptional one.
 *
 * Returns `true` when a row was created and `false` when it already existed. Both are successes —
 * the caller reports the resulting state, not which branch it took (`ADR-030`).
 *
 * Saving a nonexistent place raises `23503` (foreign key violation) from the database rather than
 * silently creating an orphan. The controller maps it; nothing here guesses whether the place
 * exists, because a check-then-insert would be a second race.
 */
const addSavedPlace = async (userId, placeId) => {
  const result = await pool.query(
    `INSERT INTO user_saved_places (user_id, place_id)
     VALUES ($1, $2)
     ON CONFLICT (user_id, place_id) DO NOTHING
     RETURNING id`,
    [userId, placeId]
  );

  return result.rowCount > 0;
};

/**
 * Unsave a place. Idempotent, and scoped to the caller in the WHERE clause.
 *
 * The `user_id = $1` predicate is the authorization boundary. It is here rather than in the
 * controller so that there is no arrangement of arguments that deletes another user's row —
 * a controller-side ownership check can be forgotten by the next caller; a WHERE clause cannot.
 *
 * Returns `true` when a row was removed and `false` when there was nothing to remove — including
 * when the row exists but belongs to somebody else, which is indistinguishable from "not saved"
 * both here and, deliberately, in the response.
 */
const removeSavedPlace = async (userId, placeId) => {
  const result = await pool.query(
    'DELETE FROM user_saved_places WHERE user_id = $1 AND place_id = $2',
    [userId, placeId]
  );

  return result.rowCount > 0;
};

module.exports = {
  listSavedPlaces,
  listSavedPlaceIds,
  addSavedPlace,
  removeSavedPlace
};
