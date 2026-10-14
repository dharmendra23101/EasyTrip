const pool = require('../config/db');
const { TRIP_ACTIVITY_ACTIONS } = require('../constants/tripActivity');
const { READABLE_BY } = require('./tripAccessModel');

/**
 * The trip activity feed (`BL-147`).
 *
 * ---------------------------------------------------------------------------
 * The write takes a `client`, and that is the whole design
 * ---------------------------------------------------------------------------
 * Inherited from `auditModel.js`, for the same reason and with the same consequence: `record` never
 * opens its own transaction. It takes whatever the caller is already using, so **the activity row
 * and the change it records commit or roll back together.**
 *
 * A reordered day that committed while its activity row did not is the exact hole this table exists
 * to close — the owner sees a plan they did not arrange and a history that says nobody touched it.
 * That is worse than no feed at all, because an empty feed reads as "nothing happened" and this
 * project keeps *empty* and *failed* apart everywhere else (`IMP-031`).
 *
 * So there is no `.catch(() => {})` in this file either. `ADR-022` named the swallowed insert as
 * *the actual defect*: code that pretends to record is worse than code that does not, because a
 * reviewer reads it as a control that exists.
 *
 * ---------------------------------------------------------------------------
 * Reading is gated by `READABLE_BY`, deliberately not by ownership
 * ---------------------------------------------------------------------------
 * `BL-147` says the reader is "the trip **owner** rather than an admin" — and the contrast being
 * drawn there is with an *administrator*, which is the mistake `ADR-056` split this out to avoid.
 * It is not an argument for excluding collaborators.
 *
 * This uses the same rule that decides whether you may see the trip at all. The activity is *about*
 * the itinerary: anyone entitled to read the plan is entitled to know how it got that way, and an
 * editor who can change a trip but cannot see that they changed it is a strange half-permission.
 * Inventing a second access model over a table that already sits behind one is how two rules drift
 * apart and one of them turns out to be wrong.
 */

/** Newest-first paging. Matches `trip_activity_trip_created_idx`. */
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/**
 * Write one entry. `client` is a transaction client or the pool — see the header.
 *
 * The vocabulary is asserted here as well as by the database's CHECK constraint. Both fire, but a
 * `TypeError` naming the bad value at the call site is a far better failure than a Postgres
 * constraint violation surfacing as a 500 three layers up — and these arguments are literals
 * written by hand, so a typo is the realistic failure.
 */
const record = async (client, { tripId, actorUid, actorLabel = null, action, detail = {} }) => {
  if (!TRIP_ACTIVITY_ACTIONS.includes(action)) {
    throw new TypeError(`Unknown trip activity action: ${action}`);
  }

  await client.query(
    `INSERT INTO trip_activity (trip_id, actor_uid, actor_label, action, detail)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [tripId, actorUid, actorLabel, action, JSON.stringify(detail)]
  );
};

/**
 * The actor's display name at the moment of the change.
 *
 * Looked up rather than passed in, because the controllers have a uid and the copy has to be taken
 * *now* — that is the entire point of denormalising it. Returns `null` when the user has no row
 * yet, which is a real state: `users` rows are created lazily on first authenticated request, so
 * somebody's first action can precede their row.
 *
 * A null label is rendered as "someone" by the feed rather than as a blank, because a line reading
 * "removed day 2" with no subject is the kind of gap a reader fills in with the wrong guess.
 */
const actorLabelFor = async (client, uid) => {
  const result = await client.query(
    'SELECT COALESCE(NULLIF(name, $2), email) AS label FROM users WHERE firebase_uid = $1',
    [uid, '']
  );
  return result.rows[0]?.label ?? null;
};

/**
 * One trip's activity, newest first, for a user entitled to read that trip.
 *
 * Returns `null` — not an empty array — when the trip does not exist or the caller cannot see it.
 * The two are different answers and the caller renders them differently: `IMP-031`'s rule that
 * *"nothing has happened"* and *"we could not find out what happened"* must not collapse into one
 * screen. An unshared trip returning `[]` would tell a stranger the trip exists.
 */
const listForTrip = async (userId, tripId, { limit = DEFAULT_LIMIT, before = null } = {}) => {
  const capped = Math.min(Math.max(Number(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);

  const visible = await pool.query(
    `SELECT trips.id FROM trips WHERE trips.id = $1 AND ${READABLE_BY}`,
    [tripId, userId]
  );
  if (visible.rowCount === 0) return null;

  // `before` is an id, not a timestamp, for the reason the index is (created_at DESC, id DESC):
  // two rows written in one transaction share `created_at` to the microsecond, and paging on a
  // non-unique column shows one row twice and skips another.
  const params = [tripId, capped];
  let cursor = '';
  if (before !== null && Number.isInteger(Number(before))) {
    params.push(Number(before));
    cursor = `AND trip_activity.id < $${params.length}`;
  }

  const result = await pool.query(
    `SELECT id, actor_uid, actor_label, action, detail, created_at
       FROM trip_activity
      WHERE trip_id = $1 ${cursor}
      ORDER BY created_at DESC, id DESC
      LIMIT $2`,
    params
  );

  return result.rows;
};

module.exports = { record, actorLabelFor, listForTrip, DEFAULT_LIMIT, MAX_LIMIT };
