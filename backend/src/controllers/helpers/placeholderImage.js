const logger = require('../../utils/logger');

/**
 * The SVG served when a place has no image, or when its stored image cannot be reached.
 *
 * Generated rather than a static file so the placeholder carries the place id — which is what
 * makes a broken image traceable to a row instead of just looking broken.
 */

// This response is served as image/svg+xml, which browsers execute scripts inside when it is
// opened directly, so request input must never reach the document body (SECURITY_AUDIT M1).
// Anything that is not a positive integer id gets this constant document verbatim.
const GENERIC_PLACEHOLDER_SVG = `
      <svg width="400" height="300" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="#f5f5f5" stroke="#e0e0e0" stroke-width="2"/>
        <text x="50%" y="50%" font-family="Arial, sans-serif" font-size="16" text-anchor="middle" fill="#666">
          No Image Available
        </text>
      </svg>
    `;

const buildPlaceholderSvg = (placeId) => {
  const numericId = Number.parseInt(placeId, 10);

  if (!Number.isInteger(numericId) || numericId <= 0) {
    return GENERIC_PLACEHOLDER_SVG;
  }

  // numericId is a parsed integer here, not the raw path param
  return `
      <svg width="400" height="300" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="#f5f5f5" stroke="#e0e0e0" stroke-width="2"/>
        <text x="50%" y="45%" font-family="Arial, sans-serif" font-size="16" text-anchor="middle" fill="#666">
          No Image Available
        </text>
        <text x="50%" y="60%" font-family="Arial, sans-serif" font-size="12" text-anchor="middle" fill="#999">
          Place ID: ${numericId}
        </text>
      </svg>
    `;
};

/**
 * Send default placeholder image
 */

const sendDefaultImage = (res, timestamp, placeId) => {
  try {
    const svgPlaceholder = buildPlaceholderSvg(placeId);

    res.set({
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=3600',
      'Content-Length': Buffer.byteLength(svgPlaceholder)
    });
    return res.send(svgPlaceholder);
  } catch (err) {
    logger.error({ err }, 'Error serving SVG placeholder');
    return res.status(404).json({
      message: 'Image not found',
      place_id: Number.parseInt(placeId, 10) || null,
      timestamp
    });
  }
};

/**
 * Create a new place with Cloudinary
 */

module.exports = { GENERIC_PLACEHOLDER_SVG, buildPlaceholderSvg, sendDefaultImage };
