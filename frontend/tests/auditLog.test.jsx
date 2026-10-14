import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminAudit from '../src/pages/admin/audit';
import { adminService } from '../src/services/adminService';

/**
 * The admin audit log's page (`PE-013`, `FV-023`, `ADR-056`).
 *
 * **This page is the reason the table was allowed to exist.** `ADR-022` deleted the previous audit
 * tables because *"a table with writers and no readers is not an audit trail"*, so the assertions
 * that matter are about what a reader can actually learn here — not that a list renders.
 *
 *   1. **`partially_applied` is surfaced as something to act on.** It means the database change
 *      landed and the Firebase claim did not: the person is an admin in the column that authorises
 *      them while every request they make is denied. A row that said "Partly applied" and stopped
 *      would be accurate and useless.
 *   2. **Empty and failed are different states** (`IMP-031`). On an audit log they are opposite
 *      answers to the question somebody came to ask.
 *   3. **Changing the filter cannot leave the previous filter's rows under the new heading.**
 *   4. **It never names the author of a moderated review** — `IMP-021`, the same rule that keeps
 *      reporter identity out of the moderation queue.
 */

jest.mock('../src/services/adminService', () => ({
  adminService: { getAuditEntries: jest.fn() }
}));
jest.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({ getIdToken: jest.fn(async () => 'tok') })
}));
jest.mock('next/router', () => ({ useRouter: () => ({ push: jest.fn() }) }));

const entry = (over = {}) => ({
  id: 1,
  actor_uid: 'seed-admin-uid',
  actor_email: 'admin@easytrip.test',
  action: 'admin.granted',
  target_type: 'user',
  target_id: 'seed-other-uid',
  target_label: 'other@easytrip.test',
  outcome: 'succeeded',
  detail: {},
  created_at: '2026-09-06T10:00:00.000Z',
  ...over
});

const page = (entries, total = entries.length) => ({ entries, total, limit: 25, offset: 0 });

beforeEach(() => jest.clearAllMocks());

