import Head from 'next/head';
import Link from 'next/link';
import { toast } from 'react-toastify';
import { FiArrowLeft, FiAlertTriangle, FiCheck, FiTrash2, FiFlag } from 'react-icons/fi';

import { useAuth } from '../../context/AuthContext';
import { requireAdminPage } from '../../services/adminGate';
import { useModerationQueue } from '../../hooks/useModerationQueue';
import { formatDateShort } from '../../utils/dateFormat';

/**
 * The review moderation queue (`IMP-111`, `ADR-036`).
 *
 * The API this consumes closed a loop `IMP-019` opened in Phase 2: the report button had been
 * writing to `review_reports` for months and nothing had ever read it. This page is the reader.
 *
 * One row per reported **review**, never per report — see `ADR-036`. A moderator makes one
 * decision about a review flagged by eight people, and a list that showed it eight times would ask
 * them to make it eight times.
 */

const TABS = [
  { id: 'open', label: 'Open' },
  { id: 'reviewed', label: 'Reviewed' },
  { id: 'dismissed', label: 'Dismissed' }
];

export default function AdminModeration() {
  const { getIdToken } = useAuth();
  const {
    rows,
    counts,
    status,
    loading,
    error,
    busyReviewId,
    changeStatus,
    resolveReview,
    removeReviewById
  } = useModerationQueue({ getIdToken });

  const act = async (promise, successMessage) => {
    const result = await promise;
    if (result.ok) {
      toast.success(successMessage);
      return;
    }
    // A 409 is not a failure of this click — it means somebody else got there first, and the list
    // has already been reloaded to show that. `toast.info` rather than `error` because nothing
    // went wrong.
    (result.conflict ? toast.info : toast.error)(result.message);
  };

  return (
    <>
      <Head>
        <title>Review Moderation | EasyTrip Admin</title>
        {/* Not indexable, and robots.txt disallows /admin/ as well (IMP-113) — belt and braces,
            because a noindex tag is the one a crawler that ignores robots.txt still honours. */}
        <meta name="robots" content="noindex, nofollow" />
      </Head>

      <div className="min-h-screen bg-gray-50 pt-20 pb-12">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <Link
            href="/admin"
            className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900"
          >
            <FiArrowLeft className="mr-2 h-4 w-4" />
            Back to dashboard
          </Link>

          <div className="mt-6 mb-8">
            <h1 className="text-3xl font-extrabold text-gray-900 flex items-center">
              <FiFlag className="mr-3 h-7 w-7 text-red-500" />
              Review Moderation
            </h1>
            <p className="mt-2 text-gray-500">
              Reviews the community has reported. One row per review, however many people reported
              it.
            </p>
          </div>

          <div className="mb-6 flex flex-wrap gap-2">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => changeStatus(tab.id)}
                aria-pressed={status === tab.id}
                className={`inline-flex items-center rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                  status === tab.id
                    ? 'bg-primary-600 text-white'
                    : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'
                }`}
              >
                {tab.label}
                {/* The server sends every status even at zero, so this never renders "undefined". */}
                <span
                  className={`ml-2 rounded-full px-2 py-0.5 text-xs ${
                    status === tab.id ? 'bg-white/20' : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {counts[tab.id]}
                </span>
              </button>
            ))}
          </div>

          {error && (
            <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {error}
            </div>
          )}

          {loading && <p className="py-12 text-center text-gray-500">Loading the queue…</p>}

          {/* An empty OPEN queue is good news and says so; an empty resolved tab is just empty.
              One message for both would congratulate a moderator for an empty archive. */}
          {!loading && !error && rows.length === 0 && (
            <div className="rounded-xl border-2 border-dashed border-gray-200 bg-white p-12 text-center">
              <FiCheck className="mx-auto mb-3 h-8 w-8 text-green-500" />
              <p className="text-gray-700">
                {status === 'open' ? 'Nothing is waiting for moderation.' : `No ${status} reports.`}
              </p>
            </div>
          )}

          <ul className="space-y-4">
            {rows.map((row) => {
              const busy = busyReviewId === row.review_id;

              return (
                <li
                  key={row.review_id}
                  className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <span className="inline-flex items-center rounded-full bg-red-50 px-3 py-1 text-xs font-medium text-red-700">
                        <FiAlertTriangle className="mr-1.5 h-3 w-3" />
                        {row.report_count} {row.report_count === 1 ? 'report' : 'reports'}
                      </span>
                      <Link
                        href={`/places/${row.place_id}`}
                        className="ml-3 text-sm font-medium text-primary-600 hover:text-primary-800"
                      >
                        {row.place_name}
                      </Link>
                    </div>
                    <p className="text-xs text-gray-400">
                      First reported {formatDateShort(row.first_reported_at)}
                    </p>
                  </div>

                  <div className="mt-4 rounded-lg bg-gray-50 p-4">
                    <p className="text-sm font-medium text-gray-800">
                      {/* The display name is public on the place page already, and may be the thing
                          being reported. No uid is shown — not the author's, not the reporters'
                          (ADR-036). */}
                      {row.review_author_name || 'Anonymous'}
                      <span className="ml-2 text-xs font-normal text-gray-500">
                        rated {row.rating}/5 · {formatDateShort(row.review_created_at)}
                      </span>
                    </p>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">
                      {row.comment || <span className="italic text-gray-400">No comment</span>}
                    </p>
                  </div>

                  {row.reasons?.length > 0 && (
                    <p className="mt-3 text-xs text-gray-500">
                      Reasons given: {row.reasons.join(' · ')}
                    </p>
                  )}

                  {status === 'open' && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          act(
                            resolveReview(row.review_id, 'dismissed'),
                            'Dismissed — the review stays up.'
                          )
                        }
                        className="inline-flex items-center rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                      >
                        <FiCheck className="mr-1.5 h-4 w-4" />
                        Dismiss
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          act(
                            resolveReview(row.review_id, 'reviewed'),
                            'Marked as reviewed — the review stays up.'
                          )
                        }
                        className="inline-flex items-center rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                      >
                        Mark reviewed
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          // The only destructive action on this page, and the only one that
                          // confirms. Removing a review is irreversible — the row and its reports
                          // both go — where dismissing is a status change somebody can revisit.
                          if (
                            !window.confirm(
                              `Permanently remove this review of ${row.place_name}? This cannot be undone.`
                            )
                          ) {
                            return;
                          }
                          act(
                            removeReviewById(row.place_id, row.review_id),
                            'Review removed, along with its reports.'
                          );
                        }}
                        className="inline-flex items-center rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                      >
                        <FiTrash2 className="mr-1.5 h-4 w-4" />
                        {busy ? 'Working…' : 'Remove review'}
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </>
  );
}

// Server-side admin gate (`IMP-054`). Without it the page HTML is served to anyone and the
// client-side redirect is the only protection — which is a flash of an admin shell, and a posture
// the other admin pages do not have. `adminPageGate.test.js` asserts every page under
// `pages/admin/` exports this, because the one that forgets is invisible until somebody looks.
export const getServerSideProps = requireAdminPage;
