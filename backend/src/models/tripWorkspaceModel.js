const pool = require('../config/db');

/**
 * A trip's notes and checklist (`FV-006` stage b).
 *
 * ---------------------------------------------------------------------------
 * The one rule this file exists to keep, inherited from `tripModel`
 * ---------------------------------------------------------------------------
 * **Every function takes the caller's uid first, and none has a variant that does not.** Neither
 * `trip_notes` nor `trip_checklist_items` carries a uid of its own; ownership lives on
 * `trips.user_id` and is reached by joining up to the trip. **That join is the authorization
 * boundary.** A check in a handler can be forgotten by the next caller; a `WHERE trips.user_id = $1`
 * inside the only query that exists cannot.
 *
 * The consequence is the same one `tripModel` states: **there is no `getNote(id)`.** Addressing a
 * child row by its own primary key without the trip in the query is one refactor away from reading
 * somebody else's trip, so the shape is never offered — not even privately in this module, because
 * "private" lasts until the next export.
 *
 * ---------------------------------------------------------------------------
 * Its own file rather than more of `tripModel`
 * ---------------------------------------------------------------------------
 * `tripModel` is 315 lines and owns the itinerary; `tripItemModel` was already split out of it on
 * the same reasoning in Sprint 8.26. These are two more child collections reached through the same
 * join, and keeping them here is what stops the 500-line guard from becoming the thing that decides
 * the architecture later, in a hurry.
 */

/**
 * Table-qualified, because the list queries join up to `trips` to prove ownership and **both tables
 * have an `id`**. Unqualified, `SELECT id, ...` is an ambiguous-column error rather than a wrong
 * answer, so it fails loudly — but it fails at runtime, in the one query the authorization boundary
 * depends on. Qualifying once here means the write statements, which do not join, use the same
 * strings and cannot drift from them.
 */
const NOTE_COLUMNS =
  'trip_notes.id, trip_notes.trip_id, trip_notes.body, trip_notes.created_at, trip_notes.updated_at';
const CHECKLIST_COLUMNS =
  'trip_checklist_items.id, trip_checklist_items.trip_id, trip_checklist_items.label, ' +
  'trip_checklist_items.is_done, trip_checklist_items.position, ' +
  'trip_checklist_items.created_at, trip_checklist_items.updated_at';

/**
 * Does this uid own this trip?
 *
 * Every write below begins here, and it is the reason none of them needs to join: a write that has
 * already proved ownership can address the child row by `(id, trip_id)`, which is a pair the caller
 * cannot forge into somebody else's trip because `trip_id` was just checked against their uid.
 *
 * Returns the id rather than a boolean so a caller cannot accidentally treat `0` as false.
 */
const ownsTrip = async (userId, tripId) => {
  const result = await pool.query('SELECT id FROM trips WHERE id = $1 AND user_id = $2', [
    tripId,
    userId
  ]);
  return result.rows[0]?.id ?? null;
};

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

/**
 * Newest first, matching the index.
 *
 * `id DESC` after `created_at DESC` is not decoration: two notes written in the same millisecond
 * would otherwise have no defined order between them, and an undefined order is one that changes
 * between reads of the same unchanged data.
 */
const listNotes = async (userId, tripId) => {
  const result = await pool.query(
    `SELECT ${NOTE_COLUMNS}
       FROM trip_notes
       JOIN trips ON trips.id = trip_notes.trip_id
      WHERE trip_notes.trip_id = $1 AND trips.user_id = $2
      ORDER BY trip_notes.created_at DESC, trip_notes.id DESC`,
    [tripId, userId]
  );
  return result.rows;
};

const createNote = async (userId, tripId, body) => {
  if (!(await ownsTrip(userId, tripId))) return null;

  const result = await pool.query(
    `INSERT INTO trip_notes (trip_id, body) VALUES ($1, $2) RETURNING ${NOTE_COLUMNS}`,
    [tripId, body]
  );
  return result.rows[0];
};

/**
 * `WHERE id = $1 AND trip_id = $2` after the ownership check.
 *
 * The pair matters. Without `trip_id` the statement would update any note whose id was guessed, and
 * the ownership check above would have proved only that the caller owns *some* trip.
 */
const updateNote = async (userId, tripId, noteId, body) => {
  if (!(await ownsTrip(userId, tripId))) return null;

  const result = await pool.query(
    `UPDATE trip_notes SET body = $1 WHERE id = $2 AND trip_id = $3 RETURNING ${NOTE_COLUMNS}`,
    [body, noteId, tripId]
  );
  return result.rows[0] ?? null;
};

