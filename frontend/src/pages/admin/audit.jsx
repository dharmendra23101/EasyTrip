import Head from 'next/head';
import Link from 'next/link';
import { FiArrowLeft, FiShield, FiAlertTriangle } from 'react-icons/fi';

import { useAuth } from '../../context/AuthContext';
import { requireAdminPage } from '../../services/adminGate';
import { useAuditLog } from '../../hooks/useAuditLog';
import { AUDIT_ACTIONS, auditActionLabel, auditOutcome } from '../../constants/auditActions';
import { formatDateTime } from '../../utils/dateFormat';

/**
 * The admin audit log (`PE-013`, `FV-023` part 1, `ADR-056`).
 *
 * ---------------------------------------------------------------------------
 * This page is the reason the table exists
 * ---------------------------------------------------------------------------
 * `ADR-022` deleted four audit INSERTs in Sprint 2.3 rather than create the tables they implied,
 * because *"a table with writers and no readers is not an audit trail — it is write amplification
 * that looks like diligence"*. It named the condition for revisiting: design the schema around what
 * a real consumer queries. This is that consumer, and `022_admin_audit_log.sql` was written from
 * the three questions on this screen.
 *
 * ---------------------------------------------------------------------------
 * What it renders and what it refuses to
 * ---------------------------------------------------------------------------
 * Every column in the table is shown. Nothing is stored that this does not read — that is
 * `ADR-022`'s rule applied one level down, and it is why there is no `metadata` blob.
 *
 * **It does not name the author of a moderated review.** `IMP-021` keeps review authorship out of
 * admin-facing surfaces, and the queue already withholds reporter identity for the same reason. So
 * a `report.resolved` row identifies the review by id and a `review.deleted_by_admin` row by the
 * place it was on — enough to act on, without turning an accountability log into a dossier on the
 * people who were moderated.
 *
 * **`partially_applied` is called out rather than shown as a status word.** It means the database
 * change landed and the Firebase claim did not, which is a state somebody has to *do something
 * about*: the person is an admin in the column that authorises them while every request they make
 * is denied for a claim mismatch. A row that read "Partly applied" and stopped there would be
 * technically accurate and operationally useless.
 */

const OUTCOME_STYLES = {
  succeeded: 'bg-green-50 text-green-800 border-green-200',
  partially_applied: 'bg-amber-50 text-amber-900 border-amber-300'
};

/** The action-specific half of a row. Every `detail` key the backend writes is rendered here. */
const Detail = ({ entry }) => {
  if (entry.action === 'report.resolved') {
    return (
      <span>
        Review #{entry.target_id} — {entry.detail?.resolution}, {entry.detail?.reports_closed}{' '}
        report{entry.detail?.reports_closed === 1 ? '' : 's'} closed
      </span>
    );
  }
  if (entry.action === 'review.deleted_by_admin') {
    return (
      <span>
        Review #{entry.target_id} on{' '}
        <Link href={`/places/${entry.detail?.place_id}`} className="text-primary-700 underline">
          place #{entry.detail?.place_id}
        </Link>
      </span>
    );
  }
  // Both privilege changes. The label is the email, because that is what an admin recognises — and
  // it is a stored copy, so it still reads correctly after the account is deleted.
  return <span>{entry.target_label || entry.target_id}</span>;
};

