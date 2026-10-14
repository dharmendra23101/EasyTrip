-- 014_place_seasonality.sql - when a place is worth visiting, as data rather than as prose
-- (FV-028 stage a)
--
-- Apply BEFORE deploying the matching backend: the list query reads best_months and the write
-- validator accepts it.
--
--   psql "$DATABASE_URL" -f backend/src/config/migrations/014_place_seasonality.sql
--
-- Re-runnable and non-destructive: every step is a no-op once applied.
--
-- THE DEFECT THIS EXISTS TO FIX (BUG-056)
--
-- The season filter has always matched a regex of month names against the free-text
-- custom_keys->>'Best Time to Visit':
--
--   winter  -> 'october|november|december|january|february|march'
--   summer  -> 'april|may|june'
--
-- That cannot distinguish a recommendation from a warning. Measured:
--
--   lower('Avoid April, it is unbearable') ~ 'april|may|june'  ->  TRUE
--
-- So a place whose own note tells you to stay away in April is returned to somebody filtering for
-- April. The filter reads the month and cannot read the sentence around it, and prose is where the
-- meaning lives. No amount of regex fixes that; the data has to say which months are GOOD.
--
-- WHY AN ARRAY OF MONTH NUMBERS
--
-- smallint[] of 1-12, not a season enum and not a start/end pair:
--
--   * A season is a different thing in Kerala and in Ladakh, and this catalogue is regional. The
--     three-season mapping above is a UI convenience over months; making it the storage format
--     would bake one region's calendar into the schema.
--   * A start/end pair cannot express "October to February AND July", which is a real answer for
--     places with a shoulder season - and it forces a decision about wrapping at December.
--   * An array of the months that are actually good is the most direct statement of the fact, and
--     the existing three-season filter is a trivial overlap query against it.
--
-- EMPTY MEANS NOBODY HAS CURATED IT, exactly as places.setting's 'unknown' does. It is NOT "no good
-- months" - that would be a claim about the place - and every consumer must treat it as "say
-- nothing" rather than as "never visit".
--
-- NO BACKFILL FROM THE PROSE, AND THAT IS THE POINT
--
-- Parsing 'October to February' into {10,11,12,1,2} looks safe and is the same guess the regex
-- makes. 'Avoid April' would become {4}. Backfilling is an editorial act (migration 011 made the
-- same call for places.setting), so the column starts empty and the filter falls back to the old
-- free-text behaviour for rows nobody has curated - documented, defective, and unchanged rather
-- than silently replaced by a different guess.
--
-- FV-028's own kill criterion is the rule here: "A blank field is acceptable; an invented one is
-- not."

BEGIN;

-- The months a place is worth visiting, 1-12. Empty array, not NULL: NULL would mean "the column
-- did not exist when this row was written", which is a different fact from "nobody has curated
-- this yet" and would leave every consumer writing COALESCE forever.
ALTER TABLE places
  ADD COLUMN IF NOT EXISTS best_months SMALLINT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN places.best_months IS
  'Months (1-12) this place is worth visiting (FV-028). Empty = not curated, which asserts nothing '
  '- never read it as "no good months". Supersedes the regex over custom_keys (BUG-056).';

-- Every entry a real month. A CHECK rather than a trigger, and in the database rather than only the
-- validator, for the reason ADR-039 gives: the API is not the only writer.
--
-- DUPLICATES ARE NOT CONSTRAINED HERE, deliberately. The first version added
-- "and no duplicates" and Postgres refused it: a CHECK cannot contain a subquery, and every
-- set-based way to express "distinct" needs one. The alternatives were an IMMUTABLE helper function
-- or dropping the clause, and dropping it is right - {1,1,2} overlaps exactly the same months as
-- {1,2}, so a duplicate is untidy rather than wrong, and a whole function to forbid untidiness is
-- a worse trade than the untidiness. The writer de-duplicates; nothing downstream cares.
ALTER TABLE places DROP CONSTRAINT IF EXISTS places_best_months_are_months;
ALTER TABLE places ADD CONSTRAINT places_best_months_are_months
  CHECK (best_months <@ ARRAY[1,2,3,4,5,6,7,8,9,10,11,12]::SMALLINT[]);

