import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MyReviews from '../src/components/profile/MyReviews';
import reviewHistoryService from '../src/services/reviewHistoryService';
import { deletePlaceReview } from '../src/services/placeService';

/**
 * "Your reviews" on the profile page (`IMP-117`).
 *
 * Two properties are worth holding here, and neither is "the list renders".
 *
 * 1. **Empty and failed are different states.** Both render zero rows, and saying *"you have not
 *    written any reviews"* after a network error tells somebody their writing is gone. That is the
 *    `IMP-031` conflation, and it is worse here than on the wishlist — a review is a paragraph the
 *    user composed, not a bookmark they can re-add in one tap.
 * 2. **Delete goes through the place route.** `IMP-019` enforces ownership there, in SQL. If this
 *    component ever grew its own delete path, ownership would be enforced in two places and the
 *    second one is where it eventually gets forgotten.
 */

jest.mock('../src/services/reviewHistoryService', () => ({
  __esModule: true,
  default: { getMyReviews: jest.fn() }
}));
jest.mock('../src/services/placeService', () => ({
  __esModule: true,
  deletePlaceReview: jest.fn()
}));

const mockAuth = {
  currentUser: { uid: 'u1' },
  loading: false,
  getIdToken: jest.fn(async () => 't')
};
jest.mock('../src/context/AuthContext', () => ({ useAuth: () => mockAuth }));

const review = (over = {}) => ({
  id: 11,
  place_id: 3,
  place_name: 'Hampi',
  place_location: 'Karnataka',
  place_image_url: null,
  rating: 4,
  comment: 'Unreal at sunrise.',
  created_at: '2026-02-01T10:00:00Z',
  updated_at: '2026-02-02T10:00:00Z',
  ...over
});

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.currentUser = { uid: 'u1' };
  mockAuth.loading = false;
  reviewHistoryService.getMyReviews.mockResolvedValue([]);
  deletePlaceReview.mockResolvedValue(true);
});

describe('the three states are genuinely three states', () => {
  test('empty invites the user to write one, and does not claim a failure', async () => {
    render(<MyReviews />);

    expect(await screen.findByText(/have not written any reviews/i)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('a load failure never renders the empty-state copy', async () => {
    reviewHistoryService.getMyReviews.mockRejectedValue(new Error('offline'));

    render(<MyReviews />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/could not load your reviews/i);
    // The assertion that matters. "You have not written any reviews" after a failed request is a
    // claim about the user's data, not about the network.
    expect(screen.queryByText(/have not written any reviews/i)).not.toBeInTheDocument();
    expect(alert).toHaveTextContent(/nothing has been deleted/i);
  });

  test('the error state retries through the same loader', async () => {
    reviewHistoryService.getMyReviews.mockRejectedValueOnce(new Error('offline'));
    render(<MyReviews />);
    await screen.findByRole('alert');

    reviewHistoryService.getMyReviews.mockResolvedValue([review()]);
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));

    expect(await screen.findByText('Hampi')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('what a review card carries', () => {
  test('the place name links back to the place, and the rating is announced', async () => {
    reviewHistoryService.getMyReviews.mockResolvedValue([review()]);

    render(<MyReviews />);

    expect(await screen.findByRole('link', { name: 'Hampi' })).toHaveAttribute('href', '/places/3');
    // A row of five icons means nothing to a screen reader without this.
    expect(screen.getByLabelText('4 out of 5')).toBeInTheDocument();
    expect(screen.getByText('Unreal at sunrise.')).toBeInTheDocument();
  });

  test('a review with no comment still renders its rating and place', async () => {
    reviewHistoryService.getMyReviews.mockResolvedValue([review({ comment: null })]);

    render(<MyReviews />);

    expect(await screen.findByRole('link', { name: 'Hampi' })).toBeInTheDocument();
    expect(screen.getByLabelText('4 out of 5')).toBeInTheDocument();
  });

  test('the count is announced and pluralised', async () => {
    // Two independent renders, not a `rerender`: the hook loads on mount and on an auth change,
    // and deliberately not on every render — so re-rendering with a new mock would assert against
    // the first payload and pass for the wrong reason.
    //
    // And queried by text, not by `role="status"`: `LoadingSpinner` claims that role too, so
    // `findByRole('status')` resolves against the spinner the instant it mounts and returns an
    // element whose only text is an `aria-label`. It passed nothing and failed confusingly.
    reviewHistoryService.getMyReviews.mockResolvedValue([review()]);
    const single = render(<MyReviews />);
    expect(await screen.findByText('1 review')).toBeInTheDocument();
    single.unmount();

    reviewHistoryService.getMyReviews.mockResolvedValue([
      review(),
      review({ id: 12, place_id: 4 })
    ]);
    render(<MyReviews />);
    expect(await screen.findByText('2 reviews')).toBeInTheDocument();
  });
});

describe('deleting a review', () => {
  test('calls the owner-gated place route with the place and review ids', async () => {
    reviewHistoryService.getMyReviews.mockResolvedValue([review()]);
    render(<MyReviews />);
    await screen.findByText('Hampi');

    await userEvent.click(screen.getByRole('button', { name: /delete your review of Hampi/i }));

    // Place-scoped, because that is where the server checks ownership. A history-scoped delete
    // would be a second endpoint enforcing one rule.
    expect(deletePlaceReview).toHaveBeenCalledWith(3, 11, 't');
    await waitFor(() => expect(screen.queryByText('Hampi')).not.toBeInTheDocument());
  });

  test('a failed delete leaves the review on screen rather than pretending', async () => {
    // Not optimistic, deliberately: a deleted review cannot be undone, so showing it gone before
    // the server agrees would be the most alarming possible lie this component can tell.
    reviewHistoryService.getMyReviews.mockResolvedValue([review()]);
    deletePlaceReview.mockRejectedValue(new Error('offline'));

    render(<MyReviews />);
    await screen.findByText('Hampi');

    await userEvent.click(screen.getByRole('button', { name: /delete your review of Hampi/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByText('Hampi')).toBeInTheDocument();
  });

  test('editing points at the place page, not at a second write path', async () => {
    reviewHistoryService.getMyReviews.mockResolvedValue([review()]);
    render(<MyReviews />);

    const edit = await screen.findByRole('link', { name: /edit/i });
    expect(edit).toHaveAttribute('href', '/places/3#reviews');
  });
});

describe('a signed-out visitor', () => {
  test('is not shown a history and the server is never called', async () => {
    mockAuth.currentUser = null;

    render(<MyReviews />);

    await screen.findByText(/have not written any reviews/i);
    expect(reviewHistoryService.getMyReviews).not.toHaveBeenCalled();
  });
});
