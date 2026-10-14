import { useCallback, useEffect, useState } from 'react';
import { FiCheckSquare, FiPlus, FiSquare, FiTrash2 } from 'react-icons/fi';

import tripService from '../../services/tripService';

/**
 * A trip's checklist (`FV-006` stage b).
 *
 * ---------------------------------------------------------------------------
 * Optimistic on the tick, and only on the tick
 * ---------------------------------------------------------------------------
 * Ticking a box is the one action here that has to feel instant — it is the interaction somebody
 * performs a dozen times while packing, and a spinner on each one makes the list feel broken. So the
 * tick paints immediately and **rolls back** if the server refuses.
 *
 * Adding and deleting are not optimistic. They change what the list *contains* rather than the state
 * of something already in it, and a row that appears and then vanishes is a worse failure than a
 * row that takes a moment to appear. The asymmetry is deliberate rather than inconsistent.
 *
 * ---------------------------------------------------------------------------
 * A failed write says so
 * ---------------------------------------------------------------------------
 * `QuieterNearby` stays silent when its fetch fails, because a lateral suggestion nobody asked for is
 * not worth an error on somebody's holiday reading. **This is the opposite case.** The reader typed
 * something and expects it kept; silently dropping it would leave them believing a packing list that
 * does not exist. So a write failure is shown, in words, next to the thing that failed.
 */

/**
 * The token is fetched per call, not held.
 *
 * `getIdToken` refreshes a Firebase token that has expired; a token captured once into a prop goes
 * stale on a workspace somebody leaves open, and every write after that fails with a 401 that looks
 * like a permissions bug. Same shape `useTripWorkspace` uses for the itinerary.
 */
export const TripChecklist = ({ tripId, getToken }) => {
  const [items, setItems] = useState([]);
  const [label, setLabel] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!tripId || !getToken) return;
    try {
      setItems(await tripService.listChecklist(tripId, await getToken()));
      setError(null);
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [tripId, getToken]);

  useEffect(() => {
    load();
  }, [load]);

  const add = async (event) => {
    event.preventDefault();

    // Trimmed here as well as on the server: a label of spaces is a 400, and letting the form send
    // one means the reader gets an error for something the button could simply not have done.
    const trimmed = label.trim();
    if (!trimmed || busy) return;

    setBusy(true);
    try {
      const created = await tripService.addChecklistItem(tripId, trimmed, await getToken());
      // Appended rather than re-fetched: the server assigns the position by appending too, so the
      // orders cannot disagree, and a reload here would discard what the reader is typing next.
      if (created) setItems((current) => [...current, created]);
      setLabel('');
      setError(null);
    } catch (addError) {
      setError(addError.message);
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (item) => {
    const next = !item.is_done;
    setItems((current) =>
      current.map((entry) => (entry.id === item.id ? { ...entry, is_done: next } : entry))
    );

    try {
      // `is_done` alone. Sending the label back would be the bug the server's PATCH exists to make
      // impossible, arriving from the other side.
      await tripService.updateChecklistItem(tripId, item.id, { is_done: next }, await getToken());
      setError(null);
    } catch (toggleError) {
      // Rolled back to the value it actually had, not flipped — flipping would be wrong if two
      // ticks were in flight, and this is the state the server still holds.
      setItems((current) =>
        current.map((entry) => (entry.id === item.id ? { ...entry, is_done: item.is_done } : entry))
      );
      setError(toggleError.message);
    }
  };

  const remove = async (item) => {
    try {
      await tripService.deleteChecklistItem(tripId, item.id, await getToken());
      setItems((current) => current.filter((entry) => entry.id !== item.id));
      setError(null);
    } catch (removeError) {
      setError(removeError.message);
    }
  };

  const done = items.filter((item) => item.is_done).length;

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-6">
      <h2 className="mb-1 flex items-center gap-2 text-xl font-semibold text-gray-900">
        <FiCheckSquare className="h-5 w-5 text-primary-600" aria-hidden="true" />
        Checklist
      </h2>

      {/* The count is rendered even at zero, because "0 of 4 packed" is the useful half of a
          checklist and an empty list is the state a new trip is actually in. */}
      {items.length > 0 && (
        <p className="mb-4 text-sm text-gray-600">
          {done} of {items.length} done
        </p>
      )}

      <form onSubmit={add} className="mb-4 flex gap-2">
        <label htmlFor="checklist-label" className="sr-only">
          Add a checklist item
        </label>
        <input
          id="checklist-label"
          type="text"
          value={label}
          maxLength={200}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="Passport, charger, tickets…"
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={busy || label.trim() === ''}
          className="flex items-center gap-1 rounded-lg bg-primary-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          <FiPlus className="h-4 w-4" aria-hidden="true" />
          Add
        </button>
      </form>

      {/* Announced, because a failed write is the thing the reader most needs to hear about and
          nothing else on screen changes when one happens. */}
      {error && (
        <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {items.length === 0 ? (
        // An empty state is right here, unlike `QuieterNearby`: this list is empty because the
        // reader has not written in it yet, which is a fact about them rather than a claim about
        // the world.
        <p className="text-sm text-gray-500">Nothing on the list yet.</p>
      ) : (
        <ul className="space-y-1">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => toggle(item)}
                // The accessible name carries the state and the label together, so a screen-reader
                // user hears what the control does rather than only that it is a button.
                aria-pressed={item.is_done}
                className="flex flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-gray-50"
              >
                {item.is_done ? (
                  <FiCheckSquare
                    className="h-4 w-4 flex-shrink-0 text-primary-600"
                    aria-hidden="true"
                  />
                ) : (
                  <FiSquare className="h-4 w-4 flex-shrink-0 text-gray-400" aria-hidden="true" />
                )}
                {/* Not colour alone (WCAG 1.4.1): the icon changes, the text is struck through, and
                    `aria-pressed` states it outright. Line-through on its own would be a visual
                    convention a screen reader cannot report. */}
                <span className={item.is_done ? 'text-gray-500 line-through' : 'text-gray-900'}>
                  {item.label}
                </span>
              </button>

              <button
                type="button"
                onClick={() => remove(item)}
                aria-label={`Remove ${item.label}`}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
              >
                <FiTrash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

export default TripChecklist;