export default function AdminAudit() {
  const { getIdToken } = useAuth();
  const {
    entries,
    total,
    action,
    offset,
    loading,
    error,
    hasMore,
    changeAction,
    nextPage,
    previousPage
  } = useAuditLog({ getIdToken });

  return (
    <>
      <Head>
        <title>Audit Log | EasyTrip Admin</title>
        {/* Not indexable; robots.txt disallows /admin/ too (`IMP-113`). */}
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

          <div className="mt-4 flex items-center gap-3">
            <FiShield className="h-6 w-6 text-gray-700" />
            <h1 className="text-2xl font-bold text-gray-900">Audit log</h1>
          </div>
          <p className="mt-2 max-w-2xl text-sm text-gray-600">
            Every privilege change and moderation decision, newest first. This log is read-only —
            there is no route that edits or deletes an entry, including for the admin who created
            it.
          </p>

          <div className="mt-6 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => changeAction('')}
              aria-pressed={action === ''}
              className={`min-h-[36px] rounded-full border px-3 py-1.5 text-sm ${
                action === ''
                  ? 'border-primary-600 bg-primary-50 text-primary-700'
                  : 'border-gray-300 text-gray-700 hover:border-primary-400'
              }`}
            >
              All
            </button>
            {AUDIT_ACTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => changeAction(option.id)}
                aria-pressed={action === option.id}
                className={`min-h-[36px] rounded-full border px-3 py-1.5 text-sm ${
                  action === option.id
                    ? 'border-primary-600 bg-primary-50 text-primary-700'
                    : 'border-gray-300 text-gray-700 hover:border-primary-400'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="mt-6 rounded-lg border border-gray-200 bg-white">
            {loading && <p className="p-6 text-sm text-gray-600">Loading the audit log…</p>}

            {!loading && error && (
              <p role="alert" className="p-6 text-sm text-red-700">
                {error}
              </p>
            )}

            {/*
              Empty and failed are different states (`IMP-031`), and on an audit log the distinction
              is the whole point: "nothing has happened" and "we could not find out what happened"
              are opposite answers to the question somebody opened this page to ask.
            */}
            {!loading && !error && entries.length === 0 && (
              <p className="p-6 text-sm text-gray-600">
                {action
                  ? 'No entries of this kind have been recorded.'
                  : 'Nothing has been recorded yet. Entries appear when an admin grants or revokes admin rights, resolves reports, or deletes somebody else’s review.'}
              </p>
            )}

            {!loading && !error && entries.length > 0 && (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-600">
                    <tr>
                      <th scope="col" className="px-4 py-3">
                        When
                      </th>
                      <th scope="col" className="px-4 py-3">
                        Who
                      </th>
                      <th scope="col" className="px-4 py-3">
                        Did what
                      </th>
                      <th scope="col" className="px-4 py-3">
                        To
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {entries.map((entry) => {
                      const outcome = auditOutcome(entry.outcome);
                      return (
                        <tr key={entry.id} className="align-top">
                          <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                            {formatDateTime(entry.created_at)}
                          </td>
                          <td className="px-4 py-3 text-gray-900">
                            {entry.actor_email || entry.actor_uid}
                          </td>
                          <td className="px-4 py-3">
                            <span className="font-medium text-gray-900">
                              {auditActionLabel(entry.action)}
                            </span>
                            {entry.outcome !== 'succeeded' && outcome && (
                              <span
                                className={`ml-2 inline-flex items-center rounded border px-2 py-0.5 text-xs ${
                                  OUTCOME_STYLES[entry.outcome] || OUTCOME_STYLES.succeeded
                                }`}
                              >
                                <FiAlertTriangle className="mr-1 h-3 w-3" />
                                {outcome.label}
                              </span>
                            )}
                            {entry.outcome === 'partially_applied' && outcome?.note && (
                              <p className="mt-1 text-xs text-amber-900">{outcome.note}</p>
                            )}
                          </td>
                          <td className="px-4 py-3 text-gray-700">
                            <Detail entry={entry} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {!loading && !error && total > 0 && (
            <div className="mt-4 flex items-center justify-between text-sm text-gray-600">
              <span>
                {offset + 1}–{offset + entries.length} of {total}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={previousPage}
                  disabled={offset === 0}
                  className="min-h-[36px] rounded border border-gray-300 px-3 py-1.5 disabled:opacity-50"
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={nextPage}
                  disabled={!hasMore}
                  className="min-h-[36px] rounded border border-gray-300 px-3 py-1.5 disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export const getServerSideProps = requireAdminPage;
