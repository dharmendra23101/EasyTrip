import apiClient, { ApiClientError } from './apiClient';

/**
 * The trip activity feed's one call (`BL-147`).
 *
 * **Its own module rather than a function in `tripService`, and the reason is a guard.** Adding it
 * there put that file at 517 lines against the 500-line criterion, and `check:size` refused it. The
 * two ways out were to split `tripService`'s notes-and-checklist half into a workspace service —
 * mirroring the backend's own `tripWorkspaceController` — or to give this feature the module it
 * already deserved.
 *
 * The second, deliberately. This is a self-contained feature with its own migration, model,
 * controller, constants, hook and component; a service module completes that set rather than
 * decorating it. The first is a real refactor with its own importers to update and its own
 * verification to run, and doing it as a side effect of shipping a feature is exactly how
 * `SESSION_PROTOCOL` §3's *"a small fix that turns into a rewrite"* happens. It is worth doing on
 * its own, and `tripService` is at 495 lines, so the next addition there will ask again.
 */

const withFallback = (error, fallback) => {
  if (error instanceof ApiClientError && error.message) return error;
  return new Error(fallback);
};

const authed = (token) => ({ authToken: token, requireAuth: true });

/**
 * Who changed this itinerary, newest first.
 *
 * `before` is an **entry id**, not a timestamp. Two rows written in one transaction share
 * `created_at` to the microsecond, so paging on a non-unique column shows one row twice and skips
 * another — which is the same reasoning behind the `(trip_id, created_at DESC, id DESC)` index the
 * query is ordered on.
 */
export const getTripActivity = async (tripId, token, { limit, before } = {}) => {
  try {
    const params = new URLSearchParams();
    if (limit) params.set('limit', String(limit));
    if (before) params.set('before', String(before));
    const query = params.toString() ? `?${params}` : '';

    const { data } = await apiClient.get(`/auth/trips/${tripId}/activity${query}`, authed(token));
    return data?.activity ?? [];
  } catch (error) {
    throw withFallback(error, 'Could not load the recent changes for this trip');
  }
};

const tripActivityService = { getTripActivity };

export default tripActivityService;
