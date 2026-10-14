# Migrations

Every schema change lives here as a numbered `.sql` file. The runner is `backend/script/migrate.js`;
what has been applied is recorded in the `schema_migrations` table.

```bash
npm run migrate            # apply everything pending
npm run migrate:status     # what is applied, what is pending — changes nothing
npm run migrate:dry-run    # what WOULD be applied — changes nothing
```

Run from `backend/`, or use the root-level `npm run migrate` which does the `cd` for you.

---

## The rules

**1. Filenames are `NNN_short_description.sql`, zero-padded to three digits.**
Lexical order is the applied order. `10_x.sql` would sort before `2_x.sql`; `010_x.sql` does not.

**2. Every migration must be re-runnable.**
This is a hard requirement, not a nicety. `migrate.js` records a migration _after_ it commits, so a
crash in that window leaves it applied but unrecorded and it will run again. Re-runnability is what
makes that harmless. In practice this means `IF NOT EXISTS`, `ON CONFLICT DO NOTHING`, and
`DO $$ ... IF NOT EXISTS (SELECT 1 FROM pg_constraint ...) ... $$` guards around anything that would
otherwise error on a second run.

It is also what let this runner be adopted with no baselining step: on the existing database, where
001–004 had already been applied by hand, the first run re-applied them as no-ops and recorded them.

**3. Each file owns its own transaction.**
Write `BEGIN;` / `COMMIT;` inside the file. The runner deliberately does _not_ wrap files, because
a `COMMIT` inside an outer transaction commits the outer one — and because `004` needs to stay
outside a transaction so it can move to `CREATE INDEX CONCURRENTLY` later. This also keeps every
file directly runnable by hand:

```bash
psql "$DATABASE_URL" -f backend/src/config/migrations/001_phase1.sql
```

Omit the transaction only when you have a reason, and write the reason in the file — `004` does.

**4. An applied migration is immutable.**
The runner checksums each file and refuses to run if one changed after it was applied. The database
has the old version and your working tree has the new one; re-running cannot reconcile them. Put the
change in a new migration.

**5. Destructive steps go in a migration, never anywhere else.**
`001` deletes duplicate review rows. That is correct in a reviewed, transactional file that an
operator runs deliberately, and it is exactly what must never happen at server boot.

---

## Why not node-pg-migrate

It was the obvious choice and the roadmap named it. It wants its own migration format and filename
convention, which would have meant rewriting four hand-written files whose comments are the best
documentation this schema has, and breaking the `psql -f` path each of them advertises. The runner
is about a hundred lines of bookkeeping — `CREATE TABLE IF NOT EXISTS`, a `SELECT`, an advisory
lock, an `INSERT`. The files were worth more than the hundred lines. Recorded as `ADR-025`.

---

## The files

