/**
 * Who produced a place's coordinates, and when that answer stops being true (IMP-127).
 *
 * ODbL section 4.3 obliges us to credit OpenStreetMap for geocoding output. Crediting it for
 * coordinates an admin typed by hand would be a fresh falsehood rather than a fix, so the notice is
 * driven by `places.coordinates_source` and this module owns the one rule that keeps that column
 * honest:
 *
 *   **provenance belongs to a coordinate pair, not to a row.** The moment the pair changes, whatever
 *   we knew about where it came from is stale, and the only claim that survives is one the caller
 *   re-declares in the same request that moved the pin.
 *
 * Pulled out of `placeController` rather than inlined because it is the entire correctness of the
 * feature and it is exercisable without a database, a token or a multipart body.
 */

/**
 * The geocoders whose output we are obliged to credit, as an allowlist.
 *
 * Mirrors the `places_coordinates_source_known` CHECK in migration 010. Two copies of a list is
 * usually a smell (`IMP-020`'s themes), and this one is deliberate: the constraint is the guarantee,
 * this is the 400 that explains the rejection instead of surfacing a driver error.
 */
const SUPPORTED_GEOCODERS = ['nominatim'];

/**
 * A caller-supplied source, reduced to something storable.
 *
 * Anything unrecognised becomes `null` rather than throwing. The route validator already rejects
 * unknown values with a 400; by the time a request reaches here, an unexpected value means a code
 * path that bypassed validation — and silently dropping an attribution claim is the safe direction,
 * because the failure mode of the alternative is a legal notice naming a provider nobody verified.
 */
const normalizeCoordinateSource = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return SUPPORTED_GEOCODERS.includes(trimmed) ? trimmed : null;
};

/**
 * Do two coordinate values refer to the same point?
 *
 * `null` and `undefined` are the same answer here — "there is no coordinate" — because the update
 * path produces `null` for a cleared field while a row that never had one reads back as `null` too.
 *
 * The numeric comparison is not incidental. `latitude` is `DECIMAL`, which node-pg returns as a
 * **string** (`'15.33500000'`), so the stored value and the parsed request value are never `===`
 * even when they are the same point. Comparing as strings would report every save as a coordinate
 * change and quietly strip attribution from places nobody edited.
 *
 * Rounding runs one way only: a request carrying more precision than the column stores compares as
 * *changed*, so provenance is dropped rather than wrongly kept. Losing a notice we owe is visible;
 * keeping one we do not is the thing this whole item exists to stop.
 */
const sameCoordinate = (a, b) => {
  const aMissing = a === null || a === undefined || a === '';
  const bMissing = b === null || b === undefined || b === '';
  if (aMissing || bMissing) return aMissing && bMissing;
  return Number(a) === Number(b);
};

/**
 * The value to write to `places.coordinates_source`.
 *
 * @param {Object} args
 * @param {*} args.requested - `coordinates_source` as it arrived from the client
 * @param {boolean} args.hasCoordinates - both latitude and longitude will be non-null after this write
 * @param {boolean} args.coordinatesChanged - this write moves the pin (always true on create)
 * @param {string|null} [args.current] - what the row says today
 * @returns {string|null}
 *
 * Three cases, in the order they are decided:
 *
 * 1. **The pin did not move** — keep what the row already says. This is what lets the edit form,
 *    which never sends `coordinates_source`, save a description without silently revoking OSM
 *    credit; and what stops the sparse image-only update after a create from doing the same.
 * 2. **The pin moved to nowhere** — a cleared coordinate cannot have a provenance. Matches the
 *    `places_coordinates_source_needs_coordinates` constraint, so the API answers 400-free instead
 *    of letting the database raise.
 * 3. **The pin moved** — only an explicit, recognised claim survives. Silence means hand-entered.
 */
const resolveCoordinateSource = ({
  requested,
  hasCoordinates,
  coordinatesChanged,
  current = null
}) => {
  if (!coordinatesChanged) return current ?? null;
  if (!hasCoordinates) return null;
  return normalizeCoordinateSource(requested);
};

module.exports = {
  SUPPORTED_GEOCODERS,
  normalizeCoordinateSource,
  sameCoordinate,
  resolveCoordinateSource
};
