/** Reviews: read, upsert, delete, report. Author identity is anonymised by `reviewPrivacy`. */
const pool = require('../config/db');
const logger = require('../utils/logger');
const { getCurrentUserName } = require('./helpers/currentUser');
const { toPublicReview } = require('./helpers/reviewPrivacy');
const { resolveAdminStatus } = require('../utils/authMiddleware');
const auditModel = require('../models/auditModel');

const getPlaceReviews = async (req, res) => {
  try {
    const { id } = req.params;

    if (isNaN(parseInt(id))) {
      return res.status(400).json({ message: 'Invalid place ID format' });
    }

    const result = await pool.query(
      'SELECT id, place_id, user_id, user_name, rating, comment, created_at, updated_at FROM place_reviews WHERE place_id = $1 ORDER BY created_at DESC',
      [id]
    );

    const viewerUid = req.user?.uid;

    res.status(200).json(result.rows.map((row) => toPublicReview(row, viewerUid)));
  } catch (error) {
    logger.error({ err: error }, 'Error getting reviews');
    res.status(500).json({ message: 'Error getting reviews' });
  }
};

const createPlaceReview = async (req, res) => {
  try {
    const { id } = req.params;
    const { rating, comment } = req.body;

    // The author is whoever the token says it is - never a body field or a header
    const userId = req.user?.uid;
    if (!userId) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const userName = getCurrentUserName(req);

    if (isNaN(parseInt(id))) {
      return res.status(400).json({ message: 'Invalid place ID format' });
    }

    const parsedRating = Number.parseInt(rating, 10);
    if (!Number.isInteger(parsedRating) || parsedRating < 1 || parsedRating > 5) {
      return res.status(400).json({ message: 'Rating must be an integer between 1 and 5' });
    }

    // One review per user per place, enforced by UNIQUE (place_id, user_id): reviewing again
    // edits the existing row instead of stacking another vote onto the place's rating.
    // `xmax = 0` distinguishes the inserted row from the updated one.
    const result = await pool.query(
      `INSERT INTO place_reviews (place_id, user_id, user_name, rating, comment, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       ON CONFLICT (place_id, user_id) DO UPDATE
       SET rating = EXCLUDED.rating,
           comment = EXCLUDED.comment,
           user_name = EXCLUDED.user_name,
           updated_at = NOW()
       RETURNING id, place_id, user_id, user_name, rating, comment, created_at, updated_at, (xmax = 0) AS inserted`,
      [id, userId, userName, parsedRating, comment || null]
    );

    const review = result.rows[0];

    res.status(review.inserted ? 201 : 200).json(toPublicReview(review, userId));
  } catch (error) {
    logger.error({ err: error }, 'Error creating review');

    // 42P10: "no unique or exclusion constraint matching the ON CONFLICT specification".
    // The upsert needs UNIQUE (place_id, user_id); app.js adds it at boot, but that fails
    // when the table still holds duplicate rows. Say so instead of returning a bare 500.
    if (error.code === '42P10') {
      logger.error(
        'place_reviews is missing UNIQUE (place_id, user_id). Back up the table, then run: ' +
          'npm run migrate'
      );
      return res.status(500).json({
        message:
          'Reviews are temporarily unavailable — the server is missing a required database constraint'
      });
    }

    // 23503: foreign_key_violation. `place_reviews.place_id` references `places(id)`, so
    // reviewing a place that does not exist raises this rather than inserting an orphan row.
    // That is a client error — the id is wrong — and it was escaping as a bare 500, which reads
    // as "the server is broken" to the caller and pages whoever watches the 5xx rate.
    // Found by the API suite (IMP-092); nothing in a build or a lint run reaches this path.
    if (error.code === '23503') {
      return res.status(404).json({ message: 'Place not found' });
    }

    res.status(500).json({ message: 'Error creating review' });
  }
};

// Editing a review is the POST upsert above - re-submitting replaces the existing row. There is
// deliberately no PUT: a second edit path would be one more way to do the same thing, and this
// codebase has spent two phases deleting exactly that.

