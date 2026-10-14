const pool = require('../config/db');

/**
 * Who may open a trip (`FV-007` stage (a)).
 *
 * ---------------------------------------------------------------------------
 * One predicate, because twenty-six of them is how one gets forgotten
 * ---------------------------------------------------------------------------
 * `tripModel.js` opens by explaining why every query carries `WHERE trips.user_id = $1`:
 *
 * > *That join is the authorization boundary — a handler-side check can be forgotten by the next
 * > caller, a `WHERE trips.user_id = $1` cannot.*
 *
 * Collaboration must not cost that. There are **26 ownership references across five trip models**,
 * and widening each one by hand would turn a rule that is impossible to forget into twenty-six
 * chances to write it slightly differently — which is the same failure the original comment is
 * about, arriving through the fix rather than the bug.
 *
 * So the rule is written **once**, here, as `READABLE_BY`, and composed into the queries that read a
 * trip. A caller cannot express "readable" any other way, because no other spelling of it exists.
 *
 * ---------------------------------------------------------------------------
 * Read only, and that is the whole of stage (a)
 * ---------------------------------------------------------------------------
 * **Nothing in the write path changes.** Every `UPDATE`, `INSERT` and `DELETE` across the trip
 * models still says `WHERE trips.user_id = $1`, and a collaborator is refused by them exactly as a
 * stranger is. That is not an oversight to be tidied later — it is what makes `role` honest: the
 * schema CHECKs `'viewer'` and only `'viewer'`, because `viewer` is the only thing the application
 * enforces (`017_trip_collaborators.sql`).
 *
 * `editor` arrives when the write path can tell the difference. Until then a trip has exactly two
 * kinds of person: the owner, who can do everything, and a viewer, who can read.
 *
 * ---------------------------------------------------------------------------
 * The email is a lookup key, not an address
 * ---------------------------------------------------------------------------
 * `addCollaborator` takes an email and resolves it against `users.email` (`UNIQUE NOT NULL`,
 * populated from the verified token on first request). **Nothing is sent.** `FV-007`'s own kill
 * criterion is an invitation flow that needs a mail provider, and this project has none; using the
 * address somebody already registered with avoids the dependency rather than escalating to it.
 *
 * The cost is stated where a reader will meet it: you can only add somebody who already has an
 * account, and `addCollaborator` returns a distinguishable `not_found` for that case so the API can
 * say so rather than failing vaguely.
 */

/**
 * The readability rule, as a SQL fragment.
 *
 * Composed into a `WHERE` with the trip id as `$1` and the caller's uid as `$2`, in that order, so
 * every call site reads identically. `EXISTS` rather than a `LEFT JOIN` because a join against a
 * table with a `UNIQUE (trip_id, user_id)` still forces the planner to prove uniqueness, and
 * because a join would silently duplicate rows the day that constraint is relaxed.
 */
const readableBy = (uid = '$2') => `(
  trips.user_id = ${uid}
  OR EXISTS (
    SELECT 1 FROM trip_collaborators
    WHERE trip_collaborators.trip_id = trips.id AND trip_collaborators.user_id = ${uid}
  )
)`;

/** The read path's two call sites both bind the uid to `$2`, so they take the default. */
const READABLE_BY = readableBy();

/**
 * The **write** rule: the owner, or a collaborator whose role is `editor` (`FV-007` stage (c)).
 *
 * Parameterised on the placeholder because the itinerary write paths bind the uid at different
 * positions - `$2` in `addDay`, `$3` in `deleteDay`, `$4` in some item writes - and a fragment that
 * silently assumed `$2` would compile fine and compare the uid against a *trip id*. Passing the
 * placeholder makes that a caller decision rather than a coincidence.
 *
 * **An editor can read by construction, not by rule.** `readableBy` does not filter on role at all,
 * so anyone in `trip_collaborators` satisfies it. There is deliberately no rank stored anywhere: a
 * hierarchy encoded in both the schema and the code is one the SQL stops matching the day a third
 * role arrives.
 *
 * What this predicate is **not** applied to is as much of the design as what it is - see
 * `018_trip_editors.sql`. Renaming, deleting, duplicating, the share link and the collaborator list
 * all stay `trips.user_id`, because each of them changes what the trip *is* or who can see it, and
 * neither is implied by "help me plan this".
 */
const editableBy = (uid = '$2') => `(
  trips.user_id = ${uid}
  OR EXISTS (
    SELECT 1 FROM trip_collaborators
    WHERE trip_collaborators.trip_id = trips.id
      AND trip_collaborators.user_id = ${uid}
      AND trip_collaborators.role = 'editor'
  )
)`;

