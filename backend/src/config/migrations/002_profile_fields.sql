-- 002_profile_fields.sql - Sprint 2.2 profile fields
--
-- Adds the two columns the profile form has always collected but never stored (IMP-008). The
-- form, the client, and the express-validator rules already send and accept `location` and
-- `dob`; only the table and the UPDATE were missing, so every save silently dropped them.
--
-- Apply this BEFORE deploying the matching backend: updateProfile writes both columns, and the
-- UPDATE errors with "column ... does not exist" until they are present.
--
--   psql "$DATABASE_URL" -f backend/src/config/migrations/002_profile_fields.sql
--
-- Re-runnable and non-destructive: both steps are no-ops once applied.

BEGIN;

-- Free text, because "Bengaluru, India" is not a lookup against anything we hold. Kept short so
-- it stays a label rather than becoming a second address field.
ALTER TABLE users ADD COLUMN IF NOT EXISTS location VARCHAR(120);

-- DATE, not TIMESTAMPTZ: a birth date has no time and no timezone, and storing one would shift
-- the date across zone boundaries. This is PII - it is written by the owner and returned only on
-- the authenticated /api/auth/profile route, never on any public response.
ALTER TABLE users ADD COLUMN IF NOT EXISTS dob DATE;

COMMIT;
