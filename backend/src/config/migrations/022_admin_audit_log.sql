-- 022_admin_audit_log.sql - a record of what admins did to other people (PE-013, FV-023 part 1)
--
-- Apply BEFORE deploying the matching backend: three controllers write to this table.
--
--   psql "$DATABASE_URL" -f backend/src/config/migrations/022_admin_audit_log.sql
--
-- Re-runnable and non-destructive: every step is a no-op once applied.
--
--
-- THIS TABLE WAS REFUSED ONCE, ON PURPOSE, AND THE REASON IT IS ALLOWED NOW IS A READER
--
-- `ADR-022` deleted four audit INSERTs rather than create the tables they implied, and the sentence
-- it turned on is the governing constraint here:
--
--   > A table with writers and no readers is not an audit trail - it is write amplification that
--   > looks like diligence.
--
-- It then named the condition for revisiting: *"it must design the audit schema around what its
-- queue and dashboard actually query."* `IMP-111` has since landed both. `PE-013`'s adoption
-- trigger - "admin or collaborator actions on shared data" - is what has fired, and this schema is
-- shaped by the three questions the admin page asks, not by what is easy to insert:
--
--   1. who has been granted or revoked admin, and by whom      -> action, actor_*, target_*
--   2. who resolved this report, and how                       -> detail->>'resolution'
--   3. which admin deleted whose review                        -> target_label, detail
--
-- Nothing here is written that none of those three read. `user_agent`, `ip`, a `severity` column
-- and a generic `metadata` blob were all considered and left out for exactly that reason.
--
--
-- THE ACTOR AND TARGET ARE DENORMALISED, AND THAT IS THE POINT
--
-- `actor_email` and `target_label` are copies, not joins. An audit row has to still read correctly
-- **after the account it names is gone** - and "who deleted this user" is precisely the question
-- asked once that user no longer exists. A joined audit log goes blank at the moment it matters.
--
-- There is no foreign key for the same reason `users.firebase_uid` has none (see the ER notes in
-- the README): rows in `users` are created lazily on first authenticated request, uids are the join
-- key everywhere, and an FK here would let a deletion elsewhere cascade away the evidence.
--
--
-- WHY `outcome` EXISTS, WHICH IS THE LEAST OBVIOUS COLUMN
--
-- `addAdmin` writes `is_admin = true` and *then* syncs the Firebase custom claim. If that sync
-- throws, the handler returns **500** - but the database write already happened and the person
-- really is an admin in the column that authorises them. `removeAdmin` has the mirror case.
--
-- An audit log that only recorded successful responses would omit a real privilege change, and
-- would omit it in exactly the case a reader most needs: the one where the admin who did it was
-- told it failed. So the outcome is recorded as `partially_applied`, and the admin page shows it
-- differently. A trail that quietly agrees with the HTTP status is not a control.

BEGIN;

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id SERIAL PRIMARY KEY,

  -- Who acted. The uid is the identity; the email is a copy so the row survives their deletion.
  actor_uid VARCHAR(255) NOT NULL,
  actor_email VARCHAR(255),

  -- A closed vocabulary, CHECKed here and mirrored in `constants/auditActions.js`. Closed rather
  -- than free text because the admin page filters on it, and a typo'd action is a row that is
  -- written, stored, and never surfaced - an audit entry nobody can find is not an audit entry.
  action VARCHAR(40) NOT NULL,

  -- What it was done to. `target_id` is TEXT because it holds a Firebase uid for a user and a
  -- numeric id for a review; one column beats a pair of half-null ones for a table whose only
  -- query pattern is "show me the log".
  target_type VARCHAR(20) NOT NULL,
  target_id VARCHAR(255) NOT NULL,
  target_label VARCHAR(255),

  -- See the header. `succeeded` is not a default: it must be stated by the caller, so that adding
  -- a new audited action cannot silently record an unverified success.
  outcome VARCHAR(20) NOT NULL,

  -- Small, action-specific, and read by the page. Not a dumping ground: the header lists what each
  -- action puts here, and nothing writes a key no reader looks at.
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT admin_audit_log_action_known CHECK (
    action IN ('admin.granted', 'admin.revoked', 'report.resolved', 'review.deleted_by_admin')
  ),
  CONSTRAINT admin_audit_log_target_type_known CHECK (target_type IN ('user', 'review')),
  CONSTRAINT admin_audit_log_outcome_known CHECK (outcome IN ('succeeded', 'partially_applied'))
);

-- The page reads newest-first and pages through. `id` is in the key so the order is total: two
-- rows written in the same transaction share `created_at` to the microsecond, and a paged query
-- ordered on a non-unique column can show one row twice and skip another.
CREATE INDEX IF NOT EXISTS admin_audit_log_created_idx ON admin_audit_log (created_at DESC, id DESC);

-- Filtering by action is the page's one filter. Filtering by actor is deliberately NOT indexed:
-- nothing offers it, and an index nothing queries is a write cost pretending to be foresight.
CREATE INDEX IF NOT EXISTS admin_audit_log_action_idx ON admin_audit_log (action);

COMMIT;

-- NOT DONE HERE: auditing collaborator actions on a shared trip.
--
-- `PE-013`'s trigger names them alongside admin actions, and `FV-007` shipped them - but they need
-- a *different reader*. The person entitled to know who changed a shared itinerary is the trip
-- owner, not an administrator, and surfacing one trip's edits on an admin page would be the
-- `IMP-021` identity-exposure mistake in a new place. That is a trip activity feed, it is its own
-- feature, and building the table for it before the feed exists would repeat `ADR-022` exactly.
--
-- NOT DONE HERE: retention. Nothing deletes from this table yet, and at the volume of a project
-- with one admin that is correct. The trigger for a retention policy is a real deployment with
-- real moderators, which is `H2`.
