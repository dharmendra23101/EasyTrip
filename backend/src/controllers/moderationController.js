const logger = require('../utils/logger');
const moderationModel = require('../models/moderationModel');

/**
 * The moderation queue (`IMP-111`, `ADR-036`).
 *
 * Admin-only, and unlike `/admin/geocode` the reason is not a third-party budget: this reads the
 * content of reviews alongside how many people objected to them. `IMP-021` keeps author identity
 * out of every public response; this endpoint keeps *reporter* identity out of even the admin one.
 */

const listReports = async (req, res) => {
  try {
    const { status, limit, offset } = req.query;
    const result = await moderationModel.listReports({ status, limit, offset });
    const counts = await moderationModel.reportCounts();

    res.status(200).json({
      data: result.rows,
      pagination: {
        total: result.total,
        limit: result.limit,
        offset: result.offset,
        hasMore: result.offset + result.rows.length < result.total,
        // The status that was actually applied, from the model.
        //
        // Echoing `req.query.status` instead is an **equivalent** mutation today (`M-11` in the
        // IMP-111 run) — the route validator rejects any unrecognised value before this handler
        // sees it, so the two are always the same string. It stays this way because the equivalence
        // depends entirely on that validator: the model's own fallback to `open` exists for callers
        // that do not come through it, and a response echoing the request would then describe a
        // filter that did not run.
        status: result.status
      },
      counts
    });
  } catch (error) {
    logger.error({ err: error }, 'Error listing review reports');
    res.status(500).json({
      message: 'Error loading the moderation queue',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Server error',
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * `PATCH /api/admin/reports/reviews/:reviewId` — resolve every open report against one review.
 *
 * **Keyed on the review, not on a report id.** A review flagged by eight people is one decision;
 * resolving one of the eight would leave it in the queue with a lower count, which reads as
 * "partly handled" and is a state nobody wants to reason about.
 *
 * Note what this endpoint does **not** do: it does not delete the review. Dismissing a report and
 * removing a review are different judgements with different consequences, and one endpoint that did
 * both according to a flag would make the destructive one reachable by a typo. Removal goes through
 * the existing review delete route, which admins may now use (`ADR-036`) — one delete path, as
 * `IMP-117` insisted.
 */
const resolveReports = async (req, res) => {
  try {
    const reviewId = Number(req.params.reviewId);
    const { resolution } = req.body;

    const moved = await moderationModel.resolveReportsForReview(reviewId, resolution, {
      uid: req.user?.uid,
      email: req.user?.email || null
    });

    if (moved === 0) {
      // Nothing was open. Two moderators can have the queue on screen at once, and the second one
      // needs to learn that the first already acted rather than seeing a success that changed
      // nothing. 409, not 404: the review may well exist and have resolved reports.
      return res.status(409).json({
        message: 'This review has no open reports — it may already have been handled.',
        resolved: 0
      });
    }

    res.status(200).json({ message: `Resolved ${moved} report(s).`, resolved: moved, resolution });
  } catch (error) {
    logger.error({ err: error }, 'Error resolving review reports');
    res.status(500).json({
      message: 'Error resolving the reports',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Server error',
      timestamp: new Date().toISOString()
    });
  }
};

module.exports = { listReports, resolveReports };
