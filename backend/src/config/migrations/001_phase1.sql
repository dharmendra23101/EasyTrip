-- 001_phase1.sql - Phase 1 data-integrity migration
--
-- Adds the one-review-per-user-per-place constraint (IMP-062 / SECURITY_AUDIT M8). Without it a
-- single account can post unlimited reviews for one place and move its rating at will.
--
-- Apply this BEFORE deploying the matching backend: the review upsert in
-- src/controllers/placeController.js uses ON CONFLICT (place_id, user_id), which errors with
-- "no unique or exclusion constraint matching the ON CONFLICT specification" until the
-- constraint exists.
--
--   psql "$DATABASE_URL" -f backend/src/config/migrations/001_phase1.sql
--
-- Re-runnable: each step is a no-op once applied. Step 1 permanently deletes rows - back the
-- table up first if the duplicate reviews matter.

BEGIN;

-- 1. De-duplicate place_reviews, keeping the newest row per (place_id, user_id).
--    The constraint in step 2 cannot be added while duplicates exist.
DELETE FROM place_reviews
WHERE id IN (
  SELECT id
  FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY place_id, user_id
             ORDER BY COALESCE(updated_at, created_at, to_timestamp(0)) DESC, id DESC
           ) AS row_rank
    FROM place_reviews
  ) ranked
  WHERE ranked.row_rank > 1
);

-- 2. One review per user per place. Same constraint name as schema.sql, so a database created
--    from the current schema skips this block.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'place_reviews'::regclass
      AND conname = 'place_reviews_place_id_user_id_key'
  ) THEN
    ALTER TABLE place_reviews
      ADD CONSTRAINT place_reviews_place_id_user_id_key UNIQUE (place_id, user_id);
  END IF;
END
$$;

-- 3. Re-sync the cached rating aggregates. update_place_rating_trigger already fires per row on
--    the DELETE above; this repairs databases where that trigger was never created. Only rows
--    that actually drifted are touched.
UPDATE places p
SET rating_sum   = agg.rating_sum,
    rating_count = agg.rating_count
FROM (
  SELECT pl.id,
         COALESCE(SUM(pr.rating), 0)::INT AS rating_sum,
         COUNT(pr.id)::INT                AS rating_count
  FROM places pl
  LEFT JOIN place_reviews pr ON pr.place_id = pl.id
  GROUP BY pl.id
) agg
WHERE p.id = agg.id
  AND (p.rating_sum IS DISTINCT FROM agg.rating_sum
       OR p.rating_count IS DISTINCT FROM agg.rating_count);

COMMIT;
