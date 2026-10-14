import { useEffect, useState } from 'react';

import { fetchPlaceSuggestions } from '../services/placesApi';

/**
 * Typeahead suggestions for the browse search box (`IMP-112`).
 *
 * **Not debounced here, deliberately.** `browse.jsx` already debounces the input by 300ms before it
 * reaches `filters.searchTerm`, and that is the value passed in. A second debounce on top would add
 * its own delay to a control whose whole job is to feel immediate, and would mean two timers to
 * keep in step when either is tuned.
 *
 * **A failure is silence, not an error.** A suggestion list is an accelerator on top of a search
 * that works without it; surfacing "could not load suggestions" under the box would be a louder
 * failure than the feature is worth. The results grid reports its own errors.
 */
export const usePlaceSuggestions = (term) => {
  const [suggestions, setSuggestions] = useState([]);

  useEffect(() => {
    const trimmed = (term || '').trim();

    // An empty box has no suggestions — and asking the server is a round trip whose answer is
    // already known (the endpoint returns `[]`).
    if (!trimmed) {
      setSuggestions([]);
      return undefined;
    }

    let cancelled = false;
    const controller = new AbortController();

    fetchPlaceSuggestions(trimmed, { signal: controller.signal })
      .then((response) => {
        // Both guards are needed. `cancelled` covers the render after unmount; aborting covers the
        // in-flight request. Without the abort, two overlapping requests can resolve out of order
        // and the dropdown ends up showing suggestions for a prefix the user has already passed.
        if (!cancelled) setSuggestions(response.data || []);
      })
      .catch(() => {
        if (!cancelled) setSuggestions([]);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [term]);

  return suggestions;
};

export default usePlaceSuggestions;
