-- 013_traveller_access_needs.sql - what a traveller needs, as opposed to what a place offers
-- (FV-029 stage c)
--
-- Apply BEFORE deploying the matching backend: getProfile selects these and updateProfile writes
-- them.
--
--   psql "$DATABASE_URL" -f backend/src/config/migrations/013_traveller_access_needs.sql
--
-- Re-runnable and non-destructive: every step is a no-op once applied.
--
-- WHY THESE ARE BOOLEANS WHEN places.step_free_access IS NOT
--
-- Migration 012 argued at length that a place's accessibility cannot be a boolean, because NULL and
-- false are the confusion that strands somebody and 'partial' is the commonest true answer. None of
-- that applies here, and the difference is worth stating so the asymmetry does not read as an
-- oversight:
--
--   * A place's answer is a CLAIM ABOUT THE WORLD that somebody had to go and check. It can be
--     unknown, and unknown has to be distinguishable from no.
--   * A traveller's answer is a STATEMENT ABOUT THEMSELVES that only they can make. There is no
--     "unknown" to represent - either they have told us they need step-free access or they have
--     not - and there is no partial: a requirement half-met is a requirement not met.
--
-- So: NOT NULL DEFAULT FALSE. The default is "no stated requirement", which is the same thing as
-- every existing row, and it is the only default that is safe. FALSE makes the trip checks silent;
-- a TRUE default would make every traveller in the catalogue start with warnings they never asked
-- for, and teaching people to dismiss accessibility warnings is worse than not showing them.
--
-- WHY THIS IS NOT A JSONB PREFERENCES BLOB
--
-- FV-020 describes a broad preference profile - interests, budget band, pace, party type, dietary
-- needs - and a JSONB column is the obvious way to hold something that open-ended. These two are
-- deliberately not in it:
--
--   * They are READ BY A VALIDATOR, not by a recommender. FV-025's engine has to branch on them,
--     and a check that reaches into a blob for a key that may not exist is one typo from silently
--     never firing - which for this feature means silently not warning somebody.
--   * They are the only fields FV-029 needs, and FV-020 is a Phase 13 item. Waiting for the blob
--     would mean holding stage (c) and (d) behind an unstarted personalization feature for two
--     columns that are already fully specified here.
--
-- When FV-020 lands it can absorb these; a typed column is a better thing to migrate FROM than an
-- untyped key nobody validated.
--
-- PRIVACY
--
-- This is health-adjacent personal data. It is written by the owner, returned only on the
-- authenticated /api/auth/profile route, and appears in no public payload - the same handling
-- users.dob already has (migration 002), for the same reason. Nothing derived from it is stored on
-- a trip: the feasibility report is computed per request and never persisted, so a shared trip
-- carries no trace of its owner's requirements.

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS requires_step_free BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS requires_accessible_restroom BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN users.requires_step_free IS
  'The traveller has stated they need step-free access (FV-029 stage c). Read by the feasibility '
  'engine to flag stops that cannot accommodate them. Personal data: authenticated routes only.';
COMMENT ON COLUMN users.requires_accessible_restroom IS
  'The traveller has stated they need an accessible restroom (FV-029 stage c). Same handling as '
  'requires_step_free.';

-- No index. Both columns are read one row at a time by uid on an already-indexed primary lookup,
-- and neither is ever a search predicate - `WHERE requires_step_free` is not a query this product
-- has any reason to run, and adding an index for a scan nobody performs is the mistake
-- places_setting_idx avoided by being partial.

COMMIT;
