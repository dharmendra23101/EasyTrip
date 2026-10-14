/**
 * One day of a trip, as a line on a map (`FV-026` stage c).
 *
 * Stages (a), (b) and (d) all produced *numbers about* a day — a shorter order, a road distance, a
 * backtracking warning. None of them produced the thing the item's user problem actually describes:
 *
 * > *"three places in the north, one in the south, then back north. Nobody notices until they are
 * > in the taxi."*
 *
 * Nobody notices **because there is nothing to look at**. A zig-zag is obvious as a shape and
 * invisible as a list, which is why this stage is a drawing rather than another finding.
 *
 * ---------------------------------------------------------------------------
 * It draws the list, not a better version of the list
 * ---------------------------------------------------------------------------
 * The stops come out in `position` order — the order the workspace shows, the order the user
 * arranged. Not the clock's order, even on a day that has times on it.
 *
 * That is the same rule `routeOrderService` follows from the other side, and for the same reason:
 * **two features quietly disagreeing about one day is worse than either of them being wrong.** If
 * the list and the times contradict each other, `FV-025` says so in words (`order_disagrees_with_
 * times`); a map that silently re-sorted would hide the very thing the report is trying to raise.
 *
 * ---------------------------------------------------------------------------
 * A measured leg and an estimated leg are never blended
 * ---------------------------------------------------------------------------
 * Every leg says which it is, exactly as `feasibilityService` does, and the route as a whole calls
 * itself estimated unless **every** leg was measured. The bias is deliberate and matches the
 * engine's: a number that overstates its own certainty is the failure worth avoiding.
 *
 * Attribution follows the measurement rather than the request — `source` is set only when a routed
 * leg actually reached the output, because CC-BY obliges attribution for results that are used, and
 * a credit under a figure the provider did not supply is its own kind of false claim.
 *
 * ---------------------------------------------------------------------------
 * What is deliberately not here: road geometry
 * ---------------------------------------------------------------------------
 * The polyline is straight between stops, and the client draws it dashed for that reason. The
 * provider's **Matrix** endpoint — the one this project integrated in stage (b) — returns distances
 * and durations and **no geometry at all**; tracing the real road needs the *Directions* endpoint,
 * a second provider surface with its own quota and its own terms to read (`ADR-041`).
 *
 * A straight line between stops answers the question the item asks. A day that doubles back is a
 * zig-zag either way, and the shape is the finding.
 */
const { haversineKm, finitePoint } = require('./geoDistance');
const { travelMinutesForKm, ASSUMPTIONS } = require('./feasibilityService');

const round = (km) => Number(km.toFixed(1));

/**
 * A day's items in the order the day lists them.
 *
 * Exported because the controller needs the *same* sequence to ask the routing provider about, and
 * two copies of one sort is exactly how the measurement ends up describing a different journey from
 * the drawing. `position` then `id`, matching `routeOrderService`.
 */
const orderedItems = (day) =>
  [...(day?.items || [])].sort((a, b) => a.position - b.position || a.id - b.id);

/**
 * The items of a day that can be put on a map, in the order the day lists them.
 *
 * `finitePoint` rather than a local check, and that is load-bearing rather than tidy. Every stop
 * that survives this filter is one `haversineKm` can measure, so the leg arithmetic below has no
 * "distance unavailable" branch to get wrong — and `tripRoutingService` selects its stops with the
 * **same** function, so what is drawn and what is measured cannot drift apart into legs keyed to
 * pairs that are not the pairs on screen.
 *
 * The first version of this wrote `Number(item.place_latitude)` and checked `isFinite` afterwards.
 * `Number(null)` is 0, so every item with no place was drawn confidently in the Gulf of Guinea.
 */
const mappableStops = (items) =>
  items
    .map((item) => ({ item, point: finitePoint(item.place_latitude, item.place_longitude) }))
    .filter(({ point }) => point !== null)
    .map(({ item, point }) => ({
      item_id: item.id,
      title: item.title,
      start_time: item.start_time ? String(item.start_time).slice(0, 5) : null,
      place_id: item.place_id ?? null,
      latitude: point.latitude,
      longitude: point.longitude
    }));

/** One leg, measured if the provider answered for this pair and estimated otherwise. */
const legBetween = (from, to, roads) => {
  const straightLineKm = haversineKm(from, to);
  const routed = roads?.legs?.[`${from.item_id}->${to.item_id}`];

  return {
    from_item_id: from.item_id,
    to_item_id: to.item_id,
    km: routed ? round(routed.km) : round(straightLineKm * ASSUMPTIONS.road_factor),
    minutes: routed ? routed.minutes : travelMinutesForKm(straightLineKm),
    // Kept beside the road figure rather than replaced by it: the difference between the two is
    // the entire argument for having a provider, and it is only visible if both are present.
    straight_line_km: round(straightLineKm),
    estimated: !routed
  };
};

/**
 * The day's route, ready to draw.
 *
 * @param {Object} day - a day from `tripModel.getTripWorkspace`
 * @param {{legs: Object, source: string}|null} roads - `tripRoutingService.roadLegsForItems` output
 * @returns {Object} `{ drawable: false, reason, detail }`, or the route
 */
const buildDayRoute = (day, roads = null) => {
  const items = orderedItems(day);
  const stops = mappableStops(items);

  if (stops.length === 0) {
    return {
      drawable: false,
      day_number: day?.day_number ?? null,
      reason: items.length === 0 ? 'day_is_empty' : 'no_mapped_stops',
      detail:
        items.length === 0
          ? 'Nothing is planned for this day yet, so there is no route to draw.'
          : 'Nothing on this day is linked to a place with coordinates, so it cannot be drawn.'
    };
  }

  // A single stop is drawn. It is a pin and no line, which is a true picture of the day rather
  // than a refusal — and the sum over no legs is 0 km, which is also true.
  const legs = stops.slice(1).map((to, index) => legBetween(stops[index], to, roads));

  return {
    drawable: true,
    day_number: day.day_number,
    stops,
    legs,
    total_km: round(legs.reduce((sum, leg) => sum + leg.km, 0)),
    total_minutes: legs.reduce((sum, leg) => sum + leg.minutes, 0),
    // True unless every leg was measured — including the no-leg case, where there is no
    // measurement to stand behind. Overstating certainty is the direction that misleads.
    estimated: legs.length === 0 || legs.some((leg) => leg.estimated),
    // CC-BY attaches to results that are *used*, so this is set only when one was. No extra guard
    // is needed for that: `roadLegsForItems` returns `null` rather than an empty set, and it
    // selects its stops with the same predicate `mappableStops` does — so a non-null `roads` means
    // at least one of the legs above is measured.
    source: roads?.source ?? null,
    // What the map is leaving out, said out loud. An item silently absent from the drawing is
    // indistinguishable from a feature that did not notice it (`FV-027`'s lesson, Sprint 8.27).
    unmapped: items
      .filter((item) => !stops.some((stop) => stop.item_id === item.id))
      .map((item) => ({ item_id: item.id, title: item.title })),
    assumptions: ASSUMPTIONS
  };
};

module.exports = { buildDayRoute, mappableStops, orderedItems };
