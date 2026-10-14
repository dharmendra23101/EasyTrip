-- 004_performance_indexes.sql - Phase 4 performance indexes (IMP-043)
--
-- Every index here targets a query that exists in the code today. Nothing is added speculatively:
-- an unused index costs write throughput and disk for no return, which is the usual way index
-- work makes a system slower rather than faster.
--
--   psql "$DATABASE_URL" -f backend/src/config/migrations/004_performance_indexes.sql
--
-- Re-runnable: every statement uses IF NOT EXISTS.
--
-- Locking note: a plain CREATE INDEX takes a lock that blocks writes to the table while it builds.
-- At this data size (hundreds of rows) that is milliseconds, so plain CREATE INDEX is used for
-- clarity. If this project ever reaches a table size where that matters, the fix is
-- CREATE INDEX CONCURRENTLY — which cannot run inside a transaction block, and cannot be used
-- inside the DO blocks below at all. That is a deliberate trade recorded here rather than a
-- detail to rediscover under load.
--
-- This file therefore has no BEGIN/COMMIT: each statement is independently idempotent, so a
-- partial run can simply be re-run.

-- ---------------------------------------------------------------------------
-- Foreign-key lookups
-- ---------------------------------------------------------------------------
-- Postgres indexes the PRIMARY KEY automatically but NOT the referencing side of a foreign key.
-- Both of these are read on every place-detail view:
--   place_images:  SELECT ... WHERE place_id = $1 ORDER BY display_order, created_at
--   place_reviews: SELECT ... WHERE place_id = $1 ORDER BY created_at DESC
-- Without them each read is a sequential scan of the whole table.
--
-- Both include the ORDER BY columns so the sort is satisfied by the index rather than by a
-- separate sort step.
CREATE INDEX IF NOT EXISTS place_images_place_id_order_idx
  ON place_images (place_id, display_order, created_at);

CREATE INDEX IF NOT EXISTS place_reviews_place_id_created_idx
  ON place_reviews (place_id, created_at DESC);

-- The rating trigger recomputes an aggregate per place on every review write, and the review
-- upsert resolves a user's existing review. The UNIQUE (place_id, user_id) constraint already
-- provides an index for the (place_id, user_id) prefix, so nothing further is needed there.

-- ---------------------------------------------------------------------------
-- Array containment filters (browse)
-- ---------------------------------------------------------------------------
-- `tags && $1` and `themes && $1` are containment operators. A btree index cannot serve them at
-- all; GIN is the index type that can.
CREATE INDEX IF NOT EXISTS places_themes_gin_idx ON places USING GIN (themes);
CREATE INDEX IF NOT EXISTS places_tags_gin_idx   ON places USING GIN (tags);

-- ---------------------------------------------------------------------------
-- Text search (browse)
-- ---------------------------------------------------------------------------
-- The search filters use `ILIKE '%term%'`. A leading wildcard makes a btree index useless, because
-- btree can only seek on a known prefix. pg_trgm indexes trigrams instead and DOES accelerate
-- infix matching, which is what these queries actually do.
--
-- If the extension cannot be created (managed hosts sometimes restrict it), the DO block below
-- logs and continues rather than failing the whole migration — the queries still work, just
-- without the index.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION WHEN insufficient_privilege OR feature_not_supported THEN
  RAISE NOTICE 'pg_trgm unavailable; skipping trigram indexes (searches will use sequential scans)';
END
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    CREATE INDEX IF NOT EXISTS places_name_trgm_idx        ON places USING GIN (name gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS places_location_trgm_idx    ON places USING GIN (location gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS places_district_trgm_idx    ON places USING GIN (district gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS places_state_trgm_idx       ON places USING GIN (state gin_trgm_ops);
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Default ordering
-- ---------------------------------------------------------------------------
-- Every place list ends with `ORDER BY created_at DESC`, and pagination (IMP-038) turns that into
-- an ORDER BY ... LIMIT, which an index on the sort column can satisfy without sorting the table.
CREATE INDEX IF NOT EXISTS places_created_at_idx ON places (created_at DESC);

-- ---------------------------------------------------------------------------
-- Newsletter
-- ---------------------------------------------------------------------------
-- The UNIQUE constraint on email already indexes the upsert's conflict target. No addition needed;
-- noted so a future reader does not "fix" its absence.
