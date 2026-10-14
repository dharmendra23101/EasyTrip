const logger = require('../utils/logger');
const placeModel = require('../models/placeModel');
const { scoreFit, WEIGHTS } = require('../services/destinationFit');

/**
 * The explainable destination-fit score (`FV-028` stage d).
 *
 * Its own module rather than another handler on `placeController`, which is already at the 500-line
 * limit with zero waivers - the same answer `placeAlternativesController` gave one sprint ago.
 */

/**
 * Interests as a list, however the query string spelled them.
 *
 * Comma-separated because this is a GET and a JSON array in a query parameter is a worse thing to ask
 * a caller for than a comma. Empty entries are dropped rather than counted: `?interests=beaches,,`
 * asks about one interest, and letting the blanks through would divide the match by three.
 */
const parseInterests = (raw) =>
  String(raw ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

/**
 * How well one place fits a month and a set of interests, with the working attached.
 *
 * **The response always carries `coverage` beside `score`, and `score` may be `null`.** A caller that
 * renders the number without the coverage is claiming a measurement where there is an opinion over a
 * fraction of the evidence, so the two are returned together and neither is optional.
 */
const getPlaceFit = async (req, res) => {
  try {
    const place = await placeModel.getPlaceById(req.params.id);
    if (!place) return res.status(404).json({ message: 'Place not found' });

    const fit = scoreFit(place, {
      month: req.query.month ? Number(req.query.month) : undefined,
      interests: parseInterests(req.query.interests)
    });

    return res.status(200).json({
      data: {
        ...fit,
        // Returned rather than documented-and-hoped-for. The weights are a judgement call, and a UI
        // that shows the working should be able to show what each factor was worth without keeping
        // its own copy that can drift.
        weights: WEIGHTS
      }
    });
  } catch (error) {
    logger.error({ err: error }, 'Error scoring destination fit');
    return res.status(500).json({
      message: 'Error scoring this place',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Server error',
      timestamp: new Date().toISOString()
    });
  }
};

module.exports = { getPlaceFit };
