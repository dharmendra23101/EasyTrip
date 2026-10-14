const pool = require('../config/db');

/**
 * Place list reads: filtering, sorting, pagination and the typeahead.
 *
 * Split from `placeModel.js` in Sprint 7.6, when `IMP-112` pushed that file to 560 lines and past
 * the 500-line criterion Phase 5 set. The seam is not arbitrary: everything here answers *"which
 * places?"* and everything left behind answers *"this place"* — create, read one, update, delete,
 * and the taxonomy vocabularies. They share only the pool.
 *
 * `placeModel.js` re-exports all of it, so `placeController` keeps one import and no caller
 * changed. Same pattern as Sprint 5.14's controller split, for the same reason: a split that
 * forces every consumer to be edited is a split people work around.
 */

// ---------------------------------------------------------------------------

// The season filter matches the free-text "Best Time to Visit" entry in custom_keys, which is
// the only seasonal data places actually carry. This used to have a hand-maintained twin in
// browse.jsx's client-side filter; that copy is gone (IMP-046), so this is now the only
// definition of what "summer" means and there is nothing left to keep in sync.
const { SEASON_MONTHS: CURATED_SEASON_MONTHS } = require('../constants/placeSeasonality');

// The same three seasons in the two shapes the two data sources need: a regex for the free-text
// fallback, and month numbers for the curated column. Duplicated on purpose and guarded by the
// tests that assert they agree — one is a way of reading prose, the other is a way of reading an
// array, and neither can be expressed in the other's terms.
const SEASON_MONTHS = {
  summer: 'april|may|june',
  monsoon: 'july|august|september',
  winter: 'october|november|december|january|february|march'
};

//
// `getAllPlaces` and `searchPlaces` were two copies of the same query — same projection, same
// LATERAL join, same ORDER BY — differing only in whether a WHERE clause was appended. They are
// one function now, because keeping them apart is how the projection drifted out of sync twice
// already, and because pagination has to behave identically on both.

// The list projection is what a card actually renders. `locality`, `pin_code`, `created_by` and
// `updated_by` are read by no list consumer (grep across frontend/src), so they are not shipped;
// `getPlaceById` still returns them for the detail page. `description` and `custom_keys` stay
// because PlaceCard renders a snippet and the detail chips from them.
const LIST_COLUMNS = `
  places.id, places.name, places.location, places.description, places.district, places.state,
  places.latitude, places.longitude, places.primary_image_url, places.themes, places.tags,
  places.custom_keys, places.rating_count, places.rating_sum, places.created_at, places.updated_at,
  places.step_free_access, places.accessibility_source,
  places.best_months, places.crowd_level, places.typical_visit_minutes,
  to_char(places.accessibility_checked_on, 'YYYY-MM-DD') AS accessibility_checked_on`;

// Three of the five accessibility columns, and the omissions follow the rule above rather than
// laziness. A card carries one badge, so it needs the step-free answer and the two facts that make
// it readable -- who said so and when. accessible_restroom and accessibility_notes belong to the
// detail page, where there is room to render them as sentences rather than compress them into an
// icon, and getPlaceById already returns both.
//
// to_char for the same reason placeModel uses it: node-pg turns a DATE into a JS Date at LOCAL
// midnight, so the serialised value is the previous day east of UTC -- and the date is the whole
// reason the badge is trustworthy.

// Markers need a pin, a label and a popup — nothing else. Dropping `description`, `tags` and
// `custom_keys` is what makes "every place with coordinates" an affordable request even though
// the grid beside it is paginated.
const MAP_COLUMNS = `
  places.id, places.name, places.location, places.district, places.state,
  places.latitude, places.longitude, places.primary_image_url, places.themes,
  places.rating_count, places.rating_sum`;

const RATING_EXPR = `
  CASE
    WHEN places.rating_count > 0 THEN ROUND(places.rating_sum::NUMERIC / places.rating_count, 1)
    ELSE NULL
  END AS average_rating`;

