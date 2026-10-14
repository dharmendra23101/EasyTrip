/**
 * Route ordering for one day of a trip (`FV-026`, stage a).
 *
 * A day that looks fine as a list can be nonsense on a map — three places in the north, one in the
 * south, then back north. Nobody notices until they are in the taxi. `FV-025` already **warns**
 * about it (`day_backtracks`, which is this item's stage (d), delivered early). This is the other
 * half: saying what a better order would be.
 *
 * ---------------------------------------------------------------------------
 * Three constraints, each taken from the item's own kill criteria
 * ---------------------------------------------------------------------------
 *
 * **1. It proposes; it never applies.** `FV-026` says to stop if *"optimisation starts overriding
 * what the user deliberately chose"*. So this returns an order and the arithmetic behind it, and
 * the existing reorder endpoint stays the only thing that writes. The user is shown a diff and
 * decides — the same principle `FV-027` is built on.
 *
 * **2. A day with times is not ours to reorder.** When items carry `start_time`, the clock decides
 * the order; rearranging the list would contradict it, and `FV-025` would immediately flag the
 * result as `order_disagrees_with_times`. Two features fighting over the same list is worse than
 * one of them declining, so this declines and says why. That is a real limit, not a stub.
 *
 * **3. It is a heuristic, and it says so.** *"It turns into a travelling-salesman project"* is a
 * listed kill criterion, and this is where it bit. Nearest-neighbour from the first stop — and
 * nothing else.
 *
 * A 2-opt improvement pass was written, tested and **then deleted**, because it was measured. On
 * four realistic day-sized fixtures from this catalogue (five to six stops, real coordinates) it
 * improved the route by **0, 0, 0 and 4 km on totals of 640–980 km** — under half a percent, and
 * below `WORTH_SUGGESTING_KM`, so on the one fixture where it helped at all the suggestion would
 * still have been withheld. Forty lines and a float-comparison epsilon for a saving nobody would
 * ever be shown.
 *
 * That is the kill criterion working as intended rather than an argument against optimisation:
 * *"a per-day hour budget and simple clustering catch almost every real failure, and an exact
 * solver catches marginally more for ten times the cost."* Nearest-neighbour finds the ordering a
 * person would call obvious, which is the whole requirement. If a future catalogue has denser days
 * where this stops being true, the measurement above is the thing to re-run — not the assumption
 * to re-argue.
 *
 * Distances are straight-line (`feasibilityService.haversineKm`) inflated by the same road factor.
 * There is no routing provider yet; stage (b) is gated on one, and every number here is labelled
 * `estimated` for the reason Article III gives.
 */
const { haversineKm } = require('./geoDistance');
const { travelMinutesForKm, ASSUMPTIONS } = require('./feasibilityService');

/** Below this, a reorder is noise — the difference is inside the error bars of the estimate. */
const WORTH_SUGGESTING_KM = 5;

const coordinatesOf = (item) =>
  item?.place_latitude != null && item?.place_longitude != null
    ? { latitude: item.place_latitude, longitude: item.place_longitude }
    : null;

/** Total straight-line length of a sequence of stops. `null` if any leg cannot be measured. */
const routeLengthKm = (stops) => {
  let total = 0;
  for (let i = 1; i < stops.length; i++) {
    const leg = haversineKm(stops[i - 1].point, stops[i].point);
    if (leg === null) return null;
    total += leg;
  }
  return total;
};

/**
 * Nearest-neighbour from the first stop.
 *
 * **The first stop stays first, deliberately.** A day starts where the traveller already is — a
 * hotel, the station they arrive at, yesterday's last stop. Choosing a different start would be the
 * optimiser overriding a decision the user made by putting it first.
 */
