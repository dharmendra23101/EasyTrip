-- 016_trip_share_links.sql - a read-only link to one trip, for the people not collaborating on it
-- (FV-009 stage c)
--
-- Apply BEFORE deploying the matching backend: the share endpoints read and write these columns.
--
--   psql "$DATABASE_URL" -f backend/src/config/migrations/016_trip_share_links.sql
--
-- Re-runnable and non-destructive: every step is a no-op once applied.
--
-- THE TOKEN IS THE CREDENTIAL, AND THAT DECIDES EVERYTHING ELSE
--
-- A share link is a bearer credential in a URL. Anybody holding it can read the trip, and URLs leak
-- in ways passwords do not: browser history, a `Referer` header, a screenshot in a group chat, a
-- pasted message. Three consequences are designed into this schema rather than left to the routes:
--
--   1. It has to be unguessable by construction. 32 random bytes, base64url-encoded to 43
--      characters. That is 256 bits, so guessing is not a threat model - which is what allows the
--      public read endpoint to exist without a rate limit tuned against brute force.
--
--      CHECK'd on shape, not just length: base64url is [A-Za-z0-9_-], and a token containing '+'
--      or '/' would be one somebody built with plain base64 and would break in a URL.
--
--   2. Revocation has to be immediate and total. The token lives ON the trip rather than in a
--      separate table of links, so `share_token = NULL` ends every copy of the link at once. A
--      table of links would allow several to exist, and then revoking would mean remembering to
--      revoke all of them.
--
--   3. Re-sharing must not resurrect an old link. Enabling sharing again mints a NEW token; the
--      previous one stays dead. This is why the column is nullable rather than a boolean beside a
--      permanent token - the token's absence *is* the revocation.
--
-- WHAT IS DELIBERATELY NOT HERE
--
-- No expiry column, and no view counter.
--
--   * An expiry would be a feature nobody asked for, and a link that stops working silently on a
--     trip somebody is standing in front of is worse than one that has to be revoked deliberately.
--     Adding it later is one nullable column and no rewrite.
--   * A view counter would turn this into an analytics record of who looked at somebody's holiday
--     plans. The owner is told the link exists; they are not told who opened it.
--
-- `shared_at` is kept because it answers a question the owner will actually ask - *when did I share
-- this?* - and it is a fact about the owner's own action rather than about anybody who followed it.

BEGIN;

ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS share_token VARCHAR(43),
  ADD COLUMN IF NOT EXISTS shared_at TIMESTAMPTZ;

-- UNIQUE and partial. Partial because NULL is the overwhelmingly common value - almost no trip is
-- shared - and a partial index is both smaller and exactly the lookup the public read performs.
-- UNIQUE because a collision would hand one person another person's trip; at 256 bits that will not
-- happen, and the constraint costs nothing to be certain.
CREATE UNIQUE INDEX IF NOT EXISTS idx_trips_share_token
  ON trips (share_token)
  WHERE share_token IS NOT NULL;

DO $$
BEGIN
  -- base64url only. A token with '+' or '/' in it was built with plain base64 and would not survive
  -- being put in a URL; catching that here rather than in a route means it cannot be reintroduced by
  -- a second caller later.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'trips_share_token_is_base64url'
  ) THEN
    ALTER TABLE trips ADD CONSTRAINT trips_share_token_is_base64url
      CHECK (share_token IS NULL OR share_token ~ '^[A-Za-z0-9_-]{43}$');
  END IF;

  -- The two columns move together: a shared trip knows when it was shared, and an unshared one
  -- carries no leftover date from a link that has since been revoked.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'trips_share_token_dated'
  ) THEN
    ALTER TABLE trips ADD CONSTRAINT trips_share_token_dated
      CHECK ((share_token IS NULL) = (shared_at IS NULL));
  END IF;
END $$;

COMMENT ON COLUMN trips.share_token IS
  'Bearer credential for the public read-only view (FV-009 stage c). 43 base64url characters = 256 '
  'bits of entropy. NULL means not shared; setting it to NULL revokes every copy of the link at '
  'once, and re-sharing mints a new one rather than restoring the old.';

COMMENT ON COLUMN trips.shared_at IS
  'When the owner created the current share link. Deliberately not a view count: the owner is told '
  'the link exists, not who opened it.';

COMMIT;
