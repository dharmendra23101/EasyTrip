import { useCallback, useEffect, useState } from 'react';

import { adminService } from '../services/adminService';

/** The windows the API accepts (1–90). Three is enough; a free-text box invites a 400. */
export const ACTIVITY_WINDOWS = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' }
];

/**
 * The admin analytics page's state (`FV-022`).
 *
 * Dependencies injected, as `useModerationQueue` and `useAuditLog` do, so the behaviour worth
 * testing is observable without a Firebase session or a network.
 *
 * **The window lives here rather than in the page**, because changing it is a refetch and not a
 * client-side filter — the series is computed by Postgres over a date range, and re-slicing 30 days
 * of data to show 7 would produce a chart that disagrees with the one the server would return.
 */
export const useAnalytics = ({ getIdToken, fetchAnalytics = adminService.getAnalytics } = {}) => {
  const [analytics, setAnalytics] = useState(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(
    async (window) => {
      setLoading(true);
      setError(null);
      try {
        const token = await getIdToken();
        if (!token) throw new Error('Your session has expired. Please sign in again.');

        setAnalytics(await fetchAnalytics(token, { days: window }));
      } catch (err) {
        setError(err.message || 'Could not load analytics.');
        // Cleared rather than left showing the previous window's numbers under the new heading.
        // On a monitoring page a stale chart is worse than an empty one: the reason somebody is
        // looking is to find out whether something changed.
        setAnalytics(null);
      } finally {
        setLoading(false);
      }
    },
    [getIdToken, fetchAnalytics]
  );

  useEffect(() => {
    load(days);
    // `load` is deliberately not a dependency, as in `useAuditLog`. It closes over `getIdToken`,
    // which this hook cannot force a caller to memoize — and an un-memoized one changes identity
    // every render, so including `load` here turns the page into an unbounded refetch loop against
    // an admin endpoint. `AuthContext` happens to memoize it today; that is the caller's choice to
    // change, and a hook should not be one edit away from hammering the API.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  return {
    analytics,
    days,
    loading,
    error,
    setDays,
    reload: () => load(days)
  };
};
