import apiClient, { ApiClientError } from './apiClient';

/**
 * The trip workspace API (`IMP-109` / `FV-006`, `ADR-031`).
 *
 * Every path is nested under its trip, mirroring the server: a day and an item are only ever
 * addressable *through* the trip that owns them. No function takes a user id — the owner comes from
 * the verified token, server-side.
 */

const withFallback = (error, fallback) => {
  if (error instanceof ApiClientError && error.status) return error;
  return new ApiClientError(fallback, error?.status, error?.data);
};

const authed = (token) => ({ authToken: token, requireAuth: true });

const listTrips = async (token) => {
  try {
    const { data } = await apiClient.get('/auth/trips', authed(token));
    return data?.trips ?? [];
  } catch (error) {
    throw withFallback(error, 'Could not load your trips');
  }
};

const getTrip = async (tripId, token) => {
  try {
    const { data } = await apiClient.get(`/auth/trips/${tripId}`, authed(token));
    return data?.trip ?? null;
  } catch (error) {
    throw withFallback(error, 'Could not load this trip');
  }
};

/**
 * The deterministic feasibility report for a trip (`FV-025`).
 *
 * A separate call rather than a field on `getTrip`, and that is the design rather than an
 * accident: the workspace reloads the whole trip after every write (see `useTripWorkspace`), and
 * making every add, edit and reorder also recompute a report the user may not be looking at would
 * put work on the critical path of a drag. The check is asked for when it is wanted.
 */
const getTripFeasibility = async (tripId, token) => {
  try {
    const { data } = await apiClient.get(`/auth/trips/${tripId}/feasibility`, authed(token));
    return data?.feasibility ?? null;
  } catch (error) {
    throw withFallback(error, 'Could not check this trip');
  }
};

/**
 * What to change when the forecast disagrees with the plan (`FV-027` stage b).
 *
 * A read. Applying a proposal is `updateItem` with a `trip_day_id`, which is the same endpoint the
 * workspace already uses for every other edit — so the replan has no privileged write path.
 */
const getTripReplanSuggestion = async (tripId, token) => {
  try {
    const { data } = await apiClient.get(`/auth/trips/${tripId}/replan-suggestion`, authed(token));
    return data.replan;
  } catch (error) {
    throw withFallback(error, 'Could not work out what to change');
  }
};

/**
 * A shorter order for one day, if there is one (`FV-026` stage a).
 *
 * Read-only. Applying a suggestion goes through `reorderItems`, which already exists and already
 * validates — so a suggestion can never become a write this module invented.
 */
const getDayRouteSuggestion = async (tripId, dayId, token) => {
  try {
    const { data } = await apiClient.get(
      `/auth/trips/${tripId}/days/${dayId}/route-suggestion`,
      authed(token)
    );
    return data?.suggestion ?? null;
  } catch (error) {
    throw withFallback(error, 'Could not check this day');
  }
};

/**
 * One day as it would be drawn (`FV-026` stage c).
 *
 * A read, and a *separate* one from `getDayRouteSuggestion` beside it even though both are about a
 * day's geography. They answer different questions — *what would a shorter order be?* and *what does
 * this order look like?* — and the second is the only one that can be true of a day the first
 * declines, which is every day with times on it.
 *
 * The response is returned whether or not it is drawable: a refusal carries a `reason` and a
 * sentence, and the panel renders it. Collapsing that to `null` would make "this day has no mapped
 * stops" indistinguishable from "the request failed".
 */
const getDayRoute = async (tripId, dayId, token) => {
  try {
    const { data } = await apiClient.get(
      `/auth/trips/${tripId}/days/${dayId}/route`,
      authed(token)
    );
    return data?.route ?? null;
  } catch (error) {
    throw withFallback(error, 'Could not draw this day');
  }
};

const createTrip = async (trip, token) => {
  try {
    const { data } = await apiClient.post('/auth/trips', trip, authed(token));
    return data?.trip;
  } catch (error) {
    throw withFallback(error, 'Could not create this trip');
  }
};

const updateTrip = async (tripId, patch, token) => {
  try {
    const { data } = await apiClient.put(`/auth/trips/${tripId}`, patch, authed(token));
    return data?.trip;
  } catch (error) {
    throw withFallback(error, 'Could not update this trip');
  }
};

const deleteTrip = async (tripId, token) => {
  try {
    await apiClient.delete(`/auth/trips/${tripId}`, authed(token));
    return true;
  } catch (error) {
    throw withFallback(error, 'Could not delete this trip');
  }
};

const addDay = async (tripId, token) => {
  try {
    const { data } = await apiClient.post(`/auth/trips/${tripId}/days`, {}, authed(token));
    return data?.day;
  } catch (error) {
    throw withFallback(error, 'Could not add a day');
  }
};

const deleteDay = async (tripId, dayId, token) => {
  try {
    await apiClient.delete(`/auth/trips/${tripId}/days/${dayId}`, authed(token));
    return true;
  } catch (error) {
    throw withFallback(error, 'Could not delete this day');
  }
};

