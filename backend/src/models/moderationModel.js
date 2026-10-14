const pool = require('../config/db');
const auditModel = require('./auditModel');

/**
 * The review moderation queue (`IMP-111`, `ADR-036`).
 *
 * `review_reports` has existed since migration `003` and has been written to since `IMP-019` gave
 * the place page a report button. **Nothing has ever read it.** Reports have been accumulating in a
 * table with a `status` column that only ever held `'open'` — which is worse than not having the
 * button, because the UI says *"Thanks - this review has been reported for moderation"* and no
 * moderation was possible.
 *
 * This module is the consumer that makes that sentence true.
 */

/** The statuses a report can be moved to. Mirrors the CHECK constraint in `schema.sql`. */
const RESOLUTIONS = ['reviewed', 'dismissed'];
const STATUSES = ['open', ...RESOLUTIONS];

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/**
 * One row per **reported review**, not one per report.
 *
 * That is the whole shape of the queue and it is a deliberate choice. A review reported by eight
 * people is one moderation decision, not eight — a per-report list would make a moderator read the
 * same review eight times and act on it eight times, and the eighth action would find the review
 * already gone. Grouping means the decision and the unit of work are the same thing.
 *
 * **What is deliberately not selected: `reporter_uid`.**
 *
 * `IMP-021` established that this API never exposes the identity behind a review, and the same
 * reasoning covers the identity behind a *report* — arguably more strongly, since a moderator who
 * can see who reported whom can be lobbied, and a leak would expose people who flagged abuse. A
 * moderator needs to judge the review, and the count and the reasons are what that takes. `IMP-117`
 * made the opposite call for a different question, and the distinction holds: there, the one person
 * entitled to the correlation was the author themselves.
 */
const listReports = async ({ status = 'open', limit, offset } = {}) => {
  const safeStatus = STATUSES.includes(status) ? status : 'open';

  const parsedLimit = Number.parseInt(limit, 10);
  const safeLimit =
    Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, MAX_LIMIT)
      : DEFAULT_LIMIT;

  const parsedOffset = Number.parseInt(offset, 10);
  const safeOffset = Number.isFinite(parsedOffset) && parsedOffset > 0 ? parsedOffset : 0;

  const where = 'WHERE r.status = $1';

  const page = pool.query(
    `SELECT
       rev.id                                   AS review_id,
       rev.rating,
       rev.comment,
       rev.user_name                            AS review_author_name,
       rev.created_at                           AS review_created_at,
       p.id                                     AS place_id,
       p.name                                   AS place_name,
       COUNT(r.id)::int                         AS report_count,
       MIN(r.created_at)                        AS first_reported_at,
       MAX(r.created_at)                        AS last_reported_at,
       -- The reasons, with the nulls dropped. The report button currently sends none, so this is
       -- usually empty — the column and this aggregate exist so a reason box can be added without
       -- touching the queue.
       COALESCE(
         ARRAY_AGG(r.reason) FILTER (WHERE r.reason IS NOT NULL),
         '{}'
       )                                        AS reasons,
       -- Every report id in this group, so resolving the review resolves all of them in one call
       -- rather than leaving seven rows behind that would resurface the review tomorrow.
       ARRAY_AGG(r.id ORDER BY r.id)            AS report_ids
     FROM review_reports r
     JOIN place_reviews rev ON rev.id = r.review_id
     JOIN places p          ON p.id  = rev.place_id
     ${where}
     GROUP BY rev.id, rev.rating, rev.comment, rev.user_name, rev.created_at, p.id, p.name
     -- Most-reported first, then oldest: the queue should surface what most people objected to,
     -- and break ties toward what has been waiting longest rather than what arrived last.
     ORDER BY COUNT(r.id) DESC, MIN(r.created_at) ASC, rev.id
     LIMIT $2 OFFSET $3`,
    [safeStatus, safeLimit, safeOffset]
  );

  // Counts the same unit the page does — reviews, not reports — so "3 of 12" cannot mean two
  // different things in one response.
  const total = pool.query(
    `SELECT COUNT(DISTINCT r.review_id)::int AS total FROM review_reports r ${where}`,
    [safeStatus]
  );

  const [rows, count] = await Promise.all([page, total]);

  return {
    rows: rows.rows,
    total: count.rows[0]?.total ?? 0,
    limit: safeLimit,
    offset: safeOffset,
    status: safeStatus
  };
};

/**
 * Resolve every open report against one review, and record who did it (`PE-013`).
 *
 * Keyed on the **review**, not on a report id, because that is the unit a moderator acts on — see
 * `listReports`. Resolving one report of eight would leave the review in the queue with a lower
 * count, which reads as "partly handled" and is a state nobody wants to reason about.
 *
 * Returns the number of report rows moved, so the caller can tell "resolved 8" from "there was
 * nothing open to resolve" — a distinction a bare 204 would throw away, and the one that matters
 * when two moderators open the queue at the same time.
 *
 * **One transaction, not two statements.** The moderation decision and its audit row commit
 * together — a resolution nothing recorded is exactly the gap `022`'s header argues this table
 * exists to close, and it is the likelier failure precisely because the audit insert is the
 * afterthought in any hand-written sequence.
 *
 * The audit row is written only when something actually moved. A second moderator hitting an
 * already-handled review gets a 409 and leaves no entry, because they did not resolve anything —
 * logging their click would fill the trail with non-events and make the real decision harder to
 * find.
 */
const resolveReportsForReview = async (reviewId, resolution, actor = null) => {
  if (!RESOLUTIONS.includes(resolution)) {
    throw new Error(`Unsupported resolution: ${resolution}`);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rowCount } = await client.query(
      `UPDATE review_reports SET status = $1 WHERE review_id = $2 AND status = 'open'`,
      [resolution, reviewId]
    );

    if (rowCount > 0 && actor) {
      await auditModel.record(client, {
        actorUid: actor.uid,
        actorEmail: actor.email,
        action: 'report.resolved',
        targetType: 'review',
        targetId: reviewId,
        // No label. The one thing that would identify this row to a human is the review's text or
        // its author, and `IMP-021` keeps review authorship out of moderator-facing surfaces —
        // the same rule that keeps `reporter_uid` out of the queue above. The review id is the
        // handle; the queue is where you go to see what it was.
        targetLabel: null,
        outcome: 'succeeded',
        detail: { resolution, reports_closed: rowCount }
      });
    }

    await client.query('COMMIT');
    return rowCount;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/** Whether a review has any open reports — used to answer 404-vs-200 honestly. */
const hasOpenReports = async (reviewId) => {
  const { rows } = await pool.query(
    `SELECT 1 FROM review_reports WHERE review_id = $1 AND status = 'open' LIMIT 1`,
    [reviewId]
  );
  return rows.length > 0;
};

/** Counts for the queue badge, one row, one scan per status. */
const reportCounts = async () => {
  const { rows } = await pool.query(
    `SELECT status, COUNT(DISTINCT review_id)::int AS reviews
     FROM review_reports GROUP BY status`
  );

  // Every status is present in the result even at zero. A missing key forces every caller into
  // `counts.open ?? 0`, and the one that forgets renders "undefined" in a badge.
  const counts = Object.fromEntries(STATUSES.map((status) => [status, 0]));
  for (const row of rows) {
    if (row.status in counts) counts[row.status] = row.reviews;
  }
  return counts;
};

module.exports = {
  listReports,
  resolveReportsForReview,
  hasOpenReports,
  reportCounts,
  STATUSES,
  RESOLUTIONS,
  DEFAULT_LIMIT,
  MAX_LIMIT
};
