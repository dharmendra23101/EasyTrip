import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import DayRoute from '../src/components/trips/DayRoute';
import { useTripWorkspace } from '../src/hooks/useTripWorkspace';
import tripService from '../src/services/tripService';

/**
 * The day's route, drawn (`FV-026` stage c).
 *
 * The map itself is stubbed. Leaflet reads `window` and measures a container jsdom will always
 * report as 0×0, so asserting against it would test the stub rather than the feature — and the
 * things worth asserting are not on the canvas anyway. `DayRouteMap` is `aria-hidden` on purpose
 * (see its header): **every fact the picture carries is also in the list**, and that claim is what
 * these tests check. If they could only be written by reading the map, the accessibility design
 * would be wrong.
 *
 * So the assertions are about honesty rather than pixels:
 *
 * - drawing changes nothing;
 * - a refusal is a sentence, not a silent no-op;
 * - a measured leg and an estimated one never read the same;
 * - a stop the map left out is named;
 * - and a drawing does not outlive the day it drew.
 */

jest.mock('../src/components/trips/DayRouteMap', () => ({
  __esModule: true,
  default: ({ stops, dayNumber }) => (
    <div data-testid={`map-stub-${dayNumber}`} data-stops={stops.map((s) => s.title).join(' > ')} />
  )
}));

