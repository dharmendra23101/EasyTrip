import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRouter } from 'next/router';

import DuplicateTripButton from '../src/components/trips/DuplicateTripButton';
import tripService from '../src/services/tripService';

/**
 * The duplicate button (`FV-006` stage d).
 *
 * **What a copy contains is surprising, and the confirmation is the only place it is written down.**
 * The server drops the dates and the notes, never copies the share link, and unticks every checklist
 * box. Those are the right defaults, but somebody expecting a photocopy and getting a template will
 * think the copy is broken and go looking for notes that were never meant to be there. So the
 * confirmation is not a generic "are you sure" — it is the list — and that is what most of this
 * suite checks.
 *
 * The other half is that it **navigates to the copy**. A toast saying "duplicated" leaves the reader
 * on the original, looking at unchanged content, having to go and verify it worked.
 */

jest.mock('../src/services/tripService', () => ({
  __esModule: true,
  default: { duplicateTrip: jest.fn() }
}));

jest.mock('next/router', () => ({ useRouter: jest.fn() }));

const getToken = jest.fn().mockResolvedValue('token-123');
const push = jest.fn().mockResolvedValue(true);

beforeEach(() => {
  jest.clearAllMocks();
  getToken.mockResolvedValue('token-123');
  push.mockResolvedValue(true);
  useRouter.mockReturnValue({ push });
  window.confirm = jest.fn(() => true);
});

describe('the confirmation is the only place the rule is written down', () => {
  test('it says what the copy keeps and what it drops', async () => {
    render(<DuplicateTripButton tripId={7} getToken={getToken} />);
    await userEvent.click(screen.getByRole('button', { name: /duplicate/i }));

    const message = window.confirm.mock.calls[0][0];
    expect(message).toMatch(/checklist/i);
    expect(message).toMatch(/unticked/i);
    // The three exclusions, each named. A reader who is not told will go looking for them.
    expect(message).toMatch(/dates/i);
    expect(message).toMatch(/notes/i);
    expect(message).toMatch(/share link/i);
  });

  test('declining makes no copy at all', async () => {
    window.confirm = jest.fn(() => false);

    render(<DuplicateTripButton tripId={7} getToken={getToken} />);
    await userEvent.click(screen.getByRole('button', { name: /duplicate/i }));

    expect(tripService.duplicateTrip).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });
});

describe('it takes you to the copy', () => {
  test('a successful duplicate navigates to the new trip', async () => {
    tripService.duplicateTrip.mockResolvedValue({ id: 42, title: 'Copy of Karnataka in March' });

    render(<DuplicateTripButton tripId={7} getToken={getToken} />);
    await userEvent.click(screen.getByRole('button', { name: /duplicate/i }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/trips/42'));
    expect(tripService.duplicateTrip).toHaveBeenCalledWith(7, 'token-123');
  });

  test('a malformed reply does not push to /trips/undefined', async () => {
    // That route renders "we could not find that trip", which looks like the copy failed after it
    // in fact succeeded — the worst of both answers.
    tripService.duplicateTrip.mockResolvedValue({});

    render(<DuplicateTripButton tripId={7} getToken={getToken} />);
    await userEvent.click(screen.getByRole('button', { name: /duplicate/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/in your trips/i);
  });

  test('a failure is shown and the button recovers', async () => {
    // A button stuck on "Duplicating…" after a failure is a page the reader has to reload.
    tripService.duplicateTrip.mockRejectedValue(new Error('Could not duplicate this trip'));

    render(<DuplicateTripButton tripId={7} getToken={getToken} />);
    const button = screen.getByRole('button', { name: /duplicate/i });
    await userEvent.click(button);

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not duplicate this trip');
    expect(button).not.toBeDisabled();
    expect(push).not.toHaveBeenCalled();
  });

  test('a second click while one copy is in flight does nothing', async () => {
    /**
     * **Two clicks in the same tick**, before React can commit `disabled`. Clicking once and
     * asserting the call count is one is true of every possible implementation and proves nothing —
     * the same defect mutation `E7` exposed in `ExportCalendarButton`, repeated here and fixed the
     * same way.
     */
    tripService.duplicateTrip.mockReturnValue(new Promise(() => {}));

    render(<DuplicateTripButton tripId={7} getToken={getToken} />);
    const button = screen.getByRole('button', { name: /duplicate/i });

    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => expect(button).toBeDisabled());
    expect(tripService.duplicateTrip).toHaveBeenCalledTimes(1);
  });

  test('the token is fetched per call rather than held', async () => {
    tripService.duplicateTrip.mockResolvedValue({ id: 42 });

    render(<DuplicateTripButton tripId={7} getToken={getToken} />);
    await userEvent.click(screen.getByRole('button', { name: /duplicate/i }));

    await waitFor(() => expect(getToken).toHaveBeenCalled());
  });
});
