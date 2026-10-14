import {
  createEmptyFilters,
  EMPTY_FILTERS,
  filtersFromInitial,
  buildCriteria,
  hasActiveFilters,
  countActiveFilters,
  buildQueryString,
  toggleInList,
  addRecentSearch,
  RECENT_SEARCH_LIMIT
} from '../src/utils/browseFilters';

/**
 * Browse filter rules (IMP-070 / IMP-011).
 *
 * These were `useMemo` bodies inside a 2,600-line page: checking that one selected theme produced
 * the right query meant mounting the whole component. Extracting them is the half of `IMP-070` that
 * actually bought testability, and this file is the part that collects the return.
 */

describe('empty filters are not shared by reference', () => {
  // The real defect this guards: `{ ...EMPTY_FILTERS }` is a SHALLOW copy, so every caller shared
  // the same `themes` and `tags` arrays. A single in-place `push` anywhere would have redefined
  // "empty" for the rest of the page's life — a bug that only appears after two interactions.
  test('each call returns fresh arrays', () => {
    const a = createEmptyFilters();
    const b = createEmptyFilters();
    expect(a.themes).not.toBe(b.themes);
    expect(a.tags).not.toBe(b.tags);
  });

  test('mutating one does not affect the next', () => {
    const a = createEmptyFilters();
    a.themes.push('beach');
    expect(createEmptyFilters().themes).toEqual([]);
  });

  test('the exported constant is frozen, arrays included', () => {
    expect(Object.isFrozen(EMPTY_FILTERS)).toBe(true);
    expect(Object.isFrozen(EMPTY_FILTERS.themes)).toBe(true);
    expect(Object.isFrozen(EMPTY_FILTERS.tags)).toBe(true);
  });
});

describe('filtersFromInitial normalises what the query string produced', () => {
  test('a bare string becomes a one-element array', () => {
    // `?theme=beach` yields a string, not an array. A component doing `themes.length` on 'beach'
    // gets 5 — a plausible number, silently wrong, and no error anywhere.
    expect(filtersFromInitial({ themes: 'beach' }).themes).toEqual(['beach']);
    expect(filtersFromInitial({ tags: 'unesco' }).tags).toEqual(['unesco']);
  });

  test('an array is preserved', () => {
    expect(filtersFromInitial({ themes: ['beach', 'heritage'] }).themes).toEqual([
      'beach',
      'heritage'
    ]);
  });

  test('absent, null and empty-string collections become []', () => {
    for (const value of [undefined, null, '']) {
      expect(filtersFromInitial({ themes: value }).themes).toEqual([]);
    }
  });

  test('no input yields a complete, empty filter set', () => {
    expect(filtersFromInitial(undefined)).toEqual(createEmptyFilters());
    expect(filtersFromInitial(null)).toEqual(createEmptyFilters());
  });

  test('a non-numeric or negative rating collapses to 0', () => {
    expect(filtersFromInitial({ minRating: 'abc' }).minRating).toBe(0);
    expect(filtersFromInitial({ minRating: -3 }).minRating).toBe(0);
    expect(filtersFromInitial({ minRating: '4' }).minRating).toBe(4);
  });
});

describe('buildCriteria omits rather than sends empty', () => {
  test('empty values become undefined, never empty strings', () => {
    // `location=''` reads to the server as "filter by the empty location" and returns nothing.
    // `undefined` is dropped by the query builder, which is "do not filter".
    const criteria = buildCriteria(createEmptyFilters());
    for (const value of Object.values(criteria)) {
      expect(value).toBeUndefined();
    }
    expect(Object.values(criteria)).not.toContain('');
  });

  test("date 'any' is not a filter", () => {
    expect(buildCriteria({ ...createEmptyFilters(), date: 'any' }).date).toBeUndefined();
    expect(buildCriteria({ ...createEmptyFilters(), date: 'summer' }).date).toBe('summer');
  });

  test('minRating 0 is not a filter', () => {
    expect(buildCriteria({ ...createEmptyFilters(), minRating: 0 }).minRating).toBeUndefined();
    expect(buildCriteria({ ...createEmptyFilters(), minRating: 4 }).minRating).toBe(4);
  });

  test('empty collections are omitted', () => {
    expect(buildCriteria({ ...createEmptyFilters(), themes: [] }).themes).toBeUndefined();
    expect(buildCriteria({ ...createEmptyFilters(), themes: ['beach'] }).themes).toEqual(['beach']);
  });
});

describe('hasActiveFilters is a FUNCTION returning a boolean', () => {
  // It once changed from a function to a boolean without its call sites following. `next build`
  // did not catch it because /browse is server-rendered and never prerendered at build time.
  test('it is callable, not a value', () => {
    expect(typeof hasActiveFilters).toBe('function');
  });

  test('false when nothing is set, true for any single filter', () => {
    expect(hasActiveFilters(createEmptyFilters())).toBe(false);
    expect(hasActiveFilters({ ...createEmptyFilters(), searchTerm: 'hampi' })).toBe(true);
    expect(hasActiveFilters({ ...createEmptyFilters(), themes: ['beach'] })).toBe(true);
    expect(hasActiveFilters({ ...createEmptyFilters(), minRating: 4 })).toBe(true);
  });
});

