-- 012_place_accessibility.sql - whether a place can actually be visited (FV-029 stage a)
--
-- Apply BEFORE deploying the matching backend: the write validator and the place payload both
-- reference these columns.
--
--   psql "$DATABASE_URL" -f backend/src/config/migrations/012_place_accessibility.sql
--
-- Re-runnable and non-destructive: every step is a no-op once applied.
--
-- WHY THIS COLUMN SET IS SHAPED BY ONE KILL CRITERION
--
-- FV-029 names a failure that no other item in FUTURE_VISION.md shares:
--
--   "A wrong step-free claim strands somebody at the bottom of a staircase - this is the one place
--    in the whole vision where an unmarked guess causes real harm, so unverified data must be
--    labelled unverified or omitted."
--
-- Every decision below follows from that sentence rather than from convenience.
--
-- WHY NOT BOOLEANS, WHICH IS WHAT THE ROADMAP ASKED FOR
--
-- FUTURE_VISION describes "a few boolean columns". A boolean cannot carry this data safely, for the
-- same reason places.setting is not one (migration 011):
--
--   * NULL vs false is the exact confusion that causes the harm. A reader - or a query written in a
--     hurry - that treats "we do not know" as "no" merely under-serves someone; one that treats it
--     as "yes" strands them. A three-state column read through COALESCE gets this wrong silently.
--   * 'partial' is the honest answer for a very large number of real places: a ramp to the ground
--     floor and steps to the shrine, a step-free entrance and gravel paths beyond it. Forced into a
--     boolean, every one of those rounds to a lie in one direction or the other.
--
-- So: the same four-value shape as places.setting, with the same NOT NULL DEFAULT 'unknown' and the
-- same rule for consumers - 'unknown' means DO NOT ASSERT ANYTHING. It is not a synonym for 'no'.
--
-- WHY PROVENANCE IS ENFORCED BY THE DATABASE AND NOT BY THE FORM
--
-- The constraint at the bottom is the whole point of this migration. A claim about accessibility
-- without a source and a date is precisely the "unmarked guess" the kill criterion forbids, and a
-- rule that lives only in a validator is a rule that holds until the next writer - a backfill
-- script, a CSV import, a psql session at 2am.
--
-- coordinates_source (migration 010, ADR-039) put an allowlist in the database on the argument that
-- the API is not the only possible writer, for a column that drives a *legal* notice. This drives a
-- *safety* claim, so the same argument applies with more force.
--
-- WHY A DATE, WHEN NOTHING ELSE IN THE CATALOGUE HAS ONE
--
-- Accessibility decays in a way that a name or a description does not. A lift breaks, a ramp is
-- removed during works, a temporary board covers a step. A 2019 claim presented with the same
-- confidence as a 2026 one is the stale-but-reassuring failure this project keeps meeting: the
-- feasibility report clears itself on every write for the same reason (ADR-031).
--
-- The date is NOT auto-set from now(). It records when a human last CHECKED, which is a different
-- fact from when the row was last written, and a trigger that conflated them would quietly refresh
-- the credibility of a claim nobody had re-verified.
--
-- Backfill is deliberately NOT attempted. There is no source to backfill from, and inventing one is
-- the failure mode this file exists to prevent.

BEGIN;

-- Both use the same vocabulary, deliberately: two axes, one set of answers, so a reader learns the
-- scale once. NOT NULL with a default, so no consumer has to write COALESCE and no row can be in
-- the "column did not exist yet" state that NULL would otherwise mean.
ALTER TABLE places
  ADD COLUMN IF NOT EXISTS step_free_access TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE places
  ADD COLUMN IF NOT EXISTS accessible_restroom TEXT NOT NULL DEFAULT 'unknown';

COMMENT ON COLUMN places.step_free_access IS
  'Whether a visitor can reach the main experience without steps (FV-029). '
  'yes / no / partial / unknown. ''unknown'' asserts nothing and must never be read as ''no''.';
COMMENT ON COLUMN places.accessible_restroom IS
  'Whether an accessible restroom is available on site (FV-029). Same vocabulary as '
  'step_free_access.';

ALTER TABLE places DROP CONSTRAINT IF EXISTS places_step_free_access_known;
ALTER TABLE places ADD CONSTRAINT places_step_free_access_known
  CHECK (step_free_access IN ('yes', 'no', 'partial', 'unknown'));

