# API test suite

Jest + supertest against **a real Postgres**, driving the real Express app (`IMP-092`).

## Running them

The suite needs a database and refuses to start without one — it will not fall back to a default,
because a default is how a test run ends up truncating somebody's development data.

```bash
# Point DATABASE_URL at a throwaway database, then:
cd backend && npm test
```

CI provides one as a service container (`.github/workflows/ci.yml`, job `api-tests`). Locally, the
docker-compose Postgres works:

```bash
docker compose up -d postgres
DATABASE_URL=postgresql://easytrip:easytrip@localhost:5432/easytrip npm test
```

> **The suite truncates every table in `beforeEach`.** Never point `DATABASE_URL` at a database
> whose contents you want to keep.

## How it is put together

| File                      | Role                                                                                    |
| ------------------------- | --------------------------------------------------------------------------------------- |
| `setup/env.js`            | Runs before any module loads: fills the environment gate and swaps in the Firebase mock |
| `helpers/firebaseMock.js` | Stands in for `firebase-admin`; a token is a base64 JSON payload                        |
| `helpers/testDb.js`       | Builds the schema, re-seeds between tests, resets the rate limiters                     |
| `../src/config/seed.js`   | The deterministic fixtures (`IMP-095`), shared with `npm run seed`                      |

**Why the database is real.** Every interesting property in this API is a property of SQL: the
rating trigger that keeps `places.rating_sum` in step with `place_reviews`, the
`UNIQUE (place_id, user_id)` that turns a second review into an edit, the foreign key that makes a
review of a nonexistent place impossible. A mocked `pool` would assert that the code sends the
query it was written to send — which is the one thing already obvious from reading it.

**Why Firebase is mocked.** The middleware asks Firebase exactly one question: decode this token.
Everything after that — is this caller an admin, does the token's claim agree with the database, is
the admin flag still true — is EasyTrip's own logic, and that is what is worth testing. A test
token is `authHeader({ uid: 'seed-admin-uid' })`; `INVALID` and `EXPIRED` simulate the two failures
the real SDK signals by throwing.

**Why `maxWorkers: 1`.** Every suite truncates and re-seeds the same database, so two workers would
wipe each other's fixtures mid-test. Parallelism here needs one database per worker; a fast suite
that lies is worse than a slow one that does not.

> ### ⚠️ A schema change is invisible to a re-used local database
>
> `createSchema()` runs `schema.sql` and then every migration, and **all of it is
> `CREATE TABLE IF NOT EXISTS` / `CREATE OR REPLACE`** — which is exactly what makes the migrations
> re-runnable in production. The consequence locally: against a database that already has the
> tables, editing `schema.sql` or adding a migration **changes nothing, and the suite still passes.**
>
> This was found the honest way, in Sprint 7.1. Two mutations that break `user_saved_places` — making
> the unique constraint per-place instead of per-(user, place), and removing the `ON DELETE CASCADE`
> — **survived** the mutation run. Both are caught immediately on a fresh database; the re-used
> cluster was silently serving the unmutated table.
>
> **CI is unaffected** — its Postgres service container is new every run, which is why this has never
> failed a build. But a developer iterating locally can edit the schema, watch the suite go green,
> and ship a table that was never created. **Drop and recreate the database after any change to
> `schema.sql` or `migrations/`:**
>
> ```bash
> dropdb --if-exists easytrip_test && createdb easytrip_test
> ```

**Why the rate limiters are reset between tests.** The stores are in-memory and per-process, so
they accumulate across a file. The newsletter bucket is 5 per hour by design, which is fewer
requests than its own test file makes — without a reset, every assertion after the fifth depends on
how many requests the earlier ones happened to send.

## What is covered