describe('countActiveFilters counts collections individually', () => {
  test('three themes is three filters, not one', () => {
    // The badge shows this number; collapsing a collection to 1 would under-report what is on.
    expect(countActiveFilters({ ...createEmptyFilters(), themes: ['a', 'b', 'c'] })).toBe(3);
  });

  test('nothing set is 0', () => {
    expect(countActiveFilters(createEmptyFilters())).toBe(0);
  });

  test('mixed filters add up', () => {
    expect(
      countActiveFilters({
        ...createEmptyFilters(),
        searchTerm: 'hampi',
        themes: ['heritage'],
        tags: ['unesco', 'ruins'],
        minRating: 4
      })
    ).toBe(5);
  });

  test('agrees with hasActiveFilters', () => {
    const cases = [
      createEmptyFilters(),
      { ...createEmptyFilters(), searchTerm: 'x' },
      { ...createEmptyFilters(), tags: ['a'] }
    ];
    for (const filters of cases) {
      expect(countActiveFilters(filters) > 0).toBe(hasActiveFilters(filters));
    }
  });
});

describe('the shared-link round trip — the contract that makes a pasted URL work', () => {
  /**
   * Mirrors `browse.jsx`'s `getServerSideProps` exactly: it reads `q`, `theme`, `tag`, `rating`.
   * If `buildQueryString` ever emitted different names, a shared link would silently server-render
   * an unfiltered page — no error, no warning, just the wrong results.
   */
  const parseAsServerWould = (queryString) => {
    const params = new URLSearchParams(queryString);
    return filtersFromInitial({
      searchTerm: params.get('q') || '',
      location: params.get('location') || '',
      district: params.get('district') || '',
      state: params.get('state') || '',
      themes: params.getAll('theme'),
      tags: params.getAll('tag'),
      date: params.get('date') || 'any',
      minRating: Number.parseInt(params.get('rating'), 10) || 0,
      stepFree: params.get('access') || 'any'
    });
  };

  test('a full filter set survives the trip unchanged', () => {
    const filters = {
      searchTerm: 'hampi',
      location: 'Hampi',
      district: 'Ballari',
      state: 'Karnataka',
      themes: ['heritage', 'ruins'],
      tags: ['unesco'],
      date: 'winter',
      minRating: 4,
      // A real value rather than the default, so the trip is genuinely exercised for this filter.
      // The fixture failing when `FV-029` added `stepFree` is the test working: it asserts the trip
      // is lossless, and a filter missing from the fixture is a filter nobody proved survives.
      stepFree: 'partly'
    };

    expect(parseAsServerWould(buildQueryString(filters))).toEqual(filters);
    // And the criteria the API receives are identical on both sides of the trip.
    expect(buildCriteria(parseAsServerWould(buildQueryString(filters)))).toEqual(
      buildCriteria(filters)
    );
  });

  test('arrays are REPEATED, not JSON-encoded', () => {
    // Deliberately the opposite of `placesApi.buildQuery`, which JSON-encodes for the API's
    // validator. Two consumers, two conventions — so this asserts which one this function is.
    const qs = buildQueryString({ ...createEmptyFilters(), themes: ['a', 'b'] });
    expect(qs).toBe('theme=a&theme=b');
    expect(qs).not.toContain('[');
  });

  test('an empty filter set produces an empty query string', () => {
    expect(buildQueryString(createEmptyFilters())).toBe('');
  });

  test('values needing encoding survive', () => {
    const filters = {
      ...createEmptyFilters(),
      searchTerm: 'hampi & goa',
      location: 'Coorg/Madikeri'
    };
    expect(parseAsServerWould(buildQueryString(filters))).toEqual(filters);
  });
});

describe('toggleInList', () => {
  test('adds when absent, removes when present', () => {
    expect(toggleInList(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleInList(['a', 'b'], 'a')).toEqual(['b']);
  });

  test('does not mutate its input', () => {
    // Filter state is compared by reference by React; mutating in place skips the re-render.
    const original = ['a'];
    toggleInList(original, 'b');
    expect(original).toEqual(['a']);
  });
});

describe('addRecentSearch', () => {
  test('newest first', () => {
    expect(addRecentSearch(['a'], 'b')).toEqual(['b', 'a']);
  });

  test('re-searching an old term moves it to the front rather than duplicating', () => {
    expect(addRecentSearch(['a', 'b'], 'b')).toEqual(['b', 'a']);
  });

  test(`caps at ${RECENT_SEARCH_LIMIT}`, () => {
    const full = ['1', '2', '3', '4', '5'];
    const result = addRecentSearch(full, '6');
    expect(result).toHaveLength(RECENT_SEARCH_LIMIT);
    expect(result[0]).toBe('6');
    expect(result).not.toContain('5');
  });

  test('blank and whitespace-only terms are ignored', () => {
    expect(addRecentSearch(['a'], '')).toEqual(['a']);
    expect(addRecentSearch(['a'], '   ')).toEqual(['a']);
    expect(addRecentSearch(['a'], null)).toEqual(['a']);
  });

  test('terms are trimmed before storing', () => {
    expect(addRecentSearch([], '  hampi  ')).toEqual(['hampi']);
  });
});
