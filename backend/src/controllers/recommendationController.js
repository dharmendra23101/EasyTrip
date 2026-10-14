const recommendationModel = require('../models/recommendationModel');
const logger = require('../utils/logger');

/**
 * Personalised recommendations (`FV-019`).
 *
 * **Authenticated, and personal rather than public.** The answer is derived entirely from what this
 * traveller has saved, so there is no version of it that makes sense without a caller — and the
 * saved list is private, so an endpoint that took a uid from anywhere but a verified token would
 * hand one person's taste to another.
 *
 * The response carries `basis` and `excluded` beside the list, and neither is optional. A
 * recommendation whose input is invisible cannot be argued with, and `FV-019`'s own text is explicit
 * that *"an unexplained recommendation is indistinguishable from an arbitrary one"*.
 */

/** GET /api/auth/recommendations */
const getRecommendations = async (req, res) => {
  try {
    const result = await recommendationModel.getRecommendations(req.user.uid, {
      limit: req.query.limit ? Number(req.query.limit) : undefined
    });

    return res.status(200).json(result);
  } catch (error) {
    logger.error({ err: error }, 'Error building recommendations');
    return res.status(500).json({ message: 'Error loading your recommendations' });
  }
};

module.exports = { getRecommendations };
