-- 006_reconcile_triggers.sql - make the migrated schema equal the fresh one (IMP-069)
--
-- Why this exists. `schema.sql` builds a database from nothing; the migrations carry an existing
-- database forward. Those two paths must converge on the same schema, or a fresh install and an
-- upgraded install are different products. Dumping both and diffing them showed they did not:
-- schema.sql creates six triggers and two trigger functions, and NO migration creates any of them.
-- A database whose triggers were missing stayed missing forever, however many migrations ran.
--
-- One of those triggers is load-bearing rather than cosmetic. `update_place_rating_trigger`
-- maintains `places.rating_sum` and `places.rating_count`, which is what every rating in the UI is
-- computed from. 001_phase1.sql already knew this could be absent — its step 3 re-syncs the
-- aggregates and says so, "this repairs databases where that trigger was never created". But it
-- repaired the data and never created the trigger, so the aggregates would drift back out of date
-- with the very next review. This file fixes the cause; 001 fixed the symptom.
--
--   psql "$DATABASE_URL" -f backend/src/config/migrations/006_reconcile_triggers.sql
--
-- Re-runnable and non-destructive: CREATE OR REPLACE for the functions, DROP-then-CREATE for the
-- triggers (Postgres has no CREATE TRIGGER IF NOT EXISTS), and the one column change is guarded.
--
-- Definitions below are copied from schema.sql deliberately, so the two files can be diffed by eye.
-- If one changes, change both — that is the invariant this whole file exists to protect.

BEGIN;

-- ---------------------------------------------------------------------------
-- Trigger functions
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE OR REPLACE FUNCTION update_place_rating() RETURNS TRIGGER AS $$
DECLARE
  new_rating_sum INT;
  new_rating_count INT;
BEGIN
  SELECT COALESCE(SUM(rating),0), COUNT(id)
  INTO new_rating_sum, new_rating_count
  FROM place_reviews
  WHERE place_id = COALESCE(NEW.place_id, OLD.place_id);

  UPDATE places
  SET rating_sum = new_rating_sum,
      rating_count = new_rating_count
  WHERE id = COALESCE(NEW.place_id, OLD.place_id);

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS update_places_modtime ON places;
CREATE TRIGGER update_places_modtime
BEFORE UPDATE ON places
FOR EACH ROW
EXECUTE FUNCTION update_modified_column();

DROP TRIGGER IF EXISTS update_place_reviews_modtime ON place_reviews;
CREATE TRIGGER update_place_reviews_modtime
BEFORE UPDATE ON place_reviews
FOR EACH ROW
EXECUTE FUNCTION update_modified_column();

DROP TRIGGER IF EXISTS update_users_modtime ON users;
CREATE TRIGGER update_users_modtime
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION update_modified_column();

-- newsletter_subscribers is created by 003, which also creates this trigger. Repeated here so the
-- file is a complete statement of the trigger set rather than a partial one.
DROP TRIGGER IF EXISTS update_newsletter_subscribers_modtime ON newsletter_subscribers;
CREATE TRIGGER update_newsletter_subscribers_modtime
BEFORE UPDATE ON newsletter_subscribers
FOR EACH ROW
EXECUTE FUNCTION update_modified_column();

-- ---------------------------------------------------------------------------
-- The rating aggregate trigger — the load-bearing one
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS update_place_rating_trigger ON place_reviews;
CREATE TRIGGER update_place_rating_trigger
AFTER INSERT OR UPDATE OR DELETE ON place_reviews
FOR EACH ROW EXECUTE FUNCTION update_place_rating();

-- Re-sync once, now that the trigger is guaranteed to exist. On a database that had been running
-- without it, the stored aggregates are stale by however many reviews arrived in the meantime.
-- Only rows that actually drifted are written.
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

-- ---------------------------------------------------------------------------
-- place_images.image_url — converge on schema.sql's NOT NULL where it is safe
-- ---------------------------------------------------------------------------
-- 005 added this column nullable, because there is no correct default for "the URL of this image"
-- and a placeholder string would be worse than a null. schema.sql declares it NOT NULL, so the two
-- paths disagree on exactly one column.
--
-- Resolved by promoting it only when the data allows: no NULLs means the constraint can be added
-- with no invented values. A database that does have NULL image_urls keeps the nullable column and
-- says so, rather than the migration either failing or fabricating data to get past itself.
DO $$
DECLARE
  null_count BIGINT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'place_images'
      AND column_name = 'image_url' AND is_nullable = 'YES'
  ) THEN
    SELECT count(*) INTO null_count FROM place_images WHERE image_url IS NULL;

    IF null_count = 0 THEN
      ALTER TABLE place_images ALTER COLUMN image_url SET NOT NULL;
    ELSE
      RAISE NOTICE
        'place_images.image_url left nullable: % row(s) have no URL. schema.sql declares this column NOT NULL. Populate or delete those rows, then re-run this migration.',
        null_count;
    END IF;
  END IF;
END
$$;

COMMIT;