const addItem = async (tripId, dayId, item, token) => {
  try {
    const { data } = await apiClient.post(
      `/auth/trips/${tripId}/days/${dayId}/items`,
      item,
      authed(token)
    );
    return data?.item;
  } catch (error) {
    throw withFallback(error, 'Could not add this item');
  }
};

const updateItem = async (tripId, itemId, patch, token) => {
  try {
    const { data } = await apiClient.put(
      `/auth/trips/${tripId}/items/${itemId}`,
      patch,
      authed(token)
    );
    return data?.item;
  } catch (error) {
    throw withFallback(error, 'Could not update this item');
  }
};

const deleteItem = async (tripId, itemId, token) => {
  try {
    await apiClient.delete(`/auth/trips/${tripId}/items/${itemId}`, authed(token));
    return true;
  } catch (error) {
    throw withFallback(error, 'Could not remove this item');
  }
};

/**
 * Reorder a day's items. Takes the **full** ordered id list, which is what the server requires —
 * a partial list is rejected rather than partially applied, because a partial apply looks like it
 * worked and silently interleaves the omitted items.
 */
const reorderItems = async (tripId, dayId, itemIds, token) => {
  try {
    await apiClient.put(
      `/auth/trips/${tripId}/days/${dayId}/items/order`,
      { item_ids: itemIds },
      authed(token)
    );
    return true;
  } catch (error) {
    throw withFallback(error, 'Could not reorder these items');
  }
};

// ---------------------------------------------------------------------------
// Notes and checklist (`FV-006` stage b)
// ---------------------------------------------------------------------------
// Nested under the trip like everything else here. A note carries no owner of its own and is only
// ever addressable through the trip that owns it — the same shape the server enforces in SQL.

const listNotes = async (tripId, token) => {
  try {
    const { data } = await apiClient.get(`/auth/trips/${tripId}/notes`, authed(token));
    return data?.notes ?? [];
  } catch (error) {
    throw withFallback(error, 'Could not load the notes for this trip');
  }
};

const addNote = async (tripId, body, token) => {
  try {
    const { data } = await apiClient.post(`/auth/trips/${tripId}/notes`, { body }, authed(token));
    return data?.note ?? null;
  } catch (error) {
    throw withFallback(error, 'Could not save this note');
  }
};

const updateNote = async (tripId, noteId, body, token) => {
  try {
    const { data } = await apiClient.put(
      `/auth/trips/${tripId}/notes/${noteId}`,
      { body },
      authed(token)
    );
    return data?.note ?? null;
  } catch (error) {
    throw withFallback(error, 'Could not update this note');
  }
};

const deleteNote = async (tripId, noteId, token) => {
  try {
    await apiClient.delete(`/auth/trips/${tripId}/notes/${noteId}`, authed(token));
    return true;
  } catch (error) {
    throw withFallback(error, 'Could not delete this note');
  }
};

const listChecklist = async (tripId, token) => {
  try {
    const { data } = await apiClient.get(`/auth/trips/${tripId}/checklist`, authed(token));
    return data?.items ?? [];
  } catch (error) {
    throw withFallback(error, 'Could not load the checklist for this trip');
  }
};

const addChecklistItem = async (tripId, label, token) => {
  try {
    const { data } = await apiClient.post(
      `/auth/trips/${tripId}/checklist`,
      { label },
      authed(token)
    );
    return data?.item ?? null;
  } catch (error) {
    throw withFallback(error, 'Could not add this checklist item');
  }
};

/**
 * PATCH, and the patch carries only what changed.
 *
 * Sending `{ is_done }` alone is the point: a PUT with the whole item would need the label too, and
 * a caller that forgot it would blank the label every time somebody ticked a box.
 */
const updateChecklistItem = async (tripId, itemId, patch, token) => {
  try {
    const { data } = await apiClient.patch(
      `/auth/trips/${tripId}/checklist/${itemId}`,
      patch,
      authed(token)
    );
    return data?.item ?? null;
  } catch (error) {
    throw withFallback(error, 'Could not update this checklist item');
  }
};

const deleteChecklistItem = async (tripId, itemId, token) => {
  try {
    await apiClient.delete(`/auth/trips/${tripId}/checklist/${itemId}`, authed(token));
    return true;
  } catch (error) {
    throw withFallback(error, 'Could not delete this checklist item');
  }
};

/**
 * The trip as an `.ics` file (`FV-009` stage a).
 *
 * **Returns the text, not a download.** The endpoint is authenticated, so the browser cannot simply
 * follow a link to it - a plain `<a href>` sends no `Authorization` header and lands on a 401. The
 * caller fetches the body with a token and hands it to the browser as a blob, which is also what
 * makes a 422 (a trip with no dates) something we can show as a sentence rather than a downloaded
 * file containing an error message.
 */
const exportCalendar = async (tripId, token) => {
  try {
    const { data } = await apiClient.get(`/auth/trips/${tripId}/calendar.ics`, {
      ...authed(token),
      // Without this axios parses the body as JSON, fails, and hands back something that is not the
      // file. It is text/calendar, so it is text.
      responseType: 'text',
      headers: { Accept: 'text/calendar' }
    });
    return data;
  } catch (error) {
    throw withFallback(error, 'Could not export this trip');
  }
};