-- How busy it typically is. Same four-value shape and the same 'unknown' default as places.setting
-- and the FV-029 columns, because it is the same kind of fact: a curated claim that can honestly be
-- absent, and whose absence must not read as a low crowd level.
ALTER TABLE places
  ADD COLUMN IF NOT EXISTS crowd_level TEXT NOT NULL DEFAULT 'unknown';

ALTER TABLE places DROP CONSTRAINT IF EXISTS places_crowd_level_known;
ALTER TABLE places ADD CONSTRAINT places_crowd_level_known
  CHECK (crowd_level IN ('low', 'moderate', 'high', 'unknown'));

COMMENT ON COLUMN places.crowd_level IS
  'Typical crowd level (FV-028): low / moderate / high / unknown. ''unknown'' is the default and '
  'asserts nothing.';

-- How long a visit typically takes. Minutes, nullable, because "nobody has said" is a real answer
-- and 0 is not.
ALTER TABLE places ADD COLUMN IF NOT EXISTS typical_visit_minutes INTEGER;

ALTER TABLE places DROP CONSTRAINT IF EXISTS places_typical_visit_is_plausible;
ALTER TABLE places ADD CONSTRAINT places_typical_visit_is_plausible
  CHECK (typical_visit_minutes IS NULL OR (typical_visit_minutes > 0 AND typical_visit_minutes <= 1440));

COMMENT ON COLUMN places.typical_visit_minutes IS
  'Typical length of a visit in minutes (FV-028). NULL = not curated. Capped at a day: anything '
  'longer is a trip, not a visit.';

-- WHO says so, and WHEN they last checked - the same pair FV-029 uses, for a weaker but real
-- version of the same reason. A crowd level from 2019 is not wrong the way a removed ramp is
-- wrong, but it is exactly as confidently displayed, and seasonality decays: a place gets popular.
ALTER TABLE places ADD COLUMN IF NOT EXISTS seasonality_source TEXT;
ALTER TABLE places ADD COLUMN IF NOT EXISTS seasonality_checked_on DATE;

ALTER TABLE places DROP CONSTRAINT IF EXISTS places_seasonality_source_known;
ALTER TABLE places ADD CONSTRAINT places_seasonality_source_known
  CHECK (seasonality_source IS NULL
         OR seasonality_source IN ('operator', 'site_visit', 'third_party', 'editorial'));

-- A claim needs a source and a date, exactly as places_accessibility_is_attributed requires. The
-- stakes are lower here - a wrong month costs a disappointing trip, not a person stranded at the
-- foot of a staircase - but the argument for attribution is the same, and two adjacent columns
-- with different honesty rules is worse than one rule applied twice.
ALTER TABLE places DROP CONSTRAINT IF EXISTS places_seasonality_is_attributed;
ALTER TABLE places ADD CONSTRAINT places_seasonality_is_attributed
  CHECK (
    (array_length(best_months, 1) IS NULL AND crowd_level = 'unknown' AND typical_visit_minutes IS NULL)
    OR (seasonality_source IS NOT NULL AND seasonality_checked_on IS NOT NULL)
  );

ALTER TABLE places DROP CONSTRAINT IF EXISTS places_seasonality_checked_on_not_future;
ALTER TABLE places ADD CONSTRAINT places_seasonality_checked_on_not_future
  CHECK (seasonality_checked_on IS NULL OR seasonality_checked_on <= CURRENT_DATE);

-- GIN, because the season filter asks "does this array overlap those months", which is exactly what
-- a GIN index on an array answers. Not partial like places_setting_idx: an empty array is cheap to
-- index and the filter's fallback branch needs to find the uncurated rows too.
CREATE INDEX IF NOT EXISTS places_best_months_idx ON places USING GIN (best_months);

COMMIT;
