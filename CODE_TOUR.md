# A tour of this repository

_What to read, in what order, and why — for anyone evaluating this code rather than contributing to
it. If you are here to contribute, [`CONTRIBUTING.md`](CONTRIBUTING.md) is the file you want._

There is a lot here: **79,500 lines** across three packages, 264 commits. Reading it linearly is the
wrong idea. This file is a set of paths through it, sized by how much time you actually have.

Everything below is a link to real code. Nothing is summarised in a way that would let it be wrong
without the link being wrong too.

---

## Five minutes

Read these three things, in this order. They are chosen because each is falsifiable on the spot.

**1. [Authentication was broken by construction](README.md#the-one-worth-leading-with-authentication-was-broken-by-construction)** — for most of this
project's life the server never initialised the Firebase Admin SDK, and compensated with a
development bypass: a request carrying the header `x-user: AdminX` was treated as an authenticated
administrator.

The interesting part is not the hole, it is _why it survived_. Local development was designed around
not having working authentication, so nothing in day-to-day work ever exercised the real path and
the bypass became load-bearing — a **dev/prod parity failure**, not a missed review. Removing it
alone would have 401'd every request; initialising the SDK alone would have left it live. The three
fixes had to land together. It is written up rather than quietly fixed, because how a project talks
about its worst defect is more informative than its best feature.

**2. [`backend/src/utils/authMiddleware.js`](backend/src/utils/authMiddleware.js)** — the fix, and
the one file to read if you read only one. Firebase answers _who this is_; the database answers
_what they may do_. A correctly-signed token asserting `admin: true` is **denied** if the `users`
row disagrees, and the disagreement is logged as a privilege inconsistency.

That distinction cannot be proved by a unit test with a mocked verifier, so it is proved by a
browser journey that mints a genuine token carrying a real `admin: true` custom claim through the
Admin SDK, for a user whose `is_admin` is `false`, and asserts the 403 —
[`e2e/tests/auth-boundary.spec.js`](e2e/tests/auth-boundary.spec.js).

**3. [The eight guards](README.md#the-guards--claims-this-readme-cannot-make-falsely)** — scripts
that fail the build when a claim in the documentation stops being true. The test counts in the
README, the 78-row API table, the ER diagram, the environment variables, the controlled
vocabularies. They exist because each of those facts had already drifted at least once.

Try one:

```bash
npm run check:schema-docs
```

---

## Twenty minutes

The five-minute path, then the product idea and the three places it is enforced.

### The product idea

**EasyTrip refuses to make things up.** That is the whole thesis, and it is a constraint on the
code rather than a line in the marketing:

| Situation                                 | What it does                                                          |
| ----------------------------------------- | --------------------------------------------------------------------- |
| A place with no accessibility data        | says **"nobody has recorded enough about it"** — not "not accessible" |
| A recommendation that cannot rank a place | **excludes it and shows the running count on screen**                 |
| A trip with a mixed-currency expense      | **refuses to total it**, and names the two currencies                 |
| A settlement suggestion                   | ships `optimal: false`, because minimising transfers is NP-hard       |
| A weather panel with no reading           | shows an absence — the original was **deleted for fabricating one**   |

The last row is the origin story. Everything above it is downstream of deleting that.

### Where to see it enforced

- **[`backend/src/services/settlementService.js`](backend/src/services/settlementService.js)** —
  the honest-uncertainty case in its clearest form. The function is called `settle`, not
  `optimise`, and returns `optimal: false` because the algorithm is a greedy heuristic and the
  problem is NP-hard. Naming it `optimise` would have been one word and a lie.
- **[`backend/src/config/migrations/022_admin_audit_log.sql`](backend/src/config/migrations/022_admin_audit_log.sql)**
  — read the header before the DDL. Fifty lines arguing why the table is _allowed to exist_, having
  been refused once for having writers and no readers. It explains why the table has no foreign
  key, and why `outcome` has a `partially_applied` value that no HTTP status corresponds to.
- **[`e2e/tests/axe.spec.js`](e2e/tests/axe.spec.js)** — accessibility gated at zero violations on
  six public routes, minus a named, reasoned allowlist. The comment block on `BUG-057` records two
  wrong diagnoses before the right one, and the eight-scan measurement that settled it.

### Then pick one feature and read it end to end

The trip workspace is the most complete vertical slice: schema, access control, collaborators,
expenses, settlement, an itinerary, and a feasibility engine that declines to guess.

`migrations/008` → [`tripModel.js`](backend/src/models/tripModel.js) →
[`tripController.js`](backend/src/controllers/tripController.js) →
[`tripValidators.js`](backend/src/routes/validators/tripValidators.js) → the frontend
[`trips`](frontend/src/pages/trips) pages → [`e2e/tests/trips.spec.js`](e2e/tests/trips.spec.js).

---

## An hour — run it

The [README's Quickstart](README.md#quickstart) is the supported path — Node 20+, PostgreSQL 13+, a
free-tier Firebase project, and two `.env` files copied from their templates. `docker-compose.yml`
is there if you would rather not install Postgres.

Two things about it are worth knowing before you start:

- **The server refuses to boot without its service-account variables.** That is deliberate: a server
  that cannot verify a token should not start rather than 401 every request in production.
- **`npm run migrate` is not optional on a fresh database.** `schema.sql` is only the first half of
  the fresh path — [`backend/src/config/migrations/README.md`](backend/src/config/migrations/README.md)
  explains why, and documents all twenty-two migrations.

Then run the suites — API, component, and the browser journeys, which start the Firebase Auth
Emulator themselves. The counts they print are the counts in the README, because a CI job parses the
runners' own JSON and fails the build when they disagree.

The API suite **truncates every table**, so point it at a throwaway `DATABASE_URL`.

---

## What I would point at in an interview

Ordered by how much they say about judgment rather than throughput.

**Work that was deleted after being measured.** A 2-opt route optimiser was written, benchmarked
against the existing heuristic on 640–980 km fixtures, found to save 0–4 km, and **deleted**. The
measurement is recorded; the code is not in the repository. Same for a fabricated weather panel and
a vendor-neutral error-reporting abstraction that would have wrapped a vendor nobody had chosen.

**Mutation testing as a habit.** Each change is followed by deliberately breaking the code to
confirm the tests notice — green control, pristine snapshot, one mutation, test, restore, and a
byte-identical MD5 check. **A run whose restore does not verify is discarded, not salvaged.**
Survivors are recorded rather than hidden, and twice they were the most useful output: a test
asserting a call count that was true of every possible implementation, and an `ORDER BY` tiebreak
whose test could never have failed on a four-row table.

**Fifty recorded architecture decisions — and eight numbered ones that are explicitly _not made_.**
The pending ones sit in a table with the trigger that would force each: `ADR-020` is the error
monitoring vendor, and it stays open because choosing a vendor by accident is worse than choosing
one late.

**A guard written the moment a document lied.** The eighth guard exists because the ER diagram had
quietly stopped listing every table. The fix was not editing the diagram — that would last until the
next migration — it was making the claim checkable, then editing the diagram.

---

## What is deliberately not here

Trust the feature list only as far as this section goes.

- **[Not Yet Implemented](README.md#-not-yet-implemented)** in the README is maintained as carefully
  as the feature list, and for the same reason.
- **No AI features**, despite an `AI_ROADMAP.md` describing them in detail. They need a model
  provider and a per-request cost, and that is a budget decision rather than an engineering one.
- **No feature-flag system.** It is designed and deferred: a flag that is never true is dead code
  wearing a disguise, so it gets built in the sprint that needs it.
- **Not deployed.** There is no public URL to click. The credentials that would back one are in
  early git history and must be rotated first — which is stated openly in
  [`SECURITY.md`](SECURITY.md) rather than left for someone to find.
- **Internationalisation is scaffolded, not finished.** The guard that keeps the dictionaries honest
  exists; the Hindi translations do not, because a half-translated interface is worse than an
  English one.

---

## The honest caveats

Reviewing a repository with a long README should include asking what the README is not saying.

- **The test counts are real and CI-enforced, but they are assertion counts, not coverage.** There
  is no line-coverage gate. `TD-017` records that as an open item rather than claiming a percentage.
- **The E2E suite runs against a seeded database and the Firebase Auth Emulator**, not against a
  production deployment, because there is not one.
- **`docs/` is a large internal knowledge base that is not in this repository** — it is
  `.gitignore`d. What you can see is the public subset: this file, the README, `CONTRIBUTING`,
  `SECURITY`, `CHANGELOG`, and the per-directory READMEs. Claims here are traceable to code you
  can read; where this file cites a decision record, that record is internal.
- **Contributor history shows three git identities for what is probably two people.** Two of them
  share a username. It is left unmerged because a repository should not assert an identity claim it
  cannot verify.

---

_If you have a question this file does not answer, the answer is probably in the README's
[Known Issues & Lessons Learned](README.md#-known-issues--lessons-learned), which is written to be
read by someone who is looking for what went wrong._
