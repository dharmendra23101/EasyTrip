import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminAnalytics from '../src/pages/admin/analytics';
import { adminService } from '../src/services/adminService';

/**
 * The analytics page (`FV-022`, extending `IMP-111` / `ADR-037`).
 *
 * **What this page fixed was a read gap, not a missing metric.** `GET /admin/analytics` has
 * returned four datasets since Sprint 7.11 and the dashboard read one and a half: `activity` was
 * computed on every load and rendered nowhere, `needsAttention` was discarded in favour of counts
 * that linked to the whole catalogue, and `ratings` was collapsed to its sum — throwing away the
 * distribution the model exists to expose.
 *
 * So the assertions worth making are about what a reader can now learn, and about the three ways
 * this kind of page lies:
 *
 *   1. **A chart is invisible to a screen reader.** The SVG is decorative and the numbers are a
 *      real table; asserting the table is asserting that the information, not the picture, shipped.
 *   2. **Empty and failed are different states** (`IMP-031`), and "nothing happened this week" is a
 *      real answer that must not render as a broken chart.
 *   3. **The window is a refetch, not a client-side slice.** Re-slicing 30 days to show 7 would
 *      produce a chart that disagrees with what the server would return for that window.
 */

jest.mock('../src/services/adminService', () => ({
  adminService: { getAnalytics: jest.fn() }
}));
jest.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({ getIdToken: jest.fn(async () => 'tok') })
}));
jest.mock('next/router', () => ({ useRouter: () => ({ push: jest.fn() }) }));

const day = (date, reviews = 0, trips = 0, reports = 0) => ({ date, reviews, trips, reports });

const payload = (over = {}) => ({
  catalogue: {
    places: 4,
    users: 3,
    admins: 1,
    trips: 2,
    saved_places: 5,
    places_without_coordinates: 1,
    places_without_images: 1,
    places_without_reviews: 2,
    average_rating: 3.75,
    open_reports: 0
  },
  ratings: { 1: 0, 2: 0, 3: 1, 4: 1, 5: 1 },
  activity: [day('2026-09-04', 1, 0, 0), day('2026-09-05'), day('2026-09-06', 2, 1, 1)],
  needsAttention: [
    {
      id: 2,
      name: 'Coorg',
      location: 'Karnataka',
      missing_coordinates: true,
      missing_image: false
    }
  ],
  ...over
});

beforeEach(() => jest.clearAllMocks());

describe('the activity series is readable without seeing the chart', () => {
  test('every day and every series is in a real table, not only in the SVG', async () => {
    // The SVG is `aria-hidden`; if this table were dropped the page would show a picture and tell a
    // screen-reader user nothing. Asserted per-cell rather than by row count so a table of the
    // right shape with the wrong numbers still fails.
    adminService.getAnalytics.mockResolvedValue(payload());
    render(<AdminAnalytics />);

    const table = await screen.findByRole('table', { name: /daily activity/i });
    const lastRow = within(table).getByRole('rowheader', { name: '2026-09-06' }).closest('tr');

    expect(
      within(lastRow)
        .getAllByRole('cell')
        .map((c) => c.textContent)
    ).toEqual(['2', '1', '1']);
  });

  test('a quiet day is present at zero rather than skipped', async () => {
    // The property the dense series exists for. A missing row plotted as a line draws a straight
    // segment across the gap, which reads as steady activity rather than none.
    adminService.getAnalytics.mockResolvedValue(payload());
    render(<AdminAnalytics />);

    const table = await screen.findByRole('table', { name: /daily activity/i });
    const quiet = within(table).getByRole('rowheader', { name: '2026-09-05' }).closest('tr');

    expect(
      within(quiet)
        .getAllByRole('cell')
        .map((c) => c.textContent)
    ).toEqual(['0', '0', '0']);
  });

  test('a window where nothing happened says so instead of drawing an empty chart', async () => {
    // Thirty invisible bars and an axis labelled 0 look like a broken render. The sentence is the
    // truth and reads as deliberate — and it is the common case for a project with no deployment.
    adminService.getAnalytics.mockResolvedValue(
      payload({ activity: [day('2026-09-05'), day('2026-09-06')] })
    );
    render(<AdminAnalytics />);

    expect(await screen.findByText(/Nothing happened in the last 2 days/i)).toBeInTheDocument();
  });
});

