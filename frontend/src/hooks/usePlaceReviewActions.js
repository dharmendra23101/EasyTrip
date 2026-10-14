import { useState, useEffect, useMemo, useCallback } from 'react';
import { toast } from 'react-toastify';
import {
  getPlaceById,
  getPlaceReviews,
  createPlaceReview,
  deletePlaceReview,
  reportPlaceReview
} from '../services/placeService';

/**
 * Everything the detail page can do to a review: write one, edit it, delete it, report one
 * (IMP-070).
 *
 * Submit and delete both re-read the place as well as the review list. A database trigger
 * recomputes the rating aggregate, so patching counts client-side would drift from what the
 * database now holds — hence `setPlace` and `setReviews` are passed in rather than the hook
 * owning that state.
 *
 * @param {String|undefined} placeId
 * @param {Array} reviews - the current list, for finding the user's own
 * @param {Object} auth - `{ currentUser, isAuthenticated, getIdToken }`
 * @param {Object} sync - `{ setPlace, setReviews }` from `usePlaceDetail`
 */
export function usePlaceReviewActions(
  placeId,
  reviews,
  { currentUser, isAuthenticated, getIdToken },
  { setPlace, setReviews }
) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState(null);

  // The API allows one review per user per place, so a second submit edits the existing one.
  // Ownership is marked by the server (`is_own`): the payload's user_id is an opaque
  // per-place digest, so comparing it to a Firebase uid would never match.
  const existingReview = useMemo(() => {
    if (!currentUser) return null;
    return reviews.find((review) => review.is_own) || null;
  }, [reviews, currentUser]);

  // Seed the form from the signed-in user's existing review so editing starts from its values
  useEffect(() => {
    if (!existingReview) return;
    setRating(existingReview.rating || 0);
    setComment(existingReview.comment || '');
  }, [existingReview]);

  /** Re-read both the list and the place, because the rating aggregate is trigger-maintained. */
  const resync = useCallback(async () => {
    const [reviewsResult, placeResult] = await Promise.allSettled([
      getPlaceReviews(placeId),
      getPlaceById(placeId)
    ]);

    if (reviewsResult.status === 'fulfilled') {
      setReviews(reviewsResult.value || []);
    }
    if (placeResult.status === 'fulfilled' && placeResult.value) {
      setPlace(placeResult.value);
    }
  }, [placeId, setPlace, setReviews]);

  /** Throws rather than returning null, so every caller's catch reports the same message. */
  const requireToken = async () => {
    const token = await getIdToken();
    if (!token) {
      throw new Error('Your session has expired. Please sign in again.');
    }
    return token;
  };

  const submit = async ({ rating: submittedRating, comment: submittedComment }) => {
    if (!isAuthenticated) {
      setError('Please sign in to share your experience.');
      toast.error('You must be logged in to submit a review.');
      return;
    }

    if (!submittedRating) {
      setError('Please select a star rating before submitting.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const wasEditing = Boolean(existingReview);

    try {
      const token = await requireToken();

      // Identity is derived server-side from the verified token, so the body carries
      // only the review itself.
      await createPlaceReview(
        placeId,
        { rating: submittedRating, comment: submittedComment },
        token
      );
      await resync();

      toast.success(
        wasEditing ? 'Your review has been updated.' : 'Thank you! Your review has been published.'
      );
    } catch (err) {
      const message = err?.message || 'Failed to submit review. Please try again.';
      setError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Deleting a review also drops the rating it contributed, and there is no undo — so this is
  // one of the few places a confirm is genuinely warranted rather than reflexive.
  const remove = async (reviewId) => {
    if (!isAuthenticated) {
      toast.error('You must be logged in to delete a review.');
      return;
    }

    if (!window.confirm('Delete your review? This will also remove your rating for this place.')) {
      return;
    }

    setIsDeleting(true);

    try {
      const token = await requireToken();
      await deletePlaceReview(placeId, reviewId, token);
      await resync();

      // Clear the form too: with the review gone the section reverts to "Share Your Experience",
      // and leaving the old text in the inputs would look like it had not been deleted.
      setRating(0);
      setComment('');
      setError(null);

      toast.success('Your review has been deleted.');
    } catch (err) {
      toast.error(err?.message || 'Failed to delete review.');
    } finally {
      setIsDeleting(false);
    }
  };

  // This faked success with a setTimeout until Sprint 2.3 (IMP-023/019) — the button told users
  // their report was filed and nothing was recorded.
  const report = async (reviewId) => {
    if (!isAuthenticated) {
      toast.error('You must be logged in to report a review.');
      return;
    }

    try {
      const token = await requireToken();

      // Reporting the same review twice is a no-op server-side, so there is nothing to guard
      // against here beyond the in-flight state.
      const result = await reportPlaceReview(placeId, reviewId, undefined, token);
      toast.success(result?.message || 'Thanks — this review has been reported for moderation.');
    } catch (err) {
      toast.error(err?.message || 'Failed to report review.');
    }
  };

  return {
    rating,
    setRating,
    comment,
    setComment,
    isSubmitting,
    isDeleting,
    error,
    existingReview,
    submit,
    remove,
    report
  };
}
