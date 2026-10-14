const pool = require('../config/db');

/**
 * Personalised recommendations, from what you have saved (`FV-019`).
 *
 * ---------------------------------------------------------------------------
 * This is a heuristic and the product says so
 * ---------------------------------------------------------------------------
 * `FP-012` bars relabelling a rule-based feature as AI, and `PRODUCT_ROADMAP` repeats it for this
 * item specifically: *"Not 'AI-powered sorting'. Build `FV-019` properly or call it what it is."*
 * There is no model here. It is a set intersection between the themes on the places you saved and
 * the themes on the places you have not, and every recommendation returns the themes that matched so
 * the reader can check it.
 *
 * ---------------------------------------------------------------------------
 * Why themes, and not the `FV-028` fit score
 * ---------------------------------------------------------------------------
 * The obvious idea is to rank by the destination-fit score. **`ADR-051` forbids it, and that is not a
 * technicality.** That score is a weighted mean over whichever factors happened to be curated, and it
 * travels with a `coverage` figure precisely because 0.9-over-a-fifth-of-the-evidence and
 * 0.9-over-all-of-it are different claims. Sorting by it would put those two in an order, which is
 * the dishonesty the whole of `FV-028` was built to avoid.
 *
 * A ranking signal has to be **comparable across candidates**: the same question asked of every row,
 * with the same evidence available. Theme overlap is that, with one condition attached below.
 *
 * ---------------------------------------------------------------------------
 * The condition, which is the same trap in a new place
 * ---------------------------------------------------------------------------
 * A place with **no themes recorded** would score zero overlap - and so would a place with themes
 * that genuinely share nothing with yours. Those are different facts and scoring them alike is
 * exactly the error `ADR-051` names: an absence rendered as a measurement.
 *
 * So **untagged places are excluded from the ranking, not ranked last**, and the count of them is
 * returned so the caller can say what was left out. "We could not consider 42 places because nobody
 * has tagged them" is a true sentence; putting those 42 at the bottom of a list is not.
 *
 * ---------------------------------------------------------------------------
 * With nothing saved there is no answer, and that is the answer
 * ---------------------------------------------------------------------------
 * A traveller who has saved nothing has expressed no preference. The tempting fallback is to return
 * the highest-rated places and call them recommendations, which would be a *different feature*
 * (popularity) wearing this one's label. Empty, with the reason, is honest.
 */

/**
 * What the caller gets back per place. Deliberately the browse-card shape, so the frontend can reuse
 * the card it already has rather than growing a second one that drifts.
 */
const CARD_COLUMNS = `places.id, places.name, places.location, places.district, places.state,
  places.primary_image_url, places.themes, places.rating_sum, places.rating_count`;

/**
 * Recommendations for one traveller.
 *
 * @param {string} userId  Firebase uid
 * @param {number} limit   how many to return
 * @returns {{recommendations: Array, basis: Object, excluded: Object}}
 *   `basis` is what the answer was computed from - the saved count and the theme profile - because a
 *   recommendation whose input is invisible cannot be argued with.
 */
const getRecommendations = async (userId, { limit = 8 } = {}) => {
  // The profile: each theme you have saved, and how many of your saved places carry it. A theme on
  // four of your saved places says more about you than one on a single place, and the weight is what
  // carries that. `unnest` because `places.themes` is a `TEXT[]`.
  const profile = await pool.query(
    `SELECT theme, COUNT(*)::int AS weight
       FROM user_saved_places
       JOIN places ON places.id = user_saved_places.place_id
       CROSS JOIN LATERAL unnest(places.themes) AS theme
      WHERE user_saved_places.user_id = $1
      GROUP BY theme
      ORDER BY weight DESC, theme`,
    [userId]
  );

  const saved = await pool.query(
    'SELECT COUNT(*)::int AS n FROM user_saved_places WHERE user_id = $1',
    [userId]
  );
  const savedCount = saved.rows[0].n;

  // How many places could not be considered at all. Counted even when there is nothing to recommend,
  // because it is the honest half of an empty answer.
  const untagged = await pool.query(
    'SELECT COUNT(*)::int AS n FROM places WHERE cardinality(themes) = 0'
  );

  const basis = {
    saved_count: savedCount,
    profile: profile.rows.map((row) => ({ theme: row.theme, weight: row.weight }))
  };
  const excluded = { no_themes_recorded: untagged.rows[0].n };

  /**
   * Nothing saved, or everything saved is itself untagged: there is no preference to match against.
   * Returning popular places here would be a different feature wearing this one's label.
   *
   * **Recorded as an equivalent mutant (`R3`).** Removing this changes no answer: an empty profile
   * makes `$2` an empty array, and `places.themes && '{}'` is false for every row, so the query below
   * would return nothing anyway. Measured, not assumed. It is kept because it says the rule where a
   * reader looks for it, and because running a query that provably cannot match is waste.
   */
  if (profile.rows.length === 0) {
    return { recommendations: [], basis, excluded };
  }

  const themes = profile.rows.map((row) => row.theme);
  const weights = profile.rows.map((row) => row.weight);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

  const result = await pool.query(
    `WITH profile AS (
       SELECT * FROM unnest($2::text[], $3::int[]) AS t(theme, weight)
     )
     SELECT ${CARD_COLUMNS},
            ARRAY(
              SELECT profile.theme FROM profile
               WHERE profile.theme = ANY(places.themes)
               ORDER BY profile.weight DESC, profile.theme
            ) AS shared_themes,
            (
              SELECT COALESCE(SUM(profile.weight), 0) FROM profile
               WHERE profile.theme = ANY(places.themes)
            )::float / $4 AS score
       FROM places
      -- Untagged places are excluded from the ranking rather than scored zero: sharing nothing and
      -- having nothing recorded are different facts, and ranking them alike is the error ADR-051
      -- names. Recorded as an equivalent mutant (R1) — the overlap clause below already excludes
      -- them, since an empty array overlaps nothing (measured). Kept because this is the line that
      -- states the rule, and the overlap clause only enforces it as a side effect.
      WHERE cardinality(places.themes) > 0
        -- Overlap is required, not merely rewarded: a place sharing nothing is not a weak
        -- recommendation, it is not a recommendation.
        AND places.themes && $2::text[]
        -- Not something they have already saved. Recommending what somebody already has is the
        -- clearest way to look like you are not paying attention.
        AND places.id NOT IN (
          SELECT place_id FROM user_saved_places WHERE user_id = $1
        )
      -- id last so the order is total: two places with identical overlap must not swap places
      -- between two identical requests.
      ORDER BY score DESC, places.rating_sum DESC, places.id
      LIMIT $5`,
    [userId, themes, weights, totalWeight, limit]
  );

  return {
    recommendations: result.rows.map((row) => ({
      ...row,
      // Rounded here rather than in SQL so the arithmetic stays visible in one place. It is the
      // share of *your* saved-theme weight that this place covers — "how much of what you like does
      // this have", which is a sentence a reader can check against `shared_themes`.
      score: Math.round(row.score * 100) / 100
    })),
    basis,
    excluded
  };
};

module.exports = { getRecommendations };