// Resolving the gallery fallback here rather than in a follow-up request is IMP-037; with an
// index-ordered scan feeding a LIMIT, the lateral only runs for the rows actually returned.
const FIRST_IMAGE_JOIN = `
  LEFT JOIN LATERAL (
    SELECT pi.image_url
    FROM place_images pi
    WHERE pi.place_id = places.id
    ORDER BY pi.display_order, pi.created_at
    LIMIT 1
  ) first_image ON TRUE`;

// Sorting moved to the server with pagination, and had to: a client that holds one page cannot
// sort the catalogue, it can only reorder the page it happens to have — which looks like sorting
// and is not. This whitelist is also the injection boundary; `sort` is never interpolated raw.
//
// Every entry ends in `places.id` so the order is total. Without a tiebreaker, rows sharing a
// sort key can be returned in a different relative order per query, which makes OFFSET pagination
// silently duplicate one row and skip another.
const SORT_ORDERS = {
  newest: 'places.created_at DESC, places.id DESC',
  oldest: 'places.created_at ASC, places.id ASC',
  rating: 'average_rating DESC NULLS LAST, places.rating_count DESC, places.id DESC',
  popular: 'places.rating_count DESC, average_rating DESC NULLS LAST, places.id DESC',
  name: 'places.name ASC, places.id ASC'
};

// `relevance` (IMP-112) is deliberately NOT in SORT_ORDERS: every entry there is a constant SQL
// fragment, and relevance is not — its ORDER BY has to reference the bound search parameter, so it
// is assembled per call once the parameter index is known. Keeping it out means SORT_ORDERS stays
// what its comment says it is: the injection boundary, a map of key to fixed SQL.
const RELEVANCE_SORT = 'relevance';

/** Every sort a caller may ask for. The route validator enumerates from this, so the two agree. */
const SORT_KEYS = [...Object.keys(SORT_ORDERS), RELEVANCE_SORT];

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 100;

/**
 * Build the shared WHERE clause. Returns the SQL fragment and its bound parameters so the
 * count query and the page query stay provably in step — they cannot filter differently.
 *
 * `searchParam` is the 1-based index of the bound search text, or null when the caller supplied
 * none. The relevance ORDER BY needs to reference that same parameter, and passing the index back
 * is what keeps the ranked expression and the filter reading the identical value — recomputing the
 * term for the ORDER BY would be a second source of truth for what the user searched for.
 */
