const pool = require('../config/db');
// The write rule, written once (`FV-007` stage (c)). Every predicate below is the same one.
const { editableBy } = require('./tripAccessModel');
// `BL-147`. Imported here rather than called from the controller so the activity row shares the
// transaction the change is already in — see `tripActivityModel`'s header for why that matters.
const tripActivity = require('./tripActivityModel');

/**
 * Everything that writes a `trip_items` row (`IMP-109`, `ADR-031`).
 *
 * **Extracted from `tripModel` in Sprint 8.26**, and the line count is what forced the question
 * rather than what answered it. The real boundary is that these four functions share a property
 * nothing else in that file has: **an item is reached through two joins, not one.** A trip is owned
 * directly; a day belongs to a trip; an item belongs to a day that belongs to a trip. Every query
 * below therefore carries `trip_items -> trip_days -> trips` and re-proves ownership at the end of
 * that chain.
 *
 * That is the rule worth keeping in one file, because it is the rule a new function here would
 * otherwise be written without. **There is deliberately no `getItem(id)` and no `updateItem(id)`** —
 * addressing a child row by its own primary key, without the trip in the query, is one refactor away
 * from writing to somebody else's itinerary, so the shape is never offered.
 */

/**
 * Add an item to a day.
 *
 * `title` is resolved from the place when one is given and no title was supplied — the item has to
 * carry its own label, because `ON DELETE SET NULL` will one day take the place away and leave the
 * row behind (`ADR-031`).
 */
const addItem = async (userId, tripId, dayId, item) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const day = await client.query(
      `SELECT trip_days.id FROM trip_days
       JOIN trips ON trips.id = trip_days.trip_id
       WHERE trip_days.id = $1 AND trips.id = $2 AND ${editableBy('$3')}`,
      [dayId, tripId, userId]
    );

    if (day.rowCount === 0) {
      await client.query('ROLLBACK');
      return null;
    }

    let title = item.title;
    if (!title && item.place_id) {
      const place = await client.query('SELECT name FROM places WHERE id = $1', [item.place_id]);
      // No row means the place does not exist; let the foreign key say so rather than inventing a
      // title for something that is about to fail.
      title = place.rows[0]?.name;
    }

    const position = await client.query(
      'SELECT COALESCE(MAX(position), -1) + 1 AS position FROM trip_items WHERE trip_day_id = $1',
      [dayId]
    );

    const created = await client.query(
      `INSERT INTO trip_items
         (trip_day_id, place_id, item_type, title, notes, start_time, end_time, position)
       VALUES ($1, $2, COALESCE($3, 'place'), $4, $5, $6, $7, $8)
       RETURNING id, trip_day_id, place_id, item_type, title, notes, start_time, end_time, position`,
      [
        dayId,
        item.place_id || null,
        item.item_type || null,
        title,
        item.notes || null,
        item.start_time || null,
        item.end_time || null,
        position.rows[0].position
      ]
    );

    await tripActivity.record(client, {
      tripId,
      actorUid: userId,
      actorLabel: await tripActivity.actorLabelFor(client, userId),
      action: 'item.added',
      detail: { title: created.rows[0].title }
    });

    await client.query('COMMIT');
    return created.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const UPDATABLE_ITEM_COLUMNS = ['title', 'notes', 'start_time', 'end_time', 'item_type'];

/**
 * Patch an item, scoped through its day to its trip to its owner.
 *
 * **`trip_day_id` is handled separately from the other columns, and the reason is a security one.**
 * Every column in `UPDATABLE_ITEM_COLUMNS` is inert data — a title, a note, a time. `trip_day_id` is
 * a *reference*, and the `WHERE` clause below proves that the item's **current** day belongs to this
 * trip, which says nothing whatever about the day it is being moved to. Listing it alongside the
 * others would have let a caller move their own item into a stranger's trip by naming that trip's
 * day id: authorised on the way out, unauthorised on the way in.
 *
 * So the destination is joined and constrained — `destination.trip_id = trips.id` — against the trip
 * this caller has already been proven to own. A day id from anywhere else matches nothing, zero rows
 * update, and the caller gets the same 404 they would get for an item that does not exist.
 *
 * **Position is recomputed, not carried.** An item keeps its own position number when its day
 * changes, which would drop it into the middle of the destination day's order at whatever rank it
 * happened to hold. It is appended instead — the only placement that cannot displace something the
 * user put where they wanted it, and the same placement `replanService` *simulates* when it asks
 * `checkTrip` whether a proposed move is feasible. If the two disagreed, the validation would have
 * been answering a question about a different plan.
 *
 * Added Sprint 8.26. Before it, **nothing could move an item between days** — not the workspace UI,
 * not the API — which made `FV-027`'s proposals unappliable and this file's own claim that they went
 * through "the endpoint that already exists" untrue.
 */
