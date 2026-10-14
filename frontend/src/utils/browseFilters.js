/**
 * The browse page's filter rules, as pure functions (IMP-070).
 *
 * These lived inside `browse.jsx` as `useMemo` bodies and inline handlers, which made them
 * unreachable from anything except a rendered page: to check that "one theme selected" produced the
 * right query you had to mount 2,600 lines of component. Everything here is a plain function of its
 * arguments, so it can be exercised directly — which is the half of `IMP-070` that actually buys
 * testability, as opposed to the half that just moves markup around.
 *
 * Nothing here touches React, the DOM, or the network. The hook that consumes it
 * (`useBrowseFilters`) owns the state; this module owns the rules.
 */

/**
 * A fresh, empty filter set. Also the shape `getServerSideProps` produces.
 *
 * A **factory**, not a shared constant. A frozen-looking object literal with `themes: []` and
 * `tags: []` inside it is not safe to hand out: `{ ...EMPTY_FILTERS }` is a *shallow* copy, so
 * every caller would share the same two arrays, and one `filters.themes.push(...)` anywhere would
 * silently redefine "empty" for the rest of the page's life. Caught by the unit tests for this
 * module, which is the sort of thing that only becomes findable once the logic is out of the
 * component.
 */
/**
 * What a traveller can ask about step-free access, and what each question means (`FV-029`).
 *
 * The API takes a list of levels; this is the shorter list of *questions* worth offering. Two, not
 * four, and deliberately not a checkbox per level:
 *
 * - **`unknown` is never offered.** Filtering for "nobody has checked" is a data-quality query, not
 *   a travel one, and putting it beside the others would suggest it belongs in the same sentence.
 * - **`no` on its own is not offered either.** It is a real answer and the API can filter on it —
 *   `an admin auditing coverage might` — but "show me the places I cannot get into" is not the
 *   question this control is for.
 *
 * The `levels` arrays are what reach the API, and they are what the filter's honesty rests on:
 * neither includes `unknown`, so neither can return a place nobody has checked.
 */
export const STEP_FREE_CHOICES = {
  any: { label: 'Any', levels: undefined },
  verified: { label: 'Step-free access', levels: ['yes'] },
  partly: { label: 'Step-free, at least partly', levels: ['yes', 'partial'] }
};

export const createEmptyFilters = () => ({
  searchTerm: '',
  location: '',
  district: '',
  state: '',
  themes: [],
  tags: [],
  date: 'any',
  minRating: 0,
  // `FV-029`. A single choice rather than an array, matching `date` rather than `themes`: the API
  // takes a list of levels, but only two combinations of it are a question a traveller asks, and
  // offering four checkboxes would invite the fifth — `unknown` — which is not a filter, it is the
  // absence of one.
  stepFree: 'any'
});

/**
 * Frozen so the mistake above cannot be made through this export either — a stray write throws in
 * strict mode instead of corrupting the default. Use `createEmptyFilters()` to get a writable one.
 */
export const EMPTY_FILTERS = Object.freeze({
  ...createEmptyFilters(),
  themes: Object.freeze([]),
  tags: Object.freeze([])
});

/**
 * Normalise whatever `getServerSideProps` supplied into a complete filter set.
 *
 * Defensive about arrays because the query string can produce a bare string for a single-valued
 * repeated parameter (`?theme=beach`), and a component that does `themes.length` on a string gets
 * a plausible number rather than an error.
 */
export const filtersFromInitial = (initial) => {
  if (!initial) return createEmptyFilters();

  const asArray = (value) =>
    Array.isArray(value)
      ? value
      : value === undefined || value === null || value === ''
        ? []
        : [value];
  const rating = Number(initial.minRating);

  return {
    searchTerm: initial.searchTerm || '',
    location: initial.location || '',
    district: initial.district || '',
    state: initial.state || '',
    themes: asArray(initial.themes),
    tags: asArray(initial.tags),
    date: initial.date || 'any',
    minRating: Number.isFinite(rating) && rating > 0 ? rating : 0,
    stepFree: STEP_FREE_CHOICES[initial.stepFree] ? initial.stepFree : 'any'
  };
};

