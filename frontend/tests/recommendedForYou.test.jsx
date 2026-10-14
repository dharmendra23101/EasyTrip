import { render, screen, waitFor } from '@testing-library/react';

import RecommendedForYou from '../src/components/RecommendedForYou';
import { fetchRecommendations } from '../src/services/placesApi';

/**
 * The recommendations panel (`FV-019`).
 *
 * **What is tested is the honesty, not the list.** The server decides the order and 19 API
 * assertions hold it to account. What this component can get wrong is presenting a heuristic as
 * something cleverer, or presenting a partial answer as a complete one:
 *
 *   - `FV-019` requires that *"every recommendation answers 'why this?'"*, **as visible UI, not a
 *     debug field** — so each card names the themes it matched on.
 *   - `FP-012` bars relabelling a rule-based feature as AI, and this item is called out for it by
 *     name. The panel says in the interface that it is comparing tags.
 *   - Places nobody has tagged could not be considered, and the count is shown. "We looked at
 *     everything" would be untrue while that number is non-zero.
 *   - Nothing saved is a specific, fixable state — not an empty grid and not an error.
 */

jest.mock('../src/services/placesApi', () => ({
  fetchRecommendations: jest.fn()
}));

const getToken = jest.fn().mockResolvedValue('token-123');

const ANSWER = {
  recommendations: [
    { id: 2, name: 'Gokarna', location: 'Uttara Kannada', shared_themes: ['beach'], score: 0.66 },
    { id: 3, name: 'Badami', location: 'Bagalkot', shared_themes: ['historical'], score: 0.33 }
  ],
  basis: {
    saved_count: 3,
    profile: [
      { theme: 'beach', weight: 2 },
      { theme: 'historical', weight: 1 }
    ]
  },
  excluded: { no_themes_recorded: 42 }
};

beforeEach(() => {
  jest.clearAllMocks();
  getToken.mockResolvedValue('token-123');
});

describe('every recommendation says why, on the card', () => {
  test('each one names the themes it matched on', async () => {
    // The difference between a recommendation and an assertion: the reader can check this against
    // their own saved list and disagree with it.
    fetchRecommendations.mockResolvedValue(ANSWER);

    render(<RecommendedForYou getToken={getToken} />);

    expect(await screen.findByText(/Because you save Beach places/)).toBeInTheDocument();
    expect(screen.getByText(/Because you save Historical places/)).toBeInTheDocument();
  });

  test('the themes are rendered as their labels, not their ids', async () => {
    fetchRecommendations.mockResolvedValue(ANSWER);

    render(<RecommendedForYou getToken={getToken} />);
    await screen.findByText(/Because you save Beach places/);

    // `beach` is the stored id; `Beach` is what a person reads.
    expect(screen.queryByText(/Because you save beach places/)).not.toBeInTheDocument();
  });

  test('the profile the whole answer came from is shown', async () => {
    // A recommendation whose input is invisible cannot be argued with.
    fetchRecommendations.mockResolvedValue(ANSWER);

    render(<RecommendedForYou getToken={getToken} />);

    expect(await screen.findByText(/Matching on:/)).toHaveTextContent('Beach (2)');
    expect(screen.getByText(/Matching on:/)).toHaveTextContent('Historical (1)');
  });

  test('each card links to its place', async () => {
    fetchRecommendations.mockResolvedValue(ANSWER);

    render(<RecommendedForYou getToken={getToken} />);

    expect(await screen.findByRole('link', { name: /Gokarna/ })).toHaveAttribute(
      'href',
      '/places/2'
    );
  });
});

describe('it says it is a heuristic', () => {
  test('the panel states it is comparing tags rather than predicting', async () => {
    // `FP-012`. A feature that stays quiet about being a heuristic lets the reader assume it is
    // something cleverer.
    fetchRecommendations.mockResolvedValue(ANSWER);

    render(<RecommendedForYou getToken={getToken} />);

    expect(await screen.findByText(/comparison of tags, not a prediction/i)).toBeInTheDocument();
  });

  test('it never claims to be AI or personalised by a model', async () => {
    fetchRecommendations.mockResolvedValue(ANSWER);

    render(<RecommendedForYou getToken={getToken} />);
    await screen.findByText(/comparison of tags/i);

    expect(screen.queryByText(/\bAI\b/)).not.toBeInTheDocument();
    expect(screen.queryByText(/smart|intelligent|learned/i)).not.toBeInTheDocument();
  });
});

describe('what could not be considered is said out loud', () => {
  test('the count of untagged places is shown', async () => {
    fetchRecommendations.mockResolvedValue(ANSWER);

    render(<RecommendedForYou getToken={getToken} />);

    expect(await screen.findByText(/42 places could not be considered/)).toBeInTheDocument();
  });

  test('nothing is said when nothing was excluded', async () => {
    // The sentence is a correction to an assumption, so it should be absent when the assumption is
    // right rather than rendered as "0 places could not be considered".
    fetchRecommendations.mockResolvedValue({ ...ANSWER, excluded: { no_themes_recorded: 0 } });

    render(<RecommendedForYou getToken={getToken} />);
    await screen.findByText(/Because you save Beach places/);

    expect(screen.queryByText(/could not be considered/)).not.toBeInTheDocument();
  });
});

describe('the two empty states are different states', () => {
  test('nothing saved gets a sentence that says what to do', async () => {
    // Not an empty grid and not an error: a specific, fixable state.
    fetchRecommendations.mockResolvedValue({
      recommendations: [],
      basis: { saved_count: 0, profile: [] },
      excluded: { no_themes_recorded: 42 }
    });

    render(<RecommendedForYou getToken={getToken} />);

    expect(await screen.findByText(/Save a place you like/)).toBeInTheDocument();
  });

  test('saved places that are untagged say so, rather than blaming the reader', async () => {
    // "You have saved nothing" would be false here — they saved things nobody has tagged.
    fetchRecommendations.mockResolvedValue({
      recommendations: [],
      basis: { saved_count: 3, profile: [] },
      excluded: { no_themes_recorded: 42 }
    });

    render(<RecommendedForYou getToken={getToken} />);

    expect(await screen.findByText(/have not been tagged yet/)).toBeInTheDocument();
    expect(screen.queryByText(/Save a place you like/)).not.toBeInTheDocument();
  });

  test('a failed request renders nothing at all, not an empty state', async () => {
    // An empty state here would be a claim about the reader ("you have saved nothing") standing in
    // for a fact about the request.
    fetchRecommendations.mockRejectedValue(new Error('network down'));

    const { container } = render(<RecommendedForYou getToken={getToken} />);

    await waitFor(() => expect(fetchRecommendations).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  test('a profile with no matches renders nothing rather than an empty heading', async () => {
    fetchRecommendations.mockResolvedValue({
      recommendations: [],
      basis: { saved_count: 2, profile: [{ theme: 'tech', weight: 2 }] },
      excluded: { no_themes_recorded: 0 }
    });

    const { container } = render(<RecommendedForYou getToken={getToken} />);

    await waitFor(() => expect(fetchRecommendations).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