/**
 * Duplicate a trip (`FV-006` stage d).
 *
 * Returns the **new** trip, so the caller can navigate straight to it rather than re-fetching the
 * list and guessing which one is the copy.
 */
const duplicateTrip = async (tripId, token, title) => {
  try {
    const { data } = await apiClient.post(
      `/auth/trips/${tripId}/duplicate`,
      // Omitted rather than sent empty: the server defaults to "Copy of <title>", and sending `null`
      // would be a caller asking for a blank name.
      title ? { title } : {},
      authed(token)
    );
    return data?.trip ?? null;
  } catch (error) {
    throw withFallback(error, 'Could not duplicate this trip');
  }
};

// ---------------------------------------------------------------------------
// The people who can open the trip (`FV-007` stage a)
// ---------------------------------------------------------------------------

/** Also returns `your_role`, which is how the panel knows whether to offer the owner's controls. */
const listCollaborators = async (tripId, token) => {
  try {
    const { data } = await apiClient.get(`/auth/trips/${tripId}/collaborators`, authed(token));
    return data ?? { collaborators: [], your_role: null };
  } catch (error) {
    throw withFallback(error, 'Could not load the people on this trip');
  }
};

/**
 * Add by the email somebody registered with, at a role. **Nothing is emailed** - the address is a
 * lookup key (`017_trip_collaborators.sql`).
 *
 * The same call **changes** a role, because the endpoint upserts: posting an address already on the
 * trip promotes or demotes them. `role` defaults to `viewer`, matching the API's own default, so a
 * caller that does not care gets the weaker one.
 *
 * The 422 for an unregistered address carries a sentence written for a reader, and `withFallback`
 * preserves it: an `ApiClientError` that already has a status is rethrown untouched, so the panel
 * shows *"they need an EasyTrip account"* rather than this function's generic fallback.
 */
const addCollaborator = async (tripId, email, token, role = 'viewer') => {
  try {
    const { data } = await apiClient.post(
      `/auth/trips/${tripId}/collaborators`,
      { email, role },
      authed(token)
    );
    return data?.collaborator ?? null;
  } catch (error) {
    throw withFallback(error, 'Could not add that person to this trip');
  }
};

const removeCollaborator = async (tripId, userId, token) => {
  try {
    await apiClient.delete(`/auth/trips/${tripId}/collaborators/${userId}`, authed(token));
    return true;
  } catch (error) {
    throw withFallback(error, 'Could not remove that person from this trip');
  }
};

// ---------------------------------------------------------------------------
// The read-only share link (`FV-009` stage c)
// ---------------------------------------------------------------------------

const getShare = async (tripId, token) => {
  try {
    const { data } = await apiClient.get(`/auth/trips/${tripId}/share`, authed(token));
    return data ?? null;
  } catch (error) {
    throw withFallback(error, 'Could not load this share link');
  }
};

/** Creates the link, and **rotates it** when one already exists — the same call for both. */
const createShare = async (tripId, token) => {
  try {
    const { data } = await apiClient.post(`/auth/trips/${tripId}/share`, {}, authed(token));
    return data ?? null;
  } catch (error) {
    throw withFallback(error, 'Could not create a share link');
  }
};

const revokeShare = async (tripId, token) => {
  try {
    await apiClient.delete(`/auth/trips/${tripId}/share`, authed(token));
    return true;
  } catch (error) {
    throw withFallback(error, 'Could not revoke this share link');
  }
};

/**
 * The public read. **No token, deliberately** — this is the one call in this file made by somebody
 * who is not signed in, and passing a credential would defeat the purpose of the link.
 */
const getSharedTrip = async (shareToken, options = {}) => {
  try {
    const { data } = await apiClient.get(`/trips/shared/${shareToken}`, options);
    return data?.trip ?? null;
  } catch (error) {
    throw withFallback(error, 'This link is not valid');
  }
};

const tripService = {
  listTrips,
  getTrip,
  getTripFeasibility,
  getTripReplanSuggestion,
  getDayRouteSuggestion,
  getDayRoute,
  createTrip,
  updateTrip,
  deleteTrip,
  addDay,
  deleteDay,
  addItem,
  updateItem,
  deleteItem,
  reorderItems,
  listNotes,
  addNote,
  updateNote,
  deleteNote,
  listChecklist,
  addChecklistItem,
  updateChecklistItem,
  deleteChecklistItem,
  exportCalendar,
  duplicateTrip,
  listCollaborators,
  addCollaborator,
  removeCollaborator,
  getShare,
  createShare,
  revokeShare,
  getSharedTrip
};

export default tripService;
export {
  listTrips,
  getTrip,
  getTripFeasibility,
  getTripReplanSuggestion,
  getDayRouteSuggestion,
  getDayRoute,
  createTrip,
  updateTrip,
  deleteTrip,
  addDay,
  deleteDay,
  addItem,
  updateItem,
  deleteItem,
  reorderItems
};