const updateItem = async (userId, tripId, itemId, patch) => {
  const movingDay = 'trip_day_id' in patch;
  const columns = UPDATABLE_ITEM_COLUMNS.filter((column) => column in patch);
  if (columns.length === 0 && !movingDay) return null;

  const values = columns.map((column) => patch[column]);
  const assignments = columns.map((column, i) => `${column} = $${i + 1}`);

  if (movingDay) {
    assignments.push(
      'trip_day_id = destination.id',
      // The pre-update snapshot, so the item being moved is still counted on its old day and
      // cannot inflate the destination's maximum by one.
      `position = (SELECT COALESCE(MAX(existing.position), -1) + 1
                     FROM trip_items AS existing
                    WHERE existing.trip_day_id = destination.id)`
    );
  }

  // A transaction, added with `BL-147`: this was a single statement, and it stays correct on its
  // own — but the activity row has to commit with the update or not at all, and a fire-and-forget
  // insert afterwards is the hole `ADR-022` identified. One statement plus one insert is still one
  // unit of work.
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const result = await client.query(
      `UPDATE trip_items SET ${assignments.join(', ')}
       FROM trip_days, trips${movingDay ? ', trip_days AS destination' : ''}
       WHERE trip_items.id = $${values.length + 1}
         AND trip_items.trip_day_id = trip_days.id
         AND trip_days.trip_id = trips.id
         AND trips.id = $${values.length + 2}
         AND ${editableBy(`$${values.length + 3}`)}
         ${
           movingDay
             ? `AND destination.id = $${values.length + 4}
         AND destination.trip_id = trips.id`
             : ''
         }
       RETURNING trip_items.id, trip_items.trip_day_id, trip_items.place_id, trip_items.item_type,
                 trip_items.title, trip_items.notes, trip_items.start_time, trip_items.end_time,
                 trip_items.position`,
      movingDay
        ? [...values, itemId, tripId, userId, patch.trip_day_id]
        : [...values, itemId, tripId, userId]
    );

    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return null;
    }

    await tripActivity.record(client, {
      tripId,
      actorUid: userId,
      actorLabel: await tripActivity.actorLabelFor(client, userId),
      action: 'item.updated',
      // `trip_day_id` is included in the field list when the item moved between days, because
      // "moved Red Fort to another day" is a different event to the reader than "renamed it" —
      // even though both arrive through this one endpoint.
      detail: {
        title: result.rows[0].title,
        fields: movingDay ? [...columns, 'trip_day_id'] : columns
      }
    });

    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/** Remove an item. */
const deleteItem = async (userId, tripId, itemId) => {
  // A transaction for `BL-147`, same reasoning as `updateItem`. The DELETE also gained a
  // `RETURNING`: after it commits the title is gone, and "removed Red Fort" is the line the reader
  // needs rather than "removed an item".
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const result = await client.query(
      `DELETE FROM trip_items
       USING trip_days, trips
       WHERE trip_items.id = $1
         AND trip_items.trip_day_id = trip_days.id
         AND trip_days.trip_id = trips.id
         AND trips.id = $2
         AND ${editableBy('$3')}
       RETURNING trip_items.title`,
      [itemId, tripId, userId]
    );

    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return false;
    }

    await tripActivity.record(client, {
      tripId,
      actorUid: userId,
      actorLabel: await tripActivity.actorLabelFor(client, userId),
      action: 'item.removed',
      detail: { title: result.rows[0].title }
    });

    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Move items into an explicit order within a day — the operation a drag-and-drop performs.
 *
 * Takes the **full** ordered list of item ids for that day and rewrites every position from it, in
 * one transaction. A "move item X to index 3" API would need the server to reconstruct the rest of
 * the order, which is the same information arriving less reliably.
 *
 * Every id is verified to belong to that day before anything is written: without it, including one
 * foreign id in the array would drag another user's item into this trip's ordering.
 */
const reorderItems = async (userId, tripId, dayId, orderedItemIds) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const owned = await client.query(
      `SELECT trip_items.id, trip_days.day_number FROM trip_items
       JOIN trip_days ON trip_days.id = trip_items.trip_day_id
       JOIN trips ON trips.id = trip_days.trip_id
       WHERE trip_days.id = $1 AND trips.id = $2 AND ${editableBy('$3')}`,
      [dayId, tripId, userId]
    );

    const ownedIds = new Set(owned.rows.map((row) => row.id));

    // Every id must be one of this day's, and every one of this day's must be present. A partial
    // list would leave the omitted items at stale positions, silently interleaved with the new
    // order — worse than a rejection, because it looks like it worked.
    const requested = orderedItemIds.map(Number);
    const sameSize = requested.length === ownedIds.size;
    const allOwned = requested.every((id) => ownedIds.has(id));
    if (!sameSize || !allOwned || new Set(requested).size !== requested.length) {
      await client.query('ROLLBACK');
      return false;
    }

    for (const [position, itemId] of requested.entries()) {
      await client.query('UPDATE trip_items SET position = $1 WHERE id = $2', [position, itemId]);
    }

    await tripActivity.record(client, {
      tripId,
      actorUid: userId,
      actorLabel: await tripActivity.actorLabelFor(client, userId),
      action: 'items.reordered',
      // The day's ordinal rather than its id, because the reader is looking at a plan numbered by
      // day and has never seen a `trip_days.id`. `owned` is non-empty here: an empty day cannot
      // reach this line, since a zero-length order fails the size check above.
      detail: { dayNumber: owned.rows[0].day_number, count: requested.length }
    });

    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

module.exports = { addItem, updateItem, deleteItem, reorderItems };
