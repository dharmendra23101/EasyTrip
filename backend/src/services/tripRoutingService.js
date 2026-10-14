const routingService = require('./routingService');
const { finitePoint } = require('./geoDistance');
const logger = require('../utils/logger');

/**
 * Road distances for a trip's days (`FV-026` stage b).
 *
 * The same division of labour `tripForecastService` uses, for the same reason: `feasibilityService`
 * commits to being a pure function of the trip object, so the network call lives out here and hands
 * the engine plain data.
 *
 * ---------------------------------------------------------------------------
 * One request per day, not one per leg
 * ---------------------------------------------------------------------------
 * A day's stops go into a single matrix call, and only the consecutive pairs are read back off the
 * diagonal. Asking leg by leg would be N-1 requests for the same answer, against a quota whose
 * Matrix figure the provider does not publish.
 *
 * The unused cells are not waste — `FV-027` stage b will want the full matrix to answer *"what if
 * these two swapped?"*, and it will find it already cached.
 *
 * ---------------------------------------------------------------------------
 * Two callers, two orders, and that is the point
 * ---------------------------------------------------------------------------
 * `attachRoadLegs` routes a day **by the clock**, because the question it serves is whether the gap
 * between two scheduled stops is long enough to drive. `roadLegsForItems` routes a day **in the
 * order it is listed**, because the question `FV-026` stage (c) serves is what the day looks like
 * as drawn — and the drawing must trace the list the user is looking at, not a re-sorted one.
 *
 * Both go through `legsFor`, so the coordinate conversion below happens in exactly one place
 * whichever question is being asked.
 *
 * ---------------------------------------------------------------------------
 * The coordinate order is the bug this file exists to not have
 * ---------------------------------------------------------------------------
 * **OpenRouteService takes `[longitude, latitude]`.** Everything else in this codebase — Leaflet,
 * the database columns, `haversineKm`, the weather service — is latitude first. Swapping them does
 * not error; it returns a confident distance to somewhere in the Indian Ocean. It is converted in
 * exactly one place, here, and asserted by a test that pins the transmitted order.
 */

/**
 * The items that can be routed at all, in the order given, as `[longitude, latitude]` pairs.
 *
 * `finitePoint` is the same selector `dayRouteService` draws with, deliberately: if the routed set
 * and the drawn set ever differ, the legs come back keyed to pairs that are not the pairs on the
 * map, and nothing errors — the measurement simply stops arriving, silently.
 *
 * It also hands back numbers rather than the strings node-pg gives `DECIMAL` columns. `JSON.
 * stringify` would otherwise transmit `"76.46"`, which the provider rejects.
 */
const pointsFor = (items) =>
  (items || [])
    .map((item) => ({ item, point: finitePoint(item?.place_latitude, item?.place_longitude) }))
    .filter(({ point }) => point !== null)
    // The one conversion to the provider's order.
    .map(({ item, point }) => ({ id: item.id, point: [point.longitude, point.latitude] }));

/**
 * The consecutive legs of an ordered stop list, measured.
 *
 * @returns {Promise<{legs: Object, source: string}|null>} `null` whenever no leg could be measured
 *   — too few stops, no key, quota spent, or a provider that could not route any of these pairs.
 *   The caller then keeps whatever estimate it already had.
 */
const legsFor = async (stops) => {
  if (stops.length < 2) return null;

  const matrix = await routingService.getMatrix(stops.map((stop) => stop.point));
  if (!matrix) return null;

  const legs = {};
  for (let i = 1; i < stops.length; i += 1) {
    const km = matrix.distances?.[i - 1]?.[i];
    const seconds = matrix.durations?.[i - 1]?.[i];
    // A provider can return `null` for a pair it cannot route — an island, a gap in the network.
    // That leg keeps the estimate rather than borrowing a number from a different pair.
    if (typeof km !== 'number' || typeof seconds !== 'number') continue;

    legs[`${stops[i - 1].id}->${stops[i].id}`] = { km, minutes: Math.ceil(seconds / 60) };
  }

  if (Object.keys(legs).length === 0) return null;
  return { legs, source: matrix.source };
};

/** A day's timed stops that have coordinates, in the order the clock puts them. */
const routableStops = (day) =>
  pointsFor(
    (day?.items || [])
      .filter((item) => item.start_time)
      .map((item) => ({
        ...item,
        minutes:
          Number(String(item.start_time).slice(0, 2)) * 60 +
          Number(String(item.start_time).slice(3, 5))
      }))
      .sort((a, b) => a.minutes - b.minutes)
  );

/**
 * A copy of the trip whose days carry the road distance between consecutive stops.
 *
 * Never mutates its argument. A day with no reading is returned exactly as it arrived, and the
 * engine then falls back to the straight-line estimate it has always used.
 *
 * @param {Object} trip - a `tripModel.getTripWorkspace` result
 * @returns {Promise<Object>} the trip, with `road_legs` (`"fromId->toId"` -> `{ km, minutes }`) and
 *   `routing_source` on any day the provider answered for.
 */
const attachRoadLegs = async (trip) => {
  const days = trip?.days || [];
  // Asked before any work: with no key configured this is the entire cost of the feature.
  if (!routingService.isConfigured() || days.length === 0) return trip;

  const lookups = days.map(async (day) => {
    const measured = await legsFor(routableStops(day));
    if (!measured) return day;

    return { ...day, road_legs: measured.legs, routing_source: measured.source };
  });

  try {
    return { ...trip, days: await Promise.all(lookups) };
  } catch (error) {
    // The report is worth more than the upgrade. `getMatrix` promises never to throw; this is here
    // because a promise in a docstring is not a mechanism.
    logger.warn({ name: error.name }, 'Road-leg lookup failed; reporting with estimates');
    return trip;
  }
};

/**
 * Road legs between the items given, **in the order given** (`FV-026` stage c).
 *
 * The drawn route follows the list, so the measurement has to follow the list too — asking about a
 * different sequence would put one number under another journey. Times are ignored here for that
 * reason, not overlooked: `attachRoadLegs` above is the caller that cares about them.
 *
 * @param {Array<Object>} items - trip items, already ordered
 * @returns {Promise<{legs: Object, source: string}|null>} `null` when nothing could be measured.
 */
const roadLegsForItems = async (items) => {
  if (!routingService.isConfigured()) return null;

  try {
    return await legsFor(pointsFor(items));
  } catch (error) {
    logger.warn({ name: error.name }, 'Road-leg lookup failed; drawing with estimates');
    return null;
  }
};

module.exports = { attachRoadLegs, roadLegsForItems };