/**
 * What this caller is to this trip: `'owner'`, `'viewer'`, or `null` for no relationship.
 *
 * One query rather than two, so there is no window in which the answer changes between them, and so
 * a caller cannot accidentally ask only half the question.
 *
 * **`null` covers both "no access" and "no such trip", deliberately.** `getTrip` already answers
 * alike for a trip that is not yours and a trip that does not exist — telling them apart is a
 * membership oracle, and the trip page says the same sentence for both.
 */
const roleOnTrip = async (userId, tripId) => {
  const result = await pool.query(
    `SELECT
       CASE
         WHEN trips.user_id = $2 THEN 'owner'
         WHEN collaborator.user_id IS NOT NULL THEN collaborator.role
         ELSE NULL
       END AS role
     FROM trips
     LEFT JOIN trip_collaborators AS collaborator
       ON collaborator.trip_id = trips.id AND collaborator.user_id = $2
     WHERE trips.id = $1`,
    [tripId, userId]
  );

  return result.rows[0]?.role || null;
};

/**
 * Everyone who can open this trip besides its owner.
 *
 * Joined to `users` for a name and email, because a list of opaque Firebase uids answers nobody's
 * question about who they have shared with. `LEFT JOIN`: the uid is the fact, and a collaborator
 * whose `users` row has not been created yet is still a collaborator.
 */
const listCollaborators = async (tripId) => {
  const result = await pool.query(
    `SELECT
       trip_collaborators.user_id,
       trip_collaborators.role,
       trip_collaborators.created_at,
       users.email,
       users.name
     FROM trip_collaborators
     LEFT JOIN users ON users.firebase_uid = trip_collaborators.user_id
     WHERE trip_collaborators.trip_id = $1
     ORDER BY trip_collaborators.created_at ASC, trip_collaborators.user_id ASC`,
    [tripId]
  );

  return result.rows;
};

/**
 * Add somebody to a trip by the email they registered with.
 *
 * Returns a discriminated result rather than throwing, because three of the four outcomes are
 * things the caller did rather than things that went wrong, and each needs a different sentence:
 *
 *   - `{ ok: true, collaborator }`      — added, or already there (see below)
 *   - `{ ok: false, reason: 'not_found' }` — nobody has registered with that address
 *   - `{ ok: false, reason: 'is_owner' }`  — that is you; the owner is not a collaborator
 *   - `{ ok: false, reason: 'bad_role' }`  — a role outside the vocabulary
 *
 * **Adding the same person twice succeeds.** It is the same fact stated twice, not a conflict, so
 * `ON CONFLICT DO UPDATE` returns the existing row and the route answers 200. A 409 here would make
 * a double-click look like a failure.
 */
const ROLES = ['viewer', 'editor'];

const addCollaborator = async ({ tripId, ownerId, email, role = 'viewer' }) => {
  // Defended here as well as at the route, because this function is the only way a row reaches the
  // table and the CHECK constraint's error is a 500 rather than something a caller can act on.
  if (!ROLES.includes(role)) return { ok: false, reason: 'bad_role' };

  const found = await pool.query('SELECT firebase_uid FROM users WHERE lower(email) = lower($1)', [
    email
  ]);
  const invitee = found.rows[0];

  if (!invitee) return { ok: false, reason: 'not_found' };

  // The owner is `trips.user_id` and nothing else. Letting them also hold a row here would put the
  // answer to "who owns this" in two places, which is how the two answers eventually differ.
  if (invitee.firebase_uid === ownerId) return { ok: false, reason: 'is_owner' };

  const inserted = await pool.query(
    `INSERT INTO trip_collaborators (trip_id, user_id, role, added_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (trip_id, user_id) DO UPDATE SET role = EXCLUDED.role
     RETURNING user_id, role, created_at`,
    [tripId, invitee.firebase_uid, role, ownerId]
  );

  return { ok: true, collaborator: inserted.rows[0] };
};

/** Remove somebody. Returns false when they were not on the trip, so the route can 404 rather than lie. */
const removeCollaborator = async (tripId, userId) => {
  const result = await pool.query(
    'DELETE FROM trip_collaborators WHERE trip_id = $1 AND user_id = $2',
    [tripId, userId]
  );

  return result.rowCount > 0;
};

module.exports = {
  READABLE_BY,
  readableBy,
  editableBy,
  roleOnTrip,
  listCollaborators,
  addCollaborator,
  removeCollaborator
};
