import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import PlaceFit from '../src/components/place/PlaceFit';
import { PlaceSeasonality } from '../src/components/place/PlaceSeasonality';
import { fetchPlaceFit } from '../src/services/placesApi';

/**
 * The explainable fit panel (`FV-028` stage d).
 *
 * **Almost none of these check the arithmetic.** The server computes the score and 23 API tests
 * already hold it to account. What this component can get wrong is *presentation*, and every way it
 * can get presentation wrong is the same way: by making a number look more certain than it is.
 *
 * So the suite is organised around the three rules the component exists to enforce:
 *
 *   1. The score is never rendered without its coverage.
 *   2. A `null` score renders as words, never as a bar at zero or a "0%".
 *   3. What could not be counted is shown, with its reason.
 *
 * `FP-012` adds a fourth: the panel must say in the interface that this is arithmetic rather than a
 * prediction, and must print the weights so a reader can add the score up themselves.
 */

jest.mock('../src/services/placesApi', () => ({
  fetchPlaceFit: jest.fn()
}));

/** A place curated on two axes and reviewed on none — the shape a real curated row actually has. */
const PARTIAL = {
  score: 0.8,
  coverage: 0.6,
  weights: { season: 0.4, interests: 0.25, crowd: 0.2, rating: 0.15 },
  factors: [
    {
      key: 'season',
      label: 'Time of year',
      weight: 0.4,
      value: 1,
      detail: 'This is one of the months somebody recommended.'
    },
    {
      key: 'crowd',
      label: 'How busy it is',
      weight: 0.2,
      value: 0.25,
      detail: 'Somebody judged this place crowded.'
    }
  ],
  unavailable: [
    {
      key: 'interests',
      label: 'Your interests',
      reason: 'You have not said what you are interested in.'
    },
    { key: 'rating', label: 'What travellers said', reason: 'Nobody has reviewed this place yet.' }
  ]
};

/** The state of essentially the whole catalogue: nothing curated, so nothing to say. */
const NOTHING_KNOWN = {
  score: null,
  coverage: 0,
  weights: PARTIAL.weights,
  factors: [],
  unavailable: [
    {
      key: 'season',
      label: 'Time of year',
      reason: 'Nobody has recorded which months are best here.'
    },
    { key: 'crowd', label: 'How busy it is', reason: 'Nobody has judged how busy this place is.' }
  ]
};

