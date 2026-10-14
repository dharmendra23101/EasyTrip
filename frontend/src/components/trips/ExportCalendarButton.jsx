import { useState } from 'react';
import { FiCalendar } from 'react-icons/fi';

import tripService from '../../services/tripService';

/**
 * Download the trip as an `.ics` file (`FV-009` stage a).
 *
 * ---------------------------------------------------------------------------
 * A button rather than a link, and that is forced rather than chosen
 * ---------------------------------------------------------------------------
 * The obvious implementation is `<a href="/api/auth/trips/1/calendar.ics" download>`. It does not
 * work here: the endpoint is authenticated, a browser navigation carries no `Authorization` header,
 * and the reader would download a 401. So the file is fetched with a token and handed to the browser
 * as a blob.
 *
 * That is also what lets the **422** be useful. A trip with no start date has no position on any
 * calendar, and the server says so in a sentence; a plain link would have downloaded that sentence
 * as a file called `trip.ics` and left the reader to open it in a calendar application to find out.
 *
 * ---------------------------------------------------------------------------
 * The object URL is revoked
 * ---------------------------------------------------------------------------
 * `URL.createObjectURL` pins the blob in memory until the document is discarded or the URL is
 * revoked. On a workspace somebody keeps open and exports from repeatedly, not revoking is a leak
 * that grows by the size of the file each time.
 */

export const ExportCalendarButton = ({ tripId, title, getToken }) => {
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const download = async () => {
    /**
     * Belt and braces, and **recorded as an equivalent mutant** rather than quietly kept.
     *
     * Mutation `E7` removes this line and every test still passes, because `disabled={busy}` below
     * already closes the window: React flushes a discrete click synchronously, so the button is
     * disabled before a second event can be dispatched — two `fireEvent.click` calls in one tick
     * produce one request either way. It is kept because it is free and because it is the only
     * protection left if `disabled` is ever dropped in a restyle, not because a test proves it
     * necessary. Manufacturing a test that reached it would be fitting a test to this renderer's
     * scheduling rather than to a behaviour.
     */
    if (busy) return;
    setBusy(true);
    setError(null);

    let url;
    try {
      const ics = await tripService.exportCalendar(tripId, await getToken());

      const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
      url = URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = url;
      // The server sends its own filename in `Content-Disposition`, which a blob download cannot
      // see, so the slug is rebuilt here. Same rule, kept deliberately simple: anything that is not
      // a letter or a digit becomes a hyphen.
      link.download = `${
        String(title || 'trip')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '') || 'trip'
      }.ics`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (downloadError) {
      // Shown, not swallowed. The reader asked for a file and did not get one; the 422 in particular
      // is actionable — it says to give the trip a start date.
      setError(downloadError.message);
    } finally {
      if (url) URL.revokeObjectURL(url);
      setBusy(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={download}
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:border-primary-400 hover:text-primary-700 disabled:opacity-50"
      >
        <FiCalendar className="h-4 w-4" aria-hidden="true" />
        {busy ? 'Preparing…' : 'Add to calendar'}
      </button>

      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
};

export default ExportCalendarButton;
