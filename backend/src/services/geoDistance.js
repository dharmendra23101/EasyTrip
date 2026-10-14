const EARTH_RADIUS_KM = 6371;

/**
 * Great-circle distance, on its own.
 *
 * Extracted from `feasibilityService` in Sprint 8.19, and the line count is what forced the
 * question rather than what answered it. The real reason is that `routeOrderService` was already
 * importing `haversineKm` **through the feasibility engine** — a module reaching into a validator to
 * borrow a geometry function, which makes the validator look like a dependency of route ordering
 * when it is not.
 *
 * Nothing here knows what a trip is. `travelMinutesForKm` deliberately stayed behind: it divides by
 * `ASSUMPTIONS.average_speed_kmh`, and those thresholds are feasibility *policy*, not geometry.
 */

const toRadians = (degrees) => (degrees * Math.PI) / 180;

/**
 * A pair of coordinates as real numbers, or `null` when there is not one.
 *
 * **`Number(null)` is 0, and 0 is a finite number.** Coercing first and checking `isFinite`
 * afterwards therefore reads a missing longitude as the Greenwich meridian, and every subsequent
 * step is confident and wrong: a distance of 8,000 km, a marker in the Gulf of Guinea, a matrix
 * request about open water. The emptiness check has to come **before** the coercion.
 *
 * Exported because more than one module has to make this decision and they must make it
 * identically. `FV-026` stage (c) has two: what gets drawn and what gets measured. If those two
 * sets ever disagree, the measured legs are keyed to pairs that are not the pairs on screen — a
 * failure that produces no error, only a quietly wrong number under a correct-looking line.
 *
 * Shape-agnostic on purpose. This module still knows nothing about a trip, a place or an item.
 */
const finitePoint = (latitude, longitude) => {
  const present = (value) => value !== null && value !== undefined && value !== '';
  if (!present(latitude) || !present(longitude)) return null;

  const parsed = { latitude: Number(latitude), longitude: Number(longitude) };
  if (!Number.isFinite(parsed.latitude) || !Number.isFinite(parsed.longitude)) return null;

  return parsed;
};

/**
 * Great-circle distance in kilometres, or `null` when either point is unknown.
 *
 * `null` rather than 0 on missing coordinates, and the difference matters: 0 would mean "these are
 * in the same place", which would silently approve a day whose stops we simply know nothing about.
 * A check that cannot run must say so, not pass.
 */
const haversineKm = (a, b) => {
  const from = finitePoint(a?.latitude, a?.longitude);
  const to = finitePoint(b?.latitude, b?.longitude);
  if (!from || !to) return null;

  const { latitude: lat1, longitude: lon1 } = from;
  const { latitude: lat2, longitude: lon2 } = to;

  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
};

module.exports = { haversineKm, finitePoint };
