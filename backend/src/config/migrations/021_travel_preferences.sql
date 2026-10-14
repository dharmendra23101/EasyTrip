-- 021_travel_preferences.sql - the traveller's stated preferences (FV-020 stage a)
--
-- Apply BEFORE deploying the matching backend: the profile route reads and writes these columns.
--
--   psql "$DATABASE_URL" -f backend/src/config/migrations/021_travel_preferences.sql
--
-- Re-runnable and non-destructive: every step is a no-op once applied.
--
--
-- TYPED COLUMNS, NOT A JSONB BLOB - AND 013 ALREADY ARGUED THIS
--
-- `013_traveller_access_needs.sql` put two accessibility booleans on `users` and explained why they
-- were not waiting for FV-020's "obvious" JSONB preferences column:
--
--   > A check that reaches into a blob for a key that may not exist is one typo from silently never
--   > firing. [...] A typed column is a better thing to migrate FROM than an untyped key nobody
--   > validated.
--
-- This migration is FV-020 arriving, and it keeps that shape rather than reversing it. Every field
-- below is CHECK'd or vocabulary-constrained, so a typo is a rejected write instead of a preference
-- that silently never matches anything.
--
--
-- NULL MEANS "NOT SAID", AND IT IS NOT THE SAME AS A DEFAULT
--
-- Every scalar here is nullable with **no default**. That is the point, and it is `ADR-051`'s rule
-- in a new place: *an absence is not a zero.* A traveller who has never opened the preferences form
-- has not told us they want a mid-range, balanced, solo trip - they have told us nothing, and a
-- recommender that treats those two states alike is inventing an opinion and attributing it to them.
--
-- `interests` is the exception and defaults to `'{}'`, because an empty array **is** the absence: an
-- array with nothing in it and a NULL array would be two spellings of one fact.
--
--
-- INTERESTS REUSE THE THEME VOCABULARY, WHICH IS ALREADY GUARDED
--
-- `interests` holds theme ids - the same fourteen `places.themes` uses, checked across both tiers by
-- `npm run check:themes`. Reusing it is what lets a stated interest ever meet a tagged place;
-- a parallel vocabulary would be two lists that drift and never join.
--
-- The membership CHECK is deliberately **not** written here, for the same reason `places.themes`
-- does not have one: the vocabulary lives in the application (`constants/themes.js`) and is enforced
-- by a repository guard, and a second copy in SQL is a second thing to update.
--
--
-- PRIVACY - SAME HANDLING AS 013, FOR A STRONGER REASON
--
-- `dietary_needs` is health- and religion-adjacent. It is written by the owner, returned only on the
-- authenticated `/api/auth/profile` route, and appears in no public payload - the same treatment
-- `users.dob` and the access-needs columns already have.
--
-- Nothing derived from it is stored on a trip, and a shared trip carries no trace of it. That is not
-- an accident of the current code: it is the property that lets somebody share an itinerary without
-- disclosing that they keep halal.

BEGIN;

ALTER TABLE users
  -- Theme ids. Empty array = told us nothing, which is the same fact as "no interests stated".
  ADD COLUMN IF NOT EXISTS interests TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS budget_band VARCHAR(20)
    CHECK (budget_band IS NULL OR budget_band IN ('budget', 'mid', 'premium'));

ALTER TABLE users
  -- How much a traveller wants to fit into a day. Feeds `FV-025`'s feasibility thresholds later;
  -- today it is stated and shown, which is the whole of stage (a).
  ADD COLUMN IF NOT EXISTS travel_pace VARCHAR(20)
    CHECK (travel_pace IS NULL OR travel_pace IN ('relaxed', 'balanced', 'packed'));

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS party_type VARCHAR(20)
    CHECK (party_type IS NULL OR party_type IN ('solo', 'couple', 'family', 'friends'));

ALTER TABLE users
  -- A closed vocabulary rather than free text, so it can be matched rather than merely displayed.
  -- Enforced in the application beside the theme list, for the reason above.
  ADD COLUMN IF NOT EXISTS dietary_needs TEXT[] NOT NULL DEFAULT '{}';

COMMIT;

-- NOT DONE HERE: feeding any of this into `FV-019`'s recommendations.
--
-- That ranking is derived from what somebody has *saved*, and it is tested and mutation-verified
-- against that definition. Mixing a stated interest into it changes what the feature means - and
-- `FV-019`'s panel tells the reader, in words, that it compares the tags on their saved places.
-- Changing the input without changing that sentence would make the interface lie.
--
-- Stage (b) is that integration, with the sentence and the tests changed together.
