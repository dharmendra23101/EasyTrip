# Contributing to EasyTrip

The goal of this file is narrow: **you should be able to clone this repository, get it running, make
a change, and open a pull request without asking anyone a question.** If you hit a step that needed a
question, that is a defect in this file — please open an issue saying which step.

The [README](README.md) is the tour. This is the working manual.

---

## 1. What you need before anything works

|                                    | Why                                                                                                 |
| ---------------------------------- | --------------------------------------------------------------------------------------------------- |
| **Node.js 20+** (`.nvmrc` pins 22) | Both tiers                                                                                          |
| **PostgreSQL 13+** _or_ Docker     | The API talks to a real database, and so do its tests                                               |
| **A Firebase project**             | Authentication. Email/password + Google sign-in on the client, Admin SDK verification on the server |
| **A Cloudinary account**           | Image uploads                                                                                       |

**Firebase is not optional for running the API.** `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` and
`FIREBASE_PRIVATE_KEY` are checked at boot and the process **exits** if any is missing, naming it.
That is deliberate: a server that cannot verify a token would otherwise start happily and reject
every authenticated request in production, which is the exact failure this project was built out of.

Cloudinary is **warned about in development and required in production** — locally you get a startup
warning and every feature except image upload works. `DATABASE_URL` is required everywhere, and it is
validated by parsing rather than by pattern, so a string `pg` would choke on is rejected at boot with
the reason rather than at the first query.

---

## 2. Setup, in the order that works

```bash
git clone https://github.com/Mukund934/EasyTrip.git
cd EasyTrip
npm run install:all          # root, backend, frontend
```

**Environment.** Copy both templates and fill them in. Each one documents every variable and where to
get it; neither file is ever committed.

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
```

**Database.** Docker is the short path — it starts Postgres and creates the schema on first run:

```bash
docker compose up -d
# DATABASE_URL=postgresql://easytrip:easytrip@localhost:5432/easytrip
npm run migrate
```

`npm run migrate` is **not optional, including on a brand-new database.** `schema.sql` creates the
tables; the migrations add everything since, and some of them add constraints rather than columns.
`npm run migrate:status` shows what is applied without changing anything. The conventions are in
[`backend/src/config/migrations/README.md`](backend/src/config/migrations/README.md).

**Sample data**, because a migrated database is empty and `/browse` shows nothing:

```bash
cd backend && npm run seed   # destructive — truncates first, so use a dev database
```

Three users, four places, three reviews, all with **fixed** ids and timestamps — the same fixtures
the API suite asserts against, so local behaviour and test behaviour are the same behaviour. The
places deliberately cover the shapes the read paths branch on: one complete, one with no
coordinates, one with no image, one with neither and no reviews.

**Run it.**

```bash
npm run dev                  # both tiers: API on :5000, Next on :3000
```

**Admin rights** are granted to an account that has already signed up:

```bash
cd backend/script && node make-admin.js you@example.com
```

---

## 3. The tests, and which one to reach for

Three layers, each earning its place by catching something the others cannot.

```bash
cd backend  && DATABASE_URL=... npm test     # API assertions against a real Postgres
cd frontend && npm test                      # component assertions (Jest + RTL)
npm run test:e2e                             # browser journeys (Playwright)
```

The current totals live in [the README](README.md#-engineering) and nowhere else. They used to be
repeated here too, and by the time anyone noticed, this copy said 509/330/81 against the suites'
actual 563/358/88 — a number duplicated in two files is a number that will disagree with itself.
The README's copy is CI-enforced (`npm run check:test-counts`, `IMP-128`); this one was not, which
is the entire argument for having one.

**The API suite needs a real database and refuses to start without `DATABASE_URL`** — it will not
fall back to a default, because a default is how a test run truncates somebody's development data.
It truncates every table between tests. Point it at something disposable.

The E2E suite provisions its own Postgres and its own Firebase Auth Emulator, on ports deliberately
different from the development ones, so it can run while you are working.

| Writing a test for…                                   | Put it in         | Because                                                                                                                            |
| ----------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| an endpoint's contract, a constraint, a trigger       | `backend/tests/`  | Most interesting properties here are properties of SQL. A mocked pool only proves the code sends the query it was written to send. |
| a component, a hook, a rendering rule                 | `frontend/tests/` | Fast, and it can assert on things a user sees                                                                                      |
| routing, hydration, SSR output, two tiers disagreeing | `e2e/tests/`      | The only layer that runs a real browser against a real server                                                                      |

**One rule worth internalising:** if the behaviour is only correct in the _server-delivered HTML_ —
SEO tags, a licence notice, anything a crawler reads — assert against the raw response body, not the
hydrated DOM. A browser-driven check passes either way. This has caught two real bugs.

**Two accessibility gates run over the public routes, and they check different things.**
`e2e/tests/axe.spec.js` runs `axe-core` and fails on **anything it reports** — the per-route
allowlist is empty as of Sprint 8.74, so the gate is zero violations across six public routes and
three authenticated ones. An entry added back needs a measured contrast ratio and a reason beside
it, so that "we did not look" cannot wear the words "we decided". `e2e/tests/touch-target.spec.js` measures every control against WCAG 2.5.8's
24×24 minimum — separate because `axe-core` deliberately does not implement that criterion, three
of whose four exceptions need a human. If you add a control smaller than 24×24, grow the _target_
and leave the visual size alone; the carousel dots are the worked example.

If either fails on a page you did not touch, read `BUG-057` before adjusting a number. That entry
spent four sprints and two confident wrong diagnoses on a count that turned out to be an animation
frame, and the allowlist entry it produced described nothing real.

More detail: [`backend/tests/README.md`](backend/tests/README.md) and
[`e2e/README.md`](e2e/README.md).

---

## 4. Repository guards

These are not tests. Each fails on a fact about the repository, and each one exists because the
corresponding fact stopped being true at least once.

```bash
npm run lint             # all three tiers
npm run check:size       # no module over 500 lines outside the recorded waivers
npm run check:secrets    # no credential-shaped names or values in tracked files
npm run check:api-docs   # the README's route table matches the routers, both directions
npm run check:schema-docs # the README's ER diagram matches the migrations, both directions
npm run check:stack-versions # badges and Structure.txt match the three package.json files
npm run check:bundle-size # after a build: the shared JS baseline and each route's own code
npm run check:env-docs   # every variable the code reads is in a .env.example, and vice versa
npm run check:test-counts # the README's assertion total against its own three parts
npx prettier --check .
```

`check:api-docs` fails on an undocumented route **and** on a documented route that does not exist.
That second direction matters: the table once drifted 23 routes behind, and a check that only looked
one way would not have noticed.

`check:schema-docs` is the same idea for the schema, and it also asserts that **every migration has
a row in `backend/src/config/migrations/README.md`.** If you add a migration, describe it there —
the table had stopped at `010` while twelve more files shipped, which is how a contributor ends up
reading twenty-two `.sql` headers to find out what the schema does.

CI runs seven jobs on every push — lint and build, frontend tests, migrations, API tests, end to end,
a README test-count check, and a dependency-advisory gate at `high`.

> **Branch protection is not yet configured**, so a red job is a signal rather than a gate. Treat it
> as a gate anyway: do not merge on red. Turning it into a real one is a repository setting only a
> maintainer can change, and it is on the list.

---

## 5. What a good pull request looks like

**One cohesive change.** Not one file, not one line — one _decision_, with everything it touches.

**With its tests.** A change to behaviour that no assertion would catch is a change that will be
undone by accident later.

**A conventional-commit subject, and a body that explains _why_.**

```
feat(places): credit OpenStreetMap for the coordinates it actually produced

