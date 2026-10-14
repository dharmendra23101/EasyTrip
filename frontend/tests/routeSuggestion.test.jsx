import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import RouteSuggestion from '../src/components/trips/RouteSuggestion';
import { useTripWorkspace } from '../src/hooks/useTripWorkspace';
import tripService from '../src/services/tripService';

/**
 * The per-day route suggestion (`FV-026` stage a, `IMP-131`).
 *
 * One sentence from the item's kill criteria decides almost everything here: stop if
 * *"optimisation starts overriding what the user deliberately chose"*. So the assertions that
 * matter are about **restraint**:
 *
 * - asking for a suggestion must not change anything;
 * - a suggestion the user has not seen must not be applicable;
 * - a decline must be a sentence the reader can act on, not a button that silently does nothing;
 * - and a suggestion computed from one order must not survive that order changing.
 */

jest.mock('../src/services/tripService', () => ({
  __esModule: true,
  default: {
    getTrip: jest.fn(),
    getTripFeasibility: jest.fn(),
    getDayRouteSuggestion: jest.fn(),
    addDay: jest.fn(),
    deleteDay: jest.fn(),
    addItem: jest.fn(),
    updateItem: jest.fn(),
    deleteItem: jest.fn(),
    reorderItems: jest.fn()
  }
}));

jest.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { uid: 'user-1' },
    loading: false,
    getIdToken: async () => 'token'
  })
}));

const APPLICABLE = {
  applicable: true,
  day_number: 1,
  current_km: 420.5,
  suggested_km: 310.2,
  saving_km: 110.3,
  saving_minutes: 165,
  item_ids: [11, 13, 12],
  order: [
    { item_id: 11, title: 'Gokarna', from_position: 0, to_position: 0 },
    { item_id: 13, title: 'Badami', from_position: 2, to_position: 1 },
    { item_id: 12, title: 'Hampi', from_position: 1, to_position: 2 }
  ],
  assumptions: { average_speed_kmh: 40, road_factor: 1.3 },
  estimated: true
};

const SCHEDULED = {
  applicable: false,
  reason: 'day_is_scheduled',
  detail: 'This day has times on it, so the clock already decides the order.',
  estimated: true
};

beforeEach(() => jest.clearAllMocks());

describe('the panel before anybody asks', () => {
  test('promises what it does, and promises not to do it unasked', () => {
    render(
      <RouteSuggestion
        suggestion={undefined}
        busy={false}
        onSuggest={jest.fn()}
        onApply={jest.fn()}
      />
    );

    expect(screen.getByText(/never rearranges anything on its own/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /use this order/i })).not.toBeInTheDocument();
  });

  test('the check is a button, not something that happens on render', async () => {
    const onSuggest = jest.fn();
    render(
      <RouteSuggestion
        suggestion={undefined}
        busy={false}
        onSuggest={onSuggest}
        onApply={jest.fn()}
      />
    );

    expect(onSuggest).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /check the route/i }));
    expect(onSuggest).toHaveBeenCalledTimes(1);
  });
});

describe('a suggestion worth showing', () => {
  test('states the saving and both totals, so it can be disagreed with', () => {
    render(
      <RouteSuggestion
        suggestion={APPLICABLE}
        busy={false}
        onSuggest={jest.fn()}
        onApply={jest.fn()}
      />
    );

    expect(screen.getByText(/110.3 km less/)).toBeInTheDocument();
    expect(screen.getByText(/420.5 km/)).toBeInTheDocument();
    expect(screen.getByText(/310.2 km/)).toBeInTheDocument();
  });

  test('shows which stops move and where from', () => {
    // A total alone asks the user to trust a heuristic over estimated distances. The list is what
    // lets them look at it and say no.
    render(
      <RouteSuggestion
        suggestion={APPLICABLE}
        busy={false}
        onSuggest={jest.fn()}
        onApply={jest.fn()}
      />
    );

    expect(screen.getByText('Badami')).toBeInTheDocument();
    expect(screen.getByText(/moves from 3/)).toBeInTheDocument();
    expect(screen.getByText(/moves from 2/)).toBeInTheDocument();
  });

  test('applying is a separate, deliberate press', async () => {
    const onApply = jest.fn();
    render(
      <RouteSuggestion
        suggestion={APPLICABLE}
        busy={false}
        onSuggest={jest.fn()}
        onApply={onApply}
      />
    );

    expect(onApply).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /use this order/i }));
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  test('says the distances are estimates', () => {
    render(
      <RouteSuggestion
        suggestion={APPLICABLE}
        busy={false}
        onSuggest={jest.fn()}
        onApply={jest.fn()}
      />
    );
    expect(screen.getByText(/does not use a routing service/i)).toBeInTheDocument();
    expect(screen.getByText(/40 km\/h/)).toBeInTheDocument();
  });
});

