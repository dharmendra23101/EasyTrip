-- 019_trip_expenses.sql - who paid for what, and who it was for (FV-008)
--
-- Apply BEFORE deploying the matching backend.
--
--   psql "$DATABASE_URL" -f backend/src/config/migrations/019_trip_expenses.sql
--
-- Re-runnable and non-destructive: every step is a no-op once applied.
--
--
-- MONEY IS AN INTEGER, IN THE CURRENCY'S MINOR UNIT
--
-- `amount_minor` is paise, cents, satang - never rupees. Two reasons, and the second is the one that
-- bites:
--
--   1. `NUMERIC` would be exact, but it arrives in node-pg as a **string**, and the first person to
--      write `a.amount + b.amount` gets "10001000". An integer arrives as a number and adds.
--   2. Splitting is division. ₹100 across three people does not divide, and a `float` turns that
--      into 33.33333333333333 which then fails to sum back to 100. With integers the remainder is a
--      paisa that somebody visibly has to absorb - a decision, made once, in `splitEvenly`.
--
-- Nothing is stored in a floating-point type anywhere on this path.
--
--
-- EVERY EXPENSE CARRIES ITS OWN CURRENCY, AND NOTHING IS CONVERTED
--
-- `currency` is a 3-letter ISO code on the expense rather than one column on `trips`, because the
-- trip does not have a currency until somebody spends something, and a default on the trip would be
-- a guess about a country nobody has stated.
--
-- **The settlement endpoint refuses a trip whose expenses are in more than one currency**, with a
-- 422 that says so. It does not convert. An exchange rate is a fact about a moment that this project
-- has no source for, and inventing one would put a fabricated number into a list of amounts people
-- are expected to hand each other - the `FP-012` failure in the place it would do the most damage.
-- Multi-currency is `FV-012`'s problem and it needs a rate provider, not a schema.
--
--
-- PARTICIPANTS ARE ROWS, NOT AN ARRAY
--
-- An expense is shared by a set of people, and that set is a **child table** rather than a
-- `TEXT[]` on the expense. `INS-005`'s rule, the same one that made `trip_items` rows: the set is
-- queried ("what do I owe on this trip?"), constrained (one row per person per expense), and will
-- eventually carry its own data - an uneven split needs a share per participant, and that is a
-- column on this table rather than a second parallel array.
--
-- A participant is a uid, not a `trip_collaborators` reference. Somebody can leave a trip after the
-- dinner they were at; deleting their collaborator row must not rewrite what they owe.

BEGIN;

CREATE TABLE IF NOT EXISTS trip_expenses (
  id SERIAL PRIMARY KEY,

  trip_id INT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,

  -- The Firebase uid of whoever actually paid. Not a foreign key, as everywhere else a uid appears.
  paid_by VARCHAR(255) NOT NULL,

  description VARCHAR(200) NOT NULL,

  -- Minor units. `<> 0` rather than `> 0`: a refund is a real expense with a negative sign, and
  -- forbidding it would mean recording a correction as a second, fictional payment in the other
  -- direction. Zero is refused because it is never a fact anybody meant to record.
  amount_minor BIGINT NOT NULL CHECK (amount_minor <> 0),

  -- ISO 4217, upper case. Length is CHECK'd rather than the code being validated against a list:
  -- a closed vocabulary of world currencies is a maintenance burden this feature does not need,
  -- and a wrong-but-well-formed code is a data-entry error rather than a correctness hazard.
  currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),

  created_by VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- "Everything on this trip, newest first" - the only read this table has.
CREATE INDEX IF NOT EXISTS trip_expenses_trip_id_created_at_idx
  ON trip_expenses (trip_id, created_at DESC);

CREATE TABLE IF NOT EXISTS trip_expense_participants (
  id SERIAL PRIMARY KEY,

  expense_id INT NOT NULL REFERENCES trip_expenses(id) ON DELETE CASCADE,

  user_id VARCHAR(255) NOT NULL,

  -- One row per person per expense. Listing somebody twice would double their share, and the
  -- arithmetic would still balance - which is exactly the kind of wrong that no assertion about
  -- sums can catch.
  CONSTRAINT trip_expense_participants_expense_id_user_id_key UNIQUE (expense_id, user_id)
);

CREATE INDEX IF NOT EXISTS trip_expense_participants_expense_id_idx
  ON trip_expense_participants (expense_id);

COMMIT;

-- NOT ENFORCED HERE: that a participant is somebody on the trip.
--
-- Deliberate. People leave trips, and an expense records what was true when it happened - somebody
-- who was at the dinner still owes for it after their collaborator row is removed. Enforcing
-- membership at write time is the model's job (it validates against the trip's people when the
-- expense is created); enforcing it forever in the schema would rewrite history whenever access
-- changed, which is the opposite of what a ledger is for.
