import apiClient from './apiClient';

/**
 * Admin-user management (IMP-072).
 *
 * Three things changed here, all of them removals:
 *
 * 1. **The base URL is gone.** This module read `process.env.NEXT_PUBLIC_API_URL` with no
 *    fallback, so with the variable unset every request went to the literal string
 *    `undefined/admin/places`. The shared client resolves the URL once (`apiConfig.js`).
 *
 * 2. **The Authorization header is gone.** It was built by hand at six call sites here alone.
 *    `apiClient`'s request interceptor attaches it now — one place to get right, which is the
 *    point of `IMP-003`'s fix rather than a restatement of it.
 *
 * 3. **`addPlace`, `updatePlace` and `deletePlace` are gone.** They duplicated
 *    `placeService.createPlace/updatePlace/deletePlace`, and nothing imported them: the only
 *    consumer of this module is `pages/admin/users.jsx`, which uses the three admin-management
 *    functions below. The place-management pages have always used `placeService`. Two
 *    implementations of one feature, one of them wired — the same shape as the profile vertical
 *    deleted in Sprint 5.1.
 *
 * `token` is still an explicit parameter. The pages hold one from `AuthContext` already, and
 * passing it lets the interceptor skip a second SDK round trip; omitting it is also fine, since
 * the interceptor falls back to asking Firebase.
 */

/** Every admin (id, email, name). Returns the raw array the API sends. */
const getAllAdmins = async (token) => {
  const response = await apiClient.get('/admin/admins', { authToken: token, requireAuth: true });
  return response.data;
};

/** Grant admin rights to an existing user by email. */
const addAdmin = async (token, email) => {
  const response = await apiClient.post(
    '/admin/admins',
    { email },
    { authToken: token, requireAuth: true }
  );
  return response.data;
};

/** Revoke admin rights. The email is a path segment, so it must be encoded. */
const removeAdmin = async (token, email) => {
  const response = await apiClient.delete(`/admin/admins/${encodeURIComponent(email)}`, {
    authToken: token,
    requireAuth: true
  });
  return response.data;
};

/**
 * Look up coordinates for a free-text address (`IMP-116`).
 *
 * Returns `{ results, status }` where `status` is `exact` · `ambiguous` · `no_match`. The server
 * derives that rather than the caller counting `results.length`, so the three cases cannot be
 * classified differently by two clients.
 */
const geocode = async (token, query) => {
  const response = await apiClient.get(`/admin/geocode?q=${encodeURIComponent(query)}`, {
    authToken: token,
    requireAuth: true
  });
  return response.data;
};

/**
 * The moderation queue (`IMP-111`).
 *
 * Returns `{ data, pagination, counts }`. `pagination.status` is the status that was **applied**,
 * not the one requested — the server decides, so a client cannot render a filter that did not run.
 */
const getReports = async (token, { status = 'open', limit, offset } = {}) => {
  const params = new URLSearchParams({ status });
  if (limit !== undefined) params.set('limit', String(limit));
  if (offset !== undefined) params.set('offset', String(offset));

  const response = await apiClient.get(`/admin/reports?${params.toString()}`, {
    authToken: token,
    requireAuth: true
  });
  return response.data;
};

/**
 * Resolve every open report against one review.
 *
 * Keyed on the review rather than a report id, because that is the unit a moderator acts on. A 409
 * means somebody else already handled it — which the caller must surface rather than swallow, or
 * two moderators quietly overwrite each other's judgement.
 */
const resolveReports = async (token, reviewId, resolution) => {
  const response = await apiClient.patch(
    `/admin/reports/reviews/${reviewId}`,
    { resolution },
    { authToken: token, requireAuth: true }
  );
  return response.data;
};

/**
 * Admin analytics (`IMP-111`). Returns `{ catalogue, ratings, activity, needsAttention }`.
 */
const getAnalytics = async (token, { days } = {}) => {
  // `days` omitted rather than sent empty: the route validates it as an integer 1-90, so `?days=`
  // is a 400 for what the caller means by "use the default".
  const params = new URLSearchParams();
  if (days !== undefined) params.set('days', String(days));

  const query = params.toString();
  const response = await apiClient.get(`/admin/analytics${query ? `?${query}` : ''}`, {
    authToken: token,
    requireAuth: true
  });
  return response.data;
};

/**
 * The admin audit log (`PE-013`). Returns `{ entries, total, limit, offset }`.
 *
 * `action` is omitted from the query string when absent rather than sent empty: the route validates
 * it against a closed list, and `?action=` would be a 400 for what the user means by "all of them".
 */
const getAuditEntries = async (token, { action, limit, offset } = {}) => {
  const params = new URLSearchParams();
  if (action) params.set('action', action);
  if (limit !== undefined) params.set('limit', String(limit));
  if (offset !== undefined) params.set('offset', String(offset));

  const query = params.toString();
  const response = await apiClient.get(`/admin/audit${query ? `?${query}` : ''}`, {
    authToken: token,
    requireAuth: true
  });
  return response.data;
};

export const adminService = {
  addAdmin,
  removeAdmin,
  getAllAdmins,
  geocode,
  getReports,
  resolveReports,
  getAnalytics,
  getAuditEntries
};
