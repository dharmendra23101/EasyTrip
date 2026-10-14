import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import ShareTripPanel from '../src/components/trips/ShareTripPanel';
import SharedTripPage from '../src/pages/shared/[token]';
import tripService from '../src/services/tripService';

/**
 * The read-only share link (`FV-009` stage c), both ends.
 *
 * **A share link is a bearer credential in a URL**, and the interface has two jobs that follow from
 * that: say so plainly before somebody pastes it into a group chat, and put the undo one click from
 * where the link is displayed. Most of what is tested here is those two things — the happy path is
 * one call and one string.
 *
 * The public page's job is narrower and mostly negative: it must show the plan, must not show the
 * token that produced it, and must give the same answer for a revoked link as for one that never
 * existed.
 */

jest.mock('../src/services/tripService', () => ({
  __esModule: true,
  default: {
    getShare: jest.fn(),
    createShare: jest.fn(),
    revokeShare: jest.fn(),
    getSharedTrip: jest.fn()
  }
}));

const getToken = jest.fn().mockResolvedValue('token-123');

const TOKEN = 'A'.repeat(43);
const OTHER_TOKEN = 'B'.repeat(43);

const SHARED = { shared: true, share_token: TOKEN, shared_at: '2026-02-14T10:00:00Z' };
const NOT_SHARED = { shared: false, share_token: null, shared_at: null };

const TRIP = {
  id: 1,
  title: 'Karnataka in March',
  start_date: '2026-03-01',
  days: [{ id: 10, day_number: 1, items: [{ id: 100, title: 'Hampi', start_time: '06:30:00' }] }]
};

beforeEach(() => {
  jest.clearAllMocks();
  getToken.mockResolvedValue('token-123');
  tripService.getShare.mockResolvedValue(NOT_SHARED);
  window.confirm = jest.fn(() => true);
  Object.assign(navigator, { clipboard: { writeText: jest.fn().mockResolvedValue() } });
});

// ---------------------------------------------------------------------------
// Saying what the link is
// ---------------------------------------------------------------------------
describe('the panel says what the link actually is', () => {
  test('it warns that anybody holding the link can read the trip', async () => {
    // Somebody about to paste this into a group chat is entitled to know it is a key rather than an
    // invitation, before they do it rather than after.
    render(<ShareTripPanel tripId={1} getToken={getToken} />);

    expect(await screen.findByText(/without signing in/i)).toBeInTheDocument();
    expect(screen.getByText(/like a key/i)).toBeInTheDocument();
  });

  test('it says the notes and checklist are not shared', async () => {
    // A reader who does not know this will either withhold a link they could safely send, or send
    // one believing it shows less than it does.
    render(<ShareTripPanel tripId={1} getToken={getToken} />);

    // The whole sentence, matched across the elements it is split over — `/not/` on its own matches
    // half the panel and would pass against wording that said the opposite.
    const blurb = (await screen.findByText(/read-only link/i)).closest('p');
    expect(blurb).toHaveTextContent(/Your notes and your checklist are\s*not\s*shared/i);
  });
});

