const pool = require('../config/db');

/**
 * Duplicating a trip (`FV-006` stage d, `PI-026`).
 *
 * ---------------------------------------------------------------------------
 * The feature is not the copying; it is deciding what does not copy
 * ---------------------------------------------------------------------------
 * A trip has seven kinds of thing attached to it, and a naive "copy everything" produces a document
 * that is confidently wrong in four different ways. Each exclusion below is a decision:
 *
 * **Dates are dropped.** A duplicate is almost always for a *different* time - that is what
 * duplicating is for. Carrying `start_date` over means the copy claims to happen on days that have
 * already passed, and the workspace would render each day with a date the traveller never chose. The
 * *shape* survives, because `day_number` is an ordinal rather than a date; the calendar does not.
 *
 * **The share token is never copied.** Two trips cannot hold one token - the unique index would
 * refuse it - but that is the smaller reason. The real one is consent: the owner circulated a link to
 * *that* trip, and a copy inheriting it would silently extend an audience they chose for something
 * else. `FV-009` stage (c) treats the token as a credential, and credentials are not duplicated.
 *
 * **`trip_notes` are not copied — but day notes and item notes are, and the distinction is the
 * point.** This schema has three things called "notes" and they are not the same kind of thing:
 *
 *   - `trip_notes.body` is a **dated observation** - *"hotel confirmed"*, *"Ravi says take the 6am
 *     bus"*. Copied into a new trip it is not merely stale, it is **false**: it asserts something
 *     happened about a journey that has not happened, and carries a date from the wrong month.
 *   - `trip_days.notes` and `trip_items.notes` are **part of the plan** - *"travel day, leave
 *     early"*, *"meet at the north gate"*. They describe the shape of the itinerary rather than
 *     recording something that occurred, so they copy with it.
 *
 * The test suite asserts both halves, because "notes are not copied" is otherwise ambiguous across
 * three tables.
 *
 * **The checklist IS copied, and this asymmetry is the reason "templates" is in the item's name.**
 * A packing list is the genuinely reusable part of a trip. But `is_done` resets to `false`: the
 * labels are what you keep, the ticks are about one journey and copying them hands somebody a list
 * that claims they have already packed.
 *
 * **Status resets to `draft`.** A copy of a completed trip has not been completed.
 *
 * ---------------------------------------------------------------------------
 * One transaction, and one statement per table
 * ---------------------------------------------------------------------------
 * `PE-011`'s case exactly - the trip, its days and its items are one atomic write, as `createTrip`
 * already treats them. A partially copied trip is worse than a failed copy, because it looks like a
 * trip.
 *
 * The rows are moved with `INSERT ... SELECT` rather than read into Node and written back. A 60-day
 * trip is 60 days and potentially hundreds of items; round-tripping every row would be hundreds of
 * statements to achieve what the database can do in three.
 */

/** Everything the workspace reads back, so the caller can render the copy without a second query. */
const TRIP_COLUMNS = `id, user_id, title, description,
  to_char(start_date, 'YYYY-MM-DD') AS start_date,
  to_char(end_date, 'YYYY-MM-DD') AS end_date,
  status, created_at, updated_at`;

/**
 * `Copy of <title>`, truncated to fit.
 *
 * `trips.title` is `VARCHAR(200)`, so a 200-character title plus the prefix is 208 and the insert
 * would fail on a trip whose only fault is a long name. The original is trimmed rather than the
 * prefix dropped, because *"Copy of"* is the part that tells the two apart in a list.
 */
const copyTitle = (title) => `Copy of ${title}`.slice(0, 200);

/**
 * Duplicate one of the caller's own trips.
 *
 * **Only their own.** Duplicating a trip somebody shared with you is a different feature with a
 * different question behind it - the person who sent a read-only link did not agree to you owning a
 * copy - and it is deliberately not this one.
 *
 * @returns the new trip, or `null` when the source is not the caller's (the same answer as one that
 *   does not exist, per the 404-never-403 rule).
 */
const duplicateTrip = async (userId, tripId, { title } = {}) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // `FOR UPDATE` so the source cannot have days added to it between the three statements below.
    // Without it a concurrent write could land a day after the days were copied and before the items
    // were, and the copy would be missing exactly that day's stops.
    const source = await client.query(
      'SELECT id, title, description FROM trips WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [tripId, userId]
    );
    if (!source.rows[0]) {
      await client.query('ROLLBACK');
      return null;
    }

    // Dates, status and the share token are all absent from this INSERT rather than nulled
    // afterwards — a column that is never written cannot be written by mistake, and the list of what
    // a copy carries is legible in one place.
    const created = await client.query(
      `INSERT INTO trips (user_id, title, description, status)
       VALUES ($1, $2, $3, 'draft')
       RETURNING ${TRIP_COLUMNS}`,
      [userId, title?.trim() || copyTitle(source.rows[0].title), source.rows[0].description]
    );
    const newTripId = created.rows[0].id;

    // Days and items in one statement. The CTE returns each new day beside its `day_number`, and the
    // items join back on that — which is sound precisely because `trip_days` has
    // `UNIQUE (trip_id, day_number)`, so the join cannot multiply rows.
    await client.query(
      `WITH new_days AS (
         INSERT INTO trip_days (trip_id, day_number, notes)
         SELECT $1, day_number, notes FROM trip_days WHERE trip_id = $2
         RETURNING id, day_number
       )
       INSERT INTO trip_items
         (trip_day_id, place_id, item_type, title, notes, start_time, end_time, position)
       SELECT new_days.id, old_items.place_id, old_items.item_type, old_items.title,
              old_items.notes, old_items.start_time, old_items.end_time, old_items.position
         FROM trip_items AS old_items
         JOIN trip_days AS old_days ON old_days.id = old_items.trip_day_id
         JOIN new_days ON new_days.day_number = old_days.day_number
        WHERE old_days.trip_id = $2`,
      [newTripId, tripId]
    );

    // The checklist, with every box unticked. `position` is carried so the copy reads in the order
    // the original did.
    await client.query(
      `INSERT INTO trip_checklist_items (trip_id, label, is_done, position)
       SELECT $1, label, FALSE, position FROM trip_checklist_items WHERE trip_id = $2`,
      [newTripId, tripId]
    );

    await client.query('COMMIT');
    return created.rows[0];
  } catch (error) {
    /**
     * **Recorded as an equivalent mutant (`D10`), with the reason measured rather than assumed.**
     *
     * Replacing this `ROLLBACK` with a `COMMIT` changes nothing for any failure that starts in a SQL
     * statement, because Postgres puts the transaction into an aborted state and then answers
     * `COMMIT` with `ROLLBACK`. Verified directly: `BEGIN; INSERT; SELECT 1/0; COMMIT;` reports
     * `ROLLBACK` and leaves zero rows.
     *
     * It is kept because it is the correct call for the case the database cannot see — a JavaScript
     * error thrown *between* two successful statements leaves the transaction healthy, and there a
     * `COMMIT` would genuinely commit half a trip.
     */
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

module.exports = { duplicateTrip, copyTitle };
