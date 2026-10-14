const pool = require('../config/db');

/**
 * Quieter places near a busy one (`FV-028` stage c).
 *
 * `FV-002`'s promise is "somewhere not crowded", and until stage (a) the only honest answer was a
 * guess. This is the query that makes it answerable: given a place somebody has judged busy, find the
 * ones nearby that somebody has judged quieter.
 *
 * ---------------------------------------------------------------------------
 * A comparison needs two known values, and that is the whole rule
 * ---------------------------------------------------------------------------
 * "Less crowded than this" is not a property of the alternative. It is a **relation** between two
 * rows, so both ends have to be curated or there is no claim to make:
 *
 *   * If the origin's `crowd_level` is `unknown`, nothing is quieter than it, because nobody has said
 *     how busy it is. The query returns nothing rather than falling back to "any place with a low
 *     crowd level", which would silently answer a different question.
 *   * A candidate at `unknown` is never suggested. It might well be quieter; nobody has looked, and
 *     `unknown` is not `low` here any more than it is anywhere else in this schema.
 *
 * That makes the feature silent for the entire catalogue on the day it ships, exactly as `FV-029`'s
 * filter was, and for the same reason: **the alternative to silence is invention.**
 *
 * ---------------------------------------------------------------------------
 * Distance in SQL rather than in Node
 * ---------------------------------------------------------------------------
 * `geoDistance.haversineKm` exists and is not used here, deliberately. Using it would mean selecting
 * every place with coordinates and filtering in the application — the whole table, growing, to return
 * three rows. The formula below is the same one; the clamp is the part worth reading.
 */

/** Busier is a bigger number. `unknown` is deliberately absent, so it compares as NULL and drops out. */
const CROWD_RANK = `CASE crowd_level WHEN 'low' THEN 1 WHEN 'moderate' THEN 2 WHEN 'high' THEN 3 END`;

/**
 * Great-circle distance in kilometres between the candidate row and a fixed point.
 *
 * `acos` is only defined on [-1, 1], and the dot product can exceed 1 by a few ULP through ordinary
 * floating-point rounding when two points nearly coincide. `LEAST(1, GREATEST(-1, ...))` keeps it in
 * domain; without it Postgres would raise `input is out of range` and the endpoint would 500.
 *
 * **How far that is verified, stated precisely.** The clamp is kept on the standard argument for
 * `acos`, not on a failure observed here. Mutation `A6` removes it and **survives** the suite: with
 * two rows at identical coordinates - the case most likely to overshoot, and one that really occurs,
 * since a place can share a position with its neighbour - this Postgres build returns exactly 1.0 and
 * the unclamped expression is fine.
 *
 * So the honest summary is: the guard is cheap, correct, and standard, and this suite does not prove
 * it is load-bearing. Manufacturing coordinates that overshoot on one build would be fitting a test
 * to a platform's rounding rather than to a behaviour, so it is recorded as a surviving mutation in
 * `VERIFICATION_LEDGER.md` instead of being papered over with a test that only passes here.
 */
const distanceKm = (latParam, lonParam) => `
  6371 * acos(
    LEAST(1, GREATEST(-1,
      cos(radians($${latParam})) * cos(radians(places.latitude))
        * cos(radians(places.longitude) - radians($${lonParam}))
      + sin(radians($${latParam})) * sin(radians(places.latitude))
    ))
  )`;

const DEFAULT_RADIUS_KM = 75;
const DEFAULT_LIMIT = 4;

/**
 * Places near `placeId` that somebody has judged quieter than it.
 *
 * Returns `[]` — never null — when the origin does not exist, has no coordinates, or has no curated
 * crowd level. The caller cannot distinguish those, and should not: all three mean "no claim".
 */
const getQuieterNearby = async (
  placeId,
  { radiusKm = DEFAULT_RADIUS_KM, limit = DEFAULT_LIMIT } = {}
) => {
  const origin = await pool.query(
    `SELECT latitude, longitude, ${CROWD_RANK} AS crowd_rank FROM places WHERE id = $1`,
    [placeId]
  );

  const row = origin.rows[0];
  // Three different absences, one answer. A place with no coordinates cannot have a "nearby", and a
  // place with no crowd level cannot have a "quieter" — neither is an error, and neither is a result.
  if (!row || row.latitude === null || row.longitude === null || row.crowd_rank === null) return [];

  const result = await pool.query(
    `SELECT places.id, places.name, places.location, places.district, places.state,
            places.primary_image_url, places.crowd_level, places.best_months,
            places.typical_visit_minutes, places.seasonality_source,
            to_char(places.seasonality_checked_on, 'YYYY-MM-DD') AS seasonality_checked_on,
            ROUND(${distanceKm(2, 3)}::NUMERIC, 1) AS distance_km
       FROM places
      WHERE places.id <> $1
        AND places.latitude IS NOT NULL
        AND places.longitude IS NOT NULL
        -- Strictly quieter. Equal is not an alternative worth showing: it is the same experience with
        -- a different name, and offering it as an improvement is the kind of small dishonesty that
        -- makes the whole panel untrustworthy.
        AND ${CROWD_RANK} IS NOT NULL
        AND ${CROWD_RANK} < $4
        AND ${distanceKm(2, 3)} <= $5
      ORDER BY ${CROWD_RANK} ASC, ${distanceKm(2, 3)} ASC
      LIMIT $6`,
    [placeId, row.latitude, row.longitude, row.crowd_rank, radiusKm, limit]
  );

  return result.rows;
};

module.exports = { getQuieterNearby, DEFAULT_RADIUS_KM, DEFAULT_LIMIT };
