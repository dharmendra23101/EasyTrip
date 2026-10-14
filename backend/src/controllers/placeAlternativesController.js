const logger = require('../utils/logger');
const placeAlternativesModel = require('../models/placeAlternativesModel');

/**
 * Alternatives to a place (`FV-028` stage c).
 *
 * Its own module because `placeController` reached 515 lines against a 500-line limit with zero
 * waivers, and because this is the shape that file already uses for everything that is not the core
 * CRUD - `placeImageController`, `placeReviewController` and `placeTaxonomyController` are all
 * spread into its exports the same way. A fourth was the answer the third had already given.
 */

/**
 * Quieter places near this one.
 *
 * **Always a 200 with a possibly-empty list, never a 404.** An empty array is the honest and by far
 * the commonest answer: the origin has no curated crowd level, so there is nothing for an
 * alternative to be quieter *than*. That is a result, not a missing resource, and a 404 would tell a
 * client the place does not exist.
 */
const getQuieterNearby = async (req, res) => {
  try {
    const quieter = await placeAlternativesModel.getQuieterNearby(req.params.id);
    res.status(200).json({ data: quieter });
  } catch (error) {
    logger.error({ err: error }, 'Error finding quieter nearby places');
    res.status(500).json({
      message: 'Error finding quieter places nearby',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Server error',
      timestamp: new Date().toISOString()
    });
  }
};

module.exports = { getQuieterNearby };
