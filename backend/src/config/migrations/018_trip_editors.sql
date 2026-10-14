-- 018_trip_editors.sql - a collaborator who can change the itinerary (FV-007 stage c)
--
-- Apply BEFORE deploying the matching backend: the write paths start accepting 'editor' and the
-- collaborator endpoints start writing it.
--
--   psql "$DATABASE_URL" -f backend/src/config/migrations/018_trip_editors.sql
--
-- Re-runnable and non-destructive: every step is a no-op once applied.
--
--
-- THE VOCABULARY GROWS WHEN THE BEHAVIOUR DOES
--
-- `017_trip_collaborators.sql` CHECK'd exactly one role and said why:
--
--   > 'editor' is deliberately absent until the write path enforces it. A role that exists in the
--   > schema while every UPDATE still says `WHERE trips.user_id = $1` is a value the database
--   > accepts and the application ignores - which reads, to anybody inspecting the data, as a
--   > permission somebody has. The vocabulary grows when the behaviour does.
--
-- This is that. `tripAccessModel.editableBy()` is composed into the itinerary write paths in the
-- same change, so the day 'editor' becomes storable is the day it means something.
--
--
-- WHAT AN EDITOR CAN CHANGE, AND WHAT STAYS THE OWNER'S
--
-- An editor edits **the plan**: days, and the items on them. That is the thing two people planning
-- one trip actually need to do together.
--
-- Everything that is about the trip's existence or its audience stays with the owner:
--
--   - renaming it, moving its dates, changing its status  - `updateTrip`
--   - deleting it                                          - `deleteTrip`
--   - duplicating it                                       - `duplicateTrip`
--   - the share link                                       - `tripShareModel`
--   - who else is on it                                    - `trip_collaborators` itself
--
-- The line is drawn at *"can this person change what somebody else can see?"* An editor who could
-- add collaborators or mint a share link would be able to widen the audience for a trip that is not
-- theirs, and an editor who could delete it could destroy it. Neither is implied by "help me plan
-- this", which is the whole of what this role is for.
--
--
-- NO ROLE HIERARCHY IN THE DATABASE
--
-- 'editor' is not stored as "viewer plus something". The two values are flat, and the *code* decides
-- that an editor can also read (`editableBy` implies `readableBy` by construction, because the read
-- predicate does not filter on role at all). Encoding a rank here - an integer level, or a
-- containment table - would put the hierarchy in two places, and the SQL would then be the one
-- nobody updates when a third role arrives.

BEGIN;

ALTER TABLE trip_collaborators
  DROP CONSTRAINT IF EXISTS trip_collaborators_role_check;

ALTER TABLE trip_collaborators
  ADD CONSTRAINT trip_collaborators_role_check CHECK (role IN ('viewer', 'editor'));

COMMIT;

-- Existing rows are untouched and stay 'viewer'. Widening a CHECK cannot invalidate data that
-- already satisfied the narrower one, which is why this migration has no backfill and needs none.
