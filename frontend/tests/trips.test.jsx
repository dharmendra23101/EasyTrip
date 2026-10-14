import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TripsPage from '../src/pages/trips/index';
import tripService from '../src/services/tripService';

/**
 * "My Trips" (`IMP-109` / `FV-006`).
 *
 * The list page. What is worth asserting is the same pair as everywhere else in Track A — the
 * three states are genuinely three, and a failed action does not hide the data it failed to change
 * — plus one rule specific to this page: **a trip that ends before it starts is refused in three
 * places**, and the one here exists so the user finds out while typing.
 */

const mockPush = jest.fn();
jest.mock('next/router', () => ({ useRouter: () => ({ push: mockPush, query: {} }) }));

const mockAuth = {
  currentUser: { uid: 'u1' },
  loading: false,
  getIdToken: jest.fn(async () => 't')
};
jest.mock('../src/context/AuthContext', () => ({ useAuth: () => mockAuth }));

jest.mock('../src/services/tripService', () => ({
  __esModule: true,
  default: {
    listTrips: jest.fn(),
    createTrip: jest.fn(),
    deleteTrip: jest.fn()
  }
}));

const trip = (over = {}) => ({
  id: 7,
  title: 'Karnataka in March',
  description: null,
  start_date: '2026-03-01',
  end_date: '2026-03-05',
  status: 'draft',
  day_count: 5,
  item_count: 3,
  ...over
});

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.currentUser = { uid: 'u1' };
  mockAuth.loading = false;
  tripService.listTrips.mockResolvedValue([]);
  tripService.createTrip.mockResolvedValue(trip());
  tripService.deleteTrip.mockResolvedValue(true);
});

describe('the three states are genuinely three states', () => {
  test('empty invites the user to plan one, and claims no failure', async () => {
    render(<TripsPage />);

    expect(await screen.findByRole('heading', { name: /no trips yet/i })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('a load failure never renders the empty-state copy', async () => {
    tripService.listTrips.mockRejectedValue(new Error('offline'));

    render(<TripsPage />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/could not load your trips/i);
    expect(alert).toHaveTextContent(/still there/i);
    expect(screen.queryByRole('heading', { name: /no trips yet/i })).not.toBeInTheDocument();
  });

  test('the error state retries through the same loader', async () => {
    tripService.listTrips.mockRejectedValueOnce(new Error('offline'));
    render(<TripsPage />);
    await screen.findByRole('alert');

    tripService.listTrips.mockResolvedValue([trip()]);
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));

    expect(await screen.findByRole('link', { name: 'Karnataka in March' })).toBeInTheDocument();
  });
});

describe('a trip card', () => {
  test('links into its workspace and reports its real counts', async () => {
    tripService.listTrips.mockResolvedValue([trip()]);

    render(<TripsPage />);

    expect(await screen.findByRole('link', { name: 'Karnataka in March' })).toHaveAttribute(
      'href',
      '/trips/7'
    );
    expect(screen.getByText(/5 days · 3 items/)).toBeInTheDocument();
  });

  test('an empty trip still appears, and says so rather than vanishing', async () => {
    // The regression an inner join on the server would cause: a brand-new trip disappearing from
    // the list, which is exactly the trip a first-time user has.
    tripService.listTrips.mockResolvedValue([trip({ day_count: 1, item_count: 0 })]);

    render(<TripsPage />);

    expect(await screen.findByRole('link', { name: 'Karnataka in March' })).toBeInTheDocument();
    expect(screen.getByText(/1 day · 0 items/)).toBeInTheDocument();
  });

  test('deleting removes it from the list', async () => {
    tripService.listTrips.mockResolvedValue([trip()]);
    render(<TripsPage />);
    await screen.findByRole('link', { name: 'Karnataka in March' });

    await userEvent.click(screen.getByRole('button', { name: /delete the trip/i }));

    expect(tripService.deleteTrip).toHaveBeenCalledWith(7, 't');
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Karnataka in March' })).not.toBeInTheDocument()
    );
  });

  test('a failed delete keeps the trip on screen', async () => {
    // Not optimistic: a trip is somebody's plan and deleting it cannot be undone, so showing it
    // gone before the server agrees would be the worst possible lie this page can tell.
    tripService.listTrips.mockResolvedValue([trip()]);
    tripService.deleteTrip.mockRejectedValue(new Error('offline'));

    render(<TripsPage />);
    await screen.findByRole('link', { name: 'Karnataka in March' });
    await userEvent.click(screen.getByRole('button', { name: /delete the trip/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Karnataka in March' })).toBeInTheDocument();
  });
});

describe('creating a trip', () => {
  const openForm = async () => {
    render(<TripsPage />);
    await screen.findByRole('heading', { name: /no trips yet/i });
    await userEvent.click(screen.getByRole('button', { name: /^new trip$/i }));
  };

  test('a title is enough — dates are optional', async () => {
    await openForm();

    await userEvent.type(screen.getByLabelText(/trip name/i), 'Weekend in Coorg');
    await userEvent.click(screen.getByRole('button', { name: /create trip/i }));

    expect(tripService.createTrip).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Weekend in Coorg' }),
      't'
    );
  });

  test('it navigates into the new trip, because an empty list page is not the destination', async () => {
    await openForm();
    await userEvent.type(screen.getByLabelText(/trip name/i), 'Weekend in Coorg');
    await userEvent.click(screen.getByRole('button', { name: /create trip/i }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/trips/7'));
  });

  test('an end date before the start is refused before it is sent', async () => {
    await openForm();

    await userEvent.type(screen.getByLabelText(/trip name/i), 'Backwards');
    await userEvent.type(screen.getByLabelText(/start date/i), '2026-03-10');
    await userEvent.type(screen.getByLabelText(/end date/i), '2026-03-01');

    expect(await screen.findByText(/cannot end before it starts/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create trip/i })).toBeDisabled();
    expect(tripService.createTrip).not.toHaveBeenCalled();
  });

  test('a failed create reports it and keeps the form open', async () => {
    tripService.createTrip.mockRejectedValue(new Error('offline'));
    await openForm();

    await userEvent.type(screen.getByLabelText(/trip name/i), 'Weekend in Coorg');
    await userEvent.click(screen.getByRole('button', { name: /create trip/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    // Still open, so the user does not have to retype what they just typed.
    expect(screen.getByLabelText(/trip name/i)).toHaveValue('Weekend in Coorg');
    expect(mockPush).not.toHaveBeenCalledWith(expect.stringContaining('/trips/'));
  });
});

describe('a trip list is not public', () => {
  test('a signed-out visitor is sent to sign in', async () => {
    mockAuth.currentUser = null;

    render(<TripsPage />);

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/login'));
    expect(tripService.listTrips).not.toHaveBeenCalled();
  });

  test('the redirect waits for auth to resolve', async () => {
    mockAuth.currentUser = null;
    mockAuth.loading = true;

    render(<TripsPage />);

    await waitFor(() => expect(mockPush).not.toHaveBeenCalled());
  });
});
