import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  buildCriteria,
  buildQueryString,
  countActiveFilters,
  filtersFromInitial,
  hasActiveFilters as hasActiveFiltersFn,
  toggleInList,
  createEmptyFilters
} from '../utils/browseFilters';

/**
 * Filter state for the browse page (IMP-070).
 *
 * Was eight `useState` calls, two `useMemo`s, a URL-sync effect and four handlers, all inline in a
 * 2,600-line component. The rules moved to `utils/browseFilters.js` — pure and directly testable —
 * and this hook is the thin React layer that holds the state and runs the effect.
 *
 * The filters are one object rather than eight separate pieces of state, which is what makes
 * `criteria`, the query string and the active count derivable rather than separately maintained.
 * The previous version recomputed the badge count from the same eight variables in a `useMemo` with
 * an eight-entry dependency array, which is the shape a bug hides in.
 */
export const useBrowseFilters = (initialFilters) => {
  const [filters, setFilters] = useState(() => filtersFromInitial(initialFilters));

  /** The API query for the current filters. */
  const criteria = useMemo(() => buildCriteria(filters), [filters]);

  /**
   * A stable dependency for the fetching effects. `criteria` is rebuilt whenever any filter's
   * identity changes — including the array literals — so depending on the object directly would
   * refetch on renders where nothing actually changed.
   */
  const criteriaKey = useMemo(() => JSON.stringify(criteria), [criteria]);

  const activeFilterCount = useMemo(() => countActiveFilters(filters), [filters]);
  const hasActiveFilters = useMemo(() => hasActiveFiltersFn(filters), [filters]);

  /**
   * Keep the URL in step with the filters, without navigating.
   *
   * Separate from fetching because it is presentation: the address bar should describe the current
   * view whether or not the request behind it succeeded. `replaceState` rather than `push` so the
   * back button leaves the page instead of walking back through every filter toggle.
   */
  useEffect(() => {
    const query = buildQueryString(filters);
    window.history.replaceState(
      {},
      '',
      query ? `${window.location.pathname}?${query}` : window.location.pathname
    );
  }, [filters]);

  const setFilter = useCallback((key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  const toggleTheme = useCallback((themeId) => {
    setFilters((prev) => ({ ...prev, themes: toggleInList(prev.themes, themeId) }));
  }, []);

  const toggleTag = useCallback((tag) => {
    setFilters((prev) => ({ ...prev, tags: toggleInList(prev.tags, tag) }));
  }, []);

  /**
   * Reset every filter.
   *
   * The URL is cleared by the effect above rather than here — a second `replaceState` in this
   * function would race it. The flash-highlight is left to the caller: it is a DOM effect on a
   * specific element, and a hook reaching for `getElementById` is a hook that cannot be tested.
   */
  const clearAllFilters = useCallback(() => {
    setFilters(createEmptyFilters());
  }, []);

  return {
    filters,
    setFilter,
    setFilters,
    toggleTheme,
    toggleTag,
    clearAllFilters,
    criteria,
    criteriaKey,
    activeFilterCount,
    hasActiveFilters
  };
};

export default useBrowseFilters;