const buildFilters = (criteria = {}) => {
  const { searchTerm, location, district, state, tags, themes, minRating, date, stepFree } =
    criteria;
  const params = [];
  let where = ' WHERE 1=1';
  let searchParam = null;

  // Full-text search (IMP-112, ADR-032), replacing `name ILIKE '%q%' OR description ILIKE '%q%'`.
  //
  // `easytrip_search_query` (migration 009) turns arbitrary text into a prefix tsquery that cannot
  // throw, so nothing here has to sanitise the term beyond binding it — and a query that is all
  // stopwords ("the") reduces to an empty tsquery, which matches nothing. That is a deliberate
  // behaviour change from ILIKE, which matched every place containing those letters anywhere.
  if (searchTerm) {
    params.push(searchTerm);
    searchParam = params.length;
    where += ` AND places.search_vector @@ easytrip_search_query($${searchParam})`;
  }

  if (location) {
    params.push(`%${location}%`);
    where += ` AND places.location ILIKE $${params.length}`;
  }

  if (district) {
    params.push(`%${district}%`);
    where += ` AND places.district ILIKE $${params.length}`;
  }

  if (state) {
    params.push(`%${state}%`);
    where += ` AND places.state ILIKE $${params.length}`;
  }

  if (tags && tags.length > 0) {
    params.push(tags);
    where += ` AND places.tags && $${params.length}`;
  }

  if (themes && themes.length > 0) {
    params.push(themes);
    where += ` AND places.themes && $${params.length}`;
  }

  // Step-free access (`FV-029`). An array of levels rather than a single value, so the caller can
  // ask for "verified" or "verified or partly" without this module deciding which of those a
  // traveller wants.
  //
  // **`unknown` is excluded, and that is the opposite of what the season filter below does.** That
  // one deliberately keeps unannotated rows, because a missing "best time" is not evidence of a bad
  // season and hiding those rows would empty the catalogue. Here the reverse is true: somebody
  // filtering on step-free access is asking *which places has anyone actually checked* — and an
  // unsurveyed row is precisely the thing they are trying not to rely on. Keeping it would answer a
  // different question with the same words.
  //
  // Nothing enforces that at this layer: passing 'unknown' would filter for it, which is a coherent
  // request an admin tool might make. The exclusion is the *caller's* choice, and the browse UI
  // never offers it.
  if (stepFree && stepFree.length > 0) {
    params.push(stepFree);
    where += ` AND places.step_free_access = ANY($${params.length})`;
  }

  if (minRating > 0) {
    params.push(minRating);
    where +=
      ` AND places.rating_count > 0` +
      ` AND (places.rating_sum::NUMERIC / places.rating_count) >= $${params.length}`;
  }

  const seasonPattern = SEASON_MONTHS[date];
  if (seasonPattern) {
    // **Curated months first, prose only as a fallback (`FV-028`, `BUG-056`).**
    //
    // The regex below cannot tell a recommendation from a warning: `lower('Avoid April') ~
    // 'april|may|june'` is TRUE, so a place whose own note says to stay away in April was returned
    // to somebody filtering for April. Measured, not suspected.
    //
    // `best_months` says which months are *good*, so the curated branch has no such failure mode.
    // The fallback is kept, unchanged and still defective, for the rows nobody has curated —
    // because the alternative is backfilling months out of the same prose, which is the identical
    // guess wearing a schema. `FV-028`'s kill criterion: a blank field is acceptable, an invented
    // one is not.
    //
    // A place with no `custom_keys` entry is still kept by the fallback, for the reason that branch
    // has always given: a missing annotation is not evidence of a bad season.
    params.push(CURATED_SEASON_MONTHS[date]);
    const monthsParam = params.length;
    params.push(seasonPattern);
    where +=
      ` AND (` +
      `(array_length(places.best_months, 1) IS NOT NULL AND places.best_months && $${monthsParam}::SMALLINT[])` +
      ` OR (array_length(places.best_months, 1) IS NULL AND (` +
      `places.custom_keys->>'Best Time to Visit' IS NULL` +
      ` OR lower(places.custom_keys->>'Best Time to Visit') ~ $${params.length}))` +
      `)`;
  }

  return { where, params, searchParam };
};

const clampLimit = (value) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
};

const clampOffset = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

/**
 * One paginated read for every place list in the product.
 *
 * Returns `{ rows, total }`. The total comes from a second query rather than
 * `COUNT(*) OVER()`, deliberately: a window function is computed over the whole filtered set
 * *before* LIMIT applies, so it would force the LATERAL join and the wide projection to run for
 * every matching row and cancel most of what the LIMIT bought. The count query skips the join and
 * selects no columns at all, and the two run concurrently, so the page costs one round trip of
 * latency rather than two.
 *
 * `projection: 'map'` returns every match with no limit. That is safe only because the map
 * projection is a handful of scalars per row; do not widen it without revisiting this.
 *
 * `withStats` swaps the plain count for one that also returns the aggregates browse displays.
 * Those used to be derived in the browser from the full dataset — which pagination takes away,
 * and averaging the twelve rows of page one under a label reading "Average Rating" would be a
 * wrong number rather than a slower one. It is opt-in because only browse's first request needs
 * it; load-more and the map skip the extra grouping.
 */