| File                               | What it does                                                                                                                                                                |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `001_phase1.sql`                   | One review per user per place (`IMP-062`). De-duplicates first — the only destructive step in the set. Re-syncs `rating_sum`/`rating_count`.                                |
| `002_profile_fields.sql`           | `users.location`, `users.dob` — collected by the profile form since forever, never stored (`IMP-008`).                                                                      |
| `003_sprint23.sql`                 | `review_reports` and `newsletter_subscribers`, behind Sprint 2.3's replacements for mocked UI (`IMP-019`, `IMP-023`).                                                       |
| `004_performance_indexes.sql`      | Phase 4 indexes (`IMP-043`). No transaction, deliberately — see the file header.                                                                                            |
| `005_retire_boot_ddl.sql`          | Absorbs the `ALTER TABLE`s that `app.js` used to run on every boot (`IMP-069`).                                                                                             |
| `006_reconcile_triggers.sql`       | Reconciles the rating triggers so `rating_sum`/`rating_count` cannot drift from `place_reviews`.                                                                            |
| `007_saved_places.sql`             | `user_saved_places` — the wishlist (`IMP-108`, `ADR-030`). Apply before deploying the backend; the endpoints 500 until it lands.                                            |
| `008_trips.sql`                    | `trips` / `trip_days` / `trip_items` — the trip workspace (`IMP-109`, `ADR-031`). Note the SET NULL cascade, which differs from 007 on purpose.                             |
| `009_search.sql`                   | `places.search_vector` (weighted, generated) + its GIN index and the prefix-query function (`IMP-112`, `ADR-032`).                                                          |
| `010_coordinate_provenance.sql`    | `places.coordinates_source` + two CHECKs — which geocoder produced a pin, so the ODbL notice credits exactly the rows that owe it (`IMP-127`, `ADR-039`).                   |
| `011_place_setting.sql`            | `places.setting` — urban/coastal/mountain/…, a closed vocabulary with its own index (`FV-031`).                                                                             |
| `012_place_accessibility.sql`      | `places.step_free_access`, `accessible_restroom`, `accessibility_notes`, `accessibility_source` — what a place offers, and **who checked it, and when** (`FV-029` stage a). |
| `013_traveller_access_needs.sql`   | `users.requires_step_free`, `users.requires_accessible_restroom` — what a traveller needs, which is a different question from what a place offers.                          |
| `014_place_seasonality.sql`        | `places.best_months`, `crowd_level`, `typical_visit_minutes`, `seasonality_source` — when a place is worth visiting, as data rather than as prose.                          |
| `015_trip_notes_and_checklist.sql` | `trip_notes` and `trip_checklist_items` — the two halves of the workspace that are not the itinerary (`FV-006` stage b).                                                    |
| `016_trip_share_links.sql`         | `trips.share_token` + `shared_at`, a unique partial index and two CHECKs — a read-only link for people not collaborating on the trip.                                       |
| `017_trip_collaborators.sql`       | `trip_collaborators` — a trip somebody else can open (`FV-007` stage a).                                                                                                    |
| `018_trip_editors.sql`             | Widens `trip_collaborators.role` to `viewer \| editor` (`FV-007` stage c). A CHECK replacement, so it drops and re-adds the constraint.                                     |
| `019_trip_expenses.sql`            | `trip_expenses` + `trip_expense_participants` — who paid for what, and who it was for. Minor units as `BIGINT`, never a float (`FV-008`).                                   |
| `020_idempotency_keys.sql`         | `idempotency_keys` — a retried write is safe to retry; a reused key with a different body is a conflict, not a replay (`PE-007`).                                           |
| `021_travel_preferences.sql`       | `users.interests`, `budget_band`, `travel_pace` — the traveller's stated preferences (`FV-020` stage a).                                                                    |
| `022_admin_audit_log.sql`          | `admin_audit_log` — what admins did to other people (`PE-013`). Refused once by `ADR-022` for having no reader; allowed now because `IMP-111` built one.                    |
| `023_trip_activity.sql`            | `trip_activity` — who changed a shared itinerary, read by the trip's own readers rather than an admin (`BL-147`). Cascades with the trip, unlike `022`.                     |

`schema.sql` is the fresh-database path: it creates the tables from nothing, and it is what
`docker-compose.yml` runs on first start. The migrations are the upgrade path for a database that
already exists — **and also the second half of the fresh path.** Every route to a working database
runs `schema.sql` and then `npm run migrate`: CI does it explicitly (`.github/workflows/ci.yml`,
job `migrations`), the API suite's `createSchema()` does it, and the quickstart tells a contributor
to. Neither half is optional.

**Column** additions are never mirrored in `schema.sql`. `009` and `010` add columns with
constraints attached; declaring the column in `schema.sql` and constraining it in the migration
would leave a fresh database holding an unconstrained column for the length of the migration run,
which is a real state a bug can be written against. One file owns each column.

**Table** creations were mirrored once and are not any more, and the honest version of the rule is
that the mirroring was always redundant. `schema.sql` carries the tables through `008`; everything
from `015` on — `trip_notes`, `trip_checklist_items`, `trip_collaborators`, `trip_expenses`,
`trip_expense_participants`, `idempotency_keys`, `admin_audit_log` — exists only in its migration,
and no path to a working database notices, because **no path stops after `schema.sql`.** Even
`docker compose up`, which runs it as an init script and nothing else, leaves a database the API
cannot serve until `npm run migrate` follows.

So the rule for a new table is: **write it in its migration, and only there.** Mirroring buys
nothing and costs a second declaration that can drift from the first — which is the same reason
columns are not mirrored. `schema.sql` is not being back-filled to match; doing so would create
seven new drift surfaces to document a fact the migrations already state.

_(The column half of this paragraph replaced an instruction to "update `schema.sql` to match" every
migration — written when the fresh path was `schema.sql` alone, and already contradicted by `009`,
which correctly did not. Corrected 2026-08-16 in the Sprint 8.2 integrity pass. The table half was
corrected 2026-09-07, when `check-schema-docs.mjs` was written and the claim was checked for the
first time: it had been false since `015` landed on 2026-09-02.)_