/**
 * The filter set in the shape the API takes.
 *
 * Empty values become `undefined` rather than being sent as empty strings, because `placesApi`'s
 * query builder drops `undefined` and would otherwise send `location=` — which the server reads as
 * "filter by the empty location" rather than "do not filter by location".
 */
export const buildCriteria = (filters) => ({
  searchTerm: filters.searchTerm || undefined,
  location: filters.location || undefined,
  district: filters.district || undefined,
  state: filters.state || undefined,
  themes: filters.themes.length ? filters.themes : undefined,
  tags: filters.tags.length ? filters.tags : undefined,
  minRating: filters.minRating > 0 ? filters.minRating : undefined,
  date: filters.date !== 'any' ? filters.date : undefined,
  // The levels the choice expands to. `undefined` for 'any', so the parameter is not sent at all —
  // sending every level would be a filter that excludes only `unknown`, which is a different and
  // much stronger claim than "no preference".
  stepFree: STEP_FREE_CHOICES[filters.stepFree]?.levels
});

/** True when anything is filtering the catalogue. */
export const hasActiveFilters = (filters) => {
  const criteria = buildCriteria(filters);
  return Object.keys(criteria).some((key) => criteria[key] !== undefined);
};

/**
 * How many filters are active, for the badge.
 *
 * Themes and tags count individually — three selected themes is three filters to the person
 * looking at the badge, not one.
 */
export const countActiveFilters = (filters) =>
  (filters.searchTerm ? 1 : 0) +
  (filters.location ? 1 : 0) +
  (filters.district ? 1 : 0) +
  (filters.state ? 1 : 0) +
  filters.themes.length +
  filters.tags.length +
  (filters.date !== 'any' ? 1 : 0) +
  (filters.minRating > 0 ? 1 : 0) +
  (filters.stepFree !== 'any' ? 1 : 0);

/**
 * The query string that describes this filter set, without the leading `?`.
 *
 * The parameter names are the ones `getServerSideProps` reads, so a URL produced here and pasted
 * into a new tab server-renders the same result set. That round trip is the contract; the names are
 * deliberately short (`q`, `theme`, `tag`) because these end up in shared links.
 *
 * Arrays are *repeated* here (`?theme=a&theme=b`) rather than JSON-encoded — the opposite of what
 * `placesApi.buildQuery` does for the API call. That is intentional: this string is read back by
 * `getServerSideProps` via Next's query parsing, which turns repeated keys into an array, whereas
 * the API's validator wants the JSON form.
 */
export const buildQueryString = (filters) => {
  const params = new URLSearchParams();

  if (filters.searchTerm) params.set('q', filters.searchTerm);
  if (filters.location) params.set('location', filters.location);
  if (filters.district) params.set('district', filters.district);
  if (filters.state) params.set('state', filters.state);
  if (filters.date !== 'any') params.set('date', filters.date);
  if (filters.minRating > 0) params.set('rating', String(filters.minRating));
  if (filters.stepFree !== 'any') params.set('access', filters.stepFree);
  filters.themes.forEach((theme) => params.append('theme', theme));
  filters.tags.forEach((tag) => params.append('tag', tag));

  return params.toString();
};

/** Add or remove a value in one of the multi-select filters. */
export const toggleInList = (list, value) =>
  list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

/**
 * Recent searches: newest first, no duplicates, capped.
 *
 * Pure so the cap and the de-duplication can be checked without a browser — this ran in three
 * places in `browse.jsx` (the debounced setter, the suggestion handler, and the initial read) with
 * the `.slice(0, 5)` repeated each time.
 */
export const RECENT_SEARCH_LIMIT = 5;

export const addRecentSearch = (recent, term) => {
  const trimmed = (term || '').trim();
  if (!trimmed) return recent;
  return [trimmed, ...recent.filter((item) => item !== trimmed)].slice(0, RECENT_SEARCH_LIMIT);
};
