import { useCallback, useEffect, useState } from 'react';

import { adminService } from '../services/adminService';

const PAGE_SIZE = 25;

/**
 * The admin audit log's state (`PE-013`, `FV-023`).
 *
 * Dependencies injected, as `useModerationQueue` does, so the behaviour worth testing — what the
 * list shows after a failure, and whether a filter change can leave the wrong rows under the wrong
 * heading — is observable without a Firebase session or a network.
 */
export const useAuditLog = ({ getIdToken, fetchEntries = adminService.getAuditEntries } = {}) => {
  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [action, setAction] = useState('');
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(
    async (nextAction = action, nextOffset = offset) => {
      setLoading(true);
      setError(null);
      try {
        const token = await getIdToken();
        if (!token) throw new Error('Your session has expired. Please sign in again.');

        const payload = await fetchEntries(token, {
          action: nextAction || undefined,
          limit: PAGE_SIZE,
          offset: nextOffset
        });

        setEntries(payload.entries || []);
        setTotal(payload.total || 0);
      } catch (err) {
        setError(err.message || 'Could not load the audit log.');
        // Emptied rather than left showing the previous filter's rows under the new heading. An
        // audit log is read to answer "did this happen" — stale rows under a filter that failed to
        // run is a wrong answer, and a wrong answer here is worse than a missing one.
        setEntries([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    },
    [action, offset, getIdToken, fetchEntries]
  );

  useEffect(() => {
    load(action, offset);
    // `load` is deliberately not a dependency: it closes over the very state this effect sets, so
    // including it re-runs the fetch on its own result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action, offset]);

  /** Changing the filter returns to the first page — page 3 of a different filter is not a place. */
  const changeAction = (nextAction) => {
    setAction(nextAction);
    setOffset(0);
  };

  const hasMore = offset + entries.length < total;

  return {
    entries,
    total,
    action,
    offset,
    loading,
    error,
    hasMore,
    pageSize: PAGE_SIZE,
    changeAction,
    nextPage: () => hasMore && setOffset(offset + PAGE_SIZE),
    previousPage: () => setOffset(Math.max(0, offset - PAGE_SIZE)),
    reload: () => load(action, offset)
  };
};
