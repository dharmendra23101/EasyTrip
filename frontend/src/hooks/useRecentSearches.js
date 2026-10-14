import { useCallback, useEffect, useState } from 'react';

import { addRecentSearch, RECENT_SEARCH_LIMIT } from '../utils/browseFilters';

const STORAGE_KEY = 'recentSearches';

/**
 * Per-browser search history (IMP-070).
 *
 * Extracted from `browse.jsx`, where the same `[term, ...prev.filter(...)].slice(0, 5)` expression
 * appeared in three places — the debounced setter, the suggestion handler, and the initial read —
 * with the cap repeated each time. The rule now lives once in `utils/browseFilters.addRecentSearch`
 * and this hook only deals with storage.
 *
 * Reads happen after hydration, never during render: `localStorage` does not exist on the server,
 * and seeding state from it would produce different markup on the two sides.
 */
export const useRecentSearches = () => {
  const [recentSearches, setRecentSearches] = useState([]);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) setRecentSearches(parsed.slice(0, RECENT_SEARCH_LIMIT));
    } catch (e) {
      // A corrupt entry should cost the history, not the page.
      console.warn('Failed to parse recent searches:', e);
    }
  }, []);

  /** Persist and update together, so the two can never disagree. */
  const persist = useCallback((next) => {
    setRecentSearches(next);
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    }
  }, []);

  const remember = useCallback((term) => {
    setRecentSearches((prev) => {
      const next = addRecentSearch(prev, term);
      // Unchanged means the term was blank or already first — no write, no re-render churn.
      if (next === prev) return prev;
      if (typeof window !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      }
      return next;
    });
  }, []);

  const removeSearch = useCallback(
    (term) => {
      persist(recentSearches.filter((item) => item !== term));
    },
    [persist, recentSearches]
  );

  const clearAll = useCallback(() => {
    setRecentSearches([]);
    if (typeof window !== 'undefined') localStorage.removeItem(STORAGE_KEY);
  }, []);

  return { recentSearches, remember, removeSearch, clearAll };
};

export default useRecentSearches;
