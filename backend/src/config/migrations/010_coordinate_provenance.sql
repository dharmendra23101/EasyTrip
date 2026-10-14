-- 010_coordinate_provenance.sql - where a place's coordinates came from (IMP-127)
--
-- ODbL section 4.3 requires attribution for geocoding *output*, separately from map-tile
-- attribution. EasyTrip credits OpenStreetMap on the Leaflet map but not for the coordinates
-- IMP-116 obtains from Nominatim - which are then displayed through a Google Maps embed that
-- credits Google. That is the gap this migration exists to make fixable.
--
-- Share-alike is NOT triggered: individual geocoding results are insubstantial extracts and may sit
-- beside proprietary data (OSMF geocoding guideline, read 2026-08-16 - see docs/RESEARCH_LOG.md).
-- Attribution is required regardless. Storing the coordinates is fine; not crediting them was not.
--
--   psql "$DATABASE_URL" -f backend/src/config/migrations/010_coordinate_provenance.sql
--
-- Re-runnable and non-destructive: every step is a no-op once applied.
--
-- The design is ADR-039. The one decision worth restating here: this column exists so the
-- attribution can be *accurate* rather than blanket. A notice on every place page would credit
-- OpenStreetMap for coordinates an admin typed by hand, which is a different falsehood from the one
-- being fixed (PROJECT_CONSTITUTION Article III). Provenance is the only way to attribute exactly
-- the rows that owe attribution.

BEGIN;

-- NULL means "not obtained from a geocoder we must credit" - hand-typed, seeded, or predating this
-- column. It deliberately does NOT mean "unknown, might be OSM": the only writer that can set this
-- is the lookup path itself, so an absent value is a real answer rather than missing data.
ALTER TABLE places ADD COLUMN IF NOT EXISTS coordinates_source TEXT;

COMMENT ON COLUMN places.coordinates_source IS
  'Geocoder that produced latitude/longitude, when one did. Drives the ODbL attribution notice '
  '(IMP-127). NULL = hand-entered or otherwise not attributable.';

-- An allowlist, not free text. The column drives a legal notice: an unrecognised value would either
-- render nothing (silently dropping attribution that is owed) or render a provider name nobody
-- checked. One provider today; adding one is a deliberate edit of this constraint plus a row in
-- docs/EXTERNAL_APIS.md, which is exactly the friction SESSION_PROTOCOL 11.4b asks for.
ALTER TABLE places DROP CONSTRAINT IF EXISTS places_coordinates_source_known;
ALTER TABLE places ADD CONSTRAINT places_coordinates_source_known
  CHECK (coordinates_source IS NULL OR coordinates_source IN ('nominatim'));

-- The invariant that actually matters, and the reason this is a database constraint rather than a
-- controller check: a provenance claim with no coordinates is an attribution for nothing. It would
-- render a notice crediting OpenStreetMap on a page that displays no OSM-derived data at all.
-- Application code can be bypassed by the next writer; this cannot.
ALTER TABLE places DROP CONSTRAINT IF EXISTS places_coordinates_source_needs_coordinates;
ALTER TABLE places ADD CONSTRAINT places_coordinates_source_needs_coordinates
  CHECK (
    coordinates_source IS NULL
    OR (latitude IS NOT NULL AND longitude IS NOT NULL)
  );

-- No index. Nothing filters or sorts on this column - it is read only as part of a row already
-- being fetched by primary key, and an index no query uses is a cost on every write (the reasoning
-- 007 applied to its absent user_id index).

COMMIT;
