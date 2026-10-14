-- 003_sprint23.sql - Sprint 2.3 user content
--
-- Adds the two tables behind this sprint's honest replacements for mocked UI:
--   * review_reports        - "report review" stopped faking success (IMP-019)
--   * newsletter_subscribers - the two newsletter forms stopped discarding addresses (IMP-023)
--
-- Apply this BEFORE deploying the matching backend: both endpoints insert into these tables and
-- will error with "relation ... does not exist" until they are present.
--
--   psql "$DATABASE_URL" -f backend/src/config/migrations/003_sprint23.sql
--
-- Re-runnable and non-destructive: every step is a no-op once applied.
--
-- Note on what is NOT here: Sprint 2.3 also removed writes to `audit_logs` and `admin_logs`
-- (IMP-010). Those tables were never created, so there is nothing to drop. A real audit trail is
-- deliberately deferred until moderation/admin analytics (IMP-111) provide a reader to design it
-- around.

BEGIN;

-- ---------------------------------------------------------------------------
-- review_reports (IMP-019)
-- ---------------------------------------------------------------------------
-- Feeds the moderation queue in IMP-111. Until then it is write-only by design - but unlike the
-- audit tables this sprint deleted, it has a named consumer on the roadmap and the row is the
-- user's own action rather than incidental telemetry.
CREATE TABLE IF NOT EXISTS review_reports (
  id SERIAL PRIMARY KEY,

  -- ON DELETE CASCADE: a report about a review that no longer exists is moot. This also means a
  -- user deleting their own review takes any reports against it with them, which is correct -
  -- there is nothing left to moderate.
  review_id INT NOT NULL REFERENCES place_reviews(id) ON DELETE CASCADE,

  -- Firebase uid, matching place_reviews.user_id. Not a FK: `users.firebase_uid` is populated
  -- lazily on first authenticated request, so a valid reporter may not have a row yet.
  reporter_uid VARCHAR(255) NOT NULL,

  -- Nullable: the current UI reports with one click and sends no reason. Present so a reason box
  -- can be added without a migration.
  reason TEXT,

  status VARCHAR(20) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'reviewed', 'dismissed')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- One report per person per review. Makes reporting idempotent instead of letting one user file
  -- the same complaint repeatedly and skew a future moderation queue.
  CONSTRAINT review_reports_review_id_reporter_uid_key UNIQUE (review_id, reporter_uid)
);

-- The moderation queue reads "open reports, newest first"; without this it is a full scan.
CREATE INDEX IF NOT EXISTS review_reports_status_created_at_idx
  ON review_reports (status, created_at DESC);

-- ---------------------------------------------------------------------------
-- newsletter_subscribers (IMP-023)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id SERIAL PRIMARY KEY,

  -- Stored already lower-cased and trimmed by the API, so this UNIQUE is a real duplicate guard.
  -- A citext column would enforce it in the database instead, but that needs an extension this
  -- deployment does not install; normalising on write is the smaller dependency.
  email VARCHAR(255) NOT NULL UNIQUE,

  status VARCHAR(20) NOT NULL DEFAULT 'subscribed'
    CHECK (status IN ('subscribed', 'unsubscribed')),

  subscribed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  unsubscribed_at TIMESTAMPTZ,

  -- Where the signup came from: 'footer', 'place_page', and so on. Deliberately NOT a CHECK
  -- constraint - adding a new signup surface should not require a migration. The API validates
  -- against its own allowlist, which is the layer that knows what surfaces exist.
  source VARCHAR(40) NOT NULL DEFAULT 'unknown',

  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- The same trigger function places and place_reviews use.
--
-- Declared here rather than assumed. This file previously said it "reuses update_modified_column()
-- from schema.sql" — which made the migration depend on an object that no migration creates. Any
-- database created from schema.sql does have it, so this was latent rather than breaking; but a
-- migration should be able to carry a database forward on its own rather than assuming which other
-- files were run first. Surfaced while applying the full set to a scratch database during IMP-069.
--
-- CREATE OR REPLACE, so it is a no-op on any database that already has it — including one created
-- from the current schema.sql, where the definition is byte-identical to this one.
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- DROP-then-CREATE because Postgres has no CREATE TRIGGER IF NOT EXISTS, and this file has to stay
-- re-runnable.
DROP TRIGGER IF EXISTS update_newsletter_subscribers_modtime ON newsletter_subscribers;
CREATE TRIGGER update_newsletter_subscribers_modtime
BEFORE UPDATE ON newsletter_subscribers
FOR EACH ROW
EXECUTE FUNCTION update_modified_column();

COMMIT;
