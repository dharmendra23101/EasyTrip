import { useCallback, useEffect, useState } from 'react';
import { FiUserPlus, FiUsers, FiX } from 'react-icons/fi';

import tripService from '../../services/tripService';

/**
 * The people who can open this trip (`FV-007` stage b).
 *
 * ---------------------------------------------------------------------------
 * The panel says what sharing actually does, because the word promises more
 * ---------------------------------------------------------------------------
 * "Share" suggests collaboration, and this is not that yet: a person added here can **read** the
 * trip and nothing else. The write path is unchanged, the schema CHECKs one role, and if the
 * interface implies otherwise the first thing that happens is somebody adds a friend, tells them to
 * add a hotel, and the friend gets an error the interface never warned them about.
 *
 * So the panel states it in a sentence a traveller reads, once, above the list. `FP-012`'s rule
 * applied to a permission rather than to a heuristic: describe what it is, not what its name
 * suggests.
 *
 * ---------------------------------------------------------------------------
 * The limitation is surfaced where somebody meets it, not in a tooltip
 * ---------------------------------------------------------------------------
 * There is no mail service (`017_trip_collaborators.sql`), so the address is a lookup key against
 * accounts that already exist. That is invisible until it fails, so two things carry it: the field's
 * own hint, and the API's 422 - which says *"they need an EasyTrip account"* in words, and which
 * `tripService` deliberately passes through rather than replacing with a generic fallback.
 *
 * ---------------------------------------------------------------------------
 * Only the owner is offered the controls, and the server does not take the panel's word for it
 * ---------------------------------------------------------------------------
 * `your_role` comes back from the same read that returns the list, so the panel knows which it is
 * without a second request. Hiding a control is a courtesy, not a permission - a viewer who posts
 * the request anyway gets a 404, which is asserted in `tripCollaborators.test.js`.
 */

/**
 * The token is fetched per call rather than held, like every other panel here: a token captured once
 * into a prop goes stale on a workspace somebody leaves open all afternoon.
 */
export const TripCollaborators = ({ tripId, getToken }) => {
  const [collaborators, setCollaborators] = useState([]);
  const [role, setRole] = useState(null);
  const [email, setEmail] = useState('');
  // Defaults to the weaker role, the same way the API does. Somebody adding a person quickly
  // grants reading, and granting write access is a thing they had to choose.
  const [newRole, setNewRole] = useState('viewer');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [loadFailed, setLoadFailed] = useState(false);
  // Whether the first read has come back at all - distinct from whether it succeeded.
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!getToken) return;
    try {
      const data = await tripService.listCollaborators(tripId, await getToken());
      setCollaborators(data.collaborators || []);
      setRole(data.your_role || null);
      setLoadFailed(false);
    } catch {
      // A failed read must not render as "nobody has this trip" — that is a claim about who can see
      // the reader's plan, and it is the `IMP-031` mistake in the place it would matter most.
      setLoadFailed(true);
    } finally {
      setLoaded(true);
    }
  }, [tripId, getToken]);

  useEffect(() => {
    load();
  }, [load]);

  const add = async (event) => {
    event.preventDefault();
    const address = email.trim();
    if (!address) return;

    setBusy(true);
    setError(null);
    try {
      await tripService.addCollaborator(tripId, address, await getToken(), newRole);
      // Cleared only after the server agreed. A field emptied on a failed add loses what the reader
      // typed and leaves them re-typing an address the server has already told them is wrong.
      setEmail('');
      await load();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (userId) => {
    setBusy(true);
    setError(null);
    try {
      await tripService.removeCollaborator(tripId, userId, await getToken());
      await load();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };

  // Nothing until the role is known, and this is a correctness point rather than a loading nicety.
  // `isOwner` is false while `role` is still `null`, so rendering early showed the **viewer** copy —
  // *"Only its owner can change it"* — to the owner, for as long as the request took. A panel about
  // permissions that briefly states the wrong one is worse than a panel that arrives a moment later.
  // Found by a component test whose `findByText` matched the wrong sentence, which is the same
  // ambiguity a reader would have hit.
  if (!loaded || loadFailed) return null;

  const isOwner = role === 'owner';

  return (
    <section
      aria-labelledby="collaborators-heading"
      className="rounded-xl border border-gray-200 bg-white p-6"
    >
      <h2
        id="collaborators-heading"
        className="mb-1 flex items-center gap-2 text-lg font-semibold text-gray-900"
      >
        <FiUsers className="h-5 w-5 text-primary-600" aria-hidden="true" />
        People on this trip
      </h2>

      {/* What sharing does, in the words it actually does it in. */}
      <p className="mb-4 text-sm text-gray-600">
        {isOwner
          ? 'Everyone you add can read this trip. An editor can also change the plan — days and stops — but not its name, its dates, who else is on it, or whether it is shared.'
          : role === 'editor'
            ? 'You can read this trip and change its plan. Only its owner can rename it, delete it, or change who else can see it.'
            : 'You can read this trip. Only its owner can change it, or change who else can see it.'}
      </p>

      {collaborators.length === 0 ? (
        <p className="text-sm text-gray-500">
          {isOwner ? 'You have not added anybody yet.' : 'Nobody else has been added.'}
        </p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {collaborators.map((person) => (
            <li key={person.user_id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-gray-900">
                  {person.name || person.email || 'Someone with an EasyTrip account'}
                </span>
                {/* The name is not always there — a collaborator whose `users` row exists only as a
                    uid is still a collaborator — so the email is shown beside it rather than
                    instead of it, and neither is assumed. */}
                {person.name && person.email && (
                  <span className="block truncate text-xs text-gray-500">{person.email}</span>
                )}
              </span>
              <span className="flex shrink-0 items-center gap-3">
                {/* What they can do, in the same words the form offers — so a reader can tell at a
                    glance which of the two somebody is, and the label matches the choice that
                    produced it. */}
                <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  {person.role === 'editor' ? 'Can edit' : 'Can read'}
                </span>
                {isOwner && (
                  <button
                    type="button"
                    onClick={() => remove(person.user_id)}
                    disabled={busy}
                    aria-label={`Remove ${person.name || person.email || 'this person'}`}
                    className="flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:text-red-600 disabled:opacity-50"
                  >
                    <FiX className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {isOwner && (
        <form onSubmit={add} className="mt-4" aria-label="Add somebody to this trip">
          <label htmlFor="collaborator-email" className="block text-sm font-medium text-gray-700">
            Add somebody by email
          </label>
          <div className="mt-1 flex flex-wrap gap-2">
            <input
              id="collaborator-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="them@example.com"
              className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
            <label className="sr-only" htmlFor="collaborator-role">
              What they can do
            </label>
            <select
              id="collaborator-role"
              value={newRole}
              onChange={(event) => setNewRole(event.target.value)}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="viewer">Can read</option>
              <option value="editor">Can edit the plan</option>
            </select>
            <button
              type="submit"
              disabled={busy || !email.trim()}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-60"
            >
              <FiUserPlus className="h-4 w-4" aria-hidden="true" />
              Add
            </button>
          </div>
          {/* The limitation, before somebody meets it as an error. */}
          <p className="mt-2 text-xs text-gray-500">
            They need an EasyTrip account already — nothing is emailed, so use the address they
            signed up with.
          </p>
        </form>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error.message}
        </p>
      )}
    </section>
  );
};

export default TripCollaborators;
