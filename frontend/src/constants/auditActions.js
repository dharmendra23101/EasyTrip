/**
 * The audit-log vocabularies, browser side (`PE-013`, `FV-023`).
 *
 * The ids here are the values `022_admin_audit_log.sql` CHECKs and
 * `backend/src/constants/auditActions.js` validates — a third copy of one list, held in step by
 * `npm run check:themes`. Without that guard an action the page filters on but the API rejects is a
 * dropdown option that always returns 400, and one the API writes but the page has no label for
 * renders as a raw string in a table somebody is meant to read under pressure.
 *
 * The labels live only here, because a label is a product decision the database has no opinion
 * about — `admin.granted` is an id, "Granted admin" is a sentence.
 */

export const AUDIT_ACTIONS = [
  { id: 'admin.granted', label: 'Granted admin' },
  { id: 'admin.revoked', label: 'Revoked admin' },
  { id: 'report.resolved', label: 'Resolved reports' },
  { id: 'review.deleted_by_admin', label: 'Deleted a review' }
];

export const AUDIT_OUTCOMES = [
  { id: 'succeeded', label: 'Applied' },
  {
    id: 'partially_applied',
    label: 'Partly applied',
    // Rendered next to the row, because this is the state somebody has to act on: the database
    // change landed and the Firebase claim did not, so the person is an admin in the column that
    // authorises them while every request they make is denied for a claim mismatch.
    note: 'The database change was applied but the Firebase claim was not. Retry the action.'
  }
];

/** `'admin.granted'` -> `'Granted admin'`, falling back to the raw id rather than to nothing. */
export const auditActionLabel = (id) =>
  AUDIT_ACTIONS.find((action) => action.id === id)?.label ?? id;

export const auditOutcome = (id) => AUDIT_OUTCOMES.find((outcome) => outcome.id === id) ?? null;
