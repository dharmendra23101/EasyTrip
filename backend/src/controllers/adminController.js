const pool = require('../config/db');
const { getAuth } = require('firebase-admin/auth');
const logger = require('../utils/logger');
const auditModel = require('../models/auditModel');

/**
 * Grant or revoke, as one transaction with its own audit row (`PE-013`).
 *
 * The privilege change and the record of it commit together or not at all. Writing the audit row
 * after the fact — or worse, `.catch`-swallowed beside it — would allow an `is_admin` flip that
 * nothing recorded, which is the one outcome this table exists to make impossible.
 *
 * The row is written `succeeded` because inside this transaction it has: the column that actually
 * authorises the person is set. The Firebase claim sync happens afterwards and can still fail; the
 * caller downgrades the entry to `partially_applied` when it does.
 */
const setAdminFlag = async ({ uid, email, name, grant, actorUid, actorEmail }) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let changed;
    if (grant) {
      const updated = await client.query(
        'UPDATE users SET is_admin = true, updated_at = NOW() WHERE firebase_uid = $1 RETURNING id',
        [uid]
      );
      if (updated.rowCount === 0) {
        await client.query(
          `INSERT INTO users (firebase_uid, email, name, is_admin, created_at, updated_at)
           VALUES ($1, $2, $3, true, NOW(), NOW())`,
          [uid, email, name || '']
        );
      }
      changed = true;
    } else {
      const updated = await client.query(
        'UPDATE users SET is_admin = false, updated_at = NOW() WHERE firebase_uid = $1 RETURNING id',
        [uid]
      );
      changed = updated.rowCount > 0;
      if (!changed) {
        await client.query('ROLLBACK');
        return { changed: false, auditId: null };
      }
    }

    const auditId = await auditModel.record(client, {
      actorUid,
      actorEmail,
      action: grant ? 'admin.granted' : 'admin.revoked',
      targetType: 'user',
      targetId: uid,
      // The email, not the uid, because that is what an admin recognises — and a copy, because the
      // row has to still name them after the account is gone.
      targetLabel: email,
      outcome: 'succeeded'
    });

    await client.query('COMMIT');
    return { changed, auditId };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Keep the Firebase custom `admin` claim in step with users.is_admin.
 *
 * authMiddleware treats a claim that disagrees with the DB column as "one side is
 * stale" and denies the request. script/make-admin.js has always written this claim,
 * so leaving it untouched here means every promotion or demotion made through the API
 * drifts out of sync and eventually locks somebody out of a role they legitimately hold.
 *
 * setCustomUserClaims REPLACES the whole claim set, so existing claims are merged back in.
 * Throws on failure — the caller must surface it, because a half-applied change is
 * exactly the mismatch state that produces 403s.
 */
const syncAdminClaim = async (userRecord, isAdmin) => {
  const existingClaims = userRecord.customClaims || {};

  await getAuth().setCustomUserClaims(userRecord.uid, {
    ...existingClaims,
    admin: isAdmin
  });
};

/**
 * Get all admins
 */
const getAllAdmins = async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, firebase_uid, email, name, created_at, updated_at FROM users WHERE is_admin = true ORDER BY name'
    );
    res.status(200).json(result.rows);
  } catch (error) {
    logger.error({ err: error }, 'Error getting admins');
    res.status(500).json({ message: 'Error getting admins' });
  }
};

/**
 * Add an admin
 */
const addAdmin = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    // Check if user exists in Firebase
    let userRecord;
    try {
      userRecord = await getAuth().getUserByEmail(email);
    } catch (error) {
      return res.status(404).json({ message: 'User not found in Firebase' });
    }

    // The upsert and its audit row, as one transaction. See `setAdminFlag`.
    const { auditId } = await setAdminFlag({
      uid: userRecord.uid,
      email: userRecord.email,
      name: userRecord.displayName,
      grant: true,
      actorUid: req.user?.uid,
      actorEmail: req.user?.email || null
    });

    try {
      await syncAdminClaim(userRecord, true);
    } catch (claimError) {
      logger.error({ err: claimError }, 'Error setting admin custom claim');
      // The grant is already committed and already recorded as `succeeded`; that is now only half
      // true, and the log is the thing a reader will trust later. Downgrading it is best-effort on
      // purpose — if this fails the entry still says the grant happened, which is the half that
      // matters, and failing the response twice over a label would help nobody.
      await auditModel.markPartiallyApplied(auditId).catch((auditError) => {
        logger.error(
          { err: auditError, auditId },
          'Could not downgrade audit entry to partially_applied'
        );
      });
      return res.status(500).json({
        message: `${email} was granted admin in the database, but the Firebase admin claim could not be set. They will be denied admin access until this call succeeds — please retry.`
      });
    }

    res.status(200).json({ message: `${email} is now an admin` });
  } catch (error) {
    logger.error({ err: error }, 'Error adding admin');
    res.status(500).json({ message: 'Error adding admin' });
  }
};

/**
 * Remove admin privileges
 */
const removeAdmin = async (req, res) => {
  try {
    const { email } = req.params;

    // Check if user exists in Firebase
    let userRecord;
    try {
      userRecord = await getAuth().getUserByEmail(email);
    } catch (error) {
      return res.status(404).json({ message: 'User not found in Firebase' });
    }

    // Demotion and its audit row, as one transaction. See `setAdminFlag`.
    const { changed, auditId } = await setAdminFlag({
      uid: userRecord.uid,
      email: userRecord.email,
      grant: false,
      actorUid: req.user?.uid,
      actorEmail: req.user?.email || null
    });

    if (!changed) {
      return res.status(404).json({ message: 'User not found in database' });
    }

    // Demotion already took effect: is_admin is false, and a leftover `admin: true`
    // claim disagrees with it, which authMiddleware denies. Clearing it is still
    // required so a later re-promotion does not read as a mismatch.
    try {
      await syncAdminClaim(userRecord, false);
    } catch (claimError) {
      logger.error({ err: claimError }, 'Error clearing admin custom claim');
      await auditModel.markPartiallyApplied(auditId).catch((auditError) => {
        logger.error(
          { err: auditError, auditId },
          'Could not downgrade audit entry to partially_applied'
        );
      });
      return res.status(500).json({
        message: `${email} was removed as an admin in the database, but the stale Firebase admin claim could not be cleared. Admin access is already denied; please retry to clear the claim.`
      });
    }

    res.status(200).json({ message: `${email} is no longer an admin` });
  } catch (error) {
    logger.error({ err: error }, 'Error removing admin');
    res.status(500).json({ message: 'Error removing admin' });
  }
};

module.exports = {
  getAllAdmins,
  addAdmin,
  removeAdmin
};
