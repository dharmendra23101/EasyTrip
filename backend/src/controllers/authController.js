const pool = require('../config/db');
const { getAuth } = require('firebase-admin/auth');
const { resolveAdminStatus } = require('../utils/authMiddleware');
const logger = require('../utils/logger');

// One list for every profile read/write. It was repeated three times, and the profile form seeds
// itself from whatever this returns — a column missing from one copy silently blanks that field.
/**
 * Map a preference scalar onto the two values the UPDATE understands.
 *
 * `undefined` -> SQL NULL, meaning "leave it". `null` -> `''`, the sentinel meaning "clear it",
 * which is also exactly what an unset `<select>` submits. Anything else passes through.
 */
const clearable = (value) => (value === undefined ? null : value === null ? '' : value);

const USER_COLUMNS =
  'id, firebase_uid, email, name, location, dob, is_admin, ' +
  // `FV-029` stage (c). Personal data on the same terms as `dob`: written by the owner, returned
  // only on this authenticated route, and present in no public payload.
  'requires_step_free, requires_accessible_restroom, ' +
  // `FV-020` stage (a). Same terms again: the owner writes them, only this authenticated route
  // returns them, and `dietary_needs` in particular is health- and religion-adjacent.
  'interests, budget_band, travel_pace, party_type, dietary_needs, ' +
  'created_at, updated_at';

/**
 * Get current user profile
 */
const getProfile = async (req, res) => {
  try {
    const { uid } = req.user;

    // Get user from database
    const result = await pool.query(`SELECT ${USER_COLUMNS} FROM users WHERE firebase_uid = $1`, [
      uid
    ]);

    if (result.rows.length === 0) {
      // User not in database yet, get from Firebase
      const userRecord = await getAuth().getUser(uid);

      // Create user in database
      const newUser = await pool.query(
        `INSERT INTO users (firebase_uid, email, name, is_admin, created_at, updated_at) VALUES ($1, $2, $3, false, NOW(), NOW()) RETURNING ${USER_COLUMNS}`,
        [userRecord.uid, userRecord.email, userRecord.displayName || '']
      );

      // Add last login time and requesting user for audit purposes
      const userData = {
        ...newUser.rows[0],
        last_login: new Date().toISOString(),
        accessed_by: uid
      };

      logger.info('New user row provisioned');
      return res.status(200).json(userData);
    }

    // Add last login time and requesting user for audit purposes
    const userData = {
      ...result.rows[0],
      last_login: new Date().toISOString(),
      accessed_by: uid
    };

    res.status(200).json(userData);
  } catch (error) {
    logger.error({ err: error }, 'Error getting profile');
    res.status(500).json({ message: 'Error getting profile' });
  }
};

/**
 * Update user profile
 */
const updateProfile = async (req, res) => {
  try {
    const { uid } = req.user;
    const {
      name,
      location,
      dob,
      requires_step_free,
      requires_accessible_restroom,
      interests,
      budget_band,
      travel_pace,
      party_type,
      dietary_needs
    } = req.body;

    // location and dob were accepted by the validator and then dropped here, so the profile form
    // reported success while saving nothing (IMP-008). A cleared field arrives as '', which DATE
    // rejects, so both are normalised to NULL rather than written through.
    // `COALESCE($n, column)` for the two access needs, which is the opposite of what `updatePlace`
    // does and right for the opposite reason (`BUG-048`). A place patch is sparse by design — the
    // image-upload path updates one column and must not wipe the rest. This route is the profile
    // form submitting itself whole, so an absent key means "this client does not know about the
    // field" rather than "clear it", and a partial client must not be able to silently reset
    // somebody's stated access needs to false.
    const result = await pool.query(
      `UPDATE users
       SET name = $1, location = $2, dob = $3,
           requires_step_free = COALESCE($4, requires_step_free),
           requires_accessible_restroom = COALESCE($5, requires_accessible_restroom),
           -- COALESCE throughout, so a client that does not send a field leaves it alone rather
           -- than erasing it. Clearing a preference is done by sending an explicit empty value:
           -- [] for the arrays, null for the scalars. Without that, an older client saving a name
           -- would silently wipe preferences it has never heard of (FV-020).
           interests = COALESCE($6, interests),
           budget_band = CASE WHEN $7::text = '' THEN NULL ELSE COALESCE($7, budget_band) END,
           travel_pace = CASE WHEN $8::text = '' THEN NULL ELSE COALESCE($8, travel_pace) END,
           party_type = CASE WHEN $9::text = '' THEN NULL ELSE COALESCE($9, party_type) END,
           dietary_needs = COALESCE($10, dietary_needs),
           updated_at = NOW()
       WHERE firebase_uid = $11
       RETURNING ${USER_COLUMNS}`,
      [
        name,
        location || null,
        dob || null,
        requires_step_free === undefined ? null : Boolean(requires_step_free),
        requires_accessible_restroom === undefined ? null : Boolean(requires_accessible_restroom),
        // `undefined` (field absent) leaves the column alone; an explicit `[]` clears it. The two
        // are different requests and must stay different, or an older client saving a name would
        // erase preferences it does not know about.
        interests === undefined ? null : interests,
        // Three states, two SQL values. `undefined` (absent) becomes SQL NULL and COALESCE leaves
        // the column alone; an explicit `null` is folded to `''`, which the CASE above turns into
        // NULL. Without that fold, sending `null` to clear a preference would be indistinguishable
        // from not sending the field, and the preference could never be unset through the API.
        clearable(budget_band),
        clearable(travel_pace),
        clearable(party_type),
        dietary_needs === undefined ? null : dietary_needs,
        uid
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Add audit data
    const userData = {
      ...result.rows[0],
      last_updated: result.rows[0].updated_at,
      updated_by: uid
    };

    logger.info('Profile updated');
    res.status(200).json(userData);
  } catch (error) {
    logger.error({ err: error }, 'Error updating profile');
    res.status(500).json({ message: 'Error updating profile' });
  }
};

/**
 * Check if current user is an admin
 */
const checkAdmin = async (req, res) => {
  try {
    const { uid } = req.user;

    // This endpoint is the sole authority behind the four /admin/* server-side page
    // gates, so it must answer exactly as the isAdmin API gate would — same DB column,
    // same claim cross-check. resolveAdminStatus is that shared rule; the route is
    // mounted behind isAuthenticatedStrict so revocation is checked here too.
    // Without both, a revoked or de-admined user is served admin HTML and then 403s on
    // every call the page makes.
    const { isAdmin, user } = await resolveAdminStatus(req.decodedToken);

    if (!user) {
      logger.debug('Admin check: no user row; treating as non-admin');
      return res.status(200).json({ isAdmin: false });
    }

    logger.debug({ isAdmin }, 'Admin check completed');
    res.status(200).json({
      isAdmin: isAdmin,
      checked_at: new Date().toISOString(),
      checked_by: uid
    });
  } catch (error) {
    logger.error({ err: error }, 'Error checking admin status');
    res.status(500).json({ message: 'Error checking admin status' });
  }
};

// `logAdminActivity` was removed in Sprint 2.3 (IMP-010). It was exported but never routed, and it
// wrote to an `admin_logs` table that has never existed — so it could only ever have 500'd. The
// three `audit_logs` inserts alongside it are gone for the same reason: nothing read them, and one
// fired on every profile page load. When moderation and admin analytics arrive (IMP-111) they bring
// a real reader, and the audit schema should be designed around that rather than guessed at now.

module.exports = {
  getProfile,
  updateProfile,
  checkAdmin
};
