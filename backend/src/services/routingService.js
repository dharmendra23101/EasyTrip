const logger = require('../utils/logger');

/**
 * Real road distance and travel time, from OpenRouteService (`FV-026` stage b).
 *
 * ---------------------------------------------------------------------------
 * What this replaces, and why it is worth a provider
 * ---------------------------------------------------------------------------
 * `feasibilityService.ASSUMPTIONS` inflates a straight line by 1.3 and divides by 40 km/h. Every
 * travel finding says *"estimated"* because of it, and the number is honest only in the sense that
 * it admits what it is. In the Himalayas road distance and crow-flies differ by a factor rather
 * than a margin, which is the case `FV-026`'s kill criteria single out.
 *
 * A matrix call replaces the disclaimer with a measurement.
 *
 * ---------------------------------------------------------------------------
 * The provider's terms, verified rather than assumed (`EXTERNAL_APIS.md` §4)
 * ---------------------------------------------------------------------------
 * - **Results are CC-BY 4.0.** That is the licence on the *output*, not just on the OSM data
 *   underneath it, and it is what makes the cache below lawful: CC-BY grants reproduction and
 *   sharing, so storing a distance is permitted **provided attribution travels with it**. Every
 *   finding built from this carries `source`, for that reason.
 * - **Attribution is required twice** — HeiGIT for the service, OpenStreetMap for the data.
 * - **Rate limits are per endpoint, daily and minutely.** Directions is documented at 2,000/day and
 *   40/minute; the Matrix endpoint's own figure is **not published**, which is exactly why nothing
 *   here hardcodes a quota. See `remaining` below.
 *
 * ---------------------------------------------------------------------------
 * Three decisions that follow from not being able to verify the quota
 * ---------------------------------------------------------------------------
 * **1. The quota is read, not assumed.** Every response carries `x-ratelimit-remaining`. When it
 * reaches zero this stops asking until `x-ratelimit-reset`, rather than discovering the ceiling as
 * a run of 403s. An unverifiable number becomes an observable one, which is strictly better than a
 * number copied from a pricing aggregator.
 *
 * **2. No key means disabled, not broken.** `OPENROUTESERVICE_API_KEY` is optional. Without it every
 * call returns `null`, the feasibility engine falls back to the straight-line estimate it uses
 * today, and the behaviour is byte-identical to before this file existed. That is what lets the
 * integration ship before anybody has registered.
 *
 * **3. It never throws.** A routing outage must cost a *better* number, never the report. The same
 * contract `weatherService` holds, for the same reason.
 */

const ORS_MATRIX = 'https://api.openrouteservice.org/v2/matrix/driving-car';

/**
 * Road geometry does not change between two visits to a trip page.
 *
 * Twenty-four hours, against weather's fifteen minutes, because the underlying figure is static:
 * the free tier is not traffic-aware, so the same two coordinates return the same distance today
 * and tomorrow. A short TTL here would spend quota re-asking a question whose answer cannot have
 * changed.
 */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 6000;
const MAX_CACHE_ENTRIES = 200;

const cache = new Map();

/**
 * When the daily allowance is spent, and when it comes back.
 *
 * Module-level rather than per-request: the limit is per key, so one exhausted response is
 * information about every subsequent call, not just that one.
 */
let exhaustedUntil = 0;

const evict = () => {
  if (cache.size <= MAX_CACHE_ENTRIES) return;
  cache.delete(cache.keys().next().value);
};

/**
 * The cache key is the ordered list of points, rounded to ~100 m.
 *
 * Rounded because `DECIMAL(10,8)` precision would make two visits to the same trip miss each other
 * over a difference no road network can express. Ordered because a matrix is not symmetric once
 * one-way streets exist — reversing the list is a different question.
 */
const cacheKey = (points) =>
  points.map(([lon, lat]) => `${lon.toFixed(3)},${lat.toFixed(3)}`).join('|');

/** Whether a key is configured at all. Exported so callers can skip work rather than fail it. */
const isConfigured = () => Boolean(process.env.OPENROUTESERVICE_API_KEY);

/**
 * Distances and durations between every pair of `points`.
 *
 * @param {Array<[number, number]>} points - **`[longitude, latitude]`**, the provider's order.
 * @returns {Promise<{distances: number[][], durations: number[][], source: string}|null>}
 *   `null` whenever an answer cannot be given honestly — no key, too few points, quota spent, a
 *   timeout, a non-200, or a shape we do not recognise.
 */
const getMatrix = async (points) => {
  if (!isConfigured()) return null;
  if (!Array.isArray(points) || points.length < 2) return null;

  // The provider's own per-request ceiling is 3,500 locations (`EXTERNAL_APIS.md` §4). A trip day
  // cannot approach it, so exceeding it means a caller has passed something that is not a day.
  if (points.length > 50) {
    logger.warn(
      { count: points.length },
      'Routing matrix asked for more points than a day can hold'
    );
    return null;
  }

  // The cache is consulted **before** the quota, deliberately: a cached answer costs nothing, so
  // an exhausted allowance is no reason to withhold one we already hold.
  const key = cacheKey(points);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { ...hit.value, cached: true };

  if (Date.now() < exhaustedUntil) return null;

  try {
    const response = await fetch(ORS_MATRIX, {
      method: 'POST',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        // The key travels in `Authorization`, never in the query string, so it cannot be captured
        // by an intermediary's request log the way a `?api_key=` would be.
        Authorization: process.env.OPENROUTESERVICE_API_KEY,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({
        locations: points,
        metrics: ['distance', 'duration'],
        units: 'km'
      })
    });

    // Read the allowance before reading the body: a 403 is the daily limit and a 429 the minutely
    // one, and both are worth recording rather than retrying into.
    const remaining = Number(response.headers?.get?.('x-ratelimit-remaining'));
    const reset = Number(response.headers?.get?.('x-ratelimit-reset'));
    if (Number.isFinite(remaining) && remaining <= 0) {
      exhaustedUntil =
        Number.isFinite(reset) && reset > 0 ? reset * 1000 : Date.now() + CACHE_TTL_MS;
      logger.warn({ reset }, 'Routing quota exhausted; falling back to straight-line estimates');
    }

    if (!response.ok) {
      logger.warn({ status: response.status }, 'Routing provider returned a non-200');
      if (response.status === 403) exhaustedUntil = Date.now() + 60 * 60 * 1000;
      return null;
    }

    const payload = await response.json();
    const distances = payload?.distances;
    const durations = payload?.durations;
    if (!Array.isArray(distances) || !Array.isArray(durations)) {
      logger.warn('Routing provider returned an unrecognised shape');
      return null;
    }

    // Attribution is part of the value, not a footnote on it — see the header.
    const value = { distances, durations, source: 'OpenRouteService' };
    cache.set(key, { at: Date.now(), value });
    evict();

    return { ...value, cached: false };
  } catch (error) {
    logger.warn({ name: error.name }, 'Routing lookup failed');
    return null;
  }
};

/** Test seam. Production never calls these; the state is process-local and dies with the process. */
const clearCache = () => {
  cache.clear();
  exhaustedUntil = 0;
};

module.exports = { getMatrix, isConfigured, clearCache, CACHE_TTL_MS };