// ---------------------------------------------------------------------------
// Creating, copying, rotating, revoking
// ---------------------------------------------------------------------------
describe('the link, and the two ways to take it back', () => {
  test('an unshared trip offers to create one', async () => {
    render(<ShareTripPanel tripId={1} getToken={getToken} />);

    expect(await screen.findByRole('button', { name: /create a share link/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/share link/i)).not.toBeInTheDocument();
  });

  test('creating shows the full URL somebody can paste', async () => {
    tripService.createShare.mockResolvedValue(SHARED);

    render(<ShareTripPanel tripId={1} getToken={getToken} />);
    await userEvent.click(await screen.findByRole('button', { name: /create a share link/i }));

    const field = await screen.findByLabelText(/share link/i);
    // The whole URL, not the bare token: a token alone is not something anybody can use.
    expect(field).toHaveValue(`${window.location.origin}/shared/${TOKEN}`);
  });

  test('the field is read-only rather than disabled, so it can still be selected', async () => {
    // A disabled input cannot be focused, so somebody whose clipboard is blocked could not copy the
    // link by hand — which is the fallback the copy button quietly relies on.
    tripService.getShare.mockResolvedValue(SHARED);

    render(<ShareTripPanel tripId={1} getToken={getToken} />);

    const field = await screen.findByLabelText(/share link/i);
    expect(field).toHaveAttribute('readonly');
    expect(field).not.toBeDisabled();
  });

  test('copying puts the URL on the clipboard', async () => {
    tripService.getShare.mockResolvedValue(SHARED);

    render(<ShareTripPanel tripId={1} getToken={getToken} />);
    await userEvent.click(await screen.findByRole('button', { name: /copy/i }));

    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        `${window.location.origin}/shared/${TOKEN}`
      )
    );
    expect(await screen.findByRole('button', { name: /copied/i })).toBeInTheDocument();
  });

  test('a refused clipboard is not an error, because the link is on screen anyway', async () => {
    tripService.getShare.mockResolvedValue(SHARED);
    navigator.clipboard.writeText.mockRejectedValue(new Error('denied'));

    render(<ShareTripPanel tripId={1} getToken={getToken} />);
    await userEvent.click(await screen.findByRole('button', { name: /copy/i }));

    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('rotating replaces the link, and confirms first', async () => {
    // The control for "that link went further than I meant, but I still want to share this trip".
    tripService.getShare.mockResolvedValue(SHARED);
    tripService.createShare.mockResolvedValue({ ...SHARED, share_token: OTHER_TOKEN });

    render(<ShareTripPanel tripId={1} getToken={getToken} />);
    await userEvent.click(await screen.findByRole('button', { name: /new link/i }));

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByLabelText(/share link/i)).toHaveValue(
        `${window.location.origin}/shared/${OTHER_TOKEN}`
      )
    );
  });

  test('revoking removes the link and confirms first', async () => {
    tripService.getShare.mockResolvedValue(SHARED);
    tripService.revokeShare.mockResolvedValue(true);

    render(<ShareTripPanel tripId={1} getToken={getToken} />);
    await userEvent.click(await screen.findByRole('button', { name: /stop sharing/i }));

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /create a share link/i })).toBeInTheDocument()
    );
    expect(screen.queryByLabelText(/share link/i)).not.toBeInTheDocument();
  });

  test('declining the confirmation does nothing at all', async () => {
    // Both controls destroy something already in circulation, so a mis-click must be recoverable.
    tripService.getShare.mockResolvedValue(SHARED);
    window.confirm = jest.fn(() => false);

    render(<ShareTripPanel tripId={1} getToken={getToken} />);
    await userEvent.click(await screen.findByRole('button', { name: /stop sharing/i }));
    await userEvent.click(screen.getByRole('button', { name: /new link/i }));

    expect(tripService.revokeShare).not.toHaveBeenCalled();
    expect(tripService.createShare).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/share link/i)).toHaveValue(
      `${window.location.origin}/shared/${TOKEN}`
    );
  });

  test('a failure is shown rather than swallowed', async () => {
    tripService.createShare.mockRejectedValue(new Error('Could not create a share link'));

    render(<ShareTripPanel tripId={1} getToken={getToken} />);
    await userEvent.click(await screen.findByRole('button', { name: /create a share link/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not create a share link');
  });
});

// ---------------------------------------------------------------------------
// The public page
// ---------------------------------------------------------------------------
describe('the page somebody who is not signed in sees', () => {
  test('it renders the itinerary', () => {
    render(<SharedTripPage trip={TRIP} />);

    expect(screen.getByText('Karnataka in March')).toBeInTheDocument();
    expect(screen.getByText('Hampi')).toBeInTheDocument();
  });

  test('it says the reader cannot change anything', () => {
    render(<SharedTripPage trip={TRIP} />);
    expect(screen.getByText(/read-only/i)).toBeInTheDocument();
  });

  test('it offers no controls, because it reuses the printable document', () => {
    // `PrintableItinerary` has no buttons or form fields by construction, so a control added to the
    // workspace can never appear here by accident.
    const { container } = render(<SharedTripPage trip={TRIP} />);

    expect(container.querySelectorAll('button')).toHaveLength(0);
    expect(container.querySelectorAll('input, textarea, select')).toHaveLength(0);
  });

  test('an invalid link gets one message for three different causes', () => {
    // Revoked, mistyped and never-existed are indistinguishable on purpose: telling them apart says
    // whether a token was ever real, which is information about somebody else's trip.
    render(<SharedTripPage trip={null} />);

    expect(screen.getByText(/this link is not valid/i)).toBeInTheDocument();
    expect(screen.getByText(/turned off/i)).toBeInTheDocument();
  });
});
