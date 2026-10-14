import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SavedPlaces from '../src/pages/saved';

/**
 * The saved-places page — the view half of `IMP-108`.
 *
 * **What is worth asserting here is the three states, not the grid.** Phase 7's success metric is
 * *"no feature shipped without an empty, loading, and error state"*, and the failure this suite
 * really guards is the one `IMP-031` names: **rendering "nothing saved yet" when the request
 * failed.** That message tells a user their data is gone. It is the most alarming thing this page
 * can say and the easiest to say by accident, because `places.length === 0` is true in both cases.
 */

const mockPush = jest.fn();
jest.mock('next/router', () => ({ useRouter: () => ({ push: mockPush }) }));

const mockAuth = { currentUser: { uid: 'u1' }, loading: false };
jest.mock('../src/context/AuthContext', () => ({ useAuth: () => mockAuth }));

const wishlist = {
  places: [],
  loading: false,
  error: null,
  refresh: jest.fn(),
  ready: true
};
jest.mock('../src/hooks/useWishlist', () => ({ useWishlist: () => wishlist }));

jest.mock('../src/components/PlaceCard', () => ({
  __esModule: true,
  default: ({ place }) => <article data-testid="place-card">{place.name}</article>
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.currentUser = { uid: 'u1' };
  mockAuth.loading = false;
  Object.assign(wishlist, { places: [], loading: false, error: null, ready: true });
});

describe('the three states are genuinely three states', () => {
  test('empty renders the invitation, and does not claim anything went wrong', () => {
    render(<SavedPlaces />);

    expect(screen.getByRole('heading', { name: /nothing saved yet/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /explore places/i })).toHaveAttribute(
      'href',
      '/browse'
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('a load failure says the data is safe — it never says the list is empty', async () => {
    wishlist.error = new Error('network');

    render(<SavedPlaces />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/could not load/i);
    // The assertion that matters: the empty-state copy must be absent. Showing it here would tell
    // somebody their saved places were deleted by a transient network error.
    expect(screen.queryByText(/nothing saved yet/i)).not.toBeInTheDocument();
  });

  test('the error state offers a retry that actually calls refresh', async () => {
    wishlist.error = new Error('network');
    render(<SavedPlaces />);

    await userEvent.click(screen.getByRole('button', { name: /try again/i }));

    expect(wishlist.refresh).toHaveBeenCalledTimes(1);
  });

  test('loading shows neither the empty state nor the error state', () => {
    wishlist.ready = false;

    render(<SavedPlaces />);

    expect(screen.queryByText(/nothing saved yet/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('saved places render as cards, in the order the API returned them', () => {
    wishlist.places = [
      { id: 3, name: 'Coorg' },
      { id: 1, name: 'Hampi' }
    ];

    render(<SavedPlaces />);

    const cards = screen.getAllByTestId('place-card');
    expect(cards.map((c) => c.textContent)).toEqual(['Coorg', 'Hampi']);
    // The server orders newest-first; re-sorting client-side would silently override it.
    expect(screen.queryByText(/nothing saved yet/i)).not.toBeInTheDocument();
  });

  test('the count is announced for screen readers, and pluralised', () => {
    wishlist.places = [{ id: 1, name: 'Hampi' }];
    const { rerender } = render(<SavedPlaces />);
    expect(screen.getByRole('status')).toHaveTextContent('1 saved place');

    wishlist.places = [
      { id: 1, name: 'Hampi' },
      { id: 2, name: 'Coorg' }
    ];
    rerender(<SavedPlaces />);
    expect(screen.getByRole('status')).toHaveTextContent('2 saved places');
  });
});

describe('a personal list is not public', () => {
  test('a signed-out visitor is sent to sign in rather than shown a list', async () => {
    mockAuth.currentUser = null;

    render(<SavedPlaces />);

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/login'));
  });

  test('the redirect waits for auth to resolve, or every reload bounces the user out', async () => {
    // `currentUser` is null while Firebase restores the session. Redirecting on that would throw a
    // signed-in user to /login on every hard refresh.
    mockAuth.currentUser = null;
    mockAuth.loading = true;

    render(<SavedPlaces />);

    await waitFor(() => expect(mockPush).not.toHaveBeenCalled());
  });
});
