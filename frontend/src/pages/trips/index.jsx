import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { FiMap, FiPlus, FiCalendar, FiTrash2, FiAlertCircle, FiCompass } from 'react-icons/fi';

import { useAuth } from '../../context/AuthContext';
import { useTrips } from '../../hooks/useTrips';
import LoadingSpinner from '../../components/LoadingSpinner';
import { formatDate } from '../../utils/dateFormat';

/**
 * "My Trips" (`IMP-109` / `FV-006`).
 *
 * The list, and the one form that creates a trip. Everything else happens inside a trip.
 */

const STATUS_STYLES = {
  draft: 'bg-gray-100 text-gray-700',
  upcoming: 'bg-emerald-100 text-emerald-800',
  completed: 'bg-blue-100 text-blue-800'
};

export default function TripsPage() {
  const { currentUser, loading: authLoading } = useAuth();
  const { trips, error, actionError, refresh, create, remove, ready } = useTrips();
  const router = useRouter();

  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!authLoading && !currentUser) router.push('/login');
  }, [authLoading, currentUser, router]);

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    const created = await create({
      title: title.trim(),
      start_date: startDate || undefined,
      end_date: endDate || undefined
    });
    setSaving(false);

    if (created) {
      setTitle('');
      setStartDate('');
      setEndDate('');
      setShowForm(false);
      router.push(`/trips/${created.id}`);
    }
  };

  // A trip cannot end before it starts. Enforced in the database, the validator and here — the
  // third one exists so the user finds out while typing rather than on submit.
  const datesInvalid = Boolean(startDate && endDate && endDate < startDate);

  return (
    <>
      <Head>
        <title>My trips · EasyTrip</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>

      <div className="bg-gray-50 min-h-screen">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl sm:text-4xl font-serif font-bold text-gray-900 flex items-center">
                <FiMap className="mr-3 h-8 w-8 text-primary-600" aria-hidden="true" />
                My trips
              </h1>
              <p className="mt-2 text-gray-600">
                Turn the places you have saved into a plan with days and times.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowForm((open) => !open)}
              className="inline-flex items-center rounded-lg bg-primary-600 px-5 py-2.5 font-medium text-white hover:bg-primary-700"
              aria-expanded={showForm}
            >
              <FiPlus className="mr-2 h-5 w-5" aria-hidden="true" />
              New trip
            </button>
          </header>

          {actionError && (
            <div
              role="alert"
              className="mb-6 flex items-start rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"
            >
              <FiAlertCircle className="mr-2 mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
              <span>{actionError.message}</span>
            </div>
          )}

          {showForm && (
            <form
              onSubmit={submit}
              className="mb-8 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
              aria-label="Create a trip"
            >
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="sm:col-span-3">
                  <label htmlFor="trip-title" className="block text-sm font-medium text-gray-700">
                    Trip name
                  </label>
                  <input
                    id="trip-title"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    required
                    maxLength={200}
                    placeholder="Karnataka in March"
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-primary-500 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label htmlFor="trip-start" className="block text-sm font-medium text-gray-700">
                    Start date <span className="text-gray-400">(optional)</span>
                  </label>
                  <input
                    id="trip-start"
                    type="date"
                    value={startDate}
                    onChange={(event) => setStartDate(event.target.value)}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
                  />
                </div>
                <div>
                  <label htmlFor="trip-end" className="block text-sm font-medium text-gray-700">
                    End date <span className="text-gray-400">(optional)</span>
                  </label>
                  <input
                    id="trip-end"
                    type="date"
                    value={endDate}
                    onChange={(event) => setEndDate(event.target.value)}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
                  />
                </div>
              </div>

              {datesInvalid && (
                <p role="alert" className="mt-3 text-sm text-red-600">
                  A trip cannot end before it starts.
                </p>
              )}

              <p className="mt-3 text-sm text-gray-500">
                Give dates and you get a day for each. Leave them out and you get one day to start
                with — you can add more at any time.
              </p>

              <div className="mt-5 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || datesInvalid || !title.trim()}
                  className="rounded-lg bg-primary-600 px-5 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
                >
                  {saving ? 'Creating…' : 'Create trip'}
                </button>
              </div>
            </form>
          )}

          {!ready && (
            <div className="py-20 flex justify-center">
              <LoadingSpinner />
            </div>
          )}

          {/* Failed-to-load and genuinely-empty stay apart (`IMP-031`). */}
          {ready && error && (
            <div
              role="alert"
              className="rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center"
            >
              <FiAlertCircle className="mx-auto h-8 w-8 text-amber-500" aria-hidden="true" />
              <h2 className="mt-4 text-lg font-semibold text-gray-900">
                We could not load your trips
              </h2>
              <p className="mt-1 text-gray-600">
                They are still there — this is a problem reaching the server.
              </p>
              <button
                type="button"
                onClick={refresh}
                className="mt-6 rounded-lg bg-primary-600 px-5 py-2.5 font-medium text-white hover:bg-primary-700"
              >
                Try again
              </button>
            </div>
          )}

          {ready && !error && trips.length === 0 && (
            <div className="rounded-2xl border border-gray-200 bg-white p-12 text-center">
              <FiCompass className="mx-auto h-10 w-10 text-gray-300" aria-hidden="true" />
              <h2 className="mt-4 text-xl font-serif font-bold text-gray-900">No trips yet</h2>
              <p className="mt-2 text-gray-600">
                Start one and add the places you have saved to it.
              </p>
              <button
                type="button"
                onClick={() => setShowForm(true)}
                className="mt-6 inline-flex items-center rounded-lg bg-primary-600 px-5 py-2.5 font-medium text-white hover:bg-primary-700"
              >
                <FiPlus className="mr-2 h-5 w-5" aria-hidden="true" />
                Plan your first trip
              </button>
            </div>
          )}

          {ready && !error && trips.length > 0 && (
            <>
              <p className="sr-only" role="status">
                {trips.length} {trips.length === 1 ? 'trip' : 'trips'}
              </p>
              <ul className="space-y-4">
                {trips.map((trip) => (
                  <li
                    key={trip.id}
                    className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0">
                        <Link
                          href={`/trips/${trip.id}`}
                          className="font-serif text-xl font-bold text-gray-900 hover:text-primary-600"
                        >
                          {trip.title}
                        </Link>
                        <p className="mt-1 flex flex-wrap items-center gap-x-3 text-sm text-gray-500">
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[trip.status] || STATUS_STYLES.draft}`}
                          >
                            {trip.status}
                          </span>
                          {trip.start_date && (
                            <span className="inline-flex items-center">
                              <FiCalendar className="mr-1 h-4 w-4" aria-hidden="true" />
                              {formatDate(trip.start_date)}
                              {trip.end_date ? ` – ${formatDate(trip.end_date)}` : ''}
                            </span>
                          )}
                          <span>
                            {trip.day_count} {trip.day_count === 1 ? 'day' : 'days'} ·{' '}
                            {trip.item_count} {trip.item_count === 1 ? 'item' : 'items'}
                          </span>
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => remove(trip.id)}
                        className="inline-flex items-center rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
                        aria-label={`Delete the trip ${trip.title}`}
                      >
                        <FiTrash2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </>
  );
}