/** Let the fetch promise settle. Without this the DOM is asserted while still trivially empty. */
const settle = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Rule 1 — the score never travels without its coverage
// ---------------------------------------------------------------------------
describe('a score is never shown alone', () => {
  test('the coverage is rendered with the score, not instead of it', async () => {
    fetchPlaceFit.mockResolvedValue({ data: PARTIAL });

    render(<PlaceFit placeId={1} />);

    expect(await screen.findByText(/80% fit/)).toBeInTheDocument();
    // 0.6 coverage. A reader who sees "80%" has, in the same sentence, seen what it stands on.
    expect(screen.getByText(/60% of what we would want to know/)).toBeInTheDocument();
  });

  test('the two numbers are in one sentence, so neither can be quoted without the other', async () => {
    // The failure this guards is a redesign that promotes the score to a headline and demotes the
    // coverage to a footnote elsewhere in the card. Asserting the shared parent is what makes
    // "they are both on the page somewhere" insufficient.
    fetchPlaceFit.mockResolvedValue({ data: PARTIAL });

    render(<PlaceFit placeId={1} />);

    const score = await screen.findByText(/80% fit/);
    const sentence = score.closest('p');
    expect(within(sentence).getByText(/60% of what we would want to know/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Rule 2 — null is words, never a number
// ---------------------------------------------------------------------------
describe('when nothing is known there is no number at all', () => {
  test('a null score says so in words', async () => {
    fetchPlaceFit.mockResolvedValue({ data: NOTHING_KNOWN });

    render(<PlaceFit placeId={1} />);

    expect(await screen.findByText(/cannot score this place yet/i)).toBeInTheDocument();
  });

  test('a null score never renders as 0%, which would read as a bad place', async () => {
    // The whole point. `null` means nobody curated it; `0%` means we judged it and it failed.
    fetchPlaceFit.mockResolvedValue({ data: NOTHING_KNOWN });

    render(<PlaceFit placeId={1} />);

    await screen.findByText(/cannot score this place yet/i);
    expect(screen.queryByText(/0% fit/)).not.toBeInTheDocument();
    expect(screen.queryByText(/fit$/)).not.toBeInTheDocument();
  });

  test('a failed request is silent rather than a wrong number', async () => {
    fetchPlaceFit.mockRejectedValue(new Error('network down'));

    render(<PlaceFit placeId={1} />);

    await waitFor(() => expect(fetchPlaceFit).toHaveBeenCalled());
    // The flush matters: `toHaveBeenCalled` is satisfied before the rejected promise settles, so
    // without it the absence below is asserted while the DOM is still trivially empty.
    await settle();

    expect(screen.queryByText(/% fit/)).not.toBeInTheDocument();
    expect(screen.queryByText(/cannot score this place yet/i)).not.toBeInTheDocument();
  });

  test('a malformed response lands on "nothing is known" rather than keeping the last answer', async () => {
    // Stale working beside a new question is worse than none — it is an explanation of something
    // the reader did not ask. `{}` rather than a rejection separates this from the catch path.
    fetchPlaceFit.mockResolvedValueOnce({ data: PARTIAL }).mockResolvedValueOnce({});

    render(<PlaceFit placeId={1} />);
    expect(await screen.findByText(/80% fit/)).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText(/when are you going/i), '11');

    await waitFor(() => expect(screen.queryByText(/80% fit/)).not.toBeInTheDocument());
  });
});

// ---------------------------------------------------------------------------
// Rule 3 — the absent half of the answer is shown
// ---------------------------------------------------------------------------
describe('what could not be counted is visible, with its reason', () => {
  test('every unavailable factor is named and explained beside a score', async () => {
    fetchPlaceFit.mockResolvedValue({ data: PARTIAL });

    render(<PlaceFit placeId={1} />);

    expect(await screen.findByText(/80% fit/)).toBeInTheDocument();
    expect(screen.getByText(/Nobody has reviewed this place yet/)).toBeInTheDocument();
    expect(screen.getByText(/You have not said what you are interested in/)).toBeInTheDocument();
  });

  test('an uncounted factor is not held against the place, and the wording says so', async () => {
    // "Not counted" and "counted as zero" are different claims. The heading is the only thing
    // telling the reader which one this is.
    fetchPlaceFit.mockResolvedValue({ data: PARTIAL });

    render(<PlaceFit placeId={1} />);

    expect(await screen.findByText(/not held against it/i)).toBeInTheDocument();
  });

  test('the reasons are shown on the null path too, where they are the entire answer', async () => {
    fetchPlaceFit.mockResolvedValue({ data: NOTHING_KNOWN });

    render(<PlaceFit placeId={1} />);

    await screen.findByText(/cannot score this place yet/i);
    expect(screen.getByText(/Nobody has recorded which months are best here/)).toBeInTheDocument();
    expect(screen.getByText(/Nobody has judged how busy this place is/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// FP-012 — it is arithmetic and it says so
// ---------------------------------------------------------------------------
describe('the working is shown, and checkable', () => {
  test('the panel says it is arithmetic rather than a prediction', async () => {
    fetchPlaceFit.mockResolvedValue({ data: PARTIAL });

    render(<PlaceFit placeId={1} />);
    await screen.findByText(/80% fit/);

    expect(screen.getByText(/arithmetic, not a prediction/i)).toBeInTheDocument();
  });

  test('each counted factor carries its own sentence', async () => {
    fetchPlaceFit.mockResolvedValue({ data: PARTIAL });

    render(<PlaceFit placeId={1} />);

    expect(
      await screen.findByText(/This is one of the months somebody recommended/)
    ).toBeInTheDocument();
    expect(screen.getByText(/Somebody judged this place crowded/)).toBeInTheDocument();
  });

  test('the weights are printed, so a reader can add the score up themselves', async () => {
    // An explanation nobody can check is decoration. 0.4 and 0.2 come from the response, not from a
    // copy this component keeps — a hard-coded table here would drift from the server's.
    fetchPlaceFit.mockResolvedValue({ data: PARTIAL });

    render(<PlaceFit placeId={1} />);

    expect(await screen.findByText(/worth 40%/)).toBeInTheDocument();
    expect(screen.getByText(/worth 20%/)).toBeInTheDocument();
  });

  test('the counted and uncounted rows are distinguishable without colour', async () => {
    // WCAG 1.4.1. `axe` checks contrast, not meaning, so this is pinned by asserting the text a
    // screen reader actually receives — a tick icon and a grey tint are not a statement.
    fetchPlaceFit.mockResolvedValue({ data: PARTIAL });

    render(<PlaceFit placeId={1} />);
    await screen.findByText(/80% fit/);

    // Exact strings and exact counts: two factors counted, two not. A looser matcher would pass
    // if every row said the same thing, which is the failure this is here to catch.
    expect(screen.getAllByText('counted:')).toHaveLength(PARTIAL.factors.length);
    expect(screen.getAllByText('could not be counted:')).toHaveLength(PARTIAL.unavailable.length);
  });
});

// ---------------------------------------------------------------------------
// What the reader asks, and how it reaches the server
// ---------------------------------------------------------------------------
describe('the question the reader asked is the question that is sent', () => {
  test('no month chosen sends no month, rather than defaulting to today', async () => {
    // Defaulting to the current month would answer a question the reader did not ask, and would make
    // the same place score differently in April.
    fetchPlaceFit.mockResolvedValue({ data: NOTHING_KNOWN });

    render(<PlaceFit placeId={1} />);

    await waitFor(() =>
      expect(fetchPlaceFit).toHaveBeenCalledWith(1, { month: undefined, interests: [] })
    );
  });

  test('choosing a month re-asks the server with it', async () => {
    fetchPlaceFit.mockResolvedValue({ data: PARTIAL });

    render(<PlaceFit placeId={1} />);
    await screen.findByText(/80% fit/);

    await userEvent.selectOptions(screen.getByLabelText(/when are you going/i), '11');

    await waitFor(() =>
      expect(fetchPlaceFit).toHaveBeenLastCalledWith(1, { month: 11, interests: [] })
    );
  });

  test('interests are sent as ids, and toggle off again', async () => {
    fetchPlaceFit.mockResolvedValue({ data: PARTIAL });

    render(<PlaceFit placeId={1} />);
    await screen.findByText(/80% fit/);

    await userEvent.click(screen.getByLabelText('Adventure'));
    await waitFor(() =>
      expect(fetchPlaceFit).toHaveBeenLastCalledWith(1, {
        month: undefined,
        interests: ['adventure']
      })
    );

    await userEvent.click(screen.getByLabelText('Adventure'));
    await waitFor(() =>
      expect(fetchPlaceFit).toHaveBeenLastCalledWith(1, { month: undefined, interests: [] })
    );
  });

  test('the answer is announced, because it changes without the page moving', async () => {
    fetchPlaceFit.mockResolvedValue({ data: PARTIAL });

    const { container } = render(<PlaceFit placeId={1} />);
    await screen.findByText(/80% fit/);

    const live = container.querySelector('[aria-live="polite"]');
    expect(live).not.toBeNull();
    expect(within(live).getByText(/80% fit/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Where it renders — the gate is inherited, not restated
// ---------------------------------------------------------------------------
describe('the panel appears only where something has been curated', () => {
  test('a curated place gets the panel inside the existing "when" card', async () => {
    fetchPlaceFit.mockResolvedValue({ data: PARTIAL });

    render(
      <PlaceSeasonality
        place={{
          id: 1,
          best_months: [10, 11],
          crowd_level: 'low',
          seasonality_source: 'editorial'
        }}
      />
    );

    expect(await screen.findByText(/Does this place fit your trip/i)).toBeInTheDocument();
  });

  test('an uncurated place gets no panel, because every answer would be "nobody recorded that"', () => {
    // `PlaceSeasonality` returns null for this row, so the form is never offered. Asserting it here
    // rather than in `PlaceFit` is deliberate: the gate lives in the parent, and a test that mounted
    // `PlaceFit` directly would pass while the real page rendered a useless form on every place.
    render(<PlaceSeasonality place={{ id: 1, best_months: [], crowd_level: 'unknown' }} />);

    expect(screen.queryByText(/Does this place fit your trip/i)).not.toBeInTheDocument();
    expect(fetchPlaceFit).not.toHaveBeenCalled();
  });
});