jest.mock('../src/services/tripService', () => ({
  __esModule: true,
  default: {
    getTrip: jest.fn(),
    getTripFeasibility: jest.fn(),
    getTripReplanSuggestion: jest.fn(),
    getDayRouteSuggestion: jest.fn(),
    getDayRoute: jest.fn(),
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

const ASSUMPTIONS = { road_factor: 1.3, average_speed_kmh: 40, negligible_distance_km: 1 };

const stop = (id, title, extra = {}) => ({
  item_id: id,
  title,
  start_time: null,
  place_id: id,
  latitude: 15.3 + id / 100,
  longitude: 76.4 + id / 100,
  ...extra
});

const ESTIMATED = {
  drawable: true,
  day_number: 1,
  stops: [stop(1, 'Hampi Bazaar'), stop(2, 'Vittala Temple'), stop(3, 'Matanga Hill')],
  legs: [
    { from_item_id: 1, to_item_id: 2, km: 5.2, minutes: 8, straight_line_km: 4, estimated: true },
    { from_item_id: 2, to_item_id: 3, km: 3.9, minutes: 6, straight_line_km: 3, estimated: true }
  ],
  total_km: 9.1,
  total_minutes: 14,
  estimated: true,
  source: null,
  unmapped: [],
  assumptions: ASSUMPTIONS
};

const MEASURED = {
  ...ESTIMATED,
  legs: ESTIMATED.legs.map((leg) => ({ ...leg, estimated: false })),
  estimated: false,
  source: 'OpenRouteService, CC-BY 4.0'
};

describe('before anything has been drawn', () => {
  test('it explains what the button does and shows no numbers', () => {
    render(<DayRoute route={undefined} dayNumber={1} busy={false} onDraw={jest.fn()} />);

    expect(
      screen.getByText(/draws the stops in the order this day lists them/i)
    ).toBeInTheDocument();
    expect(screen.queryByText(/km/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('map-stub-1')).not.toBeInTheDocument();
  });

  test('drawing is something the user asks for, not something render does', async () => {
    const onDraw = jest.fn();
    render(<DayRoute route={undefined} dayNumber={1} busy={false} onDraw={onDraw} />);

    // The whole panel is a read, but a read that costs a routing lookup. Six days rendering six
    // matrix calls on page load is the case the endpoint is shaped per-day to avoid.
    expect(onDraw).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /draw day 1/i }));
    expect(onDraw).toHaveBeenCalledTimes(1);
  });
});

describe('a day that cannot be drawn says so', () => {
  // The two refusals the engine can produce. Both are answers, and rendering them as sentences is
  // what stops "nothing on this day has coordinates" looking like "the request failed".
  test.each([
    ['day_is_empty', 'Nothing is planned for this day yet, so there is no route to draw.'],
    [
      'no_mapped_stops',
      'Nothing on this day is linked to a place with coordinates, so it cannot be drawn.'
    ]
  ])('%s renders its own sentence', (reason, detail) => {
    render(
      <DayRoute
        route={{ drawable: false, day_number: 2, reason, detail }}
        dayNumber={1}
        busy={false}
        onDraw={jest.fn()}
      />
    );

    expect(screen.getByText(detail)).toBeInTheDocument();
    expect(screen.queryByTestId('map-stub-2')).not.toBeInTheDocument();
  });
});

describe('a drawable day', () => {
  test('lists every stop once, in the order the day lists them', () => {
    render(<DayRoute route={ESTIMATED} dayNumber={1} busy={false} onDraw={jest.fn()} />);

    // One entry per stop, and no more. The first draft rendered each leg as an `li` nested inside
    // the stop's own — invalid markup that this assertion found by reading five entries where there
    // are three stops, with two of them appearing twice.
    const entries = screen.getAllByRole('listitem');
    expect(entries).toHaveLength(3);
    expect(
      entries.map((node) => within(node).getByText(/Hampi|Vittala|Matanga/).textContent)
    ).toEqual(['Hampi Bazaar', 'Vittala Temple', 'Matanga Hill']);
  });

  test('the map is handed the same stops, in the same order, as the list', () => {
    render(<DayRoute route={ESTIMATED} dayNumber={1} busy={false} onDraw={jest.fn()} />);

    // The one property that makes the map trustworthy: it is a drawing *of this list*. A map fed a
    // different sequence would be a confident picture of a day nobody planned.
    expect(screen.getByTestId('map-stub-1')).toHaveAttribute(
      'data-stops',
      'Hampi Bazaar > Vittala Temple > Matanga Hill'
    );
  });

  test('the total is stated with the number of stops it covers', () => {
    render(<DayRoute route={ESTIMATED} dayNumber={1} busy={false} onDraw={jest.fn()} />);
    expect(screen.getByText(/9\.1 km/)).toBeInTheDocument();
    expect(screen.getByText(/across 3 stops/)).toBeInTheDocument();
  });

  test('a time on a stop is shown, because the clock is why an order may look wrong', () => {
    render(
      <DayRoute
        route={{ ...ESTIMATED, stops: [stop(1, 'Hampi Bazaar', { start_time: '09:30' })] }}
        dayNumber={1}
        busy={false}
        onDraw={jest.fn()}
      />
    );
    expect(screen.getByText('09:30')).toBeInTheDocument();
  });
});

describe('an estimate never reads like a measurement', () => {
  test('every estimated leg says so, and the assumptions are named', () => {
    render(<DayRoute route={ESTIMATED} dayNumber={1} busy={false} onDraw={jest.fn()} />);

    expect(screen.getAllByText(/\(estimated\)/)).toHaveLength(2);
    expect(screen.getByText(/40 km\/h/)).toBeInTheDocument();
    expect(screen.getByText(/scaled by 1\.3 for roads/)).toBeInTheDocument();
  });

  test('a measured route says "by road" instead, and drops the assumptions', () => {
    render(<DayRoute route={MEASURED} dayNumber={1} busy={false} onDraw={jest.fn()} />);

    expect(screen.getAllByText(/by road/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/\(estimated\)/)).not.toBeInTheDocument();
    // Naming a straight-line speed under a road distance would be describing arithmetic that was
    // not used.
    expect(screen.queryByText(/40 km\/h/)).not.toBeInTheDocument();
  });

  test('attribution appears only when a measurement it belongs to appears', () => {
    // CC-BY obliges attribution for results that are **used** (`ADR-039`). A credit under numbers
    // the provider did not supply is its own false claim, so the estimated route carries none.
    const { unmount } = render(
      <DayRoute route={ESTIMATED} dayNumber={1} busy={false} onDraw={jest.fn()} />
    );
    expect(screen.queryByText(/OpenRouteService/)).not.toBeInTheDocument();
    unmount();

    render(<DayRoute route={MEASURED} dayNumber={1} busy={false} onDraw={jest.fn()} />);
    expect(screen.getByText(/OpenRouteService, CC-BY 4\.0/)).toBeInTheDocument();
  });

  test('one measured leg does not make the route measured', () => {
    // The engine biases this way on purpose and the panel must not undo it: a number that
    // overstates its own certainty is the failure worth avoiding.
    const mixed = {
      ...ESTIMATED,
      legs: [{ ...ESTIMATED.legs[0], estimated: false }, ESTIMATED.legs[1]],
      estimated: true
    };
    render(<DayRoute route={mixed} dayNumber={1} busy={false} onDraw={jest.fn()} />);

    expect(screen.getByText(/, estimated\./)).toBeInTheDocument();
    expect(screen.getByText(/5\.2 km, about 8 min by road/)).toBeInTheDocument();
    expect(screen.getByText(/3\.9 km, about 6 min \(estimated\)/)).toBeInTheDocument();
  });
});

describe('what the map leaves out is named', () => {
  test('an unmapped item is listed rather than silently dropped', () => {
    render(
      <DayRoute
        route={{ ...ESTIMATED, unmapped: [{ item_id: 9, title: 'Lunch somewhere' }] }}
        dayNumber={1}
        busy={false}
        onDraw={jest.fn()}
      />
    );

    // Sprint 8.27's lesson, applied to a drawing: an item silently absent is indistinguishable from
    // a feature that did not notice it.
    expect(screen.getByText(/Lunch somewhere/)).toBeInTheDocument();
    expect(screen.getByText(/not linked to a place with coordinates/i)).toBeInTheDocument();
  });

  test('nothing is said when nothing was left out', () => {
    render(<DayRoute route={ESTIMATED} dayNumber={1} busy={false} onDraw={jest.fn()} />);
    expect(screen.queryByText(/not linked to a place with coordinates/i)).not.toBeInTheDocument();
  });
});

describe('the hook, where staleness is decided', () => {
  const TRIP = {
    id: 7,
    title: 'Karnataka',
    days: [
      { id: 1, day_number: 1, items: [] },
      { id: 2, day_number: 2, items: [] }
    ]
  };

  beforeEach(() => {
    jest.clearAllMocks();
    tripService.getTrip.mockResolvedValue(TRIP);
  });

  test('each day is drawn separately, and one answer does not replace another', async () => {
    tripService.getDayRoute
      .mockResolvedValueOnce({ ...ESTIMATED, day_number: 1 })
      .mockResolvedValueOnce({ ...ESTIMATED, day_number: 2, total_km: 40 });

    const { result } = renderHook(() => useTripWorkspace(7));
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => {
      await result.current.drawDay(1);
    });
    await act(async () => {
      await result.current.drawDay(2);
    });

    expect(result.current.dayRoutes[1].total_km).toBe(9.1);
    expect(result.current.dayRoutes[2].total_km).toBe(40);
  });

  test('a refusal is kept, because it is an answer', async () => {
    tripService.getDayRoute.mockResolvedValue({
      drawable: false,
      day_number: 1,
      reason: 'day_is_empty',
      detail: 'Nothing is planned for this day yet, so there is no route to draw.'
    });

    const { result } = renderHook(() => useTripWorkspace(7));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => {
      await result.current.drawDay(1);
    });

    expect(result.current.dayRoutes[1]).toMatchObject({ drawable: false, reason: 'day_is_empty' });
    expect(result.current.actionError).toBeNull();
  });

  test('a failed request clears the entry and reports itself', async () => {
    tripService.getDayRoute.mockRejectedValue(new Error('offline'));

    const { result } = renderHook(() => useTripWorkspace(7));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => {
      await result.current.drawDay(1);
    });

    expect(result.current.dayRoutes[1]).toBeNull();
    expect(result.current.actionError).toBeTruthy();
  });

  test('any write throws the drawing away', async () => {
    tripService.getDayRoute.mockResolvedValue(ESTIMATED);
    tripService.addDay.mockResolvedValue({ id: 3, day_number: 3, items: [] });

    const { result } = renderHook(() => useTripWorkspace(7));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => {
      await result.current.drawDay(1);
    });
    expect(result.current.dayRoutes[1]).toBeTruthy();

    await act(async () => {
      await result.current.addDay();
    });

    // A line through the stops in their old order, still on screen beside the new order, is a
    // picture of a day that no longer exists — and a wrong map is believed faster than a wrong
    // sentence. Cleared rather than refetched, so the panel says nothing instead of something stale.
    expect(result.current.dayRoutes).toEqual({});
  });
});
