import { FiClock, FiAlertCircle } from 'react-icons/fi';

import { useTripActivity } from '../../hooks/useTripActivity';
import { TRIP_ACTIVITY_BY_ID } from '../../constants/tripActivity';
import { formatDateTime } from '../../utils/dateFormat';

/**
 * Who changed this itinerary (`BL-147`) — the reader `ADR-056` said had to exist first.
 *
 * ---------------------------------------------------------------------------
 * It says what it does NOT record, and that is the load-bearing sentence
 * ---------------------------------------------------------------------------
 * Six actions are recorded: the ones an editor can perform. Notes, checklist items and expenses are
 * not, and neither is anything only the owner can do. A reader who does not know that will read an
 * absence as *"nobody touched the packing list"* rather than as *"this panel does not watch the
 * packing list"* — and a log trusted for a guarantee it never made is worse than no log.
 *
 * `TripCollaborators` states its own limitation for the same reason and in the same place: above
 * the list, once, in a sentence rather than a tooltip.
 *
 * ---------------------------------------------------------------------------
 * Empty and failed are different screens (`IMP-031`)
 * ---------------------------------------------------------------------------
 * *"Nothing has changed"* and *"we could not find out what changed"* are opposite answers to the
 * question somebody opened this panel to ask. A failed load shows the error and **no list**, rather
 * than an empty one that reads as an answer.
 *
 * ---------------------------------------------------------------------------
 * Nothing is fetched until it is opened
 * ---------------------------------------------------------------------------
 * The workspace already makes several authenticated requests on mount. A history nobody asked for
 * is not worth one more, so opening the panel is the request — the same call `FeasibilityPanel`
 * makes, for the same reason.
 */
export const TripActivity = ({ tripId, getToken }) => {
  const { entries, loading, error, exhausted, opened, open, loadMore } = useTripActivity({
    tripId,
    getIdToken: getToken
  });

  return (
    <section
      className="rounded-lg border border-gray-200 bg-white p-4"
      aria-labelledby="trip-activity"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="trip-activity" className="flex items-center text-sm font-semibold text-gray-900">
          <FiClock className="mr-2 h-4 w-4 text-gray-500" aria-hidden="true" />
          Recent changes
        </h2>

        {!opened && (
          <button
            type="button"
            onClick={open}
            className="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            Show
          </button>
        )}
      </div>

      {/* Stated before anything is loaded, so it is read as a description of the panel rather than
          as an excuse for whatever the list happens to contain. */}
      <p className="mt-2 text-xs text-gray-500">
        Changes to days and items, by anyone who can edit this trip. Notes, the checklist and
        expenses are not tracked here.
      </p>

      {opened && (
        <div className="mt-4">
          {loading && entries.length === 0 && <p className="text-sm text-gray-500">Loading…</p>}

          {error && (
            <p className="flex items-start text-sm text-red-700" role="alert">
              <FiAlertCircle className="mr-2 mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
              {error}
            </p>
          )}

          {!loading && !error && entries.length === 0 && (
            <p className="text-sm text-gray-500">
              Nobody has changed the days or items on this trip yet.
            </p>
          )}

          {/* Rendered whenever there are entries, **including beside an error.** A failed first load
              has none, so it correctly shows the message alone; a failed *page* keeps the rows it
              already has, because they are still exactly as true as they were and discarding them
              would lose information the reader had. Gating this on `!error` hid twenty-five correct
              rows behind a message about a request for older ones — found by mutation, since the
              only test that covered a failure was a first load. */}
          {entries.length > 0 && (
            <ol className="space-y-3">
              {entries.map((entry) => {
                const action = TRIP_ACTIVITY_BY_ID[entry.action];

                return (
                  <li key={entry.id} className="text-sm">
                    <p className="text-gray-900">
                      {/* A row whose actor has no `users` record yet reads "Someone" rather than
                          rendering a blank subject — a line saying "removed day 2" with nothing in
                          front of it is a gap a reader fills in with the wrong guess. */}
                      <span className="font-medium">{entry.actor_label || 'Someone'}</span>{' '}
                      {/* An unknown action renders its id rather than disappearing. `check:themes`
                          holds this list against the backend's and the `023` CHECK, so this branch
                          should be unreachable — but a row silently dropped from an audit feed is
                          the one failure this panel must not have. */}
                      {action ? action.sentence(entry.detail || {}) : entry.action}
                    </p>
                    <p className="text-xs text-gray-500">{formatDateTime(entry.created_at)}</p>
                  </li>
                );
              })}
            </ol>
          )}

          {!error && entries.length > 0 && !exhausted && (
            <button
              type="button"
              onClick={loadMore}
              disabled={loading}
              className="mt-4 rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
            >
              {loading ? 'Loading…' : 'Show older'}
            </button>
          )}
        </div>
      )}
    </section>
  );
};

export default TripActivity;
