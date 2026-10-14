import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import ExportCalendarButton from '../src/components/trips/ExportCalendarButton';
import tripService from '../src/services/tripService';

/**
 * The calendar export button (`FV-009` stage a).
 *
 * **The button exists because a link could not.** The endpoint is authenticated, a browser
 * navigation carries no `Authorization` header, and `<a href download>` would have downloaded a 401
 * as a file called `trip.ics`. So the file is fetched with a token and handed over as a blob — and
 * that is what makes the 422 (a trip with no dates) something the reader can be *told*, rather than
 * something they discover by opening the download in a calendar application.
 *
 * The other thing worth pinning is the object URL. `createObjectURL` keeps the blob alive until the
 * document goes away or the URL is revoked, so on a workspace somebody exports from repeatedly, not
 * revoking leaks the file each time.
 */

jest.mock('../src/services/tripService', () => ({
  __esModule: true,
  default: { exportCalendar: jest.fn() }
}));

const getToken = jest.fn().mockResolvedValue('token-123');

const ICS = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n';

/**
 * Read a Blob back as text.
 *
 * `blob.text()` is not implemented in jsdom, and stubbing the Blob constructor to capture its
 * arguments would assert what was passed rather than what was built. `FileReader` is implemented, so
 * this reads the real object the component created.
 */
const readBlob = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsText(blob);
  });

let createdUrls;
let revokedUrls;
let clicked;

beforeEach(() => {
  jest.clearAllMocks();
  getToken.mockResolvedValue('token-123');

  createdUrls = [];
  revokedUrls = [];
  clicked = [];

  // jsdom implements neither, so they are stubbed rather than spied on.
  global.URL.createObjectURL = jest.fn((blob) => {
    const url = `blob:mock-${createdUrls.length}`;
    createdUrls.push({ url, blob });
    return url;
  });
  global.URL.revokeObjectURL = jest.fn((url) => revokedUrls.push(url));

  // jsdom's anchor click would try to navigate; capturing it is also how the filename is asserted.
  jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function capture() {
    clicked.push({ href: this.href, download: this.download });
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('the file is fetched with a token, not linked to', () => {
  test('a click downloads the calendar', async () => {
    tripService.exportCalendar.mockResolvedValue(ICS);

    render(<ExportCalendarButton tripId={7} title="Karnataka in March" getToken={getToken} />);
    await userEvent.click(screen.getByRole('button', { name: /add to calendar/i }));

    await waitFor(() => expect(clicked).toHaveLength(1));
    expect(tripService.exportCalendar).toHaveBeenCalledWith(7, 'token-123');
  });

  test('the blob is a calendar, carrying exactly what the server sent', async () => {
    tripService.exportCalendar.mockResolvedValue(ICS);

    render(<ExportCalendarButton tripId={7} title="Karnataka in March" getToken={getToken} />);
    await userEvent.click(screen.getByRole('button', { name: /add to calendar/i }));

    await waitFor(() => expect(createdUrls).toHaveLength(1));
    expect(createdUrls[0].blob.type).toMatch(/text\/calendar/);
    await expect(readBlob(createdUrls[0].blob)).resolves.toBe(ICS);
  });

  test('the filename is slugified from the trip title', async () => {
    tripService.exportCalendar.mockResolvedValue(ICS);

    render(<ExportCalendarButton tripId={7} title="Karnataka in March" getToken={getToken} />);
    await userEvent.click(screen.getByRole('button', { name: /add to calendar/i }));

    await waitFor(() => expect(clicked).toHaveLength(1));
    expect(clicked[0].download).toBe('karnataka-in-march.ics');
  });

  test('a title with nothing usable in it still produces a filename', async () => {
    // `"!!!"` slugifies to the empty string, and `.ics` on its own is a hidden file on Unix.
    tripService.exportCalendar.mockResolvedValue(ICS);

    render(<ExportCalendarButton tripId={7} title="!!!" getToken={getToken} />);
    await userEvent.click(screen.getByRole('button', { name: /add to calendar/i }));

    await waitFor(() => expect(clicked).toHaveLength(1));
    expect(clicked[0].download).toBe('trip.ics');
  });

  test('the object URL is revoked, so repeated exports do not leak', async () => {
    tripService.exportCalendar.mockResolvedValue(ICS);

    render(<ExportCalendarButton tripId={7} title="Trip" getToken={getToken} />);
    await userEvent.click(screen.getByRole('button', { name: /add to calendar/i }));

    await waitFor(() => expect(revokedUrls).toEqual(createdUrls.map((entry) => entry.url)));
  });
});

describe('a refusal is shown as a sentence, not downloaded as a file', () => {
  test('a trip with no dates reports why', async () => {
    // The whole reason this is a button. A link would have saved this message as `trip.ics`.
    tripService.exportCalendar.mockRejectedValue(
      new Error('This trip has no start date, so its days are not on any calendar yet')
    );

    render(<ExportCalendarButton tripId={7} title="Trip" getToken={getToken} />);
    await userEvent.click(screen.getByRole('button', { name: /add to calendar/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/no start date/i);
    expect(clicked).toHaveLength(0);
  });

  test('a failure leaves nothing to download and nothing to revoke', async () => {
    tripService.exportCalendar.mockRejectedValue(new Error('Could not export this trip'));

    render(<ExportCalendarButton tripId={7} title="Trip" getToken={getToken} />);
    await userEvent.click(screen.getByRole('button', { name: /add to calendar/i }));

    await screen.findByRole('alert');
    expect(createdUrls).toHaveLength(0);
    expect(revokedUrls).toHaveLength(0);
  });

  test('the button recovers after a failure', async () => {
    // `finally` rather than the success path: a button stuck on "Preparing…" after one failed
    // export is a workspace the reader has to reload.
    tripService.exportCalendar
      .mockRejectedValueOnce(new Error('Could not export this trip'))
      .mockResolvedValueOnce(ICS);

    render(<ExportCalendarButton tripId={7} title="Trip" getToken={getToken} />);
    const button = screen.getByRole('button', { name: /add to calendar/i });

    await userEvent.click(button);
    await screen.findByRole('alert');
    expect(button).not.toBeDisabled();

    await userEvent.click(button);
    await waitFor(() => expect(clicked).toHaveLength(1));
    // The stale error must not sit beside a download that just succeeded.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('a second click while one export is in flight does nothing', async () => {
    /**
     * **Two clicks in the same tick, before React can re-render the button as disabled.**
     *
     * The first draft of this test clicked once and asserted the call count was one, which is true
     * of any implementation and proved nothing — mutation `E7` removed the `if (busy) return` guard
     * and survived it. `disabled` alone does not close the window: it only exists after the state
     * update has been committed, and both events here are dispatched before that.
     */
    tripService.exportCalendar.mockReturnValue(new Promise(() => {}));

    render(<ExportCalendarButton tripId={7} title="Trip" getToken={getToken} />);
    const button = screen.getByRole('button', { name: /add to calendar/i });

    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => expect(button).toBeDisabled());
    expect(tripService.exportCalendar).toHaveBeenCalledTimes(1);
  });
});
