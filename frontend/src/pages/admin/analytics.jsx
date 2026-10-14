import Head from 'next/head';
import Link from 'next/link';
import { FiArrowLeft, FiBarChart2, FiMapPin, FiImage, FiFlag } from 'react-icons/fi';

import { useAuth } from '../../context/AuthContext';
import { requireAdminPage } from '../../services/adminGate';
import { useAnalytics, ACTIVITY_WINDOWS } from '../../hooks/useAnalytics';
import ActivityChart from '../../components/admin/ActivityChart';
import RatingDistribution from '../../components/admin/RatingDistribution';

/**
 * Analytics and monitoring (`FV-022`, extending `IMP-111` / `ADR-037`).
 *
 * ---------------------------------------------------------------------------
 * What was actually missing, which was not more numbers
 * ---------------------------------------------------------------------------
 * `GET /admin/analytics` has returned four datasets since Sprint 7.11, and the dashboard read
 * **one and a half** of them. `activity` — a dense daily series built with a documented argument
 * about why sparse series lie — was fetched on every dashboard load and rendered nowhere.
 * `needsAttention` — the specific places, each carrying the reason it is listed — was fetched and
 * discarded, while the tiles above it showed *counts* and linked to the whole catalogue. And
 * `ratings` was collapsed to its sum, throwing away the distribution it exists to expose.
 *
 * That is the read-side of the problem `ADR-022` names on the write side: work computed for a
 * reader that does not exist. This page is the reader, and the backend gained only what monitoring
 * genuinely needed — two more series in `activity`.
 *
 * ---------------------------------------------------------------------------
 * Why the dashboard keeps its tiles
 * ---------------------------------------------------------------------------
 * `ADR-037` split the figures into **context** and **needs attention**, and that split is right for
 * a landing page: an admin arriving to do a task should see what needs doing without navigating.
 * This page is the other question — *what has been happening* — which nobody needs on arrival and
 * which does not fit in a tile. Duplicating the tiles here would make two places to change one
 * number.
 */

const Section = ({ title, description, children }) => (
  <section className="mb-10">
    <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
    {description && <p className="mb-4 mt-1 text-sm text-gray-600">{description}</p>}
    {children}
  </section>
);

/** Why a place is listed, from the flags the API attaches to it. */
const reasons = (place) =>
  [
    place.missing_coordinates && { icon: <FiMapPin className="h-3 w-3" />, text: 'No coordinates' },
    place.missing_image && { icon: <FiImage className="h-3 w-3" />, text: 'No image' }
  ].filter(Boolean);

export default function AdminAnalytics() {
  const { getIdToken } = useAuth();
  const { analytics, days, loading, error, setDays } = useAnalytics({ getIdToken });

  return (
    <>
      <Head>
        <title>Analytics | EasyTrip Admin</title>
        {/* Not indexable; robots.txt disallows /admin/ too (`IMP-113`). */}
        <meta name="robots" content="noindex, nofollow" />
      </Head>

      <div className="min-h-screen bg-gray-50 pt-20 pb-12">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          <Link
            href="/admin"
            className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900"
          >
            <FiArrowLeft className="mr-2 h-4 w-4" />
            Back to dashboard
          </Link>

          <div className="mt-4 flex items-center gap-3">
            <FiBarChart2 className="h-6 w-6 text-gray-700" />
            <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
          </div>
          <p className="mt-2 max-w-2xl text-sm text-gray-600">
            What has been happening, and what the catalogue looks like underneath the averages. The
            dashboard shows what needs doing; this shows what has been done.
          </p>

          {loading && <p className="mt-8 text-sm text-gray-600">Loading analytics…</p>}

          {!loading && error && (
            <p
              role="alert"
              className="mt-8 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700"
            >
              {error}
            </p>
          )}

          {!loading && !error && analytics && (
            <div className="mt-8">
              <Section
                title="Activity"
                description="Reviews written, trips created and reports filed, by day. Quiet days are shown as zero rather than skipped."
              >
                <div
                  className="mb-4 flex flex-wrap gap-2"
                  role="group"
                  aria-label="Activity window"
                >
                  {ACTIVITY_WINDOWS.map((window) => (
                    <button
                      key={window.days}
                      type="button"
                      onClick={() => setDays(window.days)}
                      aria-pressed={days === window.days}
                      className={`min-h-[36px] rounded-full border px-3 py-1.5 text-sm ${
                        days === window.days
                          ? 'border-primary-600 bg-primary-50 text-primary-700'
                          : 'border-gray-300 text-gray-700 hover:border-primary-400'
                      }`}
                    >
                      {window.label}
                    </button>
                  ))}
                </div>

                <div className="rounded-xl border border-gray-200 bg-white p-4">
                  <ActivityChart activity={analytics.activity} />
                </div>
              </Section>

              <Section
                title="Rating distribution"
                description="An average hides the shape — a 3.0 from a catalogue of threes is a different product from a 3.0 of ones and fives."
              >
                <div className="rounded-xl border border-gray-200 bg-white p-4">
                  <RatingDistribution ratings={analytics.ratings} />
                </div>
              </Section>

              <Section
                title="Places to finish"
                description="Newest first, with the reason each is listed. These are the ones an admin can close out."
              >
                <div className="rounded-xl border border-gray-200 bg-white">
                  {analytics.needsAttention?.length > 0 ? (
                    <ul className="divide-y divide-gray-100">
                      {analytics.needsAttention.map((place) => (
                        <li
                          key={place.id}
                          className="flex flex-wrap items-center justify-between gap-3 p-4"
                        >
                          <div>
                            {/*
                              Linked to the specific place, which is the whole difference between
                              this list and the dashboard tile above it. A count that sends you to
                              the full catalogue to find the row yourself is a number, not a task.
                            */}
                            <Link
                              href={`/admin/editPlace/${place.id}`}
                              className="font-medium text-primary-700 underline"
                            >
                              {place.name}
                            </Link>
                            {place.location && (
                              <span className="ml-2 text-sm text-gray-500">{place.location}</span>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {reasons(place).map((reason) => (
                              <span
                                key={reason.text}
                                className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-900"
                              >
                                {reason.icon}
                                {reason.text}
                              </span>
                            ))}
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="p-4 text-sm text-gray-600">
                      Every place has coordinates and an image. Nothing to finish.
                    </p>
                  )}
                </div>
              </Section>

              {analytics.catalogue?.open_reports > 0 && (
                <Link
                  href="/admin/moderation"
                  className="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
                >
                  <FiFlag className="h-4 w-4" />
                  {analytics.catalogue.open_reports} review
                  {analytics.catalogue.open_reports === 1 ? '' : 's'} awaiting moderation
                </Link>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export const getServerSideProps = requireAdminPage;
