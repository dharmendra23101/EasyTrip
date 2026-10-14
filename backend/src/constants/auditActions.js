/**
 * The closed vocabularies behind the admin audit log (`PE-013`, `FV-023` part 1).
 *
 * `022_admin_audit_log.sql` CHECKs all three in the database, so a value only the application knows
 * is **a 500 from Postgres**, not a rejected request — the same hazard `FV-020`'s preferences and
 * `places.setting` carry.
 *
 * **`check:themes` guards two of the three, not all of them.** `AUDIT_ACTIONS` and `AUDIT_OUTCOMES`
 * are also declared in `frontend/src/constants/auditActions.js` — the page filters on the first and
 * labels the second — so those are three-tier and checked across all three.
 * `AUDIT_TARGET_TYPES` has no browser copy, because the page branches on `action` rather than on
 * the target type; it is guarded by the CHECK constraint and by `record`'s own assertion, and
 * adding it to the cross-tier check would mean inventing a frontend list nothing reads.
 *
 * **Why the actions are namespaced strings rather than an enum of integers.** The rows outlive the
 * code that wrote them. `'admin.granted'` still means something to a human reading the table in
 * three years; `3` means whatever the constant said at the time, which is exactly the information a
 * migration renumbering loses.
 */

/**
 * Every audited action, and what each one puts in `detail`:
 *
 * | action | detail |
 * | --- | --- |
 * | `admin.granted` / `admin.revoked` | `{}` — the privilege change is the whole fact |
 * | `report.resolved` | the resolution, and how many report rows it closed |
 * | `review.deleted_by_admin` | the place id — deliberately **not** the review author's uid |
 *
 * **Nothing writes a key no reader looks at** — that is `ADR-022`'s rule applied one level down.
 * The admin page renders each of these, so adding a key here means adding it to the page.
 *
 * The notes live above the array rather than inside it because `check:themes` parses this literal
 * with a regex for quoted strings, and a comment between the entries donates its own quotes to the
 * vocabulary — including the apostrophe in a word like "author's", which yielded a phantom id and a
 * guard failure that pointed at the wrong file entirely.
 */
const AUDIT_ACTIONS = [
  'admin.granted',
  'admin.revoked',
  'report.resolved',
  'review.deleted_by_admin'
];

/** What an action was done to. `target_id` holds a Firebase uid for a user, a row id for a review. */
const AUDIT_TARGET_TYPES = ['user', 'review'];

/**
 * `partially_applied` is the column's reason for existing.
 *
 * `addAdmin` writes `is_admin = true` and then syncs the Firebase claim; if that throws, the caller
 * gets a 500 while the privilege change has already landed in the column that authorises them. A
 * log recording only successful *responses* would omit a real privilege change in precisely the
 * case somebody needs to find it.
 */
const AUDIT_OUTCOMES = ['succeeded', 'partially_applied'];

module.exports = { AUDIT_ACTIONS, AUDIT_TARGET_TYPES, AUDIT_OUTCOMES };