const listPlaces = async ({
  filters = {},
  sort,
  limit,
  offset,
  projection = 'list',
  withStats = false
} = {}) => {
  const { where, params, searchParam } = buildFilters(filters);
  const isMap = projection === 'map';

  // Which sort actually runs, resolved here rather than in the controller so there is one answer
  // and the response can report it truthfully.
  //
  // Two rules beyond "use what was asked for":
  //
  //   1. **A search defaults to relevance.** Returning newest-first for a typed query is the bug
  //      IMP-112 exists to fix — it makes a place *named* "Gokarna" sort below one that merely
  //      mentions it, whenever the latter was added more recently. An explicit `sort` still wins:
  //      the browse sort selector is the user overriding this, not fighting it.
  //   2. **Relevance without a search term falls back to newest.** There is nothing to rank, and
  //      `ts_rank_cd` against an empty tsquery is 0 for every row — a total order collapsing to
  //      the tiebreakers, which would silently look like an arbitrary sort rather than an error.
  const requested = sort && (SORT_ORDERS[sort] || sort === RELEVANCE_SORT) ? sort : null;
  const effectiveSort =
    requested === RELEVANCE_SORT && !searchParam
      ? 'newest'
      : requested || (searchParam ? RELEVANCE_SORT : 'newest');

  const orderBy =
    effectiveSort === RELEVANCE_SORT
      ? `ts_rank_cd(places.search_vector, easytrip_search_query($${searchParam})) DESC,` +
        ` places.rating_count DESC, places.id DESC`
      : SORT_ORDERS[effectiveSort];
  const columns = isMap ? MAP_COLUMNS : LIST_COLUMNS;

  const safeLimit = isMap ? null : clampLimit(limit);
  const safeOffset = isMap ? 0 : clampOffset(offset);

  let pageSql = `SELECT ${columns}, ${RATING_EXPR}, first_image.image_url AS fallback_image_url
     FROM places${FIRST_IMAGE_JOIN}${where}
     ORDER BY ${orderBy}`;

  const pageParams = [...params];
  if (safeLimit !== null) {
    pageParams.push(safeLimit, safeOffset);
    pageSql += ` LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`;
  }

  // Catalogue statistics, deliberately *unfiltered*.
  //
  // The browse sidebar shows "Total Places" beside "Filtered Results", and the hero shows
  // headline figures for the site. Both describe the catalogue, not the current query — scoping
  // these to the filter would make the two numbers in that pair identical and turn the headline
  // into a restatement of the result count. `pagination.total` is the filtered number.
  //
  // Aggregates are grouped into one statement so a single scan answers all four. The outer SELECT
  // has no FROM, so each scalar subquery contributes one value and an empty table still returns a
  // row — selecting `FROM top_location` directly would return no rows at all on an empty
  // catalogue, losing the count along with the statistics.
  const statsSql = `
    WITH top_location AS (
      SELECT location, COUNT(*)::int AS place_count
      FROM places
      WHERE location IS NOT NULL
      GROUP BY location
      ORDER BY COUNT(*) DESC, location
      LIMIT 1
    )
    SELECT
      (SELECT COUNT(*)::int FROM places) AS catalogue_total,
      (SELECT ROUND(AVG(rating_sum::NUMERIC / rating_count), 1)
         FROM places WHERE rating_count > 0) AS avg_rating,
      (SELECT location FROM top_location) AS top_location,
      COALESCE((SELECT place_count FROM top_location), 0) AS top_location_count`;

  const queries = [
    pool.query(pageSql, pageParams),
    pool.query(`SELECT COUNT(*)::int AS total FROM places${where}`, params)
  ];
  // Catalogue stats take no parameters, so they cannot share the count query; run them alongside
  // rather than after, and only when a caller asked.
  if (withStats) queries.push(pool.query(statsSql));

  const [page, count, summary] = await Promise.all(queries);
  const stats = summary?.rows[0];

  return {
    rows: page.rows,
    total: count.rows[0]?.total ?? 0,
    limit: safeLimit ?? page.rows.length,
    offset: safeOffset,
    sort: effectiveSort,
    stats: stats
      ? {
          total: stats.catalogue_total ?? 0,
          // NUMERIC arrives from pg as a string; the client renders this value directly.
          avgRating: stats.avg_rating === null ? null : Number(stats.avg_rating),
          topLocation: stats.top_location ?? null,
          topLocationCount: stats.top_location_count ?? 0
        }
      : null
  };
};

