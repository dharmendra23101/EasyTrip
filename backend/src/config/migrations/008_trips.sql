-- 008_trips.sql - the trip workspace (IMP-109 / FV-006)
--
-- Three tables: a trip, its days, and the ordered items in each day. This is the keystone the
-- roadmap's whole forward half rests on - feasibility (FV-025), route optimisation (FV-026),
-- replanning (FV-027), collaboration (FV-007) and budget (FV-008) all attach here.
--
-- Apply BEFORE deploying the matching backend: every /api/auth/trips route touches these tables
-- and will error with "relation ... does not exist" until they are present.
--
--   psql "$DATABASE_URL" -f backend/src/config/migrations/008_trips.sql
--
-- Re-runnable and non-destructive: every step is a no-op once applied.
--
-- Design is ADR-031. The three decisions that are not obvious from the DDL:
--
--   1. There is NO destination column and no trip_destinations table. A trip is a container of
--      days; "Delhi -> Jaipur -> Udaipur" is items plus transport items. Not adding the column is
--      how the schema supports multi-destination without a later migration (PI-015).
--
--   2. trip_items.place_id is ON DELETE SET NULL, which is the OPPOSITE of
--      user_saved_places.place_id (CASCADE, ADR-030). A saved place pointing at a deleted place is
--      a broken card. An itinerary item is the USER'S OWN PLAN that merely mentions a place -
--      cascading would delete a line they wrote out of a trip they may be on. The link dies, the
--      plan does not. That is why `title` is NOT NULL and denormalised.
--
--   3. trip_days and trip_items carry no user_id. Ownership is trips.user_id, reached by a join.
--      A denormalised copy is a second place for the answer to live, and a child row whose user_id
--      disagrees with its trip's is a privilege-escalation bug no constraint would catch.

BEGIN;

-- ---------------------------------------------------------------------------
-- trips
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trips (
  id SERIAL PRIMARY KEY,

  -- Firebase uid, as in place_reviews.user_id and user_saved_places.user_id. Not a FK: users rows
  -- are provisioned lazily on first authenticated request.
  user_id VARCHAR(255) NOT NULL,

  title VARCHAR(200) NOT NULL,
  description TEXT,

  -- Both nullable: a trip starts as an idea. Dates arrive later, and the workspace has to be
  -- usable before they do or nobody creates one.
  start_date DATE,
  end_date DATE,

  -- CHECKed, unlike newsletter_subscribers.source: this value decides how the trip is presented
  -- and filtered, so a new one always needs code anyway.
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'upcoming', 'completed')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- A trip that ends before it starts is not a trip. Cheap to enforce here, and the API's
  -- validator would otherwise be the only thing standing between a typo and a nonsensical row.
  CONSTRAINT trips_dates_ordered CHECK (
    start_date IS NULL OR end_date IS NULL OR end_date >= start_date
  )
);

-- The "My Trips" read is "this user's trips, most recently touched first". Index order matches.
CREATE INDEX IF NOT EXISTS trips_user_id_updated_at_idx
  ON trips (user_id, updated_at DESC);

-- ---------------------------------------------------------------------------
-- trip_days
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trip_days (
  id SERIAL PRIMARY KEY,
  trip_id INT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,

  -- An ordinal, not a date. The calendar date is trips.start_date + day_number - 1, computed in
  -- the API - storing both would be two sources of truth that drift the first time a trip is
  -- shifted by a day. A trip cannot currently have a gap; a nullable `date` override is one
  -- migration away if that ever matters.
  day_number INT NOT NULL CHECK (day_number > 0),

  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT trip_days_trip_id_day_number_key UNIQUE (trip_id, day_number)
);

CREATE INDEX IF NOT EXISTS trip_days_trip_id_idx ON trip_days (trip_id);

-- ---------------------------------------------------------------------------
-- trip_items
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trip_items (
  id SERIAL PRIMARY KEY,
  trip_day_id INT NOT NULL REFERENCES trip_days(id) ON DELETE CASCADE,

  -- Nullable AND SET NULL. See the header: a meal or a note never had a place, and an item whose
  -- place was deleted keeps its title, its time and its notes.
  place_id INT REFERENCES places(id) ON DELETE SET NULL,

  item_type VARCHAR(20) NOT NULL DEFAULT 'place'
    CHECK (item_type IN ('place', 'transport', 'meal', 'activity', 'note')),

  -- Denormalised from the place at insert time, and NOT NULL, so the item still says something
  -- after ON DELETE SET NULL has removed its link.
  title VARCHAR(200) NOT NULL,
  notes TEXT,

  -- TIME, not TIMESTAMPTZ: an itinerary says "10:00", meaning ten in the morning where the
  -- traveller is standing. A timestamp would anchor it to a zone and shift it for anyone reading
  -- from elsewhere - the BUG-044/BUG-046 class of failure, designed out rather than tested for.
  start_time TIME,
  end_time TIME,

  -- Deliberately NOT unique per (trip_day_id, position). Reordering under a unique constraint
  -- needs deferred constraints or a shuffle through temporary values, to protect an invariant
  -- nothing reads. The API normalises positions inside the reorder transaction, and reads order by
  -- (position, id) so the order is total even if two rows collide.
  position INT NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT trip_items_times_ordered CHECK (
    start_time IS NULL OR end_time IS NULL OR end_time >= start_time
  )
);

CREATE INDEX IF NOT EXISTS trip_items_trip_day_id_idx ON trip_items (trip_day_id, position);

-- For the ON DELETE SET NULL above, not for a query the feature makes: without it, deleting a
-- place scans this table. Same reasoning as user_saved_places_place_id_idx.
CREATE INDEX IF NOT EXISTS trip_items_place_id_idx ON trip_items (place_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers - the same function places and place_reviews use
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_trips_modtime ON trips;
CREATE TRIGGER update_trips_modtime
BEFORE UPDATE ON trips FOR EACH ROW EXECUTE FUNCTION update_modified_column();

DROP TRIGGER IF EXISTS update_trip_days_modtime ON trip_days;
CREATE TRIGGER update_trip_days_modtime
BEFORE UPDATE ON trip_days FOR EACH ROW EXECUTE FUNCTION update_modified_column();

DROP TRIGGER IF EXISTS update_trip_items_modtime ON trip_items;
CREATE TRIGGER update_trip_items_modtime
BEFORE UPDATE ON trip_items FOR EACH ROW EXECUTE FUNCTION update_modified_column();

COMMIT;
