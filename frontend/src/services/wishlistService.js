import apiClient, { ApiClientError } from './apiClient';

/**
 * The wishlist API (`IMP-108`, `ADR-030`).
 *
 * Every call is authenticated — there is no anonymous variant, because there is no anonymous
 * wishlist on the server. The signed-out experience is `localStorage`, and it lives in
 * `useWishlist`, not here: mixing the two would give this module two storage backends and a
 * branch, and the branch is a UI concern.
 *
 * No function takes a user id. The server derives the owner from the verified token, so passing
 * one would be inert at best and misleading at worst — a parameter that looks like it selects a
 * wishlist but does not.
 */

/** Same convention as `placeService`: keep a real API message, replace axios's own wording. */
const withFallback = (error, fallback) => {
  if (error instanceof ApiClientError && error.status) return error;
  return new ApiClientError(fallback, error?.status, error?.data);
};

/**
 * The caller's saved places.
 *
 * Returns both shapes the API sends: `places` for a card list, `placeIds` for the heart buttons.
 * Deriving the ids from the cards here would make every heart in the app depend on the card
 * projection staying the same shape.
 */
const getWishlist = async (token) => {
  try {
    const response = await apiClient.get('/auth/favorites', {
      authToken: token,
      requireAuth: true
    });
    return {
      places: response.data?.places ?? [],
      placeIds: response.data?.placeIds ?? []
    };
  } catch (error) {
    throw withFallback(error, 'Could not load your saved places');
  }
};

/**
 * Save a place. Idempotent server-side, so the caller does not have to know whether it is already
 * saved — which matters because the caller often does not, on a page loaded before sign-in.
 */
const addToWishlist = async (placeId, token) => {
  try {
    const response = await apiClient.post(
      '/auth/favorites',
      { place_id: Number(placeId) },
      { authToken: token, requireAuth: true }
    );
    return response.data;
  } catch (error) {
    throw withFallback(error, 'Could not save this place');
  }
};

/** Remove a place. Also idempotent — removing something already gone is a success. */
const removeFromWishlist = async (placeId, token) => {
  try {
    const response = await apiClient.delete(`/auth/favorites/${Number(placeId)}`, {
      authToken: token,
      requireAuth: true
    });
    return response.data;
  } catch (error) {
    throw withFallback(error, 'Could not remove this place');
  }
};

const wishlistService = { getWishlist, addToWishlist, removeFromWishlist };

export default wishlistService;
export { getWishlist, addToWishlist, removeFromWishlist };
