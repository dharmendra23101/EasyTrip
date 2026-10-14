import { useCallback, useEffect, useState } from 'react';
import { getTripActivity } from '../services/tripActivityService';

const PAGE_SIZE = 25;

/**
 * The trip activity feed's data (`BL-147`).
 *
 * **`getIdToken` is deliberately not in the effect's dependency list.** `useAnalytics` shipped with
 * it there in Sprint 8.68 and the test mock found the defect: `load` closes over `getIdToken`, so a
 * caller returning a fresh function per render turns the panel into an unbounded refetch loop
 * against an authenticated endpoint. `AuthContext` memoizes it today, which made production safe by
 * accident — but a hook should not rest on a caller's memoization it cannot enforce. `useAuditLog`
 * reached the same conclusion first.
 *
 * **Empty and failed are kept apart** (`IMP-031`), and on a feed that is the whole point: *"nobody
 * has changed anything"* and *"we could not find out what changed"* are opposite answers to the
 * question somebody opened the panel to ask.
 */
export const useTripActivity = ({ tripId, getIdToken, fetchActivity = getTripActivity } = {}) => {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [exhausted, setExhausted] = useState(false);
  const [opened, setOpened] = useState(false);

  const load = useCallback(
    async ({ before = null } = {}) => {
      if (!tripId) return;

      setLoading(true);
      setError(null);

      try {
        const token = await getIdToken();
        const page = await fetchActivity(tripId, token, { limit: PAGE_SIZE, before });

        // Replaced on a first load, appended on a page. A failed page must not leave the earlier
        // ones on screen under a new heading — but a *successful* page is additive by definition.
        setEntries((current) => (before ? [...current, ...page] : page));
        setExhausted(page.length < PAGE_SIZE);
      } catch (requestError) {
        setError(requestError.message || 'Could not load this activity');

        // **Only a FIRST load clears the list, and the distinction is the whole of `IMP-031` here.**
        // `useAuditLog` empties on failure because its failures follow a *filter change*, where
        // leaving the previous filter's rows under a new heading is a wrong answer — worse than a
        // missing one.
        //
        // Paging is not a filter change. The entries already on screen were fetched successfully
        // and are still exactly as true as they were a moment ago; discarding twenty-five correct
        // rows because a request for older ones failed destroys information the reader had, and
        // tells them nothing. So a failed page keeps what it has and shows the error beside it,
        // while a failed first load shows the error and no list — because there is nothing it could
        // honestly show.
        if (!before) setEntries([]);
        setExhausted(false);
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tripId, fetchActivity]
  );

  /**
   * Nothing is fetched until the panel is opened.
   *
   * The trip page already makes several authenticated requests on mount, and a history nobody has
   * asked for is not worth a round trip on every visit — `FeasibilityPanel` made the same call for
   * the same reason. Opening is the request.
   */
  const open = useCallback(() => setOpened(true), []);

  useEffect(() => {
    if (opened) load();
  }, [opened, load]);

  const loadMore = useCallback(() => {
    const oldest = entries[entries.length - 1];
    if (oldest) load({ before: oldest.id });
  }, [entries, load]);

  return { entries, loading, error, exhausted, opened, open, reload: load, loadMore };
};

export default useTripActivity;
