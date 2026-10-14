import { act, renderHook, waitFor } from '@testing-library/react';

import { usePlaceSuggestions } from '../src/hooks/usePlaceSuggestions';
import { fetchPlaceSuggestions } from '../src/services/placesApi';

jest.mock('../src/services/placesApi', () => ({
  fetchPlaceSuggestions: jest.fn()
}));

/**
 * The typeahead hook (`IMP-112`, `ADR-033`).
 *
 * Three properties matter here and none of them are "it fetches": that an empty box asks nothing,
 * that a failure is silent rather than an error under the search field, and that an out-of-order
 * response cannot repaint the dropdown with a prefix the user has already moved past.
 */

const ok = (names) => ({ data: names.map((name, i) => ({ id: i + 1, name })) });

beforeEach(() => {
  jest.clearAllMocks();
});

describe('usePlaceSuggestions', () => {
  test('an empty term asks the server nothing', () => {
    const { result } = renderHook(() => usePlaceSuggestions(''));
    expect(fetchPlaceSuggestions).not.toHaveBeenCalled();
    expect(result.current).toEqual([]);
  });

  test('a whitespace-only term asks nothing either', () => {
    renderHook(() => usePlaceSuggestions('   '));
    expect(fetchPlaceSuggestions).not.toHaveBeenCalled();
  });

  test('a real term is trimmed before it is sent', async () => {
    fetchPlaceSuggestions.mockResolvedValue(ok(['Hampi']));
    const { result } = renderHook(() => usePlaceSuggestions('  hampi  '));

    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(fetchPlaceSuggestions).toHaveBeenCalledWith('hampi', expect.anything());
    expect(result.current[0].name).toBe('Hampi');
  });

  test('a failure clears the list instead of surfacing an error', async () => {
    // A suggestion list accelerates a search that works without it. "Could not load suggestions"
    // under the box would be a louder failure than the feature is worth; the grid reports its own.
    fetchPlaceSuggestions.mockResolvedValueOnce(ok(['Hampi']));
    const { result, rerender } = renderHook(({ term }) => usePlaceSuggestions(term), {
      initialProps: { term: 'hampi' }
    });
    await waitFor(() => expect(result.current).toHaveLength(1));

    fetchPlaceSuggestions.mockRejectedValueOnce(new Error('network'));
    rerender({ term: 'coorg' });

    await waitFor(() => expect(result.current).toEqual([]));
  });

  test('clearing the box clears the suggestions rather than leaving the last ones up', async () => {
    fetchPlaceSuggestions.mockResolvedValue(ok(['Hampi']));
    const { result, rerender } = renderHook(({ term }) => usePlaceSuggestions(term), {
      initialProps: { term: 'hampi' }
    });
    await waitFor(() => expect(result.current).toHaveLength(1));

    rerender({ term: '' });
    expect(result.current).toEqual([]);
  });

  test('a superseded request cannot repaint the dropdown', async () => {
    // The failure this guards: the user types "go" then "goa"; the "go" request is slower and lands
    // second, so the list ends up describing a prefix that is no longer on screen. The effect
    // cleanup marks the older render cancelled, so its resolution is dropped.
    let resolveSlow;
    fetchPlaceSuggestions.mockImplementationOnce(
      () => new Promise((resolve) => (resolveSlow = resolve))
    );

    const { result, rerender } = renderHook(({ term }) => usePlaceSuggestions(term), {
      initialProps: { term: 'go' }
    });

    fetchPlaceSuggestions.mockResolvedValueOnce(ok(['Goa Beaches']));
    rerender({ term: 'goa' });
    await waitFor(() => expect(result.current.map((p) => p.name)).toEqual(['Goa Beaches']));

    // The stale request finally answers, with results for the earlier prefix. Wrapped in `act` so
    // that if the hook *did* set state here — the bug — React would flush it and the assertion
    // below would see it. Outside `act` the update would be deferred and this test could pass by
    // timing rather than by the guard working.
    await act(async () => {
      resolveSlow(ok(['Gokarna', 'Golconda']));
    });

    expect(result.current.map((p) => p.name)).toEqual(['Goa Beaches']);
  });

  test('the in-flight request is aborted, not merely ignored', async () => {
    // Ignoring the answer still pays for it. The signal is what lets the browser drop the request.
    //
    // The mock never resolves on purpose: this test is about the signal, and a mock that settled
    // after the assertions would set state outside `act` and warn — a real warning about a real
    // late update, just one belonging to the harness rather than the hook.
    fetchPlaceSuggestions.mockImplementation(() => new Promise(() => {}));
    const { rerender } = renderHook(({ term }) => usePlaceSuggestions(term), {
      initialProps: { term: 'ham' }
    });

    const { signal } = fetchPlaceSuggestions.mock.calls[0][1];
    expect(signal.aborted).toBe(false);

    rerender({ term: 'hamp' });
    expect(signal.aborted).toBe(true);
  });
});
