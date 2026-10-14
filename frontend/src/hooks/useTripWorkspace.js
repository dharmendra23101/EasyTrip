import { useState, useEffect, useCallback } from 'react';

import { useAuth } from '../context/AuthContext';
import tripService from '../services/tripService';

/**
 * One trip's workspace — days, items, and the operations on them (`IMP-109`, `ADR-031`).
 *
 * **Everything reloads from the server after a write.** That is a deliberate choice over patching
 * local state: a day delete renumbers every later day server-side, and an item add computes its
 * position there too. Mirroring that arithmetic in the client would be a second implementation of
 * rules the database already owns — and the first time the two disagreed, the screen would be
 * confidently wrong.
 *
 * The exception is `reorder`, which *is* optimistic, because a drag that snaps back for 300ms is
 * the one interaction where latency is unmistakably a bug. It reverts on failure.
 */
export function useTripWorkspace(tripId) {
  const { currentUser, loading: authLoading, getIdToken } = useAuth();

  const [trip, setTrip] = useState(null);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  // The feasibility report (`FV-025`). Held separately from `trip` because it is *derived from* the
  // trip rather than part of it, and because the invariant below only makes sense if the two can be
  // out of step long enough to notice.
  const [feasibility, setFeasibility] = useState(null);
  const [checking, setChecking] = useState(false);
  const [feasibilityError, setFeasibilityError] = useState(null);

  // The replan (`FV-027` stage b). Held on exactly the same terms as the report above, and cleared
  // by the same writes, because it is a claim about a plan rather than part of one.
  const [replan, setReplan] = useState(null);
  const [replanning, setReplanning] = useState(false);
  const [replanError, setReplanError] = useState(null);

  // Route suggestions, keyed by day id (`FV-026`). A map rather than one value because each day is
  // asked about separately, and a second day's answer must not replace the first's.
  const [routeSuggestions, setRouteSuggestions] = useState({});

  // Drawn routes, keyed by day id (`FV-026` stage c). Same shape and the same reason as the map
  // above — and kept apart from it because they are different claims about a day. A suggestion says
  // *this order could be shorter*; a route says *this is the order you have*. One is a proposal that
  // goes stale the moment the day changes; so does the other, which is why both are cleared by the
  // same writes.
  const [dayRoutes, setDayRoutes] = useState({});
  const [drawingDay, setDrawingDay] = useState(null);

  const refresh = useCallback(async () => {
    if (!tripId) return null;
    setError(null);
    try {
      const token = await getIdToken();
      const loaded = await tripService.getTrip(tripId, token);
      setTrip(loaded);
      return loaded;
    } catch (loadError) {
      setError(loadError);
      return null;
    } finally {
      setReady(true);
    }
  }, [tripId, getIdToken]);

  useEffect(() => {
    if (authLoading || !tripId) return;
    if (!currentUser) {
      setReady(true);
      return;
    }
    refresh();
  }, [authLoading, currentUser, tripId, refresh]);

  /** Run a write, then reload. `busy` disables the controls so a double-click cannot double-write. */
  const run = useCallback(
    async (operation) => {
      setBusy(true);
      setActionError(null);
      try {
        const token = await getIdToken();
        await operation(token);
        await refresh();
        // A report describes the plan it was computed from. The moment that plan changes, a
        // verdict still on screen is a claim about a trip that no longer exists — and the
        // dangerous direction is the reassuring one: "everything checks out" sitting above a day
        // the user has just broken. Cleared rather than recomputed, so the panel says nothing
        // instead of saying something stale.
        setFeasibility(null);
        setFeasibilityError(null);
        // Same reasoning, same danger: a suggestion computed from the old order is a set of moves
        // that no longer means what it says once the day has changed under it.
        setRouteSuggestions({});
        // And the drawing, which is the most literal case of it: a line through the stops in their
        // old order, still on screen beside the new order, is a picture of a day that no longer
        // exists. A wrong map is read as fact faster than a wrong sentence is.
        setDayRoutes({});
        // And the replan, for the sharpest version of it: applying one proposal changes the plan
        // every *other* proposal was computed against, so the rest of the list stops being true the
        // instant the first one is accepted. Clearing here is what makes that automatic — applying
        // a proposal is an ordinary `updateItem`, so it comes through this wrapper like any edit.
        setReplan(null);
        setReplanError(null);
        return true;
      } catch (writeError) {
        setActionError(writeError);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [getIdToken, refresh]
  );

  /**
   * Ask the server whether this plan can be executed (`FV-025`).
   *
   * On demand, not on every load. The engine is a **report, not a gate** — the item's own kill
   * criteria warn against validation that makes editing feel broken — and the workspace already
   * refetches the whole trip after every write, so checking automatically would put a second
   * request on the critical path of every drag.
   */
  const checkFeasibility = useCallback(async () => {
    if (!tripId) return null;
    setChecking(true);
    setFeasibilityError(null);
    try {
      const token = await getIdToken();
      const report = await tripService.getTripFeasibility(tripId, token);
      setFeasibility(report);
      return report;
    } catch (checkError) {
      // The report is cleared, not kept: a failed check must not leave the previous verdict on
      // screen beside an error message, which reads as "still fine, but also broken".
      setFeasibility(null);
      setFeasibilityError(checkError);
      return null;
    } finally {
      setChecking(false);
    }
  }, [tripId, getIdToken]);

  /**
   * Ask what to change when the weather disagrees with the plan (`FV-027` stage b).
   *
   * Stored, never acted on. Applying is `updateItem(item, { trip_day_id })` — a second, deliberate
   * press through the endpoint every other edit uses, so accepting a proposal is the same kind of
   * event as dragging the item yourself, and is undone the same way.
   */
  const suggestReplan = useCallback(async () => {
    if (!tripId) return null;
    setReplanning(true);
    setReplanError(null);
    try {
      const token = await getIdToken();
      const suggestion = await tripService.getTripReplanSuggestion(tripId, token);
      setReplan(suggestion);
      return suggestion;
    } catch (suggestError) {
      // Cleared rather than kept, for the reason the report gives: a stale list beside an error
      // reads as "these are still the right moves, and also something is broken".
      setReplan(null);
      setReplanError(suggestError);
      return null;
    } finally {
      setReplanning(false);
    }
  }, [tripId, getIdToken]);

  /**
   * Ask whether one day could be ordered better (`FV-026`).
   *
   * The answer is stored, not acted on. `applyRouteSuggestion` is a separate, deliberate step,
   * because the item's kill criteria stop at *"optimisation starts overriding what the user
   * deliberately chose"* — and a suggestion that applies itself is exactly that.
   */
  const suggestRoute = useCallback(
    async (dayId) => {
      try {
        const token = await getIdToken();
        const suggestion = await tripService.getDayRouteSuggestion(tripId, dayId, token);
        setRouteSuggestions((current) => ({ ...current, [dayId]: suggestion }));
        return suggestion;
      } catch (suggestError) {
        setActionError(suggestError);
        // Cleared rather than kept: a stale suggestion beside an error reads as "still valid".
        setRouteSuggestions((current) => ({ ...current, [dayId]: null }));
        return null;
      }
    },
    [tripId, getIdToken]
  );

  /**
   * Fetch one day as it would be drawn (`FV-026` stage c).
   *
   * On demand and per day, for the reason the endpoint is shaped that way: drawing every day of a
   * six-day trip on page load would put six routing lookups behind a panel the reader may never
   * open. The user asks for the day they are looking at.
   *
   * A refusal is **stored**, not discarded. `{ drawable: false, reason, detail }` is an answer — the
   * day is empty, or nothing on it has coordinates — and the panel renders the sentence. Only a
   * thrown error clears the entry, so "there is nothing to draw" and "the request failed" stay
   * distinguishable on screen.
   */
  const drawDay = useCallback(
    async (dayId) => {
      setDrawingDay(dayId);
      try {
        const token = await getIdToken();
        const route = await tripService.getDayRoute(tripId, dayId, token);
        setDayRoutes((current) => ({ ...current, [dayId]: route }));
        return route;
      } catch (drawError) {
        setActionError(drawError);
        setDayRoutes((current) => ({ ...current, [dayId]: null }));
        return null;
      } finally {
        setDrawingDay(null);
      }
    },
    [tripId, getIdToken]
  );

  /** Apply a suggestion the user has seen, through the reorder path that already exists. */
  const applyRouteSuggestion = useCallback(
    (dayId) => {
      const suggestion = routeSuggestions[dayId];
      if (!suggestion?.applicable) return Promise.resolve(false);
      return run((token) => tripService.reorderItems(tripId, dayId, suggestion.item_ids, token));
    },
    [routeSuggestions, run, tripId]
  );

  const addDay = useCallback(
    () => run((token) => tripService.addDay(tripId, token)),
    [run, tripId]
  );

  const removeDay = useCallback(
    (dayId) => run((token) => tripService.deleteDay(tripId, dayId, token)),
    [run, tripId]
  );

  const addItem = useCallback(
    (dayId, item) => run((token) => tripService.addItem(tripId, dayId, item, token)),
    [run, tripId]
  );

  const updateItem = useCallback(
    (itemId, patch) => run((token) => tripService.updateItem(tripId, itemId, patch, token)),
    [run, tripId]
  );

  const removeItem = useCallback(
    (itemId) => run((token) => tripService.deleteItem(tripId, itemId, token)),
    [run, tripId]
  );

  const updateTrip = useCallback(
    (patch) => run((token) => tripService.updateTrip(tripId, patch, token)),
    [run, tripId]
  );

  /**
   * Move an item up or down within its day.
   *
   * Optimistic, and it sends the **whole** resulting order — which is what the server requires. A
   * "move item X by one" API would make the server reconstruct the rest, which is the same
   * information arriving less reliably.
   */
  const moveItem = useCallback(
    async (dayId, itemId, direction) => {
      const day = trip?.days?.find((candidate) => candidate.id === dayId);
      if (!day) return false;

      const ids = day.items.map((item) => item.id);
      const from = ids.indexOf(itemId);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= ids.length) return false;

      const reordered = [...ids];
      [reordered[from], reordered[to]] = [reordered[to], reordered[from]];

      const previous = trip;
      setTrip((current) => ({
        ...current,
        days: current.days.map((candidate) =>
          candidate.id === dayId
            ? {
                ...candidate,
                items: reordered.map((id) => candidate.items.find((item) => item.id === id))
              }
            : candidate
        )
      }));

      try {
        const token = await getIdToken();
        await tripService.reorderItems(tripId, dayId, reordered, token);
        return true;
      } catch (reorderError) {
        // Snap back to what the server still holds. Leaving the optimistic order on screen would
        // show an arrangement that does not exist.
        setTrip(previous);
        setActionError(reorderError);
        return false;
      }
    },
    [trip, tripId, getIdToken]
  );

  return {
    trip,
    error,
    actionError,
    busy,
    ready: ready && !authLoading,
    refresh,
    feasibility,
    checking,
    feasibilityError,
    replan,
    replanning,
    replanError,
    suggestReplan,
    checkFeasibility,
    routeSuggestions,
    suggestRoute,
    applyRouteSuggestion,
    dayRoutes,
    drawingDay,
    drawDay,
    updateTrip,
    addDay,
    removeDay,
    addItem,
    updateItem,
    removeItem,
    moveItem
  };
}