describe('what a reader can learn from a row', () => {
  test('a grant names the actor and the target by email', async () => {
    adminService.getAuditEntries.mockResolvedValue(page([entry()]));
    render(<AdminAudit />);

    const row = (await screen.findByText('admin@easytrip.test')).closest('tr');
    expect(within(row).getByText(/Granted admin/)).toBeInTheDocument();
    expect(within(row).getByText('other@easytrip.test')).toBeInTheDocument();
  });

  test('partially_applied is flagged and says what to do about it', async () => {
    // The state the `outcome` column exists for. Asserting the *instruction*, not just the label:
    // an admin who reads "Partly applied" and moves on has learned nothing actionable.
    adminService.getAuditEntries.mockResolvedValue(page([entry({ outcome: 'partially_applied' })]));
    render(<AdminAudit />);

    expect(await screen.findByText(/Partly applied/)).toBeInTheDocument();
    expect(screen.getByText(/Firebase claim was not\. Retry the action\./i)).toBeInTheDocument();
  });

  test('a successful row carries no status badge at all', async () => {
    // Asserted as the *absence of any badge*, not just the absence of the amber one. Checking only
    // for "Partly applied" lets through a version that decorates every row — including successes —
    // with a warning triangle and the word "Applied", which is how a page trains its reader to
    // ignore the one marker that means something.
    adminService.getAuditEntries.mockResolvedValue(page([entry()]));
    render(<AdminAudit />);

    await screen.findByText('admin@easytrip.test');
    expect(screen.queryByText(/Partly applied/)).not.toBeInTheDocument();
    expect(screen.queryByText('Applied')).not.toBeInTheDocument();
  });

  test('a resolved report shows the resolution and how many closed', async () => {
    adminService.getAuditEntries.mockResolvedValue(
      page([
        entry({
          action: 'report.resolved',
          target_type: 'review',
          target_id: '7',
          target_label: null,
          detail: { resolution: 'dismissed', reports_closed: 3 }
        })
      ])
    );
    render(<AdminAudit />);

    expect(await screen.findByText(/Review #7/)).toBeInTheDocument();
    expect(screen.getByText(/dismissed, 3 reports closed/)).toBeInTheDocument();
  });

  test('one closed report is not "1 reports"', async () => {
    adminService.getAuditEntries.mockResolvedValue(
      page([
        entry({
          action: 'report.resolved',
          target_id: '7',
          detail: { resolution: 'reviewed', reports_closed: 1 }
        })
      ])
    );
    render(<AdminAudit />);

    expect(await screen.findByText(/1 report closed/)).toBeInTheDocument();
  });

  test('a deleted review is identified by place, never by author', async () => {
    // `IMP-021`: review authorship stays out of admin-facing surfaces. The review is gone, so the
    // place is the only context still actionable — and it names nobody.
    adminService.getAuditEntries.mockResolvedValue(
      page([
        entry({
          action: 'review.deleted_by_admin',
          target_type: 'review',
          target_id: '12',
          target_label: null,
          detail: { place_id: 3 }
        })
      ])
    );
    render(<AdminAudit />);

    expect(await screen.findByText(/Review #12 on/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /place #3/ })).toHaveAttribute('href', '/places/3');
  });
});

describe('empty and failed are different states', () => {
  test('an empty log says nothing has happened, and how entries appear', async () => {
    adminService.getAuditEntries.mockResolvedValue(page([]));
    render(<AdminAudit />);

    expect(await screen.findByText(/Nothing has been recorded yet/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('a failure says so, and does not claim the log is empty', async () => {
    // The `IMP-031` conflation. "No admin has ever granted anyone privileges" and "we could not
    // find out" are opposite answers, and only one of them should end an investigation.
    adminService.getAuditEntries.mockRejectedValue(new Error('network'));
    render(<AdminAudit />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/network/);
    expect(screen.queryByText(/Nothing has been recorded yet/)).not.toBeInTheDocument();
  });

  test('an empty filtered view says the filter is empty, not the log', async () => {
    adminService.getAuditEntries.mockResolvedValue(page([]));
    render(<AdminAudit />);
    await screen.findByText(/Nothing has been recorded yet/);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Revoked admin' }));

    expect(await screen.findByText(/No entries of this kind/)).toBeInTheDocument();
  });
});

describe('filtering', () => {
  test('choosing an action refetches with it and shows it as pressed', async () => {
    adminService.getAuditEntries.mockResolvedValue(page([entry()]));
    render(<AdminAudit />);
    await screen.findByText('admin@easytrip.test');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Resolved reports' }));

    await waitFor(() =>
      expect(adminService.getAuditEntries).toHaveBeenLastCalledWith(
        'tok',
        expect.objectContaining({ action: 'report.resolved', offset: 0 })
      )
    );
    expect(screen.getByRole('button', { name: 'Resolved reports' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  test('"All" sends no action rather than an empty one', async () => {
    // `?action=` is a 400 against a route that validates against a closed list, which would turn
    // "show me everything" into an error.
    adminService.getAuditEntries.mockResolvedValue(page([entry()]));
    render(<AdminAudit />);

    await waitFor(() => expect(adminService.getAuditEntries).toHaveBeenCalled());
    expect(adminService.getAuditEntries).toHaveBeenLastCalledWith(
      'tok',
      expect.objectContaining({ action: undefined })
    );
  });

  test('changing the filter cannot leave the old rows under the new heading', async () => {
    adminService.getAuditEntries.mockResolvedValueOnce(page([entry()]));
    render(<AdminAudit />);
    await screen.findByText('admin@easytrip.test');

    adminService.getAuditEntries.mockRejectedValueOnce(new Error('network'));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Deleted a review' }));

    await screen.findByRole('alert');
    expect(screen.queryByText('admin@easytrip.test')).not.toBeInTheDocument();
  });
});

describe('paging', () => {
  test('Previous is disabled on the first page and Next when there is no more', async () => {
    adminService.getAuditEntries.mockResolvedValue(page([entry()], 1));
    render(<AdminAudit />);
    await screen.findByText('admin@easytrip.test');

    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  test('Next is offered when the total exceeds the page', async () => {
    adminService.getAuditEntries.mockResolvedValue(page([entry()], 40));
    render(<AdminAudit />);
    await screen.findByText('admin@easytrip.test');

    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
    expect(screen.getByText(/1–1 of 40/)).toBeInTheDocument();
  });
});

describe('what the page tells the reader about itself', () => {
  test('it states that the log cannot be edited, including by its own author', async () => {
    // An audit trail an admin can rewrite records nothing. The API enforces it; the page says it,
    // because the guarantee is only useful to somebody who knows it exists.
    adminService.getAuditEntries.mockResolvedValue(page([]));
    render(<AdminAudit />);

    expect(
      await screen.findByText(/read-only — there is no route that edits or deletes an entry/i)
    ).toBeInTheDocument();
  });
});
