const pool = require('../config/db');
const { AUDIT_ACTIONS, AUDIT_TARGET_TYPES, AUDIT_OUTCOMES } = require('../constants/auditActions');

/**
 * The admin audit log (`PE-013`, `FV-023` part 1).
 *
 * ---------------------------------------------------------------------------
 * `ADR-022` deleted this table's predecessor. Read that first.
 * ---------------------------------------------------------------------------
 * Four `INSERT INTO audit_logs` calls were removed in Sprint 2.3 because nothing read them and
 * three were `.catch`-swallowed, so they had never actually written a row. The ADR's sentence is
 * the constraint this module is built under:
 *
 *   > A table with writers and no readers is not an audit trail - it is write amplification that
 *   > looks like diligence.
 *
 * The reader landed with `IMP-111`, and `listEntries` below is what `admin/audit.jsx` calls. Every
 * column written here is rendered there.
 *
 * ---------------------------------------------------------------------------
 * The write takes a `client`, and that is the whole design
 * ---------------------------------------------------------------------------
 * `record` never opens its own transaction. It takes whatever the caller is already using - a
 * transaction client, or the pool - so that **the audit row and the thing it records commit or roll
 * back together**. An `is_admin = true` that committed while its audit row did not is precisely the
 * hole an audit log exists to close, and it is what a fire-and-forget insert leaves open.
 *
 * That is also why there is no `.catch(() => {})` anywhere in this file. `ADR-022` identified the
 * swallowed insert as *the actual defect* - code that pretends to audit is worse than code that
 * does not, because a reviewer reads it as a control that exists. If the insert fails here, the
 * caller's transaction fails, and the admin sees an error rather than an unrecorded action.
 */

/** Newest-first paging. Matches `admin_audit_log_created_idx`. */
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/**
 * Write one entry. `client` is a transaction client or the pool — see the header.
 *
 * The vocabularies are asserted here rather than left to the database's CHECK constraints. Both
 * fire, but a `TypeError` naming the bad value at the call site is a far better failure than a
 * Postgres constraint violation surfacing as a 500 three layers up — and this is a function whose
 * arguments are literals written by hand, so a typo is the realistic failure.
 */
const record = async (
  client,
  {
    actorUid,
    actorEmail = null,
    action,
    targetType,
    targetId,
    targetLabel = null,
    outcome,
    detail = {}
  }
) => {
  if (!AUDIT_ACTIONS.includes(action)) {
    throw new TypeError(`Unknown audit action: ${action}`);
  }
  if (!AUDIT_TARGET_TYPES.includes(targetType)) {
    throw new TypeError(`Unknown audit target type: ${targetType}`);
  }
  if (!AUDIT_OUTCOMES.includes(outcome)) {
    throw new TypeError(`Unknown audit outcome: ${outcome}`);
  }
  if (!actorUid) {
    // An entry with no actor is not an audit entry. Better to fail the action than to store a row
    // that answers "what happened" while refusing to answer "who did it".
    throw new TypeError('An audit entry needs an actorUid');
  }

  const result = await client.query(
    `INSERT INTO admin_audit_log
       (actor_uid, actor_email, action, target_type, target_id, target_label, outcome, detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      actorUid,
      actorEmail,
      action,
      targetType,
      String(targetId),
      targetLabel,
      outcome,
      JSON.stringify(detail)
    ]
  );

  return result.rows[0].id;
};

/**
 * Downgrade an entry to `partially_applied` after the fact.
 *
 * The one case that cannot be decided inside the transaction: `addAdmin` and `removeAdmin` commit
 * the database change, then call Firebase to sync the custom claim. When that throws, the caller
 * gets a 500 and **the privilege change has already happened**.
 *
 * So the row is written `succeeded` inside the transaction — guaranteeing the change is recorded at
 * all — and refined here once the external call has had its say. If this update itself fails the
 * entry still exists and still says the grant happened, which is the load-bearing half; the caller
 * logs the failure rather than escalating it, because the alternative is telling an admin their
 * grant failed twice over something that only affects a label.
 */
const markPartiallyApplied = async (id) => {
  await pool.query(`UPDATE admin_audit_log SET outcome = 'partially_applied' WHERE id = $1`, [id]);
};

/**
 * The page's read. Newest first, one optional filter, paged.
 *
 * `action` is the only filter offered, and it is the only one indexed. Filtering by actor was
 * considered and left out: with a handful of admins it is a dropdown of one, and an index nothing
 * queries is a write cost pretending to be foresight.
 */
const listEntries = async ({ action = null, limit, offset } = {}) => {
  const safeLimit = Math.min(Math.max(Number(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  const safeAction = AUDIT_ACTIONS.includes(action) ? action : null;

  // Two statements rather than one with a window function: the count is over the *filtered* set and
  // is what the page needs to know whether a "next" button should exist at all.
  const rows = await pool.query(
    `SELECT id, actor_uid, actor_email, action, target_type, target_id, target_label,
            outcome, detail, created_at
       FROM admin_audit_log
      WHERE ($1::text IS NULL OR action = $1)
      -- id is in the ORDER BY, not decoration: two rows written in one transaction share
      -- created_at to the microsecond, and a paged query on a non-unique sort can repeat one row
      -- and skip another between pages.
      ORDER BY created_at DESC, id DESC
      LIMIT $2 OFFSET $3`,
    [safeAction, safeLimit, safeOffset]
  );

  const total = await pool.query(
    `SELECT COUNT(*)::int AS total FROM admin_audit_log WHERE ($1::text IS NULL OR action = $1)`,
    [safeAction]
  );

  return {
    entries: rows.rows,
    total: total.rows[0].total,
    limit: safeLimit,
    offset: safeOffset
  };
};

module.exports = {
  record,
  markPartiallyApplied,
  listEntries,
  DEFAULT_LIMIT,
  MAX_LIMIT
};