const deleteNote = async (userId, tripId, noteId) => {
  if (!(await ownsTrip(userId, tripId))) return false;

  const result = await pool.query('DELETE FROM trip_notes WHERE id = $1 AND trip_id = $2', [
    noteId,
    tripId
  ]);
  return result.rowCount > 0;
};

// ---------------------------------------------------------------------------
// Checklist
// ---------------------------------------------------------------------------

const listChecklist = async (userId, tripId) => {
  const result = await pool.query(
    `SELECT ${CHECKLIST_COLUMNS}
       FROM trip_checklist_items
       JOIN trips ON trips.id = trip_checklist_items.trip_id
      WHERE trip_checklist_items.trip_id = $1 AND trips.user_id = $2
      ORDER BY trip_checklist_items.position, trip_checklist_items.id`,
    [tripId, userId]
  );
  return result.rows;
};

/**
 * Append to the end of the list.
 *
 * The position is computed in the same statement that inserts, rather than read and then written.
 * Two tabs adding an item at once would otherwise both read the same `MAX(position)` and both write
 * it — harmless here because position is deliberately not unique and `(position, id)` still totally
 * orders the list, but the sub-select costs nothing and means the common case is simply right.
 */
const createChecklistItem = async (userId, tripId, label) => {
  if (!(await ownsTrip(userId, tripId))) return null;

  const result = await pool.query(
    `INSERT INTO trip_checklist_items (trip_id, label, position)
     VALUES ($1, $2, (SELECT COALESCE(MAX(position), -1) + 1 FROM trip_checklist_items WHERE trip_id = $1))
     RETURNING ${CHECKLIST_COLUMNS}`,
    [tripId, label]
  );
  return result.rows[0];
};

/**
 * Change the label, the done flag, or both.
 *
 * **`undefined` means "not sent" and `null` is not accepted for either field**, so ticking a box
 * cannot blank the label it belongs to. `COALESCE` on a supplied `null` would look like the same
 * thing and quietly keep the old value instead of rejecting a malformed request; the validator
 * refuses `null` and this builds the statement from what actually arrived.
 */
const updateChecklistItem = async (userId, tripId, itemId, { label, isDone }) => {
  if (!(await ownsTrip(userId, tripId))) return null;

  const columns = [];
  const values = [];
  if (label !== undefined) {
    values.push(label);
    columns.push(`label = $${values.length}`);
  }
  if (isDone !== undefined) {
    values.push(isDone);
    columns.push(`is_done = $${values.length}`);
  }
  // Nothing to change is not an error, and must not become `SET  WHERE`. The row is returned as it
  // stands, which is what a caller sending an empty patch is asking to be told.
  if (columns.length === 0) {
    const current = await pool.query(
      `SELECT ${CHECKLIST_COLUMNS} FROM trip_checklist_items WHERE id = $1 AND trip_id = $2`,
      [itemId, tripId]
    );
    return current.rows[0] ?? null;
  }

  values.push(itemId, tripId);
  const result = await pool.query(
    `UPDATE trip_checklist_items SET ${columns.join(', ')}
      WHERE id = $${values.length - 1} AND trip_id = $${values.length}
      RETURNING ${CHECKLIST_COLUMNS}`,
    values
  );
  return result.rows[0] ?? null;
};

const deleteChecklistItem = async (userId, tripId, itemId) => {
  if (!(await ownsTrip(userId, tripId))) return false;

  const result = await pool.query(
    'DELETE FROM trip_checklist_items WHERE id = $1 AND trip_id = $2',
    [itemId, tripId]
  );
  return result.rowCount > 0;
};

/**
 * Rewrite the whole order in one transaction.
 *
 * **Only ids already in this trip are touched**, and the count is checked before anything is
 * written: a request listing an id from another trip renumbers nothing rather than renumbering what
 * it can. A partial reorder is worse than a refused one, because the list it leaves is neither the
 * old order nor the requested one.
 */
const reorderChecklist = async (userId, tripId, itemIds) => {
  if (!(await ownsTrip(userId, tripId))) return null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const owned = await client.query(
      'SELECT id FROM trip_checklist_items WHERE trip_id = $1 AND id = ANY($2::int[]) FOR UPDATE',
      [tripId, itemIds]
    );
    if (owned.rows.length !== itemIds.length) {
      await client.query('ROLLBACK');
      return null;
    }

    for (const [index, id] of itemIds.entries()) {
      await client.query(
        'UPDATE trip_checklist_items SET position = $1 WHERE id = $2 AND trip_id = $3',
        [index, id, tripId]
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return listChecklist(userId, tripId);
};

module.exports = {
  ownsTrip,
  listNotes,
  createNote,
  updateNote,
  deleteNote,
  listChecklist,
  createChecklistItem,
  updateChecklistItem,
  deleteChecklistItem,
  reorderChecklist
};
