const auditModel = require('../models/auditModel');
const logger = require('../utils/logger');

/**
 * The admin audit log's reader (`PE-013`, `FV-023` part 1).
 *
 * **This handler is the reason the table was allowed to exist.** `ADR-022` deleted the previous
 * audit tables on the ground that *"a table with writers and no readers is not an audit trail — it
 * is write amplification that looks like diligence"*, and named the condition for revisiting: a
 * schema designed around what a real consumer queries. This is that consumer, and
 * `022_admin_audit_log.sql` is shaped by the three questions it answers.
 *
 * Behind `isAdmin` like the rest of `/api/admin`. There is no per-actor scoping — an admin sees
 * every entry including their own. An audit log an actor can filter themselves out of is not one.
 */
const listAuditEntries = async (req, res) => {
  try {
    const { action, limit, offset } = req.query;

    const page = await auditModel.listEntries({ action, limit, offset });

    res.status(200).json(page);
  } catch (error) {
    logger.error({ err: error }, 'Error listing audit entries');
    res.status(500).json({ message: 'Error listing audit entries' });
  }
};

module.exports = { listAuditEntries };
