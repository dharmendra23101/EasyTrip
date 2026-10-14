import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import FeasibilityPanel from '../src/components/trips/FeasibilityPanel';
import { useTripWorkspace } from '../src/hooks/useTripWorkspace';
import tripService from '../src/services/tripService';

/**
 * The feasibility report, as a user meets it (`FV-025` / `IMP-130`).
 *
 * The engine itself is proved by 35 backend assertions against hand-built trips. What no backend
 * test can see is the half that decides whether the feature is *useful*:
 *
 * - a verdict must not appear before anybody asked for one;
 * - an error and a warning must not look the same, or the reader learns that red sometimes means
 *   "carry on" and stops reading it;
 * - every travel estimate must say it is an estimate, because there is no routing provider;
 * - **a report must never outlive the plan it describes.** That last one is the assertion this
 *   file exists for: the dangerous stale state is the *reassuring* one — "nothing looks
 *   impossible" still on screen above a day the user has just broken.
 */

jest.mock('../src/services/tripService', () => ({
  __esModule: true,
  default: {
    getTrip: jest.fn(),
    getTripFeasibility: jest.fn(),
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

const ASSUMPTIONS = {
  road_factor: 1.3,
  average_speed_kmh: 40,
  negligible_distance_km: 1,
  backtracking_ratio: 1.3,
  backtracking_excess_km: 20
};

const report = (findings = []) => ({
  feasible: findings.every((f) => f.severity !== 'error'),
  counts: {
    errors: findings.filter((f) => f.severity === 'error').length,
    warnings: findings.filter((f) => f.severity === 'warning').length
  },
  assumptions: ASSUMPTIONS,
  findings
});

const TRAVEL_ERROR = {
  code: 'insufficient_travel_time',
  severity: 'error',
  message: '"Hampi" to "Gokarna" is about 325 km — roughly 488 minutes — but the plan allows 30.',
  estimated: true
};

const BACKTRACK_WARNING = {
  code: 'day_backtracks',
  severity: 'warning',
  message: 'Day 1 covers about 590 km in this order; a sensible order is about 340 km.',
  estimated: true
};

const DUPLICATE_WARNING = {
  code: 'place_repeated_in_day',
  severity: 'warning',
  message: '"Evening at the fort" visits the same place as "Morning at the fort" on day 1.'
};

/** `FV-027` stage (a). Same reading, same attribution, a different rule reading it. */
const WET_DAY_WARNING = {
  code: 'outdoor_day_likely_wet',
  severity: 'warning',
  message: 'Day 2 is forecast rain (12.4 mm), and 2 stops are outdoors.',
  condition: 'Rain',
  precipitation_mm: 12.4,
  source: 'Open-Meteo'
};

/** `FV-031`. The `source` is what the engine passes through from whoever supplied the reading. */
const DAYLIGHT_WARNING = {
  code: 'outdoor_item_in_darkness',
  severity: 'warning',
  message: '"Sunset point" is outdoors and runs to 19:30, after sunset at 18:05.',
  sunrise: '2026-03-01T06:42',
  sunset: '2026-03-01T18:05',
  source: 'Open-Meteo'
};

beforeEach(() => jest.clearAllMocks());

describe('the panel says nothing until it is asked', () => {
  test('no verdict is shown before a check has run', () => {
    render(<FeasibilityPanel report={null} checking={false} error={null} onCheck={jest.fn()} />);

    // It explains what it would do; it does not claim anything about the plan.
    expect(screen.getByText(/estimates whether there is enough time/i)).toBeInTheDocument();
    expect(screen.queryByText(/Nothing here looks impossible/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/cannot be done as planned/i)).not.toBeInTheDocument();
  });

  test('the button asks for the check', async () => {
    const onCheck = jest.fn();
    render(<FeasibilityPanel report={null} checking={false} error={null} onCheck={onCheck} />);

    await userEvent.click(screen.getByRole('button', { name: /check this plan/i }));
    expect(onCheck).toHaveBeenCalledTimes(1);
  });

  test('the button is disabled while a check is in flight', () => {
    render(<FeasibilityPanel report={null} checking error={null} onCheck={jest.fn()} />);
    expect(screen.getByRole('button', { name: /checking/i })).toBeDisabled();
  });
});

describe('what a report looks like', () => {
  test('a clean plan is stated positively rather than left blank', () => {
    // A blank panel after pressing a button is indistinguishable from a button that did nothing.
    render(
      <FeasibilityPanel report={report()} checking={false} error={null} onCheck={jest.fn()} />
    );
    expect(screen.getByText(/Nothing here looks impossible/i)).toBeInTheDocument();
  });

  test('an error is counted and shown', () => {
    render(
      <FeasibilityPanel
        report={report([TRAVEL_ERROR])}
        checking={false}
        error={null}
        onCheck={jest.fn()}
      />
    );

    expect(screen.getByText(/1 thing that cannot be done as planned/i)).toBeInTheDocument();
    expect(screen.getByText(TRAVEL_ERROR.message)).toBeInTheDocument();
  });

  test('warnings alone do not read as failure', () => {
    // The distinction the whole severity split exists for. A plan with only warnings is executable,
    // and saying otherwise teaches the reader to ignore the panel.
    render(
      <FeasibilityPanel
        report={report([BACKTRACK_WARNING, DUPLICATE_WARNING])}
        checking={false}
        error={null}
        onCheck={jest.fn()}
      />
    );

    expect(screen.getByText(/Nothing impossible/i)).toBeInTheDocument();
    expect(screen.queryByText(/cannot be done as planned/i)).not.toBeInTheDocument();
    expect(screen.getByText(/2 worth a look/i)).toBeInTheDocument();
  });

  test('errors and warnings are distinguishable without colour', () => {
    // Colour alone is not a distinction for everyone. Each finding carries its severity as text
    // for assistive technology, which is also what makes this assertable.
    render(
      <FeasibilityPanel
        report={report([TRAVEL_ERROR, DUPLICATE_WARNING])}
        checking={false}
        error={null}
        onCheck={jest.fn()}
      />
    );

    expect(screen.getByText('Cannot be done as planned:')).toBeInTheDocument();
    expect(screen.getByText('Worth a look:')).toBeInTheDocument();
  });
});

describe('a warning carries the licence of the data underneath it', () => {
  test('a daylight warning names its source and links to it', () => {
    // Open-Meteo is CC-BY, so attribution is an obligation rather than a courtesy — and it follows
    // the data, not the page it first appeared on. The forecast panel already attributes it;
    // sunrise and sunset now travel as far as this report, so it has to say so here too. Skipping
    // exactly this is what `IMP-127` found for the geocoder.
    render(
      <FeasibilityPanel
        report={report([DAYLIGHT_WARNING])}
        checking={false}
        error={null}
        onCheck={jest.fn()}
      />
    );

    const link = screen.getByRole('link', { name: 'Open-Meteo' });
    expect(link).toHaveAttribute('href', 'https://open-meteo.com/');
    expect(screen.getByText(/Forecast from/i)).toBeInTheDocument();
  });

  test('a rain warning attributes the same forecast, without citing a sunrise', () => {
    // Two rules rest on one reading. Wording the attribution after only the first would have made
    // this finding claim it consulted a sunrise it never looked at.
    render(
      <FeasibilityPanel
        report={report([WET_DAY_WARNING])}
        checking={false}
        error={null}
        onCheck={jest.fn()}
      />
    );

    expect(screen.getByRole('link', { name: 'Open-Meteo' })).toBeInTheDocument();
    expect(screen.queryByText(/sunrise/i)).not.toBeInTheDocument();
  });

  test('a finding with no source claims none', () => {
    // The attribution is driven by the finding rather than by its code, so a check that rests on
    // nothing but arithmetic must not borrow somebody else's name for authority.
    render(
      <FeasibilityPanel
        report={report([BACKTRACK_WARNING])}
        checking={false}
        error={null}
        onCheck={jest.fn()}
      />
    );

    expect(screen.queryByText(/Forecast from/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open-Meteo' })).not.toBeInTheDocument();
  });
});

describe('every estimate says it is one', () => {
  test('a travel finding carries its own caveat', () => {
    // On the finding, not only in the footer: a screenshot of one warning has to carry it too.
    render(
      <FeasibilityPanel
        report={report([TRAVEL_ERROR])}
        checking={false}
        error={null}
        onCheck={jest.fn()}
      />
    );
    expect(screen.getByText(/not a routed journey/i)).toBeInTheDocument();
  });

  test('a finding that is not an estimate does not claim to be one', () => {
    render(
      <FeasibilityPanel
        report={report([DUPLICATE_WARNING])}
        checking={false}
        error={null}
        onCheck={jest.fn()}
      />
    );
    expect(screen.queryByText(/not a routed journey/i)).not.toBeInTheDocument();
  });

  test('the assumptions behind the numbers are rendered, not hidden', () => {
    render(
      <FeasibilityPanel report={report()} checking={false} error={null} onCheck={jest.fn()} />
    );

    expect(screen.getByText(/40 km\/h/)).toBeInTheDocument();
    expect(screen.getByText(/30% longer than a straight line/i)).toBeInTheDocument();
    expect(screen.getByText(/does not use a routing service/i)).toBeInTheDocument();
  });
});

describe('a failed check does not leave a verdict standing', () => {
  test('the error replaces the report rather than sitting beside it', () => {
    render(
      <FeasibilityPanel
        report={null}
        checking={false}
        error={new Error('Could not check this trip')}
        onCheck={jest.fn()}
      />
    );

    expect(screen.getByText('Could not check this trip')).toBeInTheDocument();
    expect(screen.queryByText(/Nothing here looks impossible/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// The invariant this feature turns on
// ---------------------------------------------------------------------------

describe('a report never outlives the plan it describes', () => {
  const TRIP = {
    id: 4,
    title: 'Karnataka',
    start_date: '2026-03-01',
    end_date: '2026-03-02',
    days: [{ id: 9, day_number: 1, items: [] }]
  };

  beforeEach(() => {
    tripService.getTrip.mockResolvedValue(TRIP);
    tripService.getTripFeasibility.mockResolvedValue(report());
    tripService.addDay.mockResolvedValue({});
  });

  test('a check produces a report', async () => {
    const { result } = renderHook(() => useTripWorkspace(4));
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => {
      await result.current.checkFeasibility();
    });
    expect(result.current.feasibility).not.toBeNull();
  });

  test('and any write clears it', async () => {
    // The failure this prevents is the reassuring one: "nothing looks impossible" still on screen
    // above a day the user has just added. Recomputing instead of clearing would be worse — it
    // puts a second request on the critical path of every edit, which the engine's own kill
    // criteria warn against.
    const { result } = renderHook(() => useTripWorkspace(4));
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => {
      await result.current.checkFeasibility();
    });
    expect(result.current.feasibility).not.toBeNull();

    await act(async () => {
      await result.current.addDay();
    });

    expect(result.current.feasibility).toBeNull();
    // And it does not silently re-check: the panel goes back to saying nothing.
    expect(tripService.getTripFeasibility).toHaveBeenCalledTimes(1);
  });

  test('a failed check clears the previous report too', async () => {
    const { result } = renderHook(() => useTripWorkspace(4));
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => {
      await result.current.checkFeasibility();
    });

    tripService.getTripFeasibility.mockRejectedValueOnce(new Error('Could not check this trip'));
    await act(async () => {
      await result.current.checkFeasibility();
    });

    expect(result.current.feasibility).toBeNull();
    expect(result.current.feasibilityError.message).toBe('Could not check this trip');
  });
});

// ---------------------------------------------------------------------------
// A stop that conflicts with the traveller's stated needs (`FV-029` stage d)
// ---------------------------------------------------------------------------
describe('an accessibility finding carries who checked and when', () => {
  const ACCESS_ERROR = {
    code: 'stop_not_step_free',
    severity: 'error',
    message: '"The Fort" has no step-free access.',
    checked_by: 'site_visit',
    checked_on: '2026-08-01'
  };

  test('the finding renders with its provenance beneath it', () => {
    // The badge's rule, in a warning. Without this a ramp removed last winter reads exactly like
    // one confirmed this morning.
    render(
      <FeasibilityPanel
        report={report([ACCESS_ERROR])}
        checking={false}
        error={null}
        onCheck={jest.fn()}
      />
    );

    expect(screen.getByText('"The Fort" has no step-free access.')).toBeInTheDocument();
    expect(screen.getByText(/Checked in person, Aug 1, 2026/)).toBeInTheDocument();
  });

  test('an operator claim stays hedged, because it is an interested party', () => {
    render(
      <FeasibilityPanel
        report={report([{ ...ACCESS_ERROR, checked_by: 'operator' }])}
        checking={false}
        error={null}
        onCheck={jest.fn()}
      />
    );
    expect(screen.getByText(/The place says so/)).toBeInTheDocument();
  });

  test('it is not mistaken for a forecast attribution', () => {
    // **The collision this key exists to avoid.** `source` means "the provider whose data produced
    // this finding" and is rendered as the literal words "Forecast from" because Open-Meteo is
    // CC-BY. Reusing it for a survey would have shipped "Forecast from site_visit".
    render(
      <FeasibilityPanel
        report={report([ACCESS_ERROR])}
        checking={false}
        error={null}
        onCheck={jest.fn()}
      />
    );

    expect(screen.queryByText(/Forecast from/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Open-Meteo/)).not.toBeInTheDocument();
  });

  test('and a forecast finding still gets its attribution', () => {
    // The other half of the same assertion: separating the keys must not have broken the one that
    // was already there.
    render(
      <FeasibilityPanel
        report={report([
          {
            code: 'outdoor_item_in_darkness',
            severity: 'warning',
            message: '"Sunset Point" is outdoors and runs to 19:30, after sunset at 18:41.',
            source: 'Open-Meteo'
          }
        ])}
        checking={false}
        error={null}
        onCheck={jest.fn()}
      />
    );

    expect(screen.getByText(/Forecast from/)).toBeInTheDocument();
  });

  test('a finding with no provenance renders no provenance line', () => {
    render(
      <FeasibilityPanel
        report={report([{ ...ACCESS_ERROR, checked_by: null, checked_on: null }])}
        checking={false}
        error={null}
        onCheck={jest.fn()}
      />
    );

    expect(screen.getByText('"The Fort" has no step-free access.')).toBeInTheDocument();
    expect(screen.queryByText(/Checked in person/)).not.toBeInTheDocument();
  });
});
