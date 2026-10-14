-- 023_trip_activity.sql - who changed a shared itinerary, for the person whose itinerary it is (BL-147)
--
-- Apply BEFORE deploying the matching backend: the trip mutation paths write to this table.
--
--   psql "$DATABASE_URL" -f backend/src/config/migrations/023_trip_activity.sql
--
-- Re-runnable and non-destructive: every step is a no-op once applied.
--
--
-- WHY THIS IS A SECOND TABLE AND NOT A ROW IN `admin_audit_log`
--
-- `PE-013`'s trigger named admin actions and collaborator actions together, and Sprint 8.66 split
-- them (`ADR-056`) for one reason: **the entitled reader is different.** An admin audit row is read
-- by an administrator asking "what did my moderators do to other people's accounts". This is read
-- by a traveller asking "what did my friend do to my plan". Putting one trip's edits on an admin
-- page would surface one user's activity to a different user - `IMP-021`'s identity-exposure
-- mistake in a new place - and gating the admin page per-trip would be a second access model
-- inside a table that already has one.
--
-- Two readers, two entitlements, two tables. The columns differ accordingly: this one has a
-- `trip_id` and a foreign key, and no `outcome`.
--
--
-- WHY THERE IS AN FK HERE AND NOT IN `admin_audit_log`
--
-- The opposite call, deliberately. `022`'s header argues that an audit row must outlive the account
-- it names, because "who deleted this user" is asked precisely once that user is gone.
--
-- The reverse is true here. This log describes **a trip**, is read **on that trip's page**, and is
-- entitled to exactly the people entitled to the trip. When the trip is deleted there is no reader
-- left, no page to render it on, and no question it answers - so `ON DELETE CASCADE` is correct and
-- keeping the rows would be retaining somebody's travel history after they deleted it.
--
--
-- WHAT IS RECORDED, AND THE LARGER SET THAT IS NOT
--
-- `ADR-037`'s rule is "what would change what the reader does next?", and `ADR-022`'s is that
-- nothing may be written that no reader reads. There are **24 mutating endpoints** on a trip. Six
-- are recorded:
--
--   day.added        - a day appeared in the plan
--   day.removed      - a day left it
--   item.added       - something was added to a day
--   item.updated     - an item's title, notes or times changed
--   item.removed     - something was taken off a day
--   items.reordered  - a day was resequenced
--
-- These six are **exactly the mutations an editor can perform**, which is the whole of `BL-147`:
-- "who changed a shared itinerary". The set was not chosen, it was read out of the access rules -
-- every one of the six is gated on `editableBy`, and every mutation gated on `trips.user_id` is
-- excluded because only the owner can reach it and the owner is the reader.
--
-- That excludes `trip.updated` and `trip.deleted`, which were both on the first draft of this list
-- until the gates were checked: renaming a trip or moving its dates is owner-only, so recording it
-- would produce a feed whose entries all say "you did this". Collaborator management and share
-- links are owner-only for the same reason, and feasibility, settlement and route suggestions are
-- reads that change nothing.
--
-- NOT recorded, on purpose: **notes and checklist items.** Both are mutable by editors and both were
-- considered. A checklist is ticked dozens of times over a trip and a note is edited while it is
-- being written; recording either produces a feed where the six lines above cannot be found. A log
-- that buries its own signal is `ADR-022`'s complaint arriving from the other direction - not
-- writes with no reader, but writes that cost the reader the ones that mattered.
--
-- NOT recorded, on purpose: **expenses.** `trip_expenses` already carries `paid_by`, so "who added
-- this" is answerable from the expense itself. A second copy in a second table is a fact with two
-- owners that can disagree.
--
--
-- THE ACTOR IS DENORMALISED, FOR `022`'S REASON
--
-- `actor_label` is a copy, not a join. "Who moved my second day" stays answerable after that
-- collaborator is removed from the trip and after their account is gone - and being removed from
-- the trip is a normal, expected event here rather than an exceptional one, which makes the copy
-- more load-bearing than it is in `022`.
--
-- There is deliberately no FK on `actor_uid` for the reason `users.firebase_uid` has none: rows in
-- `users` are created lazily on first authenticated request, and uids are the join key everywhere.

BEGIN;

CREATE TABLE IF NOT EXISTS trip_activity (
  id SERIAL PRIMARY KEY,

  -- The trip this happened to. Cascades - see the header.
  trip_id INT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,

  -- Who did it. The uid is the identity; the label is a copy so the row survives their removal.
  actor_uid VARCHAR(255) NOT NULL,
  actor_label VARCHAR(255),

  -- A closed vocabulary, CHECKed here and mirrored in `constants/tripActivity.js`. Closed because
  -- the page groups on it, and a typo'd action is a row that is written, stored, and never shown.
  action VARCHAR(40) NOT NULL,

  -- Small, action-specific, and read by the page. The header lists what each action puts here.
  -- `item.updated` records WHICH fields moved and not their values: the current value is on the
  -- screen the reader is already looking at, and storing old values would make this table a shadow
  -- copy of the itinerary, with its own retention question and its own way of disagreeing with it.
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT trip_activity_action_known CHECK (
    action IN (
      'day.added',
      'day.removed',
      'item.added',
      'item.updated',
      'item.removed',
      'items.reordered'
    )
  )
);

-- The page reads one trip, newest first, and pages through. `id` is in the key so the order is
-- total: two rows written in the same transaction share `created_at` to the microsecond, and a
-- paged query ordered on a non-unique column can show one row twice and skip another. Same
-- reasoning as `admin_audit_log_created_idx`, which learned it first.
CREATE INDEX IF NOT EXISTS trip_activity_trip_created_idx
  ON trip_activity (trip_id, created_at DESC, id DESC);

COMMIT;

-- NOT DONE HERE: retention. Nothing deletes from this table except the trip's own cascade, and at
-- the volume of a personal trip that is correct - a plan edited a hundred times is a hundred rows.
-- `BL-148` carries the same question for `admin_audit_log`, and its trigger is a real deployment.
