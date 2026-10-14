-- 011_place_setting.sql - where a place actually is (FV-031 and the intelligence that follows)
--
-- Apply BEFORE deploying the matching backend: the write validator and the place payload both
-- reference `places.setting`.
--
--   psql "$DATABASE_URL" -f backend/src/config/migrations/011_place_setting.sql
--
-- Re-runnable and non-destructive: every step is a no-op once applied.
--
-- WHY A NEW COLUMN, WHEN `themes` AND `tags` ALREADY EXIST
--
-- `FV-031` needs to know whether an itinerary item happens outdoors, so it can say that a 19:30 stop
-- is after sunset in December. Nothing in the model carries that, and the existing vocabulary cannot
-- be pressed into service: `frontend/src/constants/themes.js` mixes three orthogonal axes - season
-- (hot/cold/rainy), audience (romantic/family/weekend) and place character (beach/historical/...) -
-- and not one of its fourteen ids means "this happens outdoors". `historical` covers Hampi's open
-- ruins AND an indoor museum; `religious` covers an open temple complex AND an enclosed shrine.
-- Deriving daylight exposure from them would be wrong for real rows in this catalogue today.
--
-- `tags` is free text by design and `trip_items.item_type` describes what a line in a plan IS
-- (place/transport/meal/activity/note), not where it happens. So this is a genuinely missing
-- dimension rather than a fourth name for an existing one.
--
-- WHY FOUR VALUES, AND WHY `unknown` IS THE DEFAULT
--
--   outdoor  - exposed to weather and daylight. A viewpoint, a beach, a trek, open ruins.
--   indoor   - not. A museum, an aquarium, a mall.
--   mixed    - genuinely both, and the honest answer for a fort with a museum inside it, or a
--              temple complex with an enclosed sanctum. Without it, classifiers round to a lie.
--   unknown  - nobody has classified this row yet. This is the DEFAULT, and it is load-bearing:
--              every consumer must treat it as "do not assert anything", not as a synonym for
--              indoor. A wrong default would silently teach every downstream feature - daylight,
--              weather suitability, effort, closures, recommendations, replanning.
--
-- Backfill is deliberately NOT attempted here. Classifying the catalogue is an editorial act, and
-- guessing it from `themes` is the exact inference this column exists to avoid.

BEGIN;

-- NOT NULL with a default rather than a nullable column: NULL would mean "the column did not exist
-- when this row was written", which is a different fact from "nobody has decided yet" and would
-- leave every consumer writing `COALESCE(setting, 'unknown')` forever.
ALTER TABLE places
  ADD COLUMN IF NOT EXISTS setting TEXT NOT NULL DEFAULT 'unknown';

-- The allowlist lives in the database because this column will drive scheduling advice, and the API
-- is not the only possible writer. Same reasoning as `places_coordinates_source_known` (ADR-039).
ALTER TABLE places DROP CONSTRAINT IF EXISTS places_setting_known;
ALTER TABLE places ADD CONSTRAINT places_setting_known
  CHECK (setting IN ('outdoor', 'indoor', 'mixed', 'unknown'));

-- The daylight check reads "every outdoor item on this day", so the filter is on the value rather
-- than on the whole table. Partial, because `unknown` will be the overwhelming majority until the
-- catalogue is classified and indexing it would be paying for a scan nobody performs.
CREATE INDEX IF NOT EXISTS places_setting_idx
  ON places (setting)
  WHERE setting <> 'unknown';

COMMIT;
