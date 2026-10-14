import apiClient, { ApiClientError } from './apiClient';
import {
  fetchPlaceById,
  fetchPlaceImages,
  fetchLocations,
  fetchDistricts,
  fetchStates,
  fetchTags
} from './placesApi';

/**
 * This module holds only what needs a Firebase ID token. The public reads live in `placesApi.js`
 * so the server-rendering paths can call them without importing `../config/firebase` (IMP-040).
 *
 * The read names below are re-exported rather than reimplemented: one implementation, one place
 * for a bug to live, and no import churn in the admin pages that already call them.
 *
 * `getAllPlaces` and `searchPlaces` are deliberately *not* here any more. Both returned a bare
 * array; the endpoint now returns `{ data, pagination }`, and a function that quietly discarded
 * the pagination half would hand callers a page while letting them believe it was the catalogue.
 * Callers use `fetchPlaces` from `placesApi` instead.
 *
 * ---------------------------------------------------------------------------
 * What IMP-072 changed here
 * ---------------------------------------------------------------------------
 * Every function used to end in the same eight lines: a `console.error`, then a thrown object
 * literal that dug through `error.response?.data?.errors?.[0]?.message ||
 * error.response?.data?.message || <fallback>`. Eight copies, three of which had drifted into
 * subtly different shapes — one threw `{ message, response, status }`, another
 * `{ message, status, responseData }`, a third a bare `Error`. Callers could not know which.
 *
 * `apiClient` now owns the base URL, the Authorization header, and the error shape
 * (`ApiClientError`, always with `.message` and `.status`). What is left in each function is the
 * request and one line of fallback text — which is all these functions were ever about.
 *
 * The `authHeaders` helper is gone with them: the interceptor attaches the token, and
 * `requireAuth: true` produces the same "You must be signed in" error it used to throw by hand.
 */
const getPlaceById = fetchPlaceById;
const getPlaceImages = fetchPlaceImages;
const getLocations = fetchLocations;
const getDistricts = fetchDistricts;
const getStates = fetchStates;
const getTags = fetchTags;

/**
 * Replace the client's error text when it would not mean anything to a user, and keep it when it
 * would. A 4xx from the API carries a real message — the validator's field error, "Place not
 * found", "Admin access required". A request that never got a response carries axios's own wording
 * ("Network Error"), which is not something to show.
 */
const withFallback = (error, fallback) => {
  if (error instanceof ApiClientError && error.status) return error;
  return new ApiClientError(fallback, error?.status, error?.data);
};

/**
 * Build the multipart body for a place create/update.
 *
 * Shared because create and update had byte-identical copies of this loop. Objects and arrays are
 * JSON-encoded because `FormData` stringifies everything else to `"[object Object]"`.
 */
const buildPlaceFormData = (placeData) => {
  const formData = new FormData();

  if (placeData.image) formData.append('image', placeData.image);

  Object.entries(placeData).forEach(([key, value]) => {
    if (key === 'image' || value === undefined || value === null) return;
    if (typeof value === 'object' && !(value instanceof File)) {
      formData.append(key, JSON.stringify(value));
    } else {
      formData.append(key, value);
    }
  });

  return formData;
};

// `Content-Type` is deliberately not set for these. axios derives `multipart/form-data` from the
// FormData body *including the boundary parameter*; setting the header by hand omits the boundary
// and the server cannot parse the body. The previous adminService set it manually and only worked
// because axios overrode it anyway.

/**
 * Create place (admin)
 * @param {Object} placeData - Place data
 * @param {String} [token] - Firebase ID token; resolved from the SDK when omitted
 */
const createPlace = async (placeData, token) => {
  try {
    const response = await apiClient.post('/admin/places', buildPlaceFormData(placeData), {
      authToken: token,
      requireAuth: true
    });
    return response.data;
  } catch (error) {
    throw withFallback(
      error,
      'Server error - please try again. If the problem persists, contact support'
    );
  }
};

/**
 * Update place (admin)
 * @param {Number|String} id - Place ID
 * @param {Object} placeData - Place data
 * @param {String} [token] - Firebase ID token; resolved from the SDK when omitted
 */
const updatePlace = async (id, placeData, token) => {
  try {
    const response = await apiClient.put(`/admin/places/${id}`, buildPlaceFormData(placeData), {
      authToken: token,
      requireAuth: true
    });
    return response.data;
  } catch (error) {
    throw withFallback(error, 'Error updating place');
  }
};

/**
 * Delete place (admin)
 * @param {Number|String} id - Place ID
 * @param {String} [token] - Firebase ID token; resolved from the SDK when omitted
 */
const deletePlace = async (id, token) => {
  try {
    const response = await apiClient.delete(`/admin/places/${id}`, {
      authToken: token,
      requireAuth: true
    });
    return response.data;
  } catch (error) {
    throw withFallback(error, 'Error deleting place');
  }
};

