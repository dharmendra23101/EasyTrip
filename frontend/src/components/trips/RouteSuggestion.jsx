import { FiArrowDown, FiCheck, FiMap } from 'react-icons/fi';

/**
 * A shorter order for one day, offered rather than applied (`FV-026` stage a, `IMP-131`).
 *
 * **The whole component is built around one sentence from the item's kill criteria:** stop if
 * *"optimisation starts overriding what the user deliberately chose"*. So this never reorders
 * anything. It shows what would move, by how much the day would shorten, and a button — and the
 * button calls the reorder path the workspace already has.
 *
 * That is also why the declines are rendered as sentences rather than swallowed. *"This day has
 * times on it, so the clock already decides the order"* is a useful thing to learn; a button that
 * silently does nothing is not.
 */

const Decline = ({ suggestion }) => <p className="text-sm text-gray-600">{suggestion.detail}</p>;

export const RouteSuggestion = ({ suggestion, busy, onSuggest, onApply }) => (
  <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
    <div className="flex items-center justify-between gap-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-800">
        <FiMap className="h-4 w-4 text-primary-600" aria-hidden="true" />
        Order of this day
      </h3>
      <button
        type="button"
        onClick={onSuggest}
        disabled={busy}
        className="min-h-[44px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:opacity-60"
      >
        Check the route
      </button>
    </div>

    <div aria-live="polite" className="mt-3">
      {!suggestion && (
        <p className="text-sm text-gray-600">
          Looks for a shorter way round the same stops. It suggests; it never rearranges anything on
          its own.
        </p>
      )}

      {suggestion && !suggestion.applicable && <Decline suggestion={suggestion} />}

      {suggestion?.applicable && (
        <>
          <p className="text-sm text-gray-800">
            A different order covers about{' '}
            <strong>
              {suggestion.saving_km} km less ({suggestion.current_km} km → {suggestion.suggested_km}{' '}
              km)
            </strong>
            , roughly {suggestion.saving_minutes} minutes of driving.
          </p>

          {/* The moves themselves, not just the total. A number alone asks the user to trust a
              heuristic over estimated distances; the list lets them disagree with it. */}
          <ol className="mt-3 space-y-1 text-sm text-gray-700">
            {suggestion.order.map((entry) => (
              <li key={entry.item_id} className="flex items-center gap-2">
                <span className="w-5 text-xs text-gray-500">{entry.to_position + 1}.</span>
                <span>{entry.title}</span>
                {entry.from_position !== entry.to_position && (
                  <span className="inline-flex items-center gap-1 text-xs text-primary-700">
                    <FiArrowDown
                      className={`h-3 w-3 ${entry.to_position < entry.from_position ? 'rotate-180' : ''}`}
                      aria-hidden="true"
                    />
                    moves from {entry.from_position + 1}
                  </span>
                )}
              </li>
            ))}
          </ol>

          <button
            type="button"
            onClick={onApply}
            disabled={busy}
            className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-700 disabled:opacity-60"
          >
            <FiCheck className="h-4 w-4" aria-hidden="true" />
            Use this order
          </button>

          <p className="mt-2 text-xs text-gray-500">
            Distances are estimated from straight lines at{' '}
            {suggestion.assumptions.average_speed_kmh} km/h — EasyTrip does not use a routing
            service.
          </p>
        </>
      )}
    </div>
  </div>
);

export default RouteSuggestion;
