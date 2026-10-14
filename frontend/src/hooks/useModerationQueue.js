import { useCallback, useEffect, useState } from 'react';

import { adminService } from '../services/adminService';
import { deletePlaceReview } from '../services/placeService';

/**
 * The moderation queue's state (`IMP-111`, `ADR-036`).
 *
 * Dependencies are injected so the whole thing is testable without a Firebase session or a network
 * — the same shape `usePlaceForm` uses, and for the same reason: the interesting behaviour here is
 * *what happens after an action*, and that should not need a browser to observe.
 */
export const useModerationQueue = ({
  getIdToken,
  fetchReports = adminService.getReports,
  resolve = adminService.resolveReports,
  removeReview = deletePlaceReview
} = {}) => {
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({ open: 0, reviewed: 0, dismissed: 0 });
  const [status, setStatus] = useState('open');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Which review is mid-action, so one row can show a spinner without disabling the whole list.
  const [busyReviewId, setBusyReviewId] = useState(null);

  const load = useCallback(
    async (nextStatus = status) => {
      setLoading(true);
      setError(null);
      try {
        const token = await getIdToken();
        if (!token) throw new Error('Your session has expired. Please sign in again.');

        const payload = await fetchReports(token, { status: nextStatus });

        setRows(payload.data || []);
        setCounts(payload.counts || { open: 0, reviewed: 0, dismissed: 0 });
        // The status the SERVER applied, not the one requested. If the two ever diverge, the tabs
        // must follow the data rather than the click — otherwise the UI labels a list with a filter
        // that did not run.
        setStatus(payload.pagination?.status || nextStatus);
      } catch (err) {
        setError(err.message || 'Could not load the moderation queue.');
        // The list is emptied on failure rather than left showing the previous status' rows under
        // the new tab's heading, which would be a wrong answer rather than a missing one.
        setRows([]);
      } finally {
        setLoading(false);
      }
    },
    [getIdToken, fetchReports, status]
  );

  useEffect(() => {
    load('open');
    // Mount only. Tab changes go through `changeStatus`, which passes the target explicitly —
    // depending on `load` here would refetch on every render, since `load` closes over `status`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeStatus = useCallback((next) => load(next), [load]);

  /**
   * Resolve every open report on a review.
   *
   * A 409 is surfaced, not swallowed: it means another moderator already acted, and telling this
   * one their click succeeded is how two people quietly overwrite each other's judgement. The list
   * is reloaded either way, because in both cases what is on screen is now stale.
   */
  const resolveReview = useCallback(
    async (reviewId, resolution) => {
      setBusyReviewId(reviewId);
      try {
        const token = await getIdToken();
        if (!token) throw new Error('Your session has expired. Please sign in again.');

        await resolve(token, reviewId, resolution);
        await load(status);
        return { ok: true };
      } catch (err) {
        await load(status);
        const conflict = err?.response?.status === 409;
        return {
          ok: false,
          conflict,
          message: conflict
            ? 'Someone else already handled this one.'
            : err.message || 'Could not resolve the reports.'
        };
      } finally {
        setBusyReviewId(null);
      }
    },
    [getIdToken, resolve, load, status]
  );

  /**
   * Remove a review outright.
   *
   * Goes through the ordinary review delete, which admits admins since `ADR-036` — there is no
   * separate admin delete endpoint, and no separate client path to one. The reports go with it via
   * `ON DELETE CASCADE`, so the row leaves the queue without a second call.
   */
  const removeReviewById = useCallback(
    async (placeId, reviewId) => {
      setBusyReviewId(reviewId);
      try {
        const token = await getIdToken();
        if (!token) throw new Error('Your session has expired. Please sign in again.');

        await removeReview(placeId, reviewId, token);
        await load(status);
        return { ok: true };
      } catch (err) {
        await load(status);
        return { ok: false, message: err.message || 'Could not remove the review.' };
      } finally {
        setBusyReviewId(null);
      }
    },
    [getIdToken, removeReview, load, status]
  );

  return {
    rows,
    counts,
    status,
    loading,
    error,
    busyReviewId,
    changeStatus,
    reload: () => load(status),
    resolveReview,
    removeReviewById
  };
};

export default useModerationQueue;