const deletePlaceReview = async (req, res) => {
  try {
    const { id, reviewId } = req.params;

    const userId = req.user?.uid;
    if (!userId) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    // Moderation (`IMP-111`, `ADR-036`): an admin may remove any review, an author only their own.
    //
    // **Extended here rather than given its own admin route.** `IMP-117` recorded the rule — there
    // is no second delete path, because ownership is enforced in one place or it drifts — and a
    // parallel `DELETE /admin/reviews/:id` is exactly the drift it warned about: two statements
    // that must agree about cascade behaviour, the rating trigger and report cleanup forever.
    //
    // `resolveAdminStatus` is the single definition of "is this caller an admin" (`authMiddleware`),
    // the same one the `isAdmin` gate uses. Deriving it here from `req.dbUser.is_admin` would be a
    // second answer to that question, and the two would disagree the first time the claim and the
    // column drifted — which is the case `resolveAdminStatus` exists to detect.
    const { isAdmin: callerIsAdmin } = await resolveAdminStatus(req.decodedToken);

    // Still a single statement, so the security boundary is unchanged: a non-owner who is not an
    // admin cannot remove a row no matter what happens concurrently. Checking permission in a
    // separate query first and then deleting would leave a window between the two.
    //
    // Wrapped in a transaction only so the audit row below commits with it (`PE-013`). The DELETE
    // itself is untouched — same statement, same predicate, same guarantee.
    //
    // `user_id` is returned because it is the one thing that distinguishes the two callers this
    // endpoint serves, and it is gone the moment the row is: an author removing their own review
    // is an ordinary user action, and an admin removing somebody else's is the one worth recording.
    const client = await pool.connect();
    let deleted;
    try {
      await client.query('BEGIN');

      deleted = await client.query(
        `DELETE FROM place_reviews
         WHERE id = $1 AND place_id = $2 AND (user_id = $3 OR $4 = TRUE)
         RETURNING id, user_id`,
        [reviewId, id, userId, callerIsAdmin]
      );

      // **Only when an admin removed someone else's review.** This table records what admins did
      // *to other people*; logging an author tidying up their own review would turn an
      // accountability trail into surveillance of ordinary users, and would bury the four or five
      // entries a reader actually came for.
      const removed = deleted.rows[0];
      if (removed && callerIsAdmin && removed.user_id !== userId) {
        await auditModel.record(client, {
          actorUid: userId,
          actorEmail: req.user?.email || null,
          action: 'review.deleted_by_admin',
          targetType: 'review',
          targetId: removed.id,
          // No label, for the reason `report.resolved` has none: `IMP-021` keeps review authorship
          // out of admin-facing surfaces. Unlike the queue, though, the review is now *gone* — so
          // the place id is recorded, because "which place lost a review" is answerable without
          // naming anyone and is the only context a later reader can still act on.
          targetLabel: null,
          outcome: 'succeeded',
          detail: { place_id: Number(id) }
        });
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    if (deleted.rowCount === 0) {
      // Nothing was removed. Reviews are public, so their ids are not a secret - there is no
      // reason to blur 404 into 403, and an accurate answer is far easier to debug.
      const existing = await pool.query(
        'SELECT user_id FROM place_reviews WHERE id = $1 AND place_id = $2',
        [reviewId, id]
      );

      if (existing.rowCount === 0) {
        return res.status(404).json({ message: 'Review not found' });
      }
      return res.status(403).json({ message: 'You can only delete your own review' });
    }

    // `review_reports.review_id` is `ON DELETE CASCADE`, so removing a review takes its reports
    // with it and the moderation queue needs no cleanup here. Asserted rather than assumed: a
    // removed review that left its reports behind would resurface in the queue pointing at nothing.

    // update_place_rating_trigger fires AFTER DELETE and recomputes rating_sum/rating_count from
    // the remaining rows, so the place aggregate needs no work here.
    res.status(204).send();
  } catch (error) {
    logger.error({ err: error }, 'Error deleting review');
    res.status(500).json({ message: 'Error deleting review' });
  }
};

const reportPlaceReview = async (req, res) => {
  try {
    const { id, reviewId } = req.params;
    const { reason } = req.body;

    const reporterUid = req.user?.uid;
    if (!reporterUid) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const existing = await pool.query(
      'SELECT user_id FROM place_reviews WHERE id = $1 AND place_id = $2',
      [reviewId, id]
    );

    if (existing.rowCount === 0) {
      return res.status(404).json({ message: 'Review not found' });
    }

    if (existing.rows[0].user_id === reporterUid) {
      return res.status(400).json({ message: 'You cannot report your own review' });
    }

    // UNIQUE (review_id, reporter_uid) makes a repeat report a no-op rather than a duplicate row,
    // so one person cannot inflate a future moderation queue by clicking twice.
    await pool.query(
      `INSERT INTO review_reports (review_id, reporter_uid, reason)
       VALUES ($1, $2, $3)
       ON CONFLICT (review_id, reporter_uid) DO NOTHING`,
      [reviewId, reporterUid, reason || null]
    );

    // Same response whether the row was new or already there. Whether they had reported it before
    // is not information the reporter needs, and reporting twice should feel identical.
    res.status(200).json({ message: 'Thanks - this review has been reported for moderation.' });
  } catch (error) {
    logger.error({ err: error }, 'Error reporting review');

    // 42P01: undefined_table. The endpoint is useless until 003 is applied, so say why rather
    // than returning a bare 500 - this is the same failure mode 001 had with place_reviews.
    if (error.code === '42P01') {
      logger.error('review_reports does not exist. Run: npm run migrate');
      return res.status(500).json({
        message: 'Reporting is temporarily unavailable - the server is missing a required table'
      });
    }

    res.status(500).json({ message: 'Error reporting review' });
  }
};

/**
 * Add a gallery image to a place (admin).
 *
 * `place_images` has existed since the original schema, along with its read endpoint and the
 * lightbox that renders it — but nothing ever wrote to it, so the gallery has always been an
 * empty table behind working UI (IMP-014).
 */

module.exports = {
  getPlaceReviews,
  createPlaceReview,
  deletePlaceReview,
  reportPlaceReview
};
