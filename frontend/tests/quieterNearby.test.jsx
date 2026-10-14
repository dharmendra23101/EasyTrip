import { act, render, screen, waitFor } from '@testing-library/react';

import QuieterNearby from '../src/components/place/QuieterNearby';
import { fetchQuieterNearby } from '../src/services/placesApi';

/**
 * The "quieter nearby" panel (`FV-028` stage c).
 *
 * **Most of these assert that nothing is rendered**, which is the right weighting: the API returns an
 * empty list for every place in the catalogue today, so the empty path is the one a reader will
 * actually meet, and the tempting mistake is an empty state. "No quieter places found" would appear
 * on every page and would say something false - that we looked and there was nowhere quieter, when
 * nobody has judged either end.
 *
 * The rest is provenance. A crowd level shown on a page about a *different* place is even easier to
 * read as established fact than one shown in place, so it travels with its source.
 */

jest.mock('../src/services/placesApi', () => ({
  fetchQuieterNearby: jest.fn()
}));

const QUIETER = [
  {
    id: 7,
    name: 'Anegundi',
    crowd_level: 'low',
    distance_km: '8.2',
    seasonality_source: 'editorial',
    seasonality_checked_on: '2026-08-01'
  }
];

beforeEach(() => {
  jest.clearAllMocks();
});

describe('when nobody has judged either end', () => {
  test('an empty list renders nothing at all, not an empty state', async () => {
    fetchQuieterNearby.mockResolvedValue({ data: [] });

    const { container } = render(<QuieterNearby placeId={1} />);

    await waitFor(() => expect(fetchQuieterNearby).toHaveBeenCalledWith(1));
    expect(container).toBeEmptyDOMElement();
  });

  test('a failed request is silent rather than an error on somebody’s holiday reading', async () => {
    fetchQuieterNearby.mockRejectedValue(new Error('network down'));

    const { container } = render(<QuieterNearby placeId={1} />);

    await waitFor(() => expect(fetchQuieterNearby).toHaveBeenCalled());
    // **The flush is what makes this test able to fail.** `toHaveBeenCalled` is satisfied the moment
    // the effect runs, which is before the rejected promise settles - so the DOM was asserted empty
    // while it was still empty for the trivial reason. Mutation `Q2`, which renders an error card
    // from the `catch`, survived all nine assertions until this line existed.
    await act(async () => {
      await Promise.resolve();
    });
    expect(container).toBeEmptyDOMElement();
  });

  test('a malformed payload does not crash the page', async () => {
    // The panel is a lateral suggestion on a page that must still render.
    fetchQuieterNearby.mockResolvedValue(undefined);

    const { container } = render(<QuieterNearby placeId={1} />);

    await waitFor(() => expect(fetchQuieterNearby).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
    expect(container).toBeEmptyDOMElement();
  });

  test('a response with no data key is an empty list, not a crash', async () => {
    // A different shape from `undefined`, and the difference is the whole point: an absent response
    // throws inside the `.then` and is swallowed by the same `catch` that handles a network error,
    // so it cannot distinguish `response?.data || []` from `response.data`. An object with no `data`
    // reaches `setPlaces` intact, and only the `|| []` stops `places.length` throwing in render.
    fetchQuieterNearby.mockResolvedValue({});

    const { container } = render(<QuieterNearby placeId={1} />);

    await waitFor(() => expect(fetchQuieterNearby).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
    expect(container).toBeEmptyDOMElement();
  });

  test('no request is made without a place', async () => {
    render(<QuieterNearby />);
    expect(fetchQuieterNearby).not.toHaveBeenCalled();
  });
});

describe('when there is something quieter', () => {
  test('the place, how busy it is, and how far away all appear', async () => {
    // "Quieter" alone is not actionable. "Quieter, and 8.2 km away" is.
    fetchQuieterNearby.mockResolvedValue({ data: QUIETER });

    render(<QuieterNearby placeId={1} />);

    expect(await screen.findByText('Anegundi')).toBeInTheDocument();
    expect(screen.getByText(/Usually quiet · 8.2 km away/)).toBeInTheDocument();
  });

  test('the claim carries its source, because it is a claim about another place', async () => {
    fetchQuieterNearby.mockResolvedValue({ data: QUIETER });

    render(<QuieterNearby placeId={1} />);

    expect(await screen.findByText(/From our own research/)).toBeInTheDocument();
    expect(screen.getByText(/checked 2026-08-01/)).toBeInTheDocument();
  });

  test('an unattributed suggestion still renders, without inventing a source', async () => {
    // The API will not serve one - the CHECK constraint refuses it - but the component must not
    // print "From undefined" if a future writer ever gets round the database.
    fetchQuieterNearby.mockResolvedValue({
      data: [{ ...QUIETER[0], seasonality_source: null, seasonality_checked_on: null }]
    });

    render(<QuieterNearby placeId={1} />);

    expect(await screen.findByText('Anegundi')).toBeInTheDocument();
    // Asserted on the **prefix**, not on "From undefined". React renders `undefined` as nothing, so
    // an unguarded label reads as a bare "From" and the obvious assertion cannot see it - mutation
    // `Q5` printed the attribution line unconditionally and survived on that technicality.
    expect(screen.queryByText(/^From/)).not.toBeInTheDocument();
  });

  test('each suggestion links to its own page', async () => {
    fetchQuieterNearby.mockResolvedValue({ data: QUIETER });

    render(<QuieterNearby placeId={1} />);

    const link = await screen.findByRole('link', { name: /Anegundi/ });
    expect(link).toHaveAttribute('href', '/places/7');
  });

  test('the heading says who judged it, not that it is a fact', async () => {
    // "Somebody judged these less crowded" rather than "these are less crowded". The panel is
    // reporting a curated opinion and says so.
    fetchQuieterNearby.mockResolvedValue({ data: QUIETER });

    render(<QuieterNearby placeId={1} />);

    expect(await screen.findByText(/Somebody judged these less crowded/i)).toBeInTheDocument();
  });
});
