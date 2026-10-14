import { useState, useEffect, useCallback } from 'react';

import { useAuth } from '../context/AuthContext';
import reviewHistoryService from '../services/reviewHistoryService';
import { deletePlaceReview } from '../services/placeService';

/**
 * The caller's review history (`IMP-117`).
 *
 * **Deleting goes through the place route, not through a history route.** `IMP-019` already built
 * an owner-gated `DELETE /places/:id/reviews/:reviewId`, and ownership is enforced there, in SQL.
 * Adding a second delete path so the profile page could have its own would mean two endpoints
 * enforcing one rule — and the second one is where the rule eventually gets forgotten. The history
 * payload carries `place_id` precisely so this hook can call the existing route.
 *
 * There is no edit here for the same reason: re-submitting a review upserts, so editing already
 * has exactly one path and it lives on the place page next to the form that does it.
 */
export function useMyReviews() {
  const { currentUser, loading: authLoading, getIdToken } = useAuth();

  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(false);
  /**
   * Two error slots, not one — and collapsing them was a real bug this hook shipped for about ten
   * minutes. A failed **load** means there is no list to show, so the page becomes the error. A
   * failed **delete** means the list is fine and one action did not happen; rendering the same
   * full-page error would *hide the very reviews it failed to delete*, which reads as "they were
   * deleted after all". Opposite meanings, opposite treatments.
   */
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [ready, setReady] = useState(false);
  const [removingId, setRemovingId] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const token = await getIdToken();
      const rows = await reviewHistoryService.getMyReviews(token);
      setReviews(rows);
      return rows;
    } catch (loadError) {
      setError(loadError);
      return null;
    } finally {
      setLoading(false);
      setReady(true);
    }
  }, [getIdToken]);

  useEffect(() => {
    if (authLoading) return;

    if (!currentUser) {
      setReviews([]);
      setReady(true);
      return;
    }

    refresh();
  }, [authLoading, currentUser, refresh]);

  /**
   * Delete one review.
   *
   * **Not optimistic.** The wishlist heart is, because it is idempotent, instantly reversible, and
   * the user is mid-gesture. A review is none of those: it is a paragraph somebody wrote, deleting
   * it cannot be undone, and removing it from the list before the server agrees would show it gone
   * when it is not. The row stays, marked busy, until the delete actually lands.
   */
  const remove = useCallback(
    async (review) => {
      if (!review?.id || !review?.place_id) return false;

      setRemovingId(review.id);
      setActionError(null);

      try {
        const token = await getIdToken();
        await deletePlaceReview(review.place_id, review.id, token);
        setReviews((current) => current.filter((row) => row.id !== review.id));
        return true;
      } catch (deleteError) {
        setActionError(deleteError);
        return false;
      } finally {
        setRemovingId(null);
      }
    },
    [getIdToken]
  );

  return {
    reviews,
    loading,
    /** The load failed: there is no list to render. */
    error,
    /** An action failed: the list is still valid and must stay on screen. */
    actionError,
    refresh,
    remove,
    removingId,
    ready: ready && !authLoading
  };
}
