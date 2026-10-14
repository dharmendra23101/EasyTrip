import { useState } from 'react';
import { useRouter } from 'next/router';
import { FiCopy } from 'react-icons/fi';

import tripService from '../../services/tripService';

/**
 * Duplicate this trip (`FV-006` stage d, `PI-026`).
 *
 * ---------------------------------------------------------------------------
 * It says what a copy will and will not contain, before making one
 * ---------------------------------------------------------------------------
 * The server drops the dates, drops the notes, resets the status, never copies the share link, and
 * copies the checklist with every box unticked. Those are good defaults and they are also
 * **surprising** — somebody who expects a photocopy and gets a template will think the copy is
 * broken, go looking for the missing notes, and find nothing to explain it.
 *
 * So the confirmation is not a generic "are you sure": it is the list. It is the only place in the
 * interface where the rule is written down for the person it affects.
 *
 * ---------------------------------------------------------------------------
 * It navigates to the copy
 * ---------------------------------------------------------------------------
 * The endpoint returns the new trip precisely so this does not have to re-fetch the list and guess
 * which one is the copy. Landing on the new trip is also the answer to *"did that work?"* — a toast
 * saying "duplicated" leaves the reader on the original, looking at unchanged content, having to go
 * and check.
 */

const WHAT_A_COPY_CONTAINS =
  'The copy keeps the days, the stops and the checklist — with every box unticked.\n\n' +
  'It does not keep the dates, the notes, or the share link. Continue?';

export const DuplicateTripButton = ({ tripId, getToken }) => {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const duplicate = async () => {
    /**
     * **Recorded as an equivalent mutant (`B6`)**, exactly as `E7` is in `ExportCalendarButton`.
     * Removing this line changes nothing, because `disabled={busy}` below already closes the window:
     * React flushes a discrete click synchronously, so two clicks dispatched in one tick produce one
     * request either way. Kept because it is free and is the only guard left if `disabled` is dropped
     * in a restyle.
     */
    if (busy) return;
    if (!window.confirm(WHAT_A_COPY_CONTAINS)) return;

    setBusy(true);
    setError(null);
    try {
      const copy = await tripService.duplicateTrip(tripId, await getToken());
      // Guarded: a malformed response must not push the router to `/trips/undefined`, which renders
      // as "we could not find that trip" and looks like the copy failed after it succeeded.
      if (copy?.id) {
        await router.push(`/trips/${copy.id}`);
        return;
      }
      setError('The copy was made, but we could not open it. It is in your trips.');
    } catch (duplicateError) {
      setError(duplicateError.message);
    } finally {
      // Runs even after a successful navigation, which is harmless — this component unmounts — and
      // is what stops the button sticking on "Duplicating…" when the copy fails.
      setBusy(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={duplicate}
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:border-primary-400 hover:text-primary-700 disabled:opacity-50"
      >
        <FiCopy className="h-4 w-4" aria-hidden="true" />
        {busy ? 'Duplicating…' : 'Duplicate'}
      </button>

      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
};

export default DuplicateTripButton;
