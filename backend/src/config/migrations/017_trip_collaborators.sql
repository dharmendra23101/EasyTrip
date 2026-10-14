-- 017_trip_collaborators.sql - a trip somebody else can open (FV-007 stage a)
--
-- Apply BEFORE deploying the matching backend: the collaborator endpoints read and write this table,
-- and the trip read path joins it.
--
--   psql "$DATABASE_URL" -f backend/src/config/migrations/017_trip_collaborators.sql
--
-- Re-runnable and non-destructive: every step is a no-op once applied.
--
--
-- NO EMAIL SERVICE, AND THAT IS A DESIGN DECISION RATHER THAN A SHORTCUT
--
-- FV-007's approach says "invite by email", and one of its own kill criteria is "invitation flows
-- require an email-sending service whose cost or deliverability is prohibitive". This project has no
-- mail capability at all - no nodemailer, no provider, no credentials - so building invitations that
-- way means adopting a third party, an account, a cost and a deliverability problem before anybody
-- has shared a single trip.
--
-- So the email is used as a LOOKUP KEY, not as a delivery address. `users.email` is UNIQUE NOT NULL,
-- populated from the verified Firebase token on first request, so "add mukund@example.com" resolves
-- to exactly one uid or to nothing. The collaborator sees the trip appear in their own list next
-- time they look.
--
-- **The limitation this buys is real and must be stated rather than discovered:** you can only add
-- somebody who already has an EasyTrip account. That is a smaller cost than a mail provider, and it
-- is reversible - if invitations to strangers are ever wanted, this table is unchanged and an
-- `invitations` table arrives beside it.
--
--
-- ONE ROLE, BECAUSE ONE ROLE IS WHAT THE WRITE PATH HONOURS
--
-- FV-007 names three roles: owner, editor, viewer. This migration CHECKs exactly one - 'viewer'.
--
-- The owner is not a role in this table; the owner is `trips.user_id`, and adding an 'owner' value
-- here would create two places that answer "who owns this" and eventually two different answers.
--
-- 'editor' is deliberately absent until the write path enforces it. A role that exists in the schema
-- while every UPDATE still says `WHERE trips.user_id = $1` is a value the database accepts and the
-- application ignores - which reads, to anybody inspecting the data, as a permission somebody has.
-- The vocabulary grows when the behaviour does. Widening a CHECK later is one line; explaining why
-- three editors could never edit is not.
--
--
-- OWNERSHIP STAYS IN THE SQL
--
-- `tripModel.js`'s header records why every query carries `WHERE trips.user_id = $1`: "a
-- `WHERE trips.user_id = $1` cannot be forgotten by the next caller". Collaboration must not cost
-- that property. The read path therefore gains ONE shared predicate rather than twenty-six
-- hand-edited ORs - see `tripAccessModel.js`, which is the only place the rule is written down.

BEGIN;

CREATE TABLE IF NOT EXISTS trip_collaborators (
  id SERIAL PRIMARY KEY,

  -- CASCADE because a collaborator row pointing at a deleted trip grants access to nothing and is
  -- only a way to leak a title in a JOIN somebody writes later.
  trip_id INT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,

  -- The Firebase uid, as on `trips.user_id`, `place_reviews.user_id` and `user_saved_places.user_id`.
  -- Not a foreign key to `users`, for the same reason as every other one of those: rows in `users`
  -- are created lazily on first authenticated request, so a uid can be legitimate before its row
  -- exists. The uid is the identity; `users` is where admin-ness lives.
  user_id VARCHAR(255) NOT NULL,

  -- See the header. One value, because one value is enforced.
  role VARCHAR(20) NOT NULL DEFAULT 'viewer' CHECK (role IN ('viewer')),

  -- Who added them. Useful the day somebody asks "how does this person have my trip", and it costs
  -- one column now against a schema change then.
  added_by VARCHAR(255) NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- Adding the same person twice is the same fact, so it is idempotent rather than an error: the
  -- endpoint upserts on this and answers 200.
  CONSTRAINT trip_collaborators_trip_id_user_id_key UNIQUE (trip_id, user_id)
);

-- "Which trips can I open?" - the collaborator's own list, which is the read this table exists for.
CREATE INDEX IF NOT EXISTS trip_collaborators_user_id_idx ON trip_collaborators (user_id);

COMMIT;

-- NOT ENFORCED HERE, AND ON PURPOSE: that the owner is never also a collaborator of their own trip.
--
-- Expressing it needs a subquery against `trips`, which a CHECK constraint cannot contain, so the
-- alternatives are a trigger or the model. The model is where it lives (`tripAccessModel.addCollaborator`
-- refuses the owner's own uid), because a trigger that silently rejects would surface as a failed
-- insert with no explanation at the only layer that could give one. The consequence if it were ever
-- bypassed is mild - the owner would appear in their own collaborator list - which is why this is a
-- validation rather than a constraint.
