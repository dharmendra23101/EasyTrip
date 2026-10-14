const logger = require('../utils/logger');
const geocodingService = require('../services/geocodingService');

/**
 * `GET /api/admin/geocode?q=` (`IMP-116`, `ADR-035`).
 *
 * **Admin-only, and that is a security decision rather than a UI one.** Unlike
 * `/places/:id/weather`, which fetches a coordinate *this server chose* from its own table, this
 * endpoint necessarily forwards text the caller supplied to a third party. That makes it a proxy,
 * and `IMP-110`'s own comment states the rule it is being weighed against: *an endpoint that
 * fetches a URL the caller chose is a different and much worse endpoint than one that fetches a URL
 * we chose.*
 *
 * Three things keep it on the right side of that line:
 *
 *   1. **The caller does not choose a URL.** They choose a search *term*, which is URL-encoded into
 *      a fixed endpoint. There is no path, host or scheme under their control, so this is not SSRF —
 *      it is a bounded query against one known service.
 *   2. **`isAdmin` gates it.** The population that can spend our Nominatim budget is the same
 *      population that can already create places, and it is enumerable.
 *   3. **The upstream call is paced in one place** (`geocodingService`), so the number of admins
 *      typing does not change the rate the provider sees.
 *
 * **A miss is 200 with an empty list, not 404.** "No match for this text" is a successful answer to
 * the question asked. A 404 would mean the endpoint does not exist, and would push every client
 * into treating a normal outcome as an error.
 */
const geocodeAddress = async (req, res) => {
  try {
    const results = await geocodingService.geocode(req.query.q);

    res.status(200).json({
      // Named `results` rather than `data` so nothing reads this as the paginated list envelope the
      // place endpoints use. There is no page two: the service caps at five candidates because a
      // query with more than five is one that needs rewriting, not one that needs scrolling.
      results,
      // The client renders three different things for these three cases, and deriving them from
      // `results.length` in every client is how two of them end up inconsistent.
      status: results.length === 0 ? 'no_match' : results.length === 1 ? 'exact' : 'ambiguous'
    });
  } catch (error) {
    // The service is written never to throw — it returns `[]` for a timeout, a non-200 and an
    // unrecognised shape alike. This exists so that if that ever stops being true, an admin gets an
    // error instead of a blank form field they might mistake for "no such place".
    logger.error({ err: error }, 'Error geocoding an address');
    res.status(500).json({
      message: 'Error looking up coordinates',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Server error',
      timestamp: new Date().toISOString()
    });
  }
};

module.exports = { geocodeAddress };