// ---------------------------------------------------------------------------
// Typeahead (IMP-112, second half — ADR-033)
// ---------------------------------------------------------------------------

const SUGGEST_DEFAULT_LIMIT = 8;
const SUGGEST_MAX_LIMIT = 10;

/**
 * Suggestions for the search box, ranked in three explicit tiers.
 *
 * This is deliberately **not** `listPlaces` with a small limit. A typeahead answers a different
 * question from a search: the user has not finished asking, and what they want back is the name
 * they are part-way through typing — not the most relevant document. Relevance ranking alone puts
 * a place whose *description* matches strongly above one whose name simply starts with the letters
 * on screen, which reads as the box ignoring what was typed.
 *
 * So the tiers come first and `ts_rank_cd` only breaks ties inside one:
 *
 *   0 — the name STARTS with the text. "gok" → Gokarna. Always first, always what was meant.
 *   1 — the name CONTAINS it. Recovers the mid-word matching full-text search gave up
 *       (`KNOWN_LIMITATIONS`: "ampi" no longer finds Hampi) — for suggestions only, where a
 *       generous match costs a dropdown row rather than a wrong result set.
 *   2 — anything the ranked search matches: state, district, tags, description.
 *
 * **The pattern is escaped, for the same reason the tsquery is built rather than parsed.** A `%`
 * typed into the search box is a LIKE wildcard, and `%` alone would match every row at tier 0 —
 * turning "suggestions" into "the first eight places". `\` and `_` are escaped for the same reason.
 * The CTE computes it once so the WHERE and the ORDER BY provably use the identical pattern.
 *
 * Uses no pg_trgm function (`similarity`, `%`), only LIKE/ILIKE and the tsvector. `004`'s trigram
 * indexes accelerate tiers 0 and 1 when the extension is present, and the DO block there records
 * that a managed host may refuse it — so this must still be *correct* without it, merely slower.
 */
const suggestPlaces = async ({ term, limit } = {}) => {
  const text = typeof term === 'string' ? term.trim() : '';
  if (!text) return [];

  const parsed = Number.parseInt(limit, 10);
  const safeLimit =
    Number.isFinite(parsed) && parsed > 0
      ? Math.min(parsed, SUGGEST_MAX_LIMIT)
      : SUGGEST_DEFAULT_LIMIT;

  const { rows } = await pool.query(
    `WITH q AS (
       SELECT $1::text AS raw,
              replace(replace(replace($1::text, '\\', '\\\\'), '%', '\\%'), '_', '\\_') AS pat
     )
     SELECT places.id, places.name, places.location, places.district, places.state,
       CASE
         WHEN places.name ILIKE q.pat || '%' ESCAPE '\\' THEN 0
         WHEN places.name ILIKE '%' || q.pat || '%' ESCAPE '\\' THEN 1
         ELSE 2
       END AS tier
     FROM places, q
     WHERE places.name ILIKE '%' || q.pat || '%' ESCAPE '\\'
        OR places.search_vector @@ easytrip_search_query(q.raw)
     ORDER BY tier,
              ts_rank_cd(places.search_vector, easytrip_search_query(q.raw)) DESC,
              places.rating_count DESC,
              places.id
     LIMIT $2`,
    [text, safeLimit]
  );

  // `tier` is an implementation detail of the ordering, not part of the contract — a client that
  // rendered "tier 2" differently would be coupled to how ranking happens to be expressed today.
  return rows.map(({ tier, ...place }) => place);
};

module.exports = {
  listPlaces,
  suggestPlaces,
  buildFilters,
  SORT_ORDERS,
  SORT_KEYS,
  RELEVANCE_SORT,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  SUGGEST_DEFAULT_LIMIT,
  SUGGEST_MAX_LIMIT
};