| Suite                           | Locks in                                                                                                                                                                                                         |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth.test.js`                  | `IMP-001/002/003` — no client-supplied identity, no forged admin claim, DB is the authority                                                                                                                      |
| `places.test.js`                | CRUD, pagination, filters (`IMP-011`), the validation boundary (`IMP-057`)                                                                                                                                       |
| `reviews.test.js`               | `IMP-019/021/023` — author privacy, upsert-not-duplicate, real reports, trigger-maintained aggregates, and the deliberate 403-vs-404 split                                                                       |
| `platform.test.js`              | health, profile scoping, newsletter, helmet headers, JSON error shapes                                                                                                                                           |
| `rateLimit.test.js`             | the buckets, **and** what they deliberately do not block                                                                                                                                                         |
| `env.test.js`                   | the boot refusal — the server must not start on a half-configured environment                                                                                                                                    |
| `imageUpload.test.js`           | `IMP-014` — the multipart path with multer running for real; only the network call is stubbed                                                                                                                    |
| `routeShadowing.test.js`        | `BUG C2` — no `(method, path)` declared by two routers, and every rate limiter attached to a route that exists                                                                                                   |
| `adminManagement.test.js`       | Granting and revoking admin — the column and the Firebase claim move together, and unrelated claims survive                                                                                                      |
| `dbTls.test.js`                 | `TD-001` — production verifies the Postgres certificate, and the opt-out says so on every boot                                                                                                                   |
| `profile.test.js`               | `IMP-008` — a profile edit persists what it was sent, and reading one provisions a row                                                                                                                           |
| `placeImages.test.js`           | `SECURITY_AUDIT` M1 — the placeholder SVG never reflects request input; plus the image resolution ladder and the place-scoped delete                                                                             |
| `updatePlace.test.js`           | The admin edit path: partial updates, orphan cleanup on image replacement, and `BUG-048` pinned                                                                                                                  |
| `uploadImage.test.js`           | `IMP-024` — the staged temp file is removed on every path, including a rejected upload                                                                                                                           |
| `cloudinaryCleanup.test.js`     | Deletion never throws — an outage at the image host must not fail a user's delete                                                                                                                                |
| `publicIdFromUrl.test.js`       | The Cloudinary id recovered from a stored URL is the one that was uploaded — the input to an irreversible remote delete                                                                                          |
| `savedPlaces.test.js`           | `IMP-108` — a wishlist is private, and the privacy comes from the SQL predicate rather than a check somebody remembered; plus idempotency                                                                        |
| `myReviews.test.js`             | `IMP-117` — the endpoint that deliberately performs the correlation `IMP-021` prevents, for the one person entitled to it                                                                                        |
| `trips.test.js`                 | `IMP-109` — **transitive** ownership: days and items carry no uid, so every one of eleven endpoints must join up to `trips` to prove it                                                                          |
| `weather.test.js`               | `IMP-110` — nothing is ever invented: outage, unknown shape and missing coordinates each report absence rather than a number                                                                                     |
| `suggest.test.js`               | `IMP-112` / `ADR-033` — the typeahead: tiering, the cap, and `q` treated as text rather than a LIKE pattern (a lone `%` must not return the catalogue)                                                           |
| `analytics.test.js`             | `IMP-111` / `ADR-037` — the dashboard figures are the fixture's exactly, an unrated catalogue has no average rather than one of zero, and a half-pinned place counts as uncoordinated                            |
| `moderation.test.js`            | `IMP-111` / `ADR-036` — the queue groups by review not report, reporter identity never leaves the database, and the one delete path now admits admins without widening for anyone else                           |
| `geocode.test.js`               | `IMP-116` / `ADR-035` — the admin gate, the outcome classification, and the two properties no response reveals: the identifying `User-Agent` and the 1 req/s pacing                                              |
| `search.test.js`                | `IMP-112` — every assertion pins a property `ILIKE` did **not** have (stemming, prefix, weighting, breadth, query-syntax safety), plus the two regressions from it that are deliberate                           |
| `searchVectorFreshness.test.js` | `TD-022` — the stored `search_vector` values still agree with the expression that generates them. `CREATE OR REPLACE` on `easytrip_text_words` does **not** recompute stored rows, and nothing else would notice |
| `feasibility.test.js`           | `FV-025` — the engine as a table of hand-built trips and the verdict each must produce; plus the endpoint's ownership, mounting and the shape a client receives                                                  |
| `tripForecast.test.js`          | `FV-031` + `FV-027`(a) — the _plumbing_, not the rules: every assertion drives `GET /feasibility` with only Open-Meteo faked, because the daylight rule was correct and inert for a whole sprint                 |

**No suite may reach the network.** `setup/env.js` replaces `global.fetch` with one that throws, so
an un-stubbed outbound call fails loudly instead of quietly calling somebody's free service on every
run — the abuse `SESSION_PROTOCOL.md` §11.4b names, and which a geocoding suite committed in Sprint
7.8. A suite that means to exercise a provider assigns its own `global.fetch` in the module body,
which runs after `setupFiles` and wins (`weather.test.js`, `tripForecast.test.js`), or injects a
`fetchImpl` (`geocode.test.js`). This became load-bearing with `FV-031`: `GET /feasibility` makes an
outbound call for any day holding an **outdoor** item, and the only reason no other suite triggers
one today is that nothing in the seed is classified.

`routeShadowing.test.js` is the odd one out and says so in its own header: it asserts the **shape of
the mounted route table** rather than the behaviour of a request. That is deliberate, because the
failure it guards is invisible to a request — when two routers declare the same pair, the first one
answers correctly and the second is simply never reached. It is also the only suite that depends on
private Express internals (`app._router.stack`), and `tests/helpers/routeTable.js` throws by name
rather than enumerating an empty table if a future Express removes them.

## What it does not cover

- The frontend. Component tests are `IMP-093`, end-to-end is `IMP-094`.
- **The Cloudinary network call itself.** No test contacts Cloudinary, and none should — their SDK
  working is their test suite's job. What _is_ covered, since Sprint 6.17, is our own wrapper around
  it: `uploadImage.test.js` and `cloudinaryCleanup.test.js` stub the `cloudinary` **package** rather
  than `config/cloudinary`, one layer lower than every other suite, so the module's own logic runs
  for real — the temp-file cleanup, the `secure_url` rename, the `'not found'`-is-success mapping.
  _(This bullet used to read "both are mocked at the config layer … neither belongs in this suite",
  which stopped being true when those two files were written.)_
- Concurrency. Every assertion is sequential, so nothing here would catch a race between two
  simultaneous review submissions.
- Driver-fault paths in the review controller — the `42P10` missing-constraint and `42P01`
  missing-table mappings, and the generic `catch` arms. Reaching them means dropping a table or a
  constraint against the database every other test shares. Tracked as `TD-017`, with the measured
  numbers and the reasoning in `docs/VERIFICATION_LEDGER.md` §6.
- Controller-level `401` guards that sit behind `isAuthenticated`. They are unreachable through the
  routed stack; testing them by calling the controller with a mock `req` would assert that a
  backstop exists, not that the app is safe.

## What is deliberately not a test

`scripts/check-module-size.mjs` enforces Phase 5's 500-line criterion in CI. It is an **architecture
guard** — it asserts nothing about behaviour, and it is named that way on purpose.
`docs/VERIFICATION_LEDGER.md` explains why the distinction is worth keeping: the suites it replaced
looked like coverage long after they had stopped proving anything.
