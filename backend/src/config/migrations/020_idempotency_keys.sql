-- 020_idempotency_keys.sql - make a retried write safe to retry (PE-007)
--
-- Apply BEFORE deploying the matching backend: the middleware reads and writes this table.
--
--   psql "$DATABASE_URL" -f backend/src/config/migrations/020_idempotency_keys.sql
--
-- Re-runnable and non-destructive: every step is a no-op once applied.
--
--
-- WHY THIS EXISTS BEFORE THE FEATURE THAT NEEDS IT
--
-- `PRODUCT_ROADMAP.md` Track I lists this as a hard requirement of `FV-010` (offline trip mode)
-- rather than a nicety, and the reason is in one sentence: **offline edits reach the server by
-- retrying.** A traveller with no signal records an expense, the request fails, and the client tries
-- again when the train comes out of the tunnel. Without a key, "try again" and "do it twice" are the
-- same request.
--
-- It is worth having on its own though, and that is why it lands now rather than with `FV-010`: a
-- double-tapped "Record" button on a slow connection is the same bug with no offline mode involved.
--
--
-- THE KEY IS THE CLIENT'S, THE SCOPE IS THE CALLER'S
--
-- `UNIQUE (user_id, idempotency_key)` rather than a global unique key. A key is an arbitrary string
-- a client invents; two clients picking the same one is not a collision anybody should have to think
-- about, and a global constraint would let one caller's key deny another's request.
--
--
-- THE REQUEST IS FINGERPRINTED, BECAUSE A KEY IS A PROMISE
--
-- `request_fingerprint` is a hash of the method, path and body. Replaying a key with the *same*
-- request returns the stored response; replaying it with a *different* one is a client bug, and it
-- is answered 422 rather than silently returning somebody's earlier answer to a question they did
-- not ask this time.
--
-- Storing the hash rather than the body is deliberate: request bodies here carry trip titles, notes
-- and amounts, and a table of them would be a second copy of user content with none of the deletion
-- rules the original has.
--
--
-- ONLY SUCCESSES ARE STORED
--
-- The middleware records a 2xx and nothing else. A failed request must stay retryable - storing a
-- 500 would turn one bad moment into a permanent one, where the client retries and is handed the
-- same 500 forever with no way to ask again.

BEGIN;

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id SERIAL PRIMARY KEY,

  -- The Firebase uid. Not a foreign key, as everywhere else a uid appears here.
  user_id VARCHAR(255) NOT NULL,

  -- Whatever the client sent in `Idempotency-Key`. Bounded so the header cannot be used to write
  -- unbounded rows.
  idempotency_key VARCHAR(255) NOT NULL,

  -- sha256 hex of method + path + body.
  request_fingerprint CHAR(64) NOT NULL,

  -- What to replay. 2xx only - see the header.
  status_code INT NOT NULL CHECK (status_code >= 200 AND status_code < 300),
  response_body JSONB NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT idempotency_keys_user_id_key_unique UNIQUE (user_id, idempotency_key)
);

-- For the sweep below, and for nothing else.
CREATE INDEX IF NOT EXISTS idempotency_keys_created_at_idx ON idempotency_keys (created_at);

COMMIT;

-- RETENTION IS NOT AUTOMATED HERE, AND THAT IS A STATED GAP RATHER THAN AN OVERSIGHT.
--
-- These rows are only useful for as long as a client might retry - hours, not months - and left
-- alone the table grows without limit. The obvious fix is a scheduled delete, and this project has
-- **no scheduler**: `PE-010` records that a server-side job is "the first operation that must
-- outlive a request", and it is unbuilt.
--
-- So the cleanup is a one-line query somebody can run, written down where it will be found:
--
--   DELETE FROM idempotency_keys WHERE created_at < NOW() - INTERVAL '48 hours';
--
-- Inventing a scheduler to avoid admitting that would be a larger, less honest change than saying
-- the row above.
