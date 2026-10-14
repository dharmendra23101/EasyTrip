import { useCallback, useEffect, useState } from 'react';
import { FiEdit2, FiFileText, FiTrash2 } from 'react-icons/fi';

import tripService from '../../services/tripService';
import { formatDateTime } from '../../utils/dateFormat';

/**
 * A trip's notes (`FV-006` stage b).
 *
 * ---------------------------------------------------------------------------
 * Nothing here is optimistic, and that is the decision
 * ---------------------------------------------------------------------------
 * `TripChecklist` paints a tick before the server answers, because a tick is cheap to undo and the
 * interaction is repeated. **A note is neither.** It is something the reader wrote, sometimes at
 * length, and showing it as saved before it is saved is how somebody closes the tab believing they
 * have a record of a booking reference they no longer have anywhere else.
 *
 * So a note appears when the server says it exists, and a failed write keeps the text **in the
 * textarea** rather than clearing the field and reporting an error beside an empty box. The draft
 * the reader can still see is the recovery path.
 *
 * ---------------------------------------------------------------------------
 * The timestamp is the point
 * ---------------------------------------------------------------------------
 * "When did I write this" is most of the value of a trip note - it is what separates *"the hotel
 * confirmed"* from *"the hotel confirmed, three weeks ago, before I changed the dates"*. That is why
 * these are rows with their own `created_at` rather than one `notes` column on the trip, and why the
 * date is rendered in visible text rather than hidden in a `title`.
 */

/**
 * The token is fetched per call, not held.
 *
 * `getIdToken` refreshes a Firebase token that has expired; a token captured once into a prop goes
 * stale on a workspace somebody leaves open, and every write after that fails with a 401 that looks
 * like a permissions bug. Same shape `useTripWorkspace` uses for the itinerary.
 */
export const TripNotes = ({ tripId, getToken }) => {
  const [notes, setNotes] = useState([]);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(null);
  const [editDraft, setEditDraft] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!tripId || !getToken) return;
    try {
      setNotes(await tripService.listNotes(tripId, await getToken()));
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

    const trimmed = draft.trim();
    if (!trimmed || busy) return;

    setBusy(true);
    try {
      const created = await tripService.addNote(tripId, trimmed, await getToken());
      // Prepended, matching the server's newest-first order. Re-fetching would be a second round
      // trip to learn something already known.
      if (created) setNotes((current) => [created, ...current]);
      // Cleared only after the server confirmed. On failure the text stays where the reader can
      // still see and copy it.
      setDraft('');
      setError(null);
    } catch (addError) {
      setError(addError.message);
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async (note) => {
    const trimmed = editDraft.trim();
    if (!trimmed) return;

    try {
      const updated = await tripService.updateNote(tripId, note.id, trimmed, await getToken());
      if (updated) {
        setNotes((current) => current.map((entry) => (entry.id === note.id ? updated : entry)));
      }
      setEditing(null);
      setError(null);
    } catch (saveError) {
      // The editor stays open, holding the text. Closing it would discard the edit that just
      // failed to save.
      setError(saveError.message);
    }
  };

  const remove = async (note) => {
    try {
      await tripService.deleteNote(tripId, note.id, await getToken());
      setNotes((current) => current.filter((entry) => entry.id !== note.id));
      setError(null);
    } catch (removeError) {
      setError(removeError.message);
    }
  };

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-6">
      <h2 className="mb-4 flex items-center gap-2 text-xl font-semibold text-gray-900">
        <FiFileText className="h-5 w-5 text-primary-600" aria-hidden="true" />
        Notes
      </h2>

      <form onSubmit={add} className="mb-4">
        <label htmlFor="note-body" className="sr-only">
          Add a note
        </label>
        <textarea
          id="note-body"
          value={draft}
          maxLength={5000}
          rows={3}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Booking references, who to call, what the taxi cost…"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={busy || draft.trim() === ''}
          className="mt-2 rounded-lg bg-primary-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Add note'}
        </button>
      </form>

      {error && (
        <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {notes.length === 0 ? (
        <p className="text-sm text-gray-500">No notes yet.</p>
      ) : (
        <ul className="space-y-3">
          {notes.map((note) => (
            <li key={note.id} className="rounded-lg border border-gray-200 p-3">
              {editing === note.id ? (
                <>
                  <label htmlFor={`note-edit-${note.id}`} className="sr-only">
                    Edit note
                  </label>
                  <textarea
                    id={`note-edit-${note.id}`}
                    value={editDraft}
                    maxLength={5000}
                    rows={3}
                    onChange={(event) => setEditDraft(event.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => saveEdit(note)}
                      disabled={editDraft.trim() === ''}
                      className="rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing(null)}
                      className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {/* `whitespace-pre-wrap`, so the line breaks somebody typed survive. A note is
                      often a list, and collapsing it into a paragraph loses what it said. */}
                  <p className="whitespace-pre-wrap text-sm text-gray-900">{note.body}</p>

                  <div className="mt-2 flex items-center justify-between gap-2">
                    {/* Visible text rather than a `title`: when a note was written is part of what
                        it means, and a tooltip is not available to everyone reading it. */}
                    <span className="text-xs text-gray-500">
                      {formatDateTime(note.created_at)}
                      {/* Only when it actually differs. "Edited" on every note would be noise, and
                          on a note nobody edited it would be false. */}
                      {note.updated_at !== note.created_at && ' · edited'}
                    </span>

                    <span className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(note.id);
                          setEditDraft(note.body);
                        }}
                        aria-label="Edit note"
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                      >
                        <FiEdit2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(note)}
                        aria-label="Delete note"
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                      >
                        <FiTrash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </span>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

export default TripNotes;
