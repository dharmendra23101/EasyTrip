-- 015_trip_notes_and_checklist.sql - the two halves of a trip workspace that are not the itinerary
-- (FV-006 stage b)
--
-- Apply BEFORE deploying the matching backend: the workspace read returns both collections.
--
--   psql "$DATABASE_URL" -f backend/src/config/migrations/015_trip_notes_and_checklist.sql
--
-- Re-runnable and non-destructive: every step is a no-op once applied.
--
-- WHAT FV-006 ASKED FOR, AND WHAT THIS IS NOT
--
-- FV-006 scopes the trip as a *workspace*: "the itinerary, saved places, notes, a checklist,
-- documents and tickets, expenses (FV-008), and collaborators (FV-007)". Stage (a) shipped the
-- itinerary. Stage (b) is "notes, checklist, documents".
--
-- This migration ships the notes and the checklist. It deliberately does NOT ship documents and
-- tickets, and that omission is a decision rather than an oversight:
--
--   A boarding pass, a visa letter or a hotel voucher is somebody's identity document. Storing one
--   is a materially different proposition from storing a public photograph of a temple - different
--   retention, different access control, different consequences on breach - and this project already
--   uploads place images to a third party (Cloudinary) with none of those questions answered for
--   personal documents. Choosing a store for them is a product and privacy decision, not a schema
--   detail, and it belongs in an ADR with somebody's name on it. Tracked as BL-145.
--
-- Nothing here forecloses that: documents arrive as a third child table beside these two.
--
-- WHY TWO TABLES RATHER THAN COLUMNS ON `trips`
--
-- INS-005's rule, the same one that made an itinerary item a row rather than a paragraph: a note and
-- a checklist entry are independently addressable. A single `notes TEXT` column on `trips` cannot be
-- edited by two collaborators (FV-007) without one overwriting the other, cannot be ordered, and
-- cannot carry its own timestamp - and "when did I write this" is most of the value of a trip note.
--
-- `trips.description` already exists and is NOT this. That is the trip's one-line summary, written
-- once; these are the things a traveller adds while planning.

BEGIN;

-- ---------------------------------------------------------------------------
-- Notes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trip_notes (
  id SERIAL PRIMARY KEY,

  -- CASCADE, like trip_days: a note about a deleted trip is not a note about anything. This differs
  -- from trip_items.place_id's SET NULL on purpose - there the row survives losing its *link*,
  -- because it still has a title and a time of its own. A note has no life outside its trip.
  trip_id INT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,

  -- NOT NULL and CHECKed non-blank. An empty note is not a note, and the alternative - rows of
  -- whitespace a reader has to scroll past - is the kind of thing that only shows up in production.
  body TEXT NOT NULL CONSTRAINT trip_notes_body_not_blank CHECK (btrim(body) <> ''),

  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Newest first is how the workspace reads them, so the index carries the order. `id` breaks ties:
-- two notes written in the same millisecond must still have a total order, or pagination can repeat
-- or skip a row.
CREATE INDEX IF NOT EXISTS idx_trip_notes_trip
  ON trip_notes (trip_id, created_at DESC, id DESC);

-- ---------------------------------------------------------------------------
-- Checklist
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trip_checklist_items (
  id SERIAL PRIMARY KEY,
  trip_id INT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,

  label VARCHAR(200) NOT NULL
    CONSTRAINT trip_checklist_label_not_blank CHECK (btrim(label) <> ''),

  is_done BOOLEAN NOT NULL DEFAULT FALSE,

  -- Deliberately NOT unique per (trip_id, position), for the reason trip_items records at length:
  -- reordering under a unique constraint needs deferred constraints or a shuffle through temporary
  -- values, to protect an invariant nothing reads. Reads order by (position, id), which is total
  -- even when two rows collide.
  position INT NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_trip_checklist_trip
  ON trip_checklist_items (trip_id, position, id);

-- ---------------------------------------------------------------------------
-- updated_at, by trigger rather than by every caller remembering
-- ---------------------------------------------------------------------------
-- `update_modified_column()` is the one trigger function migration 006 reconciled across this
-- schema, and the same one trips, trip_days and trip_items already use. Reusing it rather than
-- adding a fourth spelling is the whole point of that reconciliation - and the naming here follows
-- 008's `update_<table>_modtime` rather than inventing a second convention two tables later.
DROP TRIGGER IF EXISTS update_trip_notes_modtime ON trip_notes;
CREATE TRIGGER update_trip_notes_modtime
BEFORE UPDATE ON trip_notes FOR EACH ROW EXECUTE FUNCTION update_modified_column();

DROP TRIGGER IF EXISTS update_trip_checklist_items_modtime ON trip_checklist_items;
CREATE TRIGGER update_trip_checklist_items_modtime
BEFORE UPDATE ON trip_checklist_items FOR EACH ROW EXECUTE FUNCTION update_modified_column();

COMMENT ON TABLE trip_notes IS
  'Free-text notes a traveller adds while planning (FV-006 stage b). Rows rather than a column on '
  'trips so each note is independently addressable, ordered and timestamped.';

COMMENT ON TABLE trip_checklist_items IS
  'Trip checklist (FV-006 stage b). Ordered by (position, id); position is not unique, matching '
  'trip_items.';

COMMIT;
