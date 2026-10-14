import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchPlaces, PLACES_PAGE_SIZE } from '../services/placesApi';

/**
 * The browse page's result set: fetching, pagination and refresh (IMP-070).
 *
 * Extracted from `browse.jsx` unchanged in behaviour. The comments below record why each piece is
 * shaped the way it is — several of them are the residue of bugs fixed in Phase 4, and losing them
 * during the extraction would invite the same bugs back.
 *
 * @param {Object}  args
 * @param {Object}  args.criteria     - the API filter set (from `useBrowseFilters`)
 * @param {String}  args.criteriaKey  - serialised `criteria`; the stable effect dependency
 * @param {String}  args.sortOrder
 * @param {Object}  args.initialResults - the server-rendered first page, if there was one
 * @param {String}  args.initialError
 * @param {Boolean} args.inView       - infinite-scroll sentinel visibility
 */
export const useBrowsePlaces = ({
  criteria,
  criteriaKey,
  sortOrder,
  initialResults,
  initialError,
  inView
}) => {
  // One list, not three. There used to be `places`, `filteredPlaces` and `displayedPlaces` kept in
  // step by a chain of effects, one of which compared the whole dataset with `JSON.stringify` on
  // every pass. Filtering, sorting and paging all happen in the query now.
  const [places, setPlaces] = useState(initialResults?.data || []);
  const [total, setTotal] = useState(initialResults?.pagination?.total || 0);
  const [hasMore, setHasMore] = useState(initialResults?.pagination?.hasMore || false);

  const [loading, setLoading] = useState(!initialResults);
  const [initialLoading, setInitialLoading] = useState(!initialResults);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(initialError || null);

  // Catalogue statistics, computed by the server alongside the result count. These were derived in
  // the browser by reducing over every place the API returned, which only worked while the browser
  // held the entire catalogue — averaging a page of twelve under a label reading "Average Rating"
  // is a wrong number, not a stale one.
  const [stats, setStats] = useState(() => ({
    totalPlaces: initialResults?.stats?.total ?? 0,
    avgRating: initialResults?.stats?.avgRating ?? 0,
    topLocation: initialResults?.stats?.topLocation ?? '',
    locationCount: initialResults?.stats?.topLocationCount ?? 0
  }));

  // Client-only: rendering a server timestamp would mismatch the client's locale-formatted one and
  // trip hydration.
  const [lastUpdated, setLastUpdated] = useState(null);

  const skipNextFetchRef = useRef(Boolean(initialResults));

  /**
   * Fetch the first page whenever the query changes.
   *
   * The client-side filter that used to back this up is gone rather than retained as a fallback: it
   * could only ever see the page in memory, so after pagination it would answer a whole-catalogue
   * question with whatever twelve rows happened to be loaded — confidently, and wrongly.
   */
  useEffect(() => {
    // The server already rendered page one for these criteria; refetching on mount would throw
    // away the payload that was just embedded in the HTML.
    if (skipNextFetchRef.current) {
      skipNextFetchRef.current = false;
      setLastUpdated(new Date());
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);

    // Debounced so that typing in the search box issues one request, not one per keystroke.
    const timer = setTimeout(async () => {
      try {
        const response = await fetchPlaces(
          { ...criteria, sort: sortOrder, limit: PLACES_PAGE_SIZE, offset: 0 },
          { signal: controller.signal }
        );
        if (cancelled) return;

        setPlaces(response.data);
        setTotal(response.pagination.total);
        setHasMore(response.pagination.hasMore);
        // `stats` is deliberately not requested here: it describes the catalogue, not the query,
        // so it does not change when a filter does.
        setError(null);
        setLastUpdated(new Date());
      } catch (err) {
        // An abort is this effect superseding itself, not a failure to report.
        if (cancelled || err.name === 'AbortError') return;
        console.error('Failed to load places:', err);
        setError('Failed to load places. Please try again.');
      } finally {
        if (!cancelled) {
          setLoading(false);
          setInitialLoading(false);
        }
      }
    }, 250);

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
    // criteriaKey IS criteria, serialised. Depending on the object would refetch on every render,
    // which is exactly what the key exists to prevent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [criteriaKey, sortOrder]);

  /**
   * Append the next page. Offsets come from how many rows are already held rather than a page
   * counter, so a short page or a concurrent insert cannot desynchronise the two.
   */
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;

    setLoadingMore(true);
    try {
      const response = await fetchPlaces({
        ...criteria,
        sort: sortOrder,
        limit: PLACES_PAGE_SIZE,
        offset: places.length
      });
      setPlaces((prev) => [...prev, ...response.data]);
      setTotal(response.pagination.total);
      setHasMore(response.pagination.hasMore);
    } catch (err) {
      console.error('Failed to load more places:', err);
      setHasMore(false);
      setError('Could not load more places.');
    } finally {
      setLoadingMore(false);
    }
  }, [criteria, sortOrder, places.length, hasMore, loadingMore]);

  /**
   * Infinite scroll.
   *
   * Each page is a real request, so the guard matters: this effect re-runs every time `places`
   * grows, and `inView` only clears asynchronously when the observer next fires. Without the ref,
   * one sentinel sighting would fan out into a burst of concurrent requests for the whole
   * catalogue. One page per in-view episode; the explicit "Load More" button covers the case where
   * the appended page is too short to push the sentinel back out of view.
   */
  const advancedForCurrentViewRef = useRef(false);

  useEffect(() => {
    if (!inView) {
      advancedForCurrentViewRef.current = false;
      return;
    }

    if (advancedForCurrentViewRef.current) return;
    if (!hasMore || loadingMore) return;

    advancedForCurrentViewRef.current = true;
    loadMore();
  }, [inView, hasMore, loadingMore, loadMore]);

  /**
   * Re-run the current query from page one.
   *
   * It has to respect the active filters — an earlier version fetched the unfiltered catalogue and
   * then only applied it when no filters were set, so pressing refresh with a filter active
   * downloaded everything and displayed none of it.
   */
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetchPlaces({
        ...criteria,
        sort: sortOrder,
        limit: PLACES_PAGE_SIZE,
        offset: 0,
        withStats: true
      });
      setPlaces(response.data);
      setTotal(response.pagination.total);
      setHasMore(response.pagination.hasMore);
      if (response.stats) {
        setStats({
          totalPlaces: response.stats.total,
          avgRating: response.stats.avgRating ?? 0,
          topLocation: response.stats.topLocation || '',
          locationCount: response.stats.topLocationCount
        });
      }
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      console.error('Error refreshing places:', err);
      setError('Failed to refresh. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [criteria, sortOrder]);

  return {
    places,
    total,
    hasMore,
    loading,
    initialLoading,
    loadingMore,
    error,
    stats,
    lastUpdated,
    loadMore,
    refresh,
    setError
  };
};

export default useBrowsePlaces;