The one-line fix -- a notice on every place page -- was rejected. Most
coordinates in the catalogue were typed by an admin, and crediting
OpenStreetMap for those replaces a missing attribution with a fabricated one.
```

Types in use: `feat`, `fix`, `docs`, `chore`, `test`, `security`, `perf`, `refactor`.

> **Name the alternative you rejected and why it lost.** That is the expensive half to reconstruct
> six months later, and it is the half that makes a diff reviewable by someone who was not in your
> head. The commit bodies in this repository are where its design reasoning lives.

**Do not reformat code you did not otherwise change.** A diff that mixes a fix with a re-indent is a
diff nobody can review.

---

## 6. House rules that are not obvious from the code

- **No fabricated data, ever.** Not a placeholder rating, not a plausible-looking forecast, not a
  default that renders as though it were a measurement. If a value is unknown, the UI says so. A
  large part of this project's history is deleting invented content that looked functional.
- **Nothing is "done" because it should work.** Verified means a command was run and its output
  read. Reviewed means read carefully. They are different words and they mean different things.
- **A shortcut needs a written expiry.** Deliberate debt is fine; undocumented debt is how a
  codebase stops being explainable.
- **Match the surrounding style.** CommonJS in `backend/`, hooks and Tailwind in `frontend/`. No
  TypeScript — that is a project-wide decision, not an oversight.
- **All SQL is parameterised.** Every one, without exception. Where a query needs a dynamic column
  name, it comes from a hard-coded allowlist and never from a request.
- **New third-party data source?** Read its licence, not just its rate limits — they are different
  risks and satisfying one says nothing about the other. This project has already shipped one
  integration that was scrupulous about pacing and silent about attribution.

---

## 7. Two things this file cannot tell you

**Who wrote which part.** The repository has three git identities across two people — or possibly
two identities belonging to one person with two configs. Attribution is about real people, and this
file will not assert a guess. It is an open question for the maintainers, not a documentation gap
somebody can close by reading the history.

**What licence the code is under.** There is no `LICENSE` file yet. The manifests declare `ISC`,
which means nothing on its own. Until a licence file lands, treat the code as all rights reserved —
and if you are planning a substantial contribution, ask first, because that question affects you.

---

## 8. Reporting a security issue

Please **do not** open a public issue. Contact a maintainer directly (see
[Contact](README.md#-contact)).

If it concerns credentials visible in this repository's git history: that is known, tracked, and
being handled. The four values committed early in the project's life are documented as an open item
rather than quietly ignored.
