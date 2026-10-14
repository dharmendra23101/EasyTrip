/**
 * Public place reads, usable from anywhere (IMP-040).
 *
 * Split from `placeService.js` along a trust boundary rather than for convenience:
 *   placesApi.js    — public, unauthenticated reads. Runs on the server and in the browser.
 *   placeService.js — everything that needs a Firebase ID token. Browser only.
 *
 * `placeService` imports `../config/firebase` at module scope, so importing it from
 * `getStaticProps` / `getServerSideProps` drags the Firebase *client* SDK into the server render
 * path — a browser auth library, initialised on the server, to fetch public rows that need no
 * identity at all.
 *
 * To be precise about what this does and does not fix: the SDK is *already* initialised during
 * SSR, because `_app` renders `AuthProvider` and several admin pages import the service directly.
 * A build with no `NEXT_PUBLIC_FIREBASE_*` variables fails at `/admin/addPlace` with
 * `auth/invalid-api-key` today, and this split does not change that — it is tracked separately.
 * What the split does is keep the new server-rendered data path from deepening that coupling.
 *
 * Uses `fetch` rather than axios: it is available in both runtimes, needs no second HTTP client
 * in the browser bundle, and supports the server-only `API_URL` indirection below.
 */

import { resolveApiBaseUrl } from './apiConfig';

// The base-URL rule now lives in `apiConfig.js` and nowhere else (IMP-072). This module keeps
// using `fetch` rather than the shared axios instance on purpose: these are the *public* reads,
// called from `getServerSideProps`/`getStaticProps`, and `fetch` needs no auth interceptor and
// pulls nothing extra into the server bundle.
const baseUrl = resolveApiBaseUrl;

/** Page size for the browse grid. Server caps this at 100 (placeModel MAX_LIMIT). */
export const PLACES_PAGE_SIZE = 12;

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

const request = async (path, { signal } = {}) => {
  const response = await fetch(`${baseUrl()}${path}`, {
    signal,
    headers: { Accept: 'application/json' }
  });

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    try {
      const body = await response.json();
      if (body?.message) message = body.message;
    } catch {
      // A non-JSON error body (a proxy's HTML 502, say) leaves the status-derived message.
    }
    throw new ApiError(message, response.status);
  }

  return response.json();
};

/**
 * Serialise list parameters.
 *
 * Arrays are JSON-encoded rather than repeated (`tags=["a","b"]`, not `tags=a&tags=b`). That is
 * the shape the server's validator requires: a repeated parameter with a single value arrives as
 * a bare string, which `JSON.parse` rejects, so the one-tag case would 400 while the two-tag case
 * passed. Encoding always keeps both cases on the same path.
 */
const buildQuery = (params = {}) => {
  const query = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value)) {
      if (value.length === 0) return;
      query.set(key, JSON.stringify(value));
    } else {
      query.set(key, String(value));
    }
  });

  const encoded = query.toString();
  return encoded ? `?${encoded}` : '';
};

/**
 * Fetch a page of places.
 *
 * Accepts filters (searchTerm, location, district, state, themes, tags, minRating, date)
 * alongside `limit`, `offset`, `sort` and `projection`, and returns the server envelope:
 *
 *   { data: [...], pagination: { total, limit, offset, hasMore, sort } }
 *
 * `projection: 'map'` returns every match, unpaginated, with a marker-sized row.
 */
export const fetchPlaces = async (params = {}, options = {}) =>
  request(`/places${buildQuery(params)}`, options);

/**
 * Search suggestions for the typeahead (`IMP-112`).
 *
 * Returns `{ data: [{ id, name, location, district, state }] }` — at most eight, capped server-side.
 * Public, so it lives here rather than in `placeService`.
 */
export const fetchPlaceSuggestions = async (term, options = {}) =>
  request(`/places/suggest${buildQuery({ q: term })}`, options);

export const fetchPlaceById = async (id, options = {}) => request(`/places/${id}`, options);

export const fetchPlaceImages = async (id, options = {}) =>
  request(`/places/${id}/images`, options);

/**
 * Quieter places near this one (`FV-028` stage c).
 *
 * Returns `{ data: [] }` for almost every place, and that is the designed answer rather than a
 * failure: "less crowded" is a relation, so it needs a curated crowd level at both ends.
 */
export const fetchQuieterNearby = async (id, options = {}) =>
  request(`/places/${id}/quieter-nearby`, options);

/**
 * How well one place fits a month and a set of interests, with the working attached (`FV-028` stage d).
 *
 * Returns `{ data: { score, coverage, factors, unavailable, weights } }`. **`score` is `null` for
 * almost every place** - nothing has been curated, so there is nothing to compute - and `coverage`
 * says how much of the evidence existed. The two are meant to be rendered together; a caller showing
 * the score alone is claiming a measurement where there is an opinion over a fraction of the evidence.
 */
export const fetchPlaceFit = async (id, { month, interests } = {}, options = {}) =>
  request(
    `/places/${id}/fit${buildQuery({
      month,
      // A comma-joined string rather than repeated parameters, which is the shape the validator
      // accepts. An empty list must not become `interests=`, or the server counts a blank interest.
      interests: interests?.length ? interests.join(',') : undefined
    })}`,
    options
  );

/**
 * Personalised recommendations (`FV-019`).
 *
 * Authenticated, because the answer is derived entirely from this traveller's saved places. Returns
 * `{ recommendations, basis, excluded }` — and **the last two are not optional decoration**: `basis`
 * is what the answer was computed from and `excluded` is what could not be considered, without which
 * a recommendation is indistinguishable from an arbitrary one.
 */
export const fetchRecommendations = async (token, options = {}) =>
  request('/auth/recommendations', { ...options, authToken: token, requireAuth: true });

export const fetchPlaceReviews = async (id, options = {}) =>
  request(`/places/${id}/reviews`, options);

export const fetchLocations = async (options = {}) => request('/places/locations', options);

/**
 * Real weather for a place (`IMP-110`).
 *
 * Lives here rather than in `placeService` because it needs no token — but it is deliberately NOT
 * called from `getStaticProps`: a forecast baked into an ISR page would be up to five minutes stale
 * on arrival and would then be served from cache to everyone. Weather is the one thing on this page
 * that has to be fetched when the page is *looked at*.
 */
export const fetchPlaceWeather = async (id, options = {}) =>
  request(`/places/${id}/weather`, options);
export const fetchDistricts = async (options = {}) => request('/places/districts', options);
export const fetchStates = async (options = {}) => request('/places/states', options);
export const fetchTags = async (options = {}) => request('/places/tags', options);

/**
 * The four filter vocabularies browse renders, in one round of parallel requests.
 *
 * Individually optional: a facet that fails to load costs one empty filter section, not the
 * page, so each settles to `[]` on error rather than rejecting the whole set.
 */
export const fetchFacets = async (options = {}) => {
  const [locations, districts, states, tags] = await Promise.all([
    fetchLocations(options).catch(() => []),
    fetchDistricts(options).catch(() => []),
    fetchStates(options).catch(() => []),
    fetchTags(options).catch(() => [])
  ]);

  return { locations, districts, states, tags };
};

export { ApiError };
