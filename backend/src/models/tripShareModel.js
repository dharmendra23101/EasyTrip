const crypto = require('node:crypto');
const pool = require('../config/db');

/**
 * The read-only share link (`FV-009` stage c).
 *
 * ---------------------------------------------------------------------------
 * Its own file, because it breaks the rule the other trip models are built on
 * ---------------------------------------------------------------------------
 * `tripModel`'s docstring says it plainly: *"every function takes the caller's uid first, and none
 * has a variant that does not"*, and *"there is no `getDay(id)`"* — because a query that addresses a
 * trip without a uid is one refactor away from reading somebody else's.
 *
 * **`getSharedTrip` is exactly such a query**, deliberately and necessarily: the whole point of a
 * share link is that the reader is not signed in. Putting it inside `tripModel` would mean that
 * file's invariant is no longer true, and an invariant with one exception in it is one a future
 * reader has to check rather than rely on. So it lives here, alone, where it is the subject of the
 * file rather than the exception in it.
 *
 * ---------------------------------------------------------------------------
 * The token is the credential
 * ---------------------------------------------------------------------------
 * Anybody holding the link can read the trip. That is the feature, and it is also the risk: URLs
 * leak through browser history, `Referer` headers, screenshots and pasted messages in a way
 * passwords do not. Three things follow, and the migration enforces two of them in the schema:
 *
 *   - **256 bits of entropy**, so guessing is not a threat model.
 *   - **Revocation is total**: the token lives on the trip, so `NULL` ends every copy at once.
 *   - **Re-sharing mints a new token**, so a revoked link never comes back to life.
 */

/**
 * 32 random bytes as 43 base64url characters.
 *
 * `randomBytes`, not `Math.random`: this is a credential, and `Math.random` is a seeded PRNG whose
 * output is predictable from previous output. `base64url` rather than `base64` because the value
 * goes in a URL, and `+` and `/` do not survive that — the `CHECK` constraint on the column refuses
 * them for the same reason.
 */
const mintToken = () => crypto.randomBytes(32).toString('base64url');

/**
 * Create or rotate this trip's share link.
 *
 * **Rotating rather than reusing is the security decision.** Calling this on an already-shared trip
 * replaces the token, which invalidates the previous link. That is what somebody who suspects a link
 * has spread further than they meant reaches for, and making it the *same* action as sharing means
 * they do not have to find a separate "rotate" control while worried.
 *
 * Returns `null` when the trip is not the caller's — the same answer as a trip that does not exist,
 * per the 404-never-403 rule.
 */
const shareTrip = async (userId, tripId) => {
  const result = await pool.query(
    `UPDATE trips
        SET share_token = $1, shared_at = CURRENT_TIMESTAMP
      WHERE id = $2 AND user_id = $3
      RETURNING share_token, shared_at`,
    [mintToken(), tripId, userId]
  );
  return result.rows[0] ?? null;
};

/** Revoke. Every copy of the link stops working at once, because there is only one token. */
const revokeShare = async (userId, tripId) => {
  const result = await pool.query(
    `UPDATE trips
        SET share_token = NULL, shared_at = NULL
      WHERE id = $1 AND user_id = $2
      RETURNING id`,
    [tripId, userId]
  );
  return result.rowCount > 0;
};

/** What the owner is told about their own link. Never includes anybody who followed it. */
const getShareState = async (userId, tripId) => {
  const result = await pool.query(
    'SELECT share_token, shared_at FROM trips WHERE id = $1 AND user_id = $2',
    [tripId, userId]
  );
  return result.rows[0] ?? null;
};

/**
 * The public read. **This is the one query in the codebase that reaches a trip without a uid.**
 *
 * ---------------------------------------------------------------------------
 * What a share link does and does not show
 * ---------------------------------------------------------------------------
 * It shows **the plan**: the trip's title, dates and description, its days, and the stops on them
 * with their times, places and per-stop notes. A note attached to a stop — *"meet at the north
 * gate"* — is part of the itinerary and is useless to withhold from somebody being sent the
 * itinerary.
 *
 * It does **not** show the trip's own notes or its checklist. Those are the owner's private working:
 * `trip_notes` is where a booking reference lives, and the checklist is a packing list. Sharing a
 * plan and handing over a hotel confirmation number are different acts, and only one of them was
 * asked for.
 *
 * That boundary is a judgement rather than a law, and it is drawn conservatively on purpose — the
 * cost of getting it wrong is asymmetric. Widening it later is a per-note flag and an opt-in;
 * narrowing it after links are in circulation is not possible.
 *
 * **`user_id` is never selected**, here or anywhere in this response. A public endpoint that returns
 * an owner's uid hands out an identifier that every other table keys on.
 */
const getSharedTrip = async (token) => {
  // Selected column by column rather than `t.*`, so a column added to `trips` later — an email, a
  // billing reference, anything — does not become public by default. The failure mode of `SELECT *`
  // on a public endpoint is silent and retroactive.
  const trip = await pool.query(
    `SELECT id, title, description,
            to_char(start_date, 'YYYY-MM-DD') AS start_date,
            to_char(end_date, 'YYYY-MM-DD') AS end_date,
            status
       FROM trips
      WHERE share_token = $1`,
    [token]
  );
  if (!trip.rows[0]) return null;

  const tripId = trip.rows[0].id;

  const days = await pool.query(
    'SELECT id, day_number FROM trip_days WHERE trip_id = $1 ORDER BY day_number',
    [tripId]
  );

  const items = await pool.query(
    `SELECT trip_items.id, trip_items.trip_day_id, trip_items.item_type,
            trip_items.title, trip_items.notes, trip_items.start_time, trip_items.end_time,
            trip_items.position,
            places.name AS place_name, places.location AS place_location
       FROM trip_items
       JOIN trip_days ON trip_days.id = trip_items.trip_day_id
       LEFT JOIN places ON places.id = trip_items.place_id
      WHERE trip_days.trip_id = $1
      ORDER BY trip_days.day_number, trip_items.position, trip_items.id`,
    [tripId]
  );

  return {
    ...trip.rows[0],
    days: days.rows.map((day) => ({
      ...day,
      items: items.rows.filter((item) => item.trip_day_id === day.id)
    }))
  };
};

module.exports = { mintToken, shareTrip, revokeShare, getShareState, getSharedTrip };
