import { useState, useEffect, useCallback } from 'react';

import { useAuth } from '../context/AuthContext';
import tripService from '../services/tripService';

/**
 * "My Trips" — the list (`IMP-109`).
 *
 * Two error slots, as `useMyReviews` learned to have: a failed **load** means there is no list, so
 * the page becomes the error; a failed **create or delete** means the list is fine and one action
 * did not happen. Collapsing them hides the very trips an action failed to change.
 */
export function useTrips() {
  const { currentUser, loading: authLoading, getIdToken } = useAuth();

  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getIdToken();
      setTrips(await tripService.listTrips(token));
    } catch (loadError) {
      setError(loadError);
    } finally {
      setLoading(false);
      setReady(true);
    }
  }, [getIdToken]);

  useEffect(() => {
    if (authLoading) return;
    if (!currentUser) {
      setTrips([]);
      setReady(true);
      return;
    }
    refresh();
  }, [authLoading, currentUser, refresh]);

  /** Create, then reload — the server computes `day_count` and the day rows, so a synthesised
   *  card would show a trip with zero days until the next refresh. */
  const create = useCallback(
    async (trip) => {
      setActionError(null);
      try {
        const token = await getIdToken();
        const created = await tripService.createTrip(trip, token);
        await refresh();
        return created;
      } catch (createError) {
        setActionError(createError);
        return null;
      }
    },
    [getIdToken, refresh]
  );

  /** Delete is **not** optimistic: a trip is somebody's plan, and it cannot be undone. */
  const remove = useCallback(
    async (tripId) => {
      setActionError(null);
      try {
        const token = await getIdToken();
        await tripService.deleteTrip(tripId, token);
        setTrips((current) => current.filter((trip) => trip.id !== tripId));
        return true;
      } catch (deleteError) {
        setActionError(deleteError);
        return false;
      }
    },
    [getIdToken]
  );

  return {
    trips,
    loading,
    error,
    actionError,
    refresh,
    create,
    remove,
    ready: ready && !authLoading
  };
}