const nearestNeighbourOrder = (stops) => {
  const remaining = stops.slice(1);
  const ordered = [stops[0]];

  while (remaining.length) {
    const cursor = ordered[ordered.length - 1];
    let bestIndex = 0;
    let bestDistance = Infinity;
    remaining.forEach((candidate, index) => {
      const distance = haversineKm(cursor.point, candidate.point);
      if (distance !== null && distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    ordered.push(remaining.splice(bestIndex, 1)[0]);
  }

  return ordered;
};

const declined = (reason, detail) => ({
  applicable: false,
  reason,
  detail,
  estimated: true
});

/**
 * Suggest an order for one day's stops.
 *
 * @param {Object} day - `{ day_number, items: [...] }` as `tripModel.getTripWorkspace` returns it
 * @returns {Object} either `{ applicable: false, reason, detail }` or a full suggestion
 *
 * The suggestion carries **both** lengths and the saving, because a proposal a user cannot evaluate
 * is a proposal they have to take on trust — and this one is a heuristic over estimated distances,
 * which is exactly the kind of thing that should not be taken on trust.
 */
const suggestDayOrder = (day) => {
  const items = [...(day?.items || [])].sort((a, b) => a.position - b.position || a.id - b.id);

  if (items.some((item) => item.start_time)) {
    return declined(
      'day_is_scheduled',
      'This day has times on it, so the clock already decides the order. Clear the times to let the route be reordered.'
    );
  }

  const stops = items
    .map((item) => ({ item, point: coordinatesOf(item) }))
    .filter((stop) => stop.point !== null);

  // Fewer than three stops cannot be reordered into anything different — with two, both orders are
  // the same journey, and the first one stays first.
  if (stops.length < 3) {
    return declined(
      'not_enough_stops',
      'A day needs at least three places with coordinates before its order can be improved.'
    );
  }

  if (stops.length !== items.length) {
    // Reordering a subset would interleave placed and unplaced items arbitrarily, which moves
    // things the optimiser knows nothing about.
    return declined(
      'some_items_have_no_place',
      'Some items on this day have no coordinates, so their position cannot be reasoned about.'
    );
  }

  const currentKm = routeLengthKm(stops);
  if (currentKm === null) {
    return declined('distances_unavailable', 'Some distances on this day could not be measured.');
  }

  const suggested = nearestNeighbourOrder(stops);
  const suggestedKm = routeLengthKm(suggested);
  const savingKm = currentKm - suggestedKm;

  const unchanged = suggested.every((stop, index) => stop.item.id === stops[index].item.id);
  if (unchanged || savingKm < WORTH_SUGGESTING_KM) {
    return {
      applicable: false,
      reason: unchanged ? 'already_in_a_sensible_order' : 'saving_too_small',
      detail: unchanged
        ? 'This day is already ordered about as well as it can be.'
        : `A different order would save about ${Math.round(savingKm * ASSUMPTIONS.road_factor)} km — not enough to be worth rearranging.`,
      estimated: true
    };
  }

  return {
    applicable: true,
    day_number: day.day_number,
    // Road-adjusted for display, because a traveller thinks in road kilometres. The straight-line
    // figures stay available so the two can never be confused for each other.
    current_km: Number((currentKm * ASSUMPTIONS.road_factor).toFixed(1)),
    suggested_km: Number((suggestedKm * ASSUMPTIONS.road_factor).toFixed(1)),
    saving_km: Number((savingKm * ASSUMPTIONS.road_factor).toFixed(1)),
    saving_minutes: travelMinutesForKm(savingKm),
    straight_line_current_km: Number(currentKm.toFixed(1)),
    straight_line_suggested_km: Number(suggestedKm.toFixed(1)),
    // The payload the existing reorder endpoint takes, so applying a suggestion needs no new write
    // path and no new authorisation surface.
    item_ids: suggested.map((stop) => stop.item.id),
    order: suggested.map((stop, index) => ({
      item_id: stop.item.id,
      title: stop.item.title,
      from_position: stops.findIndex((s) => s.item.id === stop.item.id),
      to_position: index
    })),
    assumptions: ASSUMPTIONS,
    estimated: true
  };
};

module.exports = {
  suggestDayOrder,
  nearestNeighbourOrder,
  routeLengthKm,
  WORTH_SUGGESTING_KM
};
