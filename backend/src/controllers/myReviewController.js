const pool = require('../config/db');
const logger = require('../utils/logger');

/**
 * The caller's own review history — `GET /api/auth/reviews` (`IMP-117`).
 *
 * **Why this is not `getPlaceReviews` with a different filter.** That endpoint answers *"what do
 * strangers see about this place"*, and it exists to **hide** identity: `toPublicReview` replaces
 * the author's uid with a per-place digest so nobody can correlate a person's reviews across the
 * site (`IMP-021`). This endpoint answers the opposite question — *"what have I written"* — which
 * is precisely the correlation the public shape refuses to allow.
 *
 * They are different reads with opposite privacy postures, so they are different handlers. Adding
 * a `mine=true` flag to the public one would put both postures behind a single query parameter,
 * which is exactly the shape of mistake `IMP-002` was: one endpoint whose answer depends on
 * something the caller supplies.
 *
 * The safety property here is the same one the wishlist has: **the owner is `req.user.uid` and
 * nothing in the request names a user.** There is no `?user=` and no body field; the WHERE clause
 * is the boundary.
 */

/**
 * The review, plus enough of the place to render a card and link back to it.
 *
 * No `user_id` and no digest. The rows all belong to the caller, so a per-place author digest
 * would be noise — and echoing the raw uid back would put it in a payload for the first time since
 * `SECURITY_AUDIT` M7 removed uids from review responses. Neither is needed to render the list.
 */
const MY_REVIEW_COLUMNS = `
  place_reviews.id, place_reviews.place_id, place_reviews.rating, place_reviews.comment,
  place_reviews.created_at, place_reviews.updated_at,
  places.name AS place_name, places.location AS place_location,
  places.primary_image_url AS place_image_url`;

const getMyReviews = async (req, res) => {
  try {
    // INNER JOIN, not LEFT: `place_reviews.place_id` cascades on place delete, so a review with no
    // place cannot exist. If one ever did, rendering a card with a null name and a dead link is
    // worse than omitting it.
    const result = await pool.query(
      `SELECT ${MY_REVIEW_COLUMNS}
       FROM place_reviews
       JOIN places ON places.id = place_reviews.place_id
       WHERE place_reviews.user_id = $1
       ORDER BY place_reviews.updated_at DESC, place_reviews.id DESC`,
      [req.user.uid]
    );

    res.status(200).json({ reviews: result.rows });
  } catch (error) {
    logger.error({ err: error }, 'Error listing own reviews');
    res.status(500).json({ message: 'Error loading your reviews' });
  }
};

module.exports = { getMyReviews };
