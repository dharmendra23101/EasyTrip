const pool = require('../config/db');
// One rule for who may touch a trip, shared with every other trip model (`FV-007`).
const { readableBy, editableBy } = require('./tripAccessModel');

/**
 * Trip expenses (`FV-008`).
 *
 * ---------------------------------------------------------------------------
 * Reading is for everybody on the trip; writing follows the editor rule
 * ---------------------------------------------------------------------------
 * A viewer can see what has been spent — being able to read the plan and not the bill would be an
 * odd place to draw a line, and the amounts are about *them*. Recording an expense is a change to
 * the trip's shared state, so it takes the same `editableBy` the itinerary does.
 *
 * Deleting an expense is the **owner's or the payer's**, which is neither of the two predicates and
 * is therefore checked in the model rather than in SQL: somebody who recorded a dinner by mistake
 * must be able to unrecord it without asking, and nobody else should be able to erase what they
 * paid.
 *
 * ---------------------------------------------------------------------------
 * Participants are validated once, at write time
 * ---------------------------------------------------------------------------
 * `019_trip_expenses.sql` deliberately does not constrain a participant to be on the trip, because
 * people leave trips and an expense records what was true when it happened. That makes validation
 * this file's job on the way in: at the moment an expense is created, every participant must be
 * somebody who can currently see the trip. Afterwards it is history, and history does not get
 * rewritten because access changed.
 */

/** Everyone who can currently see this trip: the owner, plus every collaborator. */
const peopleOnTrip = async (client, tripId) => {
  const result = await client.query(
    `SELECT trips.user_id AS uid FROM trips WHERE trips.id = $1
     UNION
     SELECT trip_collaborators.user_id AS uid FROM trip_collaborators
     WHERE trip_collaborators.trip_id = $1`,
    [tripId]
  );

  return new Set(result.rows.map((row) => row.uid));
};

/**
 * Every expense on a trip, with its participants, newest first.
 *
 * Two queries rather than a join, for the same reason `getTripWorkspace` uses two: a join between an
 * expense and its participants multiplies rows, and reassembling them in JavaScript is clearer than
 * de-duplicating in SQL.
 */
const listExpenses = async (userId, tripId) => {
  const expenses = await pool.query(
    `SELECT trip_expenses.id, trip_expenses.paid_by, trip_expenses.description,
            trip_expenses.amount_minor, trip_expenses.currency,
            trip_expenses.created_by, trip_expenses.created_at
     FROM trip_expenses
     JOIN trips ON trips.id = trip_expenses.trip_id
     WHERE trip_expenses.trip_id = $1 AND ${readableBy('$2')}
     ORDER BY trip_expenses.created_at DESC, trip_expenses.id DESC`,
    [tripId, userId]
  );

  if (expenses.rowCount === 0) return [];

  const participants = await pool.query(
    `SELECT expense_id, user_id FROM trip_expense_participants
     WHERE expense_id = ANY($1::int[])
     ORDER BY user_id`,
    [expenses.rows.map((row) => row.id)]
  );

  const byExpense = new Map(expenses.rows.map((row) => [row.id, { ...row, participants: [] }]));
  for (const row of participants.rows) {
    byExpense.get(row.expense_id)?.participants.push(row.user_id);
  }

  return [...byExpense.values()];
};

/**
 * Record an expense.
 *
 * One transaction: the expense and its participants are a single fact, and an expense with no
 * participants is not a smaller version of one — it is a row the settlement will silently skip.
 *
 * Returns a discriminated result rather than throwing, because the interesting failures are things
 * the caller did:
 *
 *   - `{ ok: false, reason: 'not_editable' }`  — no access, or read-only
 *   - `{ ok: false, reason: 'unknown_person' }` — a participant or payer who is not on the trip
 */
const createExpense = async (
  userId,
  tripId,
  { description, amount_minor, currency, paid_by, participants }
) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const allowed = await client.query(
      `SELECT trips.id FROM trips WHERE trips.id = $1 AND ${editableBy('$2')}`,
      [tripId, userId]
    );
    if (allowed.rowCount === 0) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'not_editable' };
    }

    // Validated against the trip's people at write time — see the header for why the schema does
    // not do this and why it must not.
    const people = await peopleOnTrip(client, tripId);
    const payer = paid_by || userId;
    const sharers = participants && participants.length > 0 ? participants : [...people].sort();

    if (!people.has(payer) || sharers.some((uid) => !people.has(uid))) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'unknown_person' };
    }

    const expense = await client.query(
      `INSERT INTO trip_expenses (trip_id, paid_by, description, amount_minor, currency, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, paid_by, description, amount_minor, currency, created_by, created_at`,
      [tripId, payer, description, amount_minor, currency, userId]
    );

    // `unnest` rather than a loop: one round trip, and the UNIQUE constraint still rejects a
    // duplicate uid in the same request rather than doubling somebody's share.
    await client.query(
      `INSERT INTO trip_expense_participants (expense_id, user_id)
       SELECT $1, unnest($2::varchar[])`,
      [expense.rows[0].id, [...new Set(sharers)]]
    );

    await client.query('COMMIT');
    return {
      ok: true,
      expense: { ...expense.rows[0], participants: [...new Set(sharers)].sort() }
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Delete an expense — the owner's or the payer's.
 *
 * Not `editableBy`: an editor who joined last week should not be able to erase what somebody else
 * paid for, and the person who recorded a mistake should not have to ask. Neither rule is
 * expressible as one of the shared predicates, so it is written here, once.
 */
const deleteExpense = async (userId, tripId, expenseId) => {
  const result = await pool.query(
    `DELETE FROM trip_expenses
     USING trips
     WHERE trip_expenses.id = $1
       AND trip_expenses.trip_id = trips.id
       AND trips.id = $2
       AND (trips.user_id = $3 OR trip_expenses.paid_by = $3)`,
    [expenseId, tripId, userId]
  );

  return result.rowCount > 0;
};

module.exports = { listExpenses, createExpense, deleteExpense };
