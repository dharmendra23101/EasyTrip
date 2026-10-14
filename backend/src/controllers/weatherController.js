const pool = require('../config/db');
const logger = require('../utils/logger');
const weatherService = require('../services/weatherService');

/**
 * `GET /api/places/:id/weather` (`IMP-110`).
 *
 * **Keyed on the place, not on a coordinate the caller supplies.** A `?lat=&lon=` endpoint would be
 * an open proxy to a third-party API — anyone could point EasyTrip's server at any coordinate, at
 * our rate limit, from our IP. Reading the coordinates from the row means the only forecasts this
 * server will ever fetch are for places that are in its own catalogue.
 *
 * That is the same reasoning that removed the image proxy in Sprint 6.16: an endpoint that fetches
 * a URL the caller chose is a different, much worse endpoint than one that fetches a URL we chose.
 *
 * **Public, deliberately.** The weather at a tourist site is not private, and the place page is
 * server-rendered for crawlers — requiring a token would mean signed-out visitors, which is most
 * of them, never see it.
 */
const getPlaceWeather = async (req, res) => {
  const placeId = Number(req.params.id);

  try {
    const place = await pool.query('SELECT id, latitude, longitude FROM places WHERE id = $1', [
      placeId
    ]);

    if (place.rowCount === 0) {
      return res.status(404).json({ message: 'Place not found' });
    }

    const { latitude, longitude } = place.rows[0];

    // A place with no coordinates is a real state — admin-entered rows may have none — and it is
    // reported as such rather than as an error. `available: false` is the shape the UI branches on.
    if (!latitude || !longitude) {
      return res.status(200).json({
        available: false,
        reason: 'no_coordinates',
        message: 'This place has no coordinates yet, so there is no forecast for it.'
      });
    }

    const weather = await weatherService.getWeather(latitude, longitude);

    if (!weather) {
      // 200, not 502. The forecast is a panel on a page that renders fine without it, and an error
      // status would make every caller treat a third party's bad afternoon as a failed request.
      return res.status(200).json({
        available: false,
        reason: 'provider_unavailable',
        message: 'Weather is unavailable right now.'
      });
    }

    // Short public cache. The service already caches for 15 minutes in-process; this lets a CDN or
    // the browser skip the round trip entirely for a repeat view, and `stale-while-revalidate`
    // means a visitor never waits on a refresh.
    res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=900');
    res.status(200).json({ available: true, ...weather });
  } catch (error) {
    logger.error({ err: error }, 'Error getting place weather');
    res.status(500).json({ message: 'Error getting weather' });
  }
};

module.exports = { getPlaceWeather };
