-- 007_saved_places.sql - the server-persisted wishlist (IMP-108)
--
-- Adds `user_saved_places`, the table behind Track A's first deliverable. Until now the heart
-- buttons persisted to `localStorage` on the home carousel and to nothing at all on the detail
-- page, so "saved" meant two different things on two pages and neither survived a device change.
--
-- Apply this BEFORE deploying the matching backend: GET/POST/DELETE /api/auth/favorites all touch
-- this table and will error with "relation ... does not exist" until it is present.
--
--   psql "$DATABASE_URL" -f backend/src/config/migrations/007_saved_places.sql
--
-- Re-runnable and non-destructive: every step is a no-op once applied.
--
-- The design decisions below are ADR-030. Short version of the two that are not obvious:
--   * `user_id` is a Firebase uid, not users(id), because users rows are provisioned lazily and
--     the helper that does it is documented as unreliable for authorization purposes. Matches
--     place_reviews.user_id and review_reports.reporter_uid.
--   * There is no `position` column. Nothing reorders a wishlist, and a column no code writes is
--     the IMP-010 pattern (audit_logs) all over again. Ordering is a requirement of trip_items
--     (FV-006), not of this table.

BEGIN;

CREATE TABLE IF NOT EXISTS user_saved_places (
  id SERIAL PRIMARY KEY,

  -- Firebase uid, as in place_reviews.user_id. Not a FK: `users.firebase_uid` is populated lazily
  -- on first authenticated request, so a valid saver may not have a row yet.
  user_id VARCHAR(255) NOT NULL,

  -- ON DELETE CASCADE is load-bearing, not tidiness. A saved place pointing at a deleted place is
  -- not a stale row, it is a broken card in somebody's wishlist - the same class of failure
  -- IMP-027 and IMP-050 exist to prevent. It also makes saving a nonexistent place a database
  -- error rather than an application check that can be forgotten.
  place_id INT NOT NULL REFERENCES places(id) ON DELETE CASCADE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- One save per user per place. Makes saving idempotent instead of letting a double-click or a
  -- retry-after-timeout stack duplicates - the same guarantee place_reviews gets from
  -- place_reviews_place_id_user_id_key, and the reason the API can answer a repeat save with 200
  -- rather than a 409 the UI would have to special-case.
  CONSTRAINT user_saved_places_user_id_place_id_key UNIQUE (user_id, place_id)
);

-- Deliberately NOT a second index on (user_id): the UNIQUE constraint above is already an index
-- whose leading column is user_id, so "this user's saved places" is a prefix scan on it. A
-- standalone user_id index would be redundant and would cost every write.

-- This one is not redundant, and it is not for a query the feature makes. Without an index on the
-- referencing column, the ON DELETE CASCADE above turns every admin place-delete into a full scan
-- of this table. Invisible at seed scale; the standard omission that makes a delete slow later.
-- It is also the index FV-019 will read for "who else saved this place".
CREATE INDEX IF NOT EXISTS user_saved_places_place_id_idx
  ON user_saved_places (place_id);

COMMIT;
