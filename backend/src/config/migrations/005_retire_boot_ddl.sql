-- 005_retire_boot_ddl.sql - fold the boot-time DDL into a real migration (IMP-069)
--
-- Until this migration, `backend/app.js` ran an `ensureDatabaseSchema()` function on every server
-- start that issued these same `ALTER TABLE`s. That is now deleted, so the statements need a home
-- where they run once, in a known order, and leave a record. This is that home.
--
-- Both columns are already declared in schema.sql's `CREATE TABLE`, so a database created from the
-- current schema.sql has them and both steps below are no-ops. This migration exists for databases
-- that predate those columns and were being silently patched at boot instead.
--
--   psql "$DATABASE_URL" -f backend/src/config/migrations/005_retire_boot_ddl.sql
--
-- Re-runnable and non-destructive: both steps are no-ops once applied.
--
-- NOT here: the `place_reviews_place_id_user_id_key` constraint, which `ensureDatabaseSchema()`
-- also maintained. 001_phase1.sql already adds it, and 001 sorts before 005, so the runner has
-- always applied it by the time this file runs. Repeating it here would mean two files owning one
-- constraint — and 001's version is the one that can safely add it, because it de-duplicates the
-- offending rows first inside a transaction. Boot-time code could never do that.

BEGIN;

-- The denormalised "first image" pointer read by the place list and card components. Nullable by
-- design: a place with no images yet is legitimate, and the read path already falls back to
-- place_images.
ALTER TABLE places
  ADD COLUMN IF NOT EXISTS primary_image_url TEXT;

-- Nullable here, though schema.sql declares it NOT NULL on a fresh database. Adding a NOT NULL
-- column to a legacy table that already has rows requires a default or a backfill, and there is no
-- correct default for "the URL of this image" — a placeholder string would be worse than a null,
-- because the read path can test for null but cannot tell a real URL from a fabricated one.
ALTER TABLE place_images
  ADD COLUMN IF NOT EXISTS image_url TEXT;

COMMIT;
