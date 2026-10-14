import { act, renderHook, waitFor } from '@testing-library/react';

import { useModerationQueue } from '../src/hooks/useModerationQueue';

/**
 * The moderation queue's client state (`IMP-111`, `ADR-036`).
 *
 * The interesting behaviour is all *after* an action: what the list shows once somebody else has
 * already handled a row, what the tabs say when the server applies a different filter from the one
 * clicked, and whether a failure leaves stale rows under a new heading. None of that needs a
 * browser, so the hook takes its dependencies as arguments.
 */

const ROW = {
  review_id: 7,
  place_id: 1,
  place_name: 'Hampi',
  rating: 1,
  comment: 'spam spam spam',
  review_author_name: 'Someone',
  report_count: 3,
  reasons: ['Spam'],
  first_reported_at: '2026-08-01T00:00:00.000Z',
  review_created_at: '2026-07-01T00:00:00.000Z'
};

const payload = (rows, overrides = {}) => ({
  data: rows,
  pagination: { total: rows.length, limit: 25, offset: 0, hasMore: false, status: 'open' },
  counts: { open: rows.length, reviewed: 0, dismissed: 0 },
  ...overrides
});

const setup = (overrides = {}) =>
  renderHook(() =>
    useModerationQueue({
      getIdToken: async () => 'test-token',
      fetchReports: jest.fn(async () => payload([ROW])),
      resolve: jest.fn(async () => ({ resolved: 3 })),
      removeReview: jest.fn(async () => true),
      ...overrides
    })
  );

describe('loading the queue', () => {
  test('it opens on the open queue', async () => {
    const fetchReports = jest.fn(async () => payload([ROW]));
    const { result } = setup({ fetchReports });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchReports).toHaveBeenCalledWith('test-token', { status: 'open' });
    expect(result.current.rows).toHaveLength(1);
    expect(result.current.counts).toEqual({ open: 1, reviewed: 0, dismissed: 0 });
  });

  test('the tab follows the status the SERVER applied, not the one clicked', async () => {
    // The server owns the decision (`ADR-036`). If the two ever diverge, a UI that trusted the
    // click would label a list with a filter that did not run.
    const fetchReports = jest.fn(async () =>
      payload([], {
        pagination: { status: 'open', total: 0, limit: 25, offset: 0, hasMore: false }
      })
    );
    const { result } = setup({ fetchReports });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.changeStatus('dismissed');
    });

    expect(fetchReports).toHaveBeenLastCalledWith('test-token', { status: 'dismissed' });
    expect(result.current.status).toBe('open');
  });

  test('a failure empties the list rather than leaving the old rows under a new heading', async () => {
    // Stale rows under the wrong tab is a *wrong* answer; an empty list is a missing one.
    let call = 0;
    const fetchReports = jest.fn(async () => {
      call += 1;
      if (call === 1) return payload([ROW]);
      throw new Error('network down');
    });

    const { result } = setup({ fetchReports });
    await waitFor(() => expect(result.current.rows).toHaveLength(1));

    await act(async () => {
      await result.current.changeStatus('reviewed');
    });

    expect(result.current.rows).toEqual([]);
    expect(result.current.error).toMatch(/network down/);
  });

  test('an expired session is reported as one', async () => {
    const { result } = renderHook(() =>
      useModerationQueue({
        getIdToken: async () => null,
        fetchReports: jest.fn(),
        resolve: jest.fn(),
        removeReview: jest.fn()
      })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toMatch(/session has expired/);
  });
});

describe('resolving', () => {
  test('it resolves and reloads, so the row leaves the open list', async () => {
    let call = 0;
    const fetchReports = jest.fn(async () => {
      call += 1;
      return call === 1 ? payload([ROW]) : payload([]);
    });
    const resolve = jest.fn(async () => ({ resolved: 3 }));

    const { result } = setup({ fetchReports, resolve });
    await waitFor(() => expect(result.current.rows).toHaveLength(1));

    let outcome;
    await act(async () => {
      outcome = await result.current.resolveReview(7, 'dismissed');
    });

    expect(resolve).toHaveBeenCalledWith('test-token', 7, 'dismissed');
    expect(outcome.ok).toBe(true);
    expect(result.current.rows).toEqual([]);
  });

  test('a 409 is surfaced as a conflict, not as a success', async () => {
    // Two moderators can have this open at once. Reporting success for a request that changed
    // nothing is how they quietly overwrite each other's judgement.
    const resolve = jest.fn(async () => {
      const error = new Error('conflict');
      error.response = { status: 409 };
      throw error;
    });

    const { result } = setup({ resolve });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let outcome;
    await act(async () => {
      outcome = await result.current.resolveReview(7, 'dismissed');
    });

    expect(outcome).toMatchObject({ ok: false, conflict: true });
    expect(outcome.message).toMatch(/already handled/i);
  });

  test('the list is reloaded even when the action failed', async () => {
    // A 409 means the queue on screen is already stale — refusing to refresh would leave the
    // moderator staring at the row somebody else just handled.
    const fetchReports = jest.fn(async () => payload([ROW]));
    const resolve = jest.fn(async () => {
      const error = new Error('conflict');
      error.response = { status: 409 };
      throw error;
    });

    const { result } = setup({ fetchReports, resolve });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const before = fetchReports.mock.calls.length;

    await act(async () => {
      await result.current.resolveReview(7, 'dismissed');
    });

    expect(fetchReports.mock.calls.length).toBeGreaterThan(before);
  });

  test('an ordinary failure is not reported as a conflict', async () => {
    const resolve = jest.fn(async () => {
      throw new Error('server exploded');
    });

    const { result } = setup({ resolve });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let outcome;
    await act(async () => {
      outcome = await result.current.resolveReview(7, 'dismissed');
    });

    expect(outcome.conflict).toBe(false);
    expect(outcome.message).toMatch(/server exploded/);
  });

  test('the busy marker clears, whatever happened', async () => {
    // A stuck spinner leaves the row's buttons permanently disabled — the failure after the failure.
    const resolve = jest.fn(async () => {
      throw new Error('nope');
    });

    const { result } = setup({ resolve });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.resolveReview(7, 'dismissed');
    });

    await waitFor(() => expect(result.current.busyReviewId).toBeNull());
  });
});

describe('removing a review', () => {
  test('it goes through the ordinary review delete, with the place id', async () => {
    // There is no admin-only delete endpoint (`ADR-036`) and so no second client path to one. The
    // place id is required because the route is scoped to it.
    const removeReview = jest.fn(async () => true);
    const { result } = setup({ removeReview });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.removeReviewById(1, 7);
    });

    expect(removeReview).toHaveBeenCalledWith(1, 7, 'test-token');
  });

  test('the queue is reloaded, because the reports cascade away with the review', async () => {
    let call = 0;
    const fetchReports = jest.fn(async () => {
      call += 1;
      return call === 1 ? payload([ROW]) : payload([]);
    });

    const { result } = setup({ fetchReports });
    await waitFor(() => expect(result.current.rows).toHaveLength(1));

    await act(async () => {
      await result.current.removeReviewById(1, 7);
    });

    expect(result.current.rows).toEqual([]);
  });

  test('a failed removal reports it and does not pretend the row is gone', async () => {
    const removeReview = jest.fn(async () => {
      throw new Error('permission denied');
    });

    const { result } = setup({ removeReview });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let outcome;
    await act(async () => {
      outcome = await result.current.removeReviewById(1, 7);
    });

    expect(outcome).toMatchObject({ ok: false });
    expect(outcome.message).toMatch(/permission denied/);
    expect(result.current.rows).toHaveLength(1);
  });
});