/**
 * Get place reviews.
 *
 * The endpoint is public, so this never requires a token — but when one is available the server
 * soft-authenticates the request and flags the caller's own review with `is_own`. That flag is the
 * only way the client can recognise its own review, since the payload's `user_id` is an opaque
 * per-place digest rather than a Firebase uid.
 *
 * Hence no `requireAuth`: the shared interceptor attaches a token if there is one and sends the
 * request without it if there is not, which is exactly the behaviour this needs.
 *
 * @param {Number|String} id - Place ID
 * @param {String} [token] - Firebase ID token; resolved from the SDK when omitted
 */
const getPlaceReviews = async (id, token) => {
  try {
    const response = await apiClient.get(`/places/${id}/reviews`, { authToken: token });
    return response.data;
  } catch (error) {
    throw withFallback(error, 'Failed to fetch reviews');
  }
};

/**
 * Create place review
 * @param {Number|String} id - Place ID
 * @param {Object} reviewData - { rating, comment }
 * @param {String} [token] - Firebase ID token; resolved from the SDK when omitted
 */
const createPlaceReview = async (id, reviewData, token) => {
  try {
    // Only the review itself travels on the wire; the author is derived from the verified token
    // server-side, so any client-supplied identity is dropped here.
    const response = await apiClient.post(
      `/places/${id}/reviews`,
      { rating: reviewData.rating, comment: reviewData.comment },
      { authToken: token, requireAuth: true }
    );
    return response.data;
  } catch (error) {
    throw withFallback(error, 'Error creating review');
  }
};

/**
 * Delete the caller's own review.
 *
 * There is no `PUT` counterpart by design: re-submitting through `createPlaceReview` upserts,
 * so editing already has exactly one path. Ownership is enforced server-side from the token —
 * the client cannot pass an author, and a review belonging to someone else returns 403.
 *
 * @param {Number|String} id - Place ID
 * @param {Number|String} reviewId - Review ID (the `id` field of the review payload)
 * @param {String} [token] - Firebase ID token; resolved from the SDK when omitted
 */
const deletePlaceReview = async (id, reviewId, token) => {
  try {
    await apiClient.delete(`/places/${id}/reviews/${reviewId}`, {
      authToken: token,
      requireAuth: true
    });
    return true;
  } catch (error) {
    throw withFallback(error, 'Error deleting review');
  }
};

/**
 * Report a review for moderation.
 *
 * Reporting the same review twice is a no-op server-side rather than an error, so the caller
 * does not need to track whether it has already been reported.
 *
 * @param {Number|String} id - Place ID
 * @param {Number|String} reviewId - Review ID
 * @param {String} [reason] - Optional free-text reason; no UI sends one yet
 * @param {String} [token] - Firebase ID token; resolved from the SDK when omitted
 */
const reportPlaceReview = async (id, reviewId, reason, token) => {
  try {
    const response = await apiClient.post(
      `/places/${id}/reviews/${reviewId}/report`,
      reason ? { reason } : {},
      { authToken: token, requireAuth: true }
    );
    return response.data;
  } catch (error) {
    throw withFallback(error, 'Error reporting review');
  }
};

/**
 * Add a gallery image to a place (admin).
 *
 * @param {Number|String} id - Place ID
 * @param {File} file - Image file
 * @param {String} [caption] - Optional caption
 * @param {String} [token] - Firebase ID token; resolved from the SDK when omitted
 */
const addPlaceImage = async (id, file, caption, token) => {
  try {
    const formData = new FormData();
    formData.append('image', file);
    if (caption) formData.append('caption', caption);

    const response = await apiClient.post(`/admin/places/${id}/images`, formData, {
      authToken: token,
      requireAuth: true
    });
    return response.data;
  } catch (error) {
    throw withFallback(error, 'Error adding gallery image');
  }
};

/**
 * Remove a gallery image from a place (admin).
 *
 * @param {Number|String} id - Place ID
 * @param {Number|String} imageId - Image ID
 * @param {String} [token] - Firebase ID token; resolved from the SDK when omitted
 */
const deletePlaceImage = async (id, imageId, token) => {
  try {
    await apiClient.delete(`/admin/places/${id}/images/${imageId}`, {
      authToken: token,
      requireAuth: true
    });
    return true;
  } catch (error) {
    throw withFallback(error, 'Error deleting gallery image');
  }
};

const placeService = {
  getPlaceById,
  getLocations,
  getDistricts,
  getStates,
  getTags,
  createPlace,
  updatePlace,
  deletePlace,
  getPlaceReviews,
  createPlaceReview,
  deletePlaceReview,
  reportPlaceReview,
  getPlaceImages,
  addPlaceImage,
  deletePlaceImage
};

export default placeService;

// Named exports for direct imports
export {
  getPlaceById,
  getLocations,
  getDistricts,
  getStates,
  getTags,
  createPlace,
  updatePlace,
  deletePlace,
  getPlaceReviews,
  createPlaceReview,
  deletePlaceReview,
  reportPlaceReview,
  getPlaceImages,
  addPlaceImage,
  deletePlaceImage
};