describe('a decline is an answer, not a silence', () => {
  test('a scheduled day explains itself', () => {
    render(
      <RouteSuggestion
        suggestion={SCHEDULED}
        busy={false}
        onSuggest={jest.fn()}
        onApply={jest.fn()}
      />
    );

    expect(screen.getByText(/the clock already decides the order/i)).toBeInTheDocument();
    // And offers nothing to apply, because there is nothing.
    expect(screen.queryByRole('button', { name: /use this order/i })).not.toBeInTheDocument();
  });

  test('a day with too few stops explains itself too', () => {
    render(
      <RouteSuggestion
        suggestion={{
          applicable: false,
          reason: 'not_enough_stops',
          detail: 'A day needs at least three places with coordinates.'
        }}
        busy={false}
        onSuggest={jest.fn()}
        onApply={jest.fn()}
      />
    );
    expect(screen.getByText(/at least three places/i)).toBeInTheDocument();
  });
});

describe('the hook keeps suggestions honest', () => {
  const TRIP = {
    id: 4,
    title: 'Karnataka',
    start_date: '2026-03-01',
    end_date: '2026-03-01',
    days: [{ id: 9, day_number: 1, items: [] }]
  };

  beforeEach(() => {
    tripService.getTrip.mockResolvedValue(TRIP);
    tripService.getDayRouteSuggestion.mockResolvedValue(APPLICABLE);
    tripService.reorderItems.mockResolvedValue({});
    tripService.addDay.mockResolvedValue({});
  });

  test('asking for a suggestion writes nothing', async () => {
    const { result } = renderHook(() => useTripWorkspace(4));
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => {
      await result.current.suggestRoute(9);
    });

    expect(result.current.routeSuggestions[9]).toEqual(APPLICABLE);
    expect(tripService.reorderItems).not.toHaveBeenCalled();
  });

  test('applying sends the whole order to the endpoint that already validates it', async () => {
    const { result } = renderHook(() => useTripWorkspace(4));
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => {
      await result.current.suggestRoute(9);
    });
    await act(async () => {
      await result.current.applyRouteSuggestion(9);
    });

    expect(tripService.reorderItems).toHaveBeenCalledWith(4, 9, [11, 13, 12], 'token');
  });

  test('a suggestion nobody fetched cannot be applied', async () => {
    // The guard against a caller applying `routeSuggestions[dayId]` before it exists — which would
    // send `undefined` to the reorder endpoint and 400, or worse, send a stale order.
    const { result } = renderHook(() => useTripWorkspace(4));
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => {
      const applied = await result.current.applyRouteSuggestion(9);
      expect(applied).toBe(false);
    });
    expect(tripService.reorderItems).not.toHaveBeenCalled();
  });

  test('a decline cannot be applied either', async () => {
    tripService.getDayRouteSuggestion.mockResolvedValue(SCHEDULED);
    const { result } = renderHook(() => useTripWorkspace(4));
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => {
      await result.current.suggestRoute(9);
    });
    await act(async () => {
      await result.current.applyRouteSuggestion(9);
    });

    expect(tripService.reorderItems).not.toHaveBeenCalled();
  });

  test('any write clears every suggestion', async () => {
    // A suggestion is a list of moves over a specific order. Once the day changes, those moves no
    // longer mean what they say — and unlike a stale feasibility verdict, applying one would
    // actually rearrange the trip.
    const { result } = renderHook(() => useTripWorkspace(4));
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => {
      await result.current.suggestRoute(9);
    });
    expect(result.current.routeSuggestions[9]).toBeTruthy();

    await act(async () => {
      await result.current.addDay();
    });
    expect(result.current.routeSuggestions).toEqual({});
  });

  test('a failed check clears that day rather than leaving the old answer', async () => {
    const { result } = renderHook(() => useTripWorkspace(4));
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => {
      await result.current.suggestRoute(9);
    });

    tripService.getDayRouteSuggestion.mockRejectedValueOnce(new Error('Could not check this day'));
    await act(async () => {
      await result.current.suggestRoute(9);
    });

    expect(result.current.routeSuggestions[9]).toBeNull();
    expect(result.current.actionError.message).toBe('Could not check this day');
  });
});
