import dynamic from 'next/dynamic';
import { FiAlertCircle, FiClock, FiNavigation } from 'react-icons/fi';

// Leaflet reads `window` at import time, so the map may only be loaded in the browser — the same
// rule `ExploreMap`'s callers follow. The placeholder holds the panel's height so drawing a day
// does not shove the rest of the workspace down the page.
const DayRouteMap = dynamic(() => import('./DayRouteMap'), {
  ssr: false,
  loading: () => (
    <div
      aria-hidden="true"
      className="h-64 w-full animate-pulse rounded-lg border border-gray-200 bg-gray-100"
    />
  )
});

/**
 * One day, as a shape rather than a list (`FV-026` stage c).
 *
 * Stages (a), (b) and (d) all produced *numbers about* a day — a shorter order, a road distance, a
 * backtracking warning. None of them produced what the item's user problem actually describes:
 *
 * > *"three places in the north, one in the south, then back north. Nobody notices until they are in
 * > the taxi."*
 *
 * Nobody notices **because there is nothing to look at**.
 *
 * ---------------------------------------------------------------------------
 * The list is the rendering; the map is the enhancement
 * ---------------------------------------------------------------------------
 * A Leaflet canvas says nothing to a screen reader, and the honest response to that is not a longer
 * `aria-label` on a shape. Every fact the map carries — the order, each leg's distance and time,
 * whether it was measured or estimated, and the total — is in the ordered list below it, for every
 * reader. The map is `aria-hidden` and adds no information; it makes one already-stated fact
 * *obvious*, which is a real thing to add and not a reason to state it only there.
 *
 * ---------------------------------------------------------------------------
 * Measured and estimated are never blended, at this end either
 * ---------------------------------------------------------------------------
 * The engine labels every leg and refuses to call the whole route measured unless all of them were.
 * This renders that label per leg rather than once at the bottom, because a route with one measured
 * leg and four estimates is not "estimated" in the same way a route with five estimates is, and the
 * difference is exactly what a reader deciding whether to trust the total needs.
 *
 * Attribution follows the same rule as the engine: `source` is rendered only when a routed leg
 * actually reached the output, because CC-BY obliges attribution for results that are **used**, and
 * crediting a provider under numbers it did not supply is its own false claim (`ADR-039`).
 */

/** A refusal, rendered as the sentence the server wrote. Never as a button that does nothing. */
const NotDrawable = ({ route }) => <p className="text-sm text-gray-600">{route.detail}</p>;

/**
 * The distance from this stop to the next one.
 *
 * A `div`, not an `li`. The first draft nested one inside the stop's own `li`, which is invalid —
 * a list item may only contain another list item through a nested list — and a component test
 * caught it by reading two overlapping entries out of one. It is not a list of its own: a leg is a
 * property of the gap between two stops, and the stop it hangs under is the one it leaves.
 */
const Leg = ({ leg }) => (
  <div className="flex items-center gap-2 pl-7 text-xs text-gray-500">
    <FiNavigation className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
    <span>
      {leg.km} km, about {leg.minutes} min
      {leg.estimated ? ' (estimated)' : ' by road'}
    </span>
  </div>
);

/**
 * @param dayNumber - the day this panel belongs to, needed **before** anything is drawn.
 *
 * A trip renders one of these per day and every one of them says "This day on a map", so without it
 * a screen reader hears the same region name six times and a test matching on text finds six
 * panels. `route.day_number` cannot supply it: it arrives with the drawing, and the ambiguity is
 * already on screen before that. Same defect and same fix as the `Day 1 → Day 3` chip in Sprint
 * 8.27 — the ambiguity in the test was a real ambiguity in the markup.
 */
export const DayRoute = ({ route, busy, onDraw, dayNumber }) => (
  <section
    aria-label={`Day ${dayNumber} on a map`}
    data-testid={`day-route-${dayNumber}`}
    className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4"
  >
    <div className="flex items-center justify-between gap-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-800">
        <FiNavigation className="h-4 w-4 text-primary-600" aria-hidden="true" />
        This day on a map
      </h3>
      <button
        type="button"
        onClick={onDraw}
        disabled={busy}
        className="min-h-[44px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:opacity-60"
      >
        {busy ? 'Drawing…' : `Draw day ${dayNumber}`}
      </button>
    </div>

    <div aria-live="polite" className="mt-3">
      {!route && (
        <p className="text-sm text-gray-600">
          Draws the stops in the order this day lists them, so a day that doubles back looks like
          one. It changes nothing.
        </p>
      )}

      {route && !route.drawable && <NotDrawable route={route} />}

      {route?.drawable && (
        <>
          <p className="text-sm text-gray-800">
            <strong>
              {route.total_km} km, about {Math.round(route.total_minutes / 60) || '<1'} h
            </strong>{' '}
            across {route.stops.length} {route.stops.length === 1 ? 'stop' : 'stops'}
            {route.estimated ? ', estimated' : ', measured by road'}.
          </p>

          <ol className="mt-3 space-y-1 text-sm text-gray-700">
            {route.stops.map((stop, index) => (
              <li key={stop.item_id}>
                <div className="flex items-center gap-2">
                  <span className="w-5 text-xs text-gray-500">{index + 1}.</span>
                  <span>{stop.title}</span>
                  {stop.start_time && (
                    <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                      <FiClock className="h-3 w-3" aria-hidden="true" />
                      {stop.start_time}
                    </span>
                  )}
                </div>
                {/* The leg *after* this stop, so the distance reads between the two names it
                    separates rather than as a property of one of them. */}
                {route.legs[index] && <Leg leg={route.legs[index]} />}
              </li>
            ))}
          </ol>

          <DayRouteMap stops={route.stops} dayNumber={route.day_number} className="mt-4" />

          {/* What the map is leaving out, said out loud. An item silently absent from a drawing is
              indistinguishable from a feature that did not notice it — Sprint 8.27's lesson. */}
          {route.unmapped.length > 0 && (
            <div className="mt-3 flex items-start gap-2 text-xs text-gray-600">
              <FiAlertCircle className="mt-0.5 h-3 w-3 flex-shrink-0" aria-hidden="true" />
              <p>
                Not on the map, because {route.unmapped.length === 1 ? 'it is' : 'they are'} not
                linked to a place with coordinates:{' '}
                {route.unmapped.map((item) => item.title).join(', ')}
              </p>
            </div>
          )}

          <p className="mt-2 text-xs text-gray-500">
            {route.estimated
              ? `Straight-line distances at ${route.assumptions.average_speed_kmh} km/h, scaled by ${route.assumptions.road_factor} for roads. The line is drawn straight because it shows the order, not the road.`
              : 'The line is drawn straight because it shows the order, not the road.'}
            {route.source && ` Distances ${route.source}.`}
          </p>
        </>
      )}
    </div>
  </section>
);

export default DayRoute;