describe('the rating distribution, which the dashboard threw away', () => {
  test('all five buckets render, including the empty ones', async () => {
    // A chart that shows only non-empty buckets hides the very thing it is for: "no 1-stars" is a
    // fact about the catalogue, not a row to omit.
    adminService.getAnalytics.mockResolvedValue(payload());
    render(<AdminAnalytics />);

    await screen.findByText('5 stars');
    for (const label of ['1 star', '2 stars', '3 stars', '4 stars', '5 stars']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  test('each bucket exposes its proportion to assistive technology, not just a coloured bar', async () => {
    adminService.getAnalytics.mockResolvedValue(payload());
    render(<AdminAnalytics />);

    const meter = await screen.findByRole('meter', { name: /rated 5 out of 5/i });
    expect(meter).toHaveAttribute('aria-valuenow', '1');
    expect(meter).toHaveAttribute('aria-valuemax', '3');
  });

  test('no reviews at all is stated, not drawn as five empty bars', async () => {
    adminService.getAnalytics.mockResolvedValue(
      payload({ ratings: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } })
    );
    render(<AdminAnalytics />);

    expect(await screen.findByText(/No reviews have been left yet/i)).toBeInTheDocument();
  });
});

describe('places to finish link to the place, not to the catalogue', () => {
  test('each row links to that place and says why it is listed', async () => {
    // The whole difference between this list and the dashboard tile it complements. A count that
    // sends you to the full catalogue to find the row yourself is a number, not a task.
    adminService.getAnalytics.mockResolvedValue(payload());
    render(<AdminAnalytics />);

    const link = await screen.findByRole('link', { name: 'Coorg' });
    expect(link).toHaveAttribute('href', '/admin/editPlace/2');
    expect(screen.getByText('No coordinates')).toBeInTheDocument();
    // Only the reasons that apply. `missing_image` is false for this fixture.
    expect(screen.queryByText('No image')).not.toBeInTheDocument();
  });

  test('nothing to finish is stated positively rather than as an empty list', async () => {
    adminService.getAnalytics.mockResolvedValue(payload({ needsAttention: [] }));
    render(<AdminAnalytics />);

    expect(
      await screen.findByText(/Every place has coordinates and an image/i)
    ).toBeInTheDocument();
  });
});

describe('the window is a refetch', () => {
  test('choosing a window asks the server for it', async () => {
    // Not a client-side slice: the series is computed by Postgres over a date range, and re-slicing
    // 30 days to show 7 would disagree with what the server returns for that window.
    adminService.getAnalytics.mockResolvedValue(payload());
    render(<AdminAnalytics />);
    await screen.findByText('5 stars');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '7 days' }));

    await waitFor(() =>
      expect(adminService.getAnalytics).toHaveBeenLastCalledWith('tok', { days: 7 })
    );
    expect(screen.getByRole('button', { name: '7 days' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('the default window is 30 days and is sent explicitly', async () => {
    adminService.getAnalytics.mockResolvedValue(payload());
    render(<AdminAnalytics />);

    await waitFor(() => expect(adminService.getAnalytics).toHaveBeenCalled());
    expect(adminService.getAnalytics).toHaveBeenLastCalledWith('tok', { days: 30 });
  });
});

describe('empty and failed are different states', () => {
  test('a failure is announced and no stale numbers remain', async () => {
    // On a monitoring page a stale chart is worse than an empty one — the reason somebody is
    // looking is to find out whether something changed.
    adminService.getAnalytics.mockResolvedValueOnce(payload());
    render(<AdminAnalytics />);
    await screen.findByText('5 stars');

    adminService.getAnalytics.mockRejectedValueOnce(new Error('network'));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '90 days' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/network/);
    expect(screen.queryByText('5 stars')).not.toBeInTheDocument();
  });
});

describe('open reports', () => {
  test('a backlog links to the queue, and is absent at zero', async () => {
    adminService.getAnalytics.mockResolvedValue(payload());
    render(<AdminAnalytics />);
    await screen.findByText('5 stars');
    expect(screen.queryByRole('link', { name: /awaiting moderation/i })).not.toBeInTheDocument();
  });

  test('one open report is singular', async () => {
    adminService.getAnalytics.mockResolvedValue(
      payload({ catalogue: { ...payload().catalogue, open_reports: 1 } })
    );
    render(<AdminAnalytics />);

    const link = await screen.findByRole('link', { name: /1 review awaiting moderation/i });
    expect(link).toHaveAttribute('href', '/admin/moderation');
  });
});
