import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TripActivity from '../src/components/trips/TripActivity';
import { getTripActivity } from '../src/services/tripActivityService';

/**
 * The trip activity feed (`BL-147`) — the reader `ADR-056` required before the table was allowed.
 *
 * **The assertions that matter are the three the panel could get subtly wrong**, none of which is
 * "does it list the entries":
 *
 *   1. **It fetches nothing until it is opened.** The workspace already makes several authenticated
 *      requests on mount; a history nobody asked for should not be one more.
 *   2. **Empty and failed are different screens** (`IMP-031`). An empty list under an error message
 *      reads as *"nothing happened"*, which is the opposite of what happened.
 *   3. **It says what it does not record.** Six actions are tracked and notes, checklist and
 *      expenses are not — a reader who does not know that reads silence as a guarantee.
 */

jest.mock('../src/services/tripActivityService', () => ({
  __esModule: true,
  getTripActivity: jest.fn()
}));

const entry = (over = {}) => ({
  id: 10,
  actor_uid: 'seed-other-uid',
  actor_label: 'Priya',
  action: 'day.added',
  detail: { dayNumber: 2 },
  created_at: '2026-03-01T09:30:00.000Z',
  ...over
});

const getToken = jest.fn().mockResolvedValue('token');

const open = async () => userEvent.click(screen.getByRole('button', { name: /show/i }));

beforeEach(() => {
  jest.clearAllMocks();
  getTripActivity.mockResolvedValue([entry()]);
});

describe('it costs nothing until somebody asks', () => {
  test('renders without fetching', () => {
    render(<TripActivity tripId={1} getToken={getToken} />);

    expect(getTripActivity).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /show/i })).toBeInTheDocument();
  });

  test('opening it is the request', async () => {
    render(<TripActivity tripId={1} getToken={getToken} />);
    await open();

    await waitFor(() => expect(getTripActivity).toHaveBeenCalledTimes(1));
    expect(getTripActivity).toHaveBeenCalledWith(
      1,
      'token',
      expect.objectContaining({ limit: 25 })
    );
  });
});

describe('what it says', () => {
  test('renders a sentence, not an action id', async () => {
    render(<TripActivity tripId={1} getToken={getToken} />);
    await open();

    expect(await screen.findByText(/added day 2/i)).toBeInTheDocument();
    expect(screen.getByText('Priya')).toBeInTheDocument();
    // The raw id must never reach the reader — that is what the shared vocabulary is for.
    expect(screen.queryByText('day.added')).not.toBeInTheDocument();
  });

  test('an entry whose actor has no user row yet says "Someone", not nothing', async () => {
    // `users` rows are created lazily on first authenticated request, so somebody's first action
    // can precede their row. A line reading "removed day 2" with no subject is a gap a reader fills
    // in with the wrong guess.
    getTripActivity.mockResolvedValue([entry({ actor_label: null, action: 'day.removed' })]);

    render(<TripActivity tripId={1} getToken={getToken} />);
    await open();

    expect(await screen.findByText('Someone')).toBeInTheDocument();
    expect(screen.getByText(/removed day 2/i)).toBeInTheDocument();
  });

  test('a changed item names the fields and not their values', async () => {
    getTripActivity.mockResolvedValue([
      entry({ action: 'item.updated', detail: { title: 'Red Fort', fields: ['notes'] } })
    ]);

    render(<TripActivity tripId={1} getToken={getToken} />);
    await open();

    expect(await screen.findByText(/changed Red Fort \(notes\)/i)).toBeInTheDocument();
  });

  test('a reorder pluralises its count', async () => {
    getTripActivity.mockResolvedValue([
      entry({ id: 1, action: 'items.reordered', detail: { dayNumber: 3, count: 1 } })
    ]);

    render(<TripActivity tripId={1} getToken={getToken} />);
    await open();

    expect(await screen.findByText(/reordered day 3 \(1 item\)/i)).toBeInTheDocument();
  });

  test('states what it does NOT record, before anything is loaded', () => {
    // Before opening, so it reads as a description of the panel rather than as an excuse for
    // whatever the list happens to contain.
    render(<TripActivity tripId={1} getToken={getToken} />);

    expect(
      screen.getByText(/notes, the checklist and expenses are not tracked here/i)
    ).toBeInTheDocument();
  });
});

describe('empty and failed are not the same screen', () => {
  test('an empty feed says nobody has changed anything', async () => {
    getTripActivity.mockResolvedValue([]);

    render(<TripActivity tripId={1} getToken={getToken} />);
    await open();

    expect(await screen.findByText(/nobody has changed the days or items/i)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('a failed load shows the error and no list at all', async () => {
    getTripActivity.mockRejectedValue(new Error('Could not load the recent changes for this trip'));

    render(<TripActivity tripId={1} getToken={getToken} />);
    await open();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/could not load the recent changes/i);
    // The assertion that separates the two states: no entry, and crucially no "nobody has changed
    // anything" either — that sentence is an answer, and this screen does not have one.
    expect(screen.queryByText('Priya')).not.toBeInTheDocument();
    expect(screen.queryByText(/nobody has changed the days or items/i)).not.toBeInTheDocument();
  });
});

describe('a failed page is not a failed load', () => {
  test('entries already fetched survive a failed "show older"', async () => {
    // The distinction `IMP-031` is really about. `useAuditLog` clears on failure because its
    // failures follow a *filter change*, where old rows under a new heading are a wrong answer.
    // Paging is not a filter change: these twenty-five rows are still exactly as true as they were,
    // and throwing them away because a request for older ones failed loses information the reader
    // had and tells them nothing.
    const page = Array.from({ length: 25 }, (_, i) => entry({ id: 100 - i }));
    getTripActivity.mockResolvedValueOnce(page).mockRejectedValueOnce(new Error('Network is down'));

    render(<TripActivity tripId={1} getToken={getToken} />);
    await open();
    await screen.findAllByText('Priya');

    await userEvent.click(screen.getByRole('button', { name: /show older/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/network is down/i);
    expect(screen.getAllByText('Priya')).toHaveLength(25);
  });
});

describe('paging', () => {
  test('a full page offers older entries and asks for them by id', async () => {
    const page = Array.from({ length: 25 }, (_, i) => entry({ id: 100 - i }));
    getTripActivity.mockResolvedValue(page);

    render(<TripActivity tripId={1} getToken={getToken} />);
    await open();

    await screen.findAllByText('Priya');
    await userEvent.click(screen.getByRole('button', { name: /show older/i }));

    await waitFor(() => expect(getTripActivity).toHaveBeenCalledTimes(2));
    // The cursor is the oldest id on screen, not an offset: two rows written in one transaction
    // share a timestamp, and an offset over a non-unique order repeats and skips rows.
    expect(getTripActivity).toHaveBeenLastCalledWith(
      1,
      'token',
      expect.objectContaining({ before: 76 })
    );
  });

  test('a short page offers nothing more, because there is nothing more', async () => {
    render(<TripActivity tripId={1} getToken={getToken} />);
    await open();

    await screen.findByText('Priya');
    expect(screen.queryByRole('button', { name: /show older/i })).not.toBeInTheDocument();
  });
});
