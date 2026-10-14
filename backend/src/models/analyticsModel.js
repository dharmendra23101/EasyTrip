const pool = require('../config/db');

/**
 * Admin analytics (`IMP-111` second half, `ADR-037`).
 *
 * **The item's premise was stale and the scope is re-argued rather than followed.** `IMP-111` says
 * *"dashboard tiles with real counts replacing the four static tiles"*, and those tiles no longer
 * exist: the fabricated "last login" (`new Date()`, always "just now") was removed in Phase 3, and
 * what is on the dashboard now is navigation cards. There is nothing to replace.
 *
 * So the question became *what would an admin of this product actually use?* — and the answer is
 * not a scoreboard. Totals are the easy thing to render and the least useful thing to read: a
 * curator does not change their behaviour because the catalogue has 47 places rather than 46.
 *
 * Every figure here is therefore either **context** (how big is the catalogue, how engaged are
 * users) or **actionable** (something is missing and you are the person who can add it). The
 * actionable ones carry the ids they refer to, so a tile can link to the work rather than describe
 * it.
 */

/**
 * One round trip, several scalar subqueries.
 *
 * The alternative — a query per tile — is six round trips for a page that renders once, and six
 * independent snapshots of a database that is being written to. Grouping them means the numbers on
 * screen are consistent with each other, which matters when two of them are meant to sum.
 */