ALTER TABLE places DROP CONSTRAINT IF EXISTS places_accessible_restroom_known;
ALTER TABLE places ADD CONSTRAINT places_accessible_restroom_known
  CHECK (accessible_restroom IN ('yes', 'no', 'partial', 'unknown'));

-- Free text, and it carries most of the value. "Step-free to the courtyard; the inner sanctum is up
-- eleven steps with no handrail" is worth more to a traveller than any enumeration, and the
-- enumeration exists to make the catalogue filterable rather than to replace the sentence.
ALTER TABLE places ADD COLUMN IF NOT EXISTS accessibility_notes TEXT;

COMMENT ON COLUMN places.accessibility_notes IS
  'Free-text detail behind the two enumerated answers (FV-029). Where the ramp stops, what the '
  'surface is, whether staff assist.';

-- WHO says so. An allowlist rather than free text, for the reason ADR-039 gives about
-- coordinates_source: an unrecognised value either renders nothing - silently dropping the caveat a
-- reader needs - or renders a provenance nobody checked.
--
--   operator     - published by the place or its operator. The commonest, and the weakest: it is a
--                  claim by an interested party, which is why it is recorded rather than trusted.
--   site_visit   - somebody went and looked. The strongest thing this catalogue can hold.
--   third_party  - a tourism board, an accessibility organisation, a government dataset.
ALTER TABLE places ADD COLUMN IF NOT EXISTS accessibility_source TEXT;

COMMENT ON COLUMN places.accessibility_source IS
  'Where an accessibility claim came from (FV-029). NULL only when no claim is made. Required by '
  'places_accessibility_is_attributed.';

ALTER TABLE places DROP CONSTRAINT IF EXISTS places_accessibility_source_known;
ALTER TABLE places ADD CONSTRAINT places_accessibility_source_known
  CHECK (accessibility_source IS NULL
         OR accessibility_source IN ('operator', 'site_visit', 'third_party'));

-- WHEN it was last confirmed. A date rather than a timestamp: nobody checks a ramp to the second,
-- and a precision the data does not have is its own small dishonesty.
ALTER TABLE places ADD COLUMN IF NOT EXISTS accessibility_checked_on DATE;

COMMENT ON COLUMN places.accessibility_checked_on IS
  'The day a human last verified the accessibility claim (FV-029). Not the row''s mtime - it is set '
  'by whoever checked, so a later unrelated edit cannot refresh a stale claim''s credibility.';

-- THE CONSTRAINT THIS MIGRATION EXISTS FOR
--
-- A claim requires a source and a date. Both enumerated columns at 'unknown' is "no claim", and
-- needs neither; anything else is a claim, and an unattributed claim is exactly the unmarked guess
-- the kill criterion forbids.
--
-- Notes are deliberately NOT a claim. "The lift was out of order when we visited" is useful and
-- attributing it to nothing is honest, because it asserts nothing about the two axes a filter reads.
ALTER TABLE places DROP CONSTRAINT IF EXISTS places_accessibility_is_attributed;
ALTER TABLE places ADD CONSTRAINT places_accessibility_is_attributed
  CHECK (
    (step_free_access = 'unknown' AND accessible_restroom = 'unknown')
    OR (accessibility_source IS NOT NULL AND accessibility_checked_on IS NOT NULL)
  );

-- A future check cannot have happened. Guards the likeliest data-entry slip - a mistyped year - in
-- the direction that matters, since a date in the future would make a claim look freshly verified.
ALTER TABLE places DROP CONSTRAINT IF EXISTS places_accessibility_checked_on_not_future;
ALTER TABLE places ADD CONSTRAINT places_accessibility_checked_on_not_future
  CHECK (accessibility_checked_on IS NULL OR accessibility_checked_on <= CURRENT_DATE);

-- Partial, for the same reason places_setting_idx is: 'unknown' will be the overwhelming majority
-- until the catalogue is surveyed, and the query the browse filter runs asks for the rows that are
-- not unknown.
CREATE INDEX IF NOT EXISTS places_step_free_access_idx
  ON places (step_free_access)
  WHERE step_free_access <> 'unknown';

COMMIT;
