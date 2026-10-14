import apiClient, { ApiClientError } from './apiClient';

/**
 * The caller's own review history (`IMP-117`).
 *
 * Read-only, deliberately. Editing and deleting a review already have exactly one path each —
 * `placeService.createPlaceReview` upserts, `placeService.deletePlaceReview` is owner-gated — and
 * both are place-scoped because that is where the server enforces ownership. A second delete
 * wrapper here would be a second place for that contract to drift.
 *
 * No function takes a user id: the server derives the owner from the verified token.
 */

/** Same convention as `placeService`: keep a real API message, replace axios's own wording. */
const withFallback = (error, fallback) => {
  if (error instanceof ApiClientError && error.status) return error;
  return new ApiClientError(fallback, error?.status, error?.data);
};

/**
 * Every review this user has written, most recently updated first, each carrying enough of its
 * place to render a card and link back to it.
 */
const getMyReviews = async (token) => {
  try {
    const response = await apiClient.get('/auth/reviews', {
      authToken: token,
      requireAuth: true
    });
    return response.data?.reviews ?? [];
  } catch (error) {
    throw withFallback(error, 'Could not load your reviews');
  }
};

// Named before exporting, matching `placeService` and `wishlistService` — an anonymous default
// export gives the module no name in a stack trace or a mock factory.
const reviewHistoryService = { getMyReviews };

export default reviewHistoryService;
export { getMyReviews };
