-- 009_search.sql - ranked full-text search (IMP-112 / ADR-032)
--
-- Replaces the `name ILIKE '%q%' OR description ILIKE '%q%'` searchTerm filter with a weighted
-- tsvector. Apply BEFORE deploying the matching backend: `placeModel.buildFilters` references
-- `places.search_vector` and `easytrip_search_query`, and will error with
-- "column ... does not exist" until they are present.
--
--   psql "$DATABASE_URL" -f backend/src/config/migrations/009_search.sql
--
-- Re-runnable and non-destructive: every step is a no-op once applied.
--
-- What ILIKE actually cost, stated precisely, because IMPROVEMENTS.md overstated one half of it:
-- the columns were NOT unindexed - 004_performance_indexes.sql already put trigram GIN indexes on
-- name/location/district/state, so infix matching was indexed. The two real gaps were
--
--   1. NO RANKING. Every match was equally good, so a place whose *name* is "Gokarna" sorted below
--      one that merely mentions Gokarna in its description, if the latter happened to be newer.
--   2. NO LANGUAGE. "temples" did not match "temple", and "beaches" did not match "beach". A
--      traveller typing a plural got nothing, which reads as "we don't have that".
--
-- `description` was also genuinely unindexed - it is not in 004 - so it is the one column where
-- this migration removes a sequential scan as well.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. An immutable way to flatten text[]
-- ---------------------------------------------------------------------------
-- A GENERATED column's expression must be IMMUTABLE, and `array_to_string` is marked STABLE - not
-- because it varies for text[], but because for other element types the output function can depend
-- on run-time settings (a timestamp[] renders differently under a different DateStyle). Narrowing
-- the argument to text[] removes that possibility, so this wrapper is immutable in fact as well as
-- in declaration.
--
-- Verified rather than assumed: `to_tsvector('english', tags::text)` was tried first and Postgres
-- rejected it outright with "generation expression is not immutable", for the same reason.
--
-- The footgun to know about: CREATE OR REPLACE on a function a generated column depends on does
-- NOT recompute the stored values. If this definition ever changes, the column has to be dropped
-- and re-added in the same migration, or the stored vectors silently disagree with the code.
CREATE OR REPLACE FUNCTION easytrip_text_words(arr text[])
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS
$$ SELECT coalesce(array_to_string(arr, ' '), '') $$;

-- ---------------------------------------------------------------------------
-- 2. The search vector
-- ---------------------------------------------------------------------------
-- GENERATED ... STORED rather than a trigger, because a trigger is a second place the definition
-- of "searchable" can live, and the usual failure is a later INSERT path that forgets to fire it.
-- The column cannot drift from the row: Postgres recomputes it on every INSERT and UPDATE, which
-- also means `placeModel.updatePlace` needed no change at all.
--
-- Weights, and why each column sits where it does:
--
--   A  name         - what the place IS. A name match is the strongest possible signal.
--   B  location,    - where it is. Typing "Karnataka" or "Kodagu" is a real search, not a filter
--      district,      the user knows how to spell into a facet dropdown.
--      state,
--      locality
--   C  tags,        - curated vocabulary: "unesco", "coffee", "beaches". High precision, but a tag
--      themes         match says less than the place being named that.
--   D  description  - free prose. Matches here are the weakest, and lowering them is exactly what
--                     stops a long description from outranking a name.
--
-- `ts_rank_cd` applies the default {0.1, 0.2, 0.4, 1.0} multipliers for D/C/B/A.
ALTER TABLE places
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english',
      coalesce(location, '') || ' ' || coalesce(district, '') || ' ' ||
      coalesce(state, '') || ' ' || coalesce(locality, '')), 'B') ||
    setweight(to_tsvector('english',
      easytrip_text_words(tags) || ' ' || easytrip_text_words(themes)), 'C') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'D')
  ) STORED;

-- GIN, not GiST: this table is read far more than it is written, and GIN answers @@ faster at the
-- cost of slower updates. The opposite trade would only pay off if places churned.
CREATE INDEX IF NOT EXISTS places_search_vector_idx ON places USING GIN (search_vector);

-- ---------------------------------------------------------------------------
-- 3. Turning arbitrary user text into a tsquery that cannot throw
-- ---------------------------------------------------------------------------
-- Three requirements, and no single built-in satisfies all of them:
--
--   `to_tsquery`         - supports the `:*` prefix operator we need, but RAISES on malformed
--                          input. A user typing "a & " would be a 500.
--   `plainto_tsquery`    - total, but no prefix support.
--   `websearch_to_tsquery` - total, supports quoted phrases and `-`, still no prefix support.
--
-- Prefix support is not optional here. The browse search box is debounced search-as-you-text
-- (useBrowsePlaces.js, 250ms), so the server sees "g", "go", "goa" - and without `:*` the first two
-- match nothing and the grid blanks out while the user is still typing.
--
-- So: run the raw text through `to_tsvector`, which tokenises and stems it safely and cannot throw,
-- then rebuild a tsquery from the resulting lexemes with `:*` on each. The user's text is never
-- parsed as query syntax, so there is nothing to inject: "a & b | c ! ( ) : *" reduces to
-- `'b':* & 'c':*`. `quote_literal` handles the lexeme that contains a quote ("o'brien").
--
-- Multi-word input is ANDed, which is what a search box implies: "goa beach" means both.
--
-- One subtlety worth keeping. Lexemes get stemmed twice - once by to_tsvector here, once by
-- to_tsquery - and the second pass is lossy: 'waterfall' -> 'waterfal' -> 'waterf'. Without `:*`
-- that would be a bug, because 'waterf' does not equal the stored 'waterfal'. With `:*` it is
-- merely a broader prefix, so the double stemming can only ever widen the match, never miss one.
--
-- STABLE rather than IMMUTABLE: it is used in WHERE clauses only, never in an index, and the text
-- search configuration is a run-time setting in the general case.
CREATE OR REPLACE FUNCTION easytrip_search_query(raw text)
RETURNS tsquery LANGUAGE sql STABLE PARALLEL SAFE AS
$$
  SELECT coalesce(
    (SELECT to_tsquery('english', string_agg(quote_literal(lexeme) || ':*', ' & '))
       FROM unnest(to_tsvector('english', coalesce(raw, '')))),
    ''::tsquery)
$$;

COMMIT;
