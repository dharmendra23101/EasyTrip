const logger = require('../utils/logger');
const analyticsModel = require('../models/analyticsModel');

/**
 * `GET /api/admin/analytics` (`IMP-111`, `ADR-037`).
 *
 * Admin-only. Nothing here is secret in isolation — the catalogue is public and so are the ratings —
 * but the aggregate is operational information about the product (how many users, how many trips,
 * what is unfinished), and there is no reason for it to be readable by anyone who is not running it.
 *
 * One endpoint rather than four, because the four figures are meant to be consistent with each
 * other; fetched separately they are four snapshots of a database that is being written to.
 */
const getAnalytics = async (req, res) => {
  try {
    const [stats, ratings, activity, incomplete] = await Promise.all([
      analyticsModel.catalogueStats(),
      analyticsModel.ratingDistribution(),
      analyticsModel.activitySeries(req.query.days),
      analyticsModel.incompletePlaces()
    ]);

    res.status(200).json({
      catalogue: stats,
      ratings,
      activity,
      // Named for what a reader does with it, not for what the query selected. `incomplete` invites
      // "incomplete what?"; these are places an admin can finish.
      needsAttention: incomplete
    });
  } catch (error) {
    logger.error({ err: error }, 'Error building admin analytics');
    res.status(500).json({
      message: 'Error loading analytics',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Server error',
      timestamp: new Date().toISOString()
    });
  }
};

module.exports = { getAnalytics };