const catalogueStats = async () => {
  const { rows } = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM places)                                   AS places,
      (SELECT COUNT(*)::int FROM place_reviews)                            AS reviews,
      (SELECT COUNT(*)::int FROM users)                                    AS users,
      (SELECT COUNT(*)::int FROM users WHERE is_admin = TRUE)              AS admins,
      (SELECT COUNT(*)::int FROM trips)                                    AS trips,
      (SELECT COUNT(*)::int FROM user_saved_places)                        AS saved_places,

      -- Actionable: a place with no coordinates cannot appear on the map, and one with no image
      -- renders a placeholder. Both are curation gaps an admin can close, which is the difference
      -- between a metric and a number.
      (SELECT COUNT(*)::int FROM places
        WHERE latitude IS NULL OR longitude IS NULL)                       AS places_without_coordinates,
      (SELECT COUNT(*)::int FROM places p
        WHERE (p.primary_image_url IS NULL OR p.primary_image_url = '')
          AND NOT EXISTS (SELECT 1 FROM place_images i WHERE i.place_id = p.id))
                                                                           AS places_without_images,
      (SELECT COUNT(*)::int FROM places WHERE rating_count = 0)            AS places_without_reviews,

      -- NULL, not 0, when nothing is rated. Zero would render as "average rating: 0.0", which is
      -- the BUG M-2 rule — an empty catalogue has no average, it does not have an average of zero.
      (SELECT ROUND(AVG(rating_sum::NUMERIC / rating_count), 2)
         FROM places WHERE rating_count > 0)                               AS average_rating,
      (SELECT COUNT(DISTINCT review_id)::int FROM review_reports
        WHERE status = 'open')                                             AS open_reports
  `);

  const row = rows[0] || {};

  return {
    ...row,
    // NUMERIC arrives from pg as a string. Every consumer of this would otherwise have to remember
    // that exactly once, and the one that forgets renders "4.50" through a `.toFixed` that throws.
    average_rating: row.average_rating === null ? null : Number(row.average_rating)
  };
};

/**
 * How the ratings are distributed, 1–5.
 *
 * An average alone hides the shape: 3.0 is a catalogue of threes or a catalogue of ones and fives,
 * and those are different products. Every bucket is present even at zero, so a bar chart has five
 * bars rather than however many happen to be non-empty.
 */
const ratingDistribution = async () => {
  const { rows } = await pool.query(
    `SELECT rating, COUNT(*)::int AS count FROM place_reviews GROUP BY rating`
  );

  const counts = Object.fromEntries([1, 2, 3, 4, 5].map((rating) => [rating, 0]));
  for (const row of rows) {
    if (row.rating in counts) counts[row.rating] = row.count;
  }
  return counts;
};

/**
 * Recent activity, by day, as three series (`FV-022`).
 *
 * Bounded to a window rather than "all time" so the query stays cheap as the table grows, and
 * expressed as a dense series — **quiet days are present at zero.** A sparse series plotted as a
 * line silently draws a straight segment across a quiet week, which reads as steady activity rather
 * than none.
 *
 * ---------------------------------------------------------------------------
 * Why these three and not the ones that are easier to count
 * ---------------------------------------------------------------------------
 * `ADR-037`'s rule governs here too: *what would change what an admin does next?* Each series is
 * one an admin would act on, and the ones left out are left out on that ground.
 *
 * | series | what a change in it means |
 * | --- | --- |
 * | `reviews` | content arriving. A run of zeros where there were not zeros is a signal the review path broke, not that taste changed |
 * | `trips` | the keystone feature being used at all |
 * | `reports` | moderation **inflow** — read against the open-report count, it answers whether the queue is keeping up or falling behind |
 *
 * **Deliberately absent: users joined, and places added.** The first is the vanity metric this
 * dashboard exists to avoid; the second is the admin's own output, and a chart of your own activity
 * is not monitoring. `ADR-037` removed a fabricated "last login" for less.
 *
 * It was `reviewActivity` returning `{ date, count }` until `FV-022`. `count` never said what it
 * counted, which was survivable while there was one series and is not now.
 */
const activitySeries = async (days = 30) => {
  const window = Number.isFinite(Number(days)) ? Math.min(Math.max(Number(days), 1), 90) : 30;

  // One query with three correlated subqueries rather than three queries joined in JS: the days
  // must line up exactly, and three separate dense series assembled client-side is three chances to
  // produce a row whose date does not match the row beside it.
  const { rows } = await pool.query(
    `SELECT
       d.day::date AS date,
       (SELECT COUNT(*)::int FROM place_reviews r  WHERE r.created_at::date  = d.day::date) AS reviews,
       (SELECT COUNT(*)::int FROM trips t          WHERE t.created_at::date  = d.day::date) AS trips,
       (SELECT COUNT(*)::int FROM review_reports p WHERE p.created_at::date  = d.day::date) AS reports
     FROM generate_series(
            CURRENT_DATE - ($1::int - 1) * INTERVAL '1 day',
            CURRENT_DATE,
            INTERVAL '1 day'
          ) AS d(day)
     ORDER BY d.day`,
    [window]
  );

  // `date` comes back as a JS Date. Rendered as a plain `YYYY-MM-DD` string here rather than at the
  // client, because a Date serialised to JSON is UTC midnight and re-parsing it in a browser behind
  // UTC lands on the previous day — the BUG-044/BUG-046 class, designed out rather than tested for.
  return rows.map((row) => ({
    date: row.date instanceof Date ? row.date.toISOString().slice(0, 10) : String(row.date),
    reviews: row.reviews,
    trips: row.trips,
    reports: row.reports
  }));
};

/**
 * The places an admin would most plausibly act on next.
 *
 * Not "top rated" — that is a leaderboard nobody acts on. These are the incomplete ones, newest
 * first, with the reason attached so the tile can say *why* each row is listed.
 */
const incompletePlaces = async (limit = 5) => {
  const safeLimit = Math.min(Math.max(Number(limit) || 5, 1), 20);

  const { rows } = await pool.query(
    `SELECT p.id, p.name, p.location,
            (p.latitude IS NULL OR p.longitude IS NULL) AS missing_coordinates,
            ((p.primary_image_url IS NULL OR p.primary_image_url = '')
              AND NOT EXISTS (SELECT 1 FROM place_images i WHERE i.place_id = p.id))
              AS missing_image
     FROM places p
     WHERE p.latitude IS NULL OR p.longitude IS NULL
        OR ((p.primary_image_url IS NULL OR p.primary_image_url = '')
             AND NOT EXISTS (SELECT 1 FROM place_images i WHERE i.place_id = p.id))
     ORDER BY p.created_at DESC, p.id DESC
     LIMIT $1`,
    [safeLimit]
  );

  return rows;
};

module.exports = { catalogueStats, ratingDistribution, activitySeries, incompletePlaces };
