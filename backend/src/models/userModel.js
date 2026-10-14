const pool = require('../config/db');

/**
 * Reads about the signed-in traveller themselves, as opposed to what they have planned.
 *
 * One function today. It has its own file rather than living in `tripModel` because it answers a
 * question about a **person**, not about a trip — and `tripModel`'s entire discipline is that
 * everything it touches is owned transitively through `trips` (`ADR-031`). A users lookup in there
 * would be the first query in the file that is not, which is exactly how that rule stops being
 * obvious to the next person reading it.
 */

/**
 * What this traveller has said they need in order to get in (`FV-029` stage d).
 *
 * Returns the shape `feasibilityService.checkTrip` takes as its second argument, and **never
 * `null`**: an absent row is a traveller who has stated nothing, which is a real answer and the one
 * every row starts at. Returning `null` would push a falsy check into the engine, and the engine's
 * job is to read data rather than to interpret its absence.
 */
const getAccessNeeds = async (firebaseUid) => {
  const { rows } = await pool.query(
    'SELECT requires_step_free, requires_accessible_restroom FROM users WHERE firebase_uid = $1',
    [firebaseUid]
  );

  return {
    requires_step_free: Boolean(rows[0]?.requires_step_free),
    requires_accessible_restroom: Boolean(rows[0]?.requires_accessible_restroom)
  };
};

module.exports = { getAccessNeeds };
