# EasyTrip 🌍

> **A travel platform that refuses to make things up.** Browse real destinations, plan a day that is
> actually walkable, split what the trip cost — and when EasyTrip does not know something, it says
> so instead of showing a plausible number.

[![CI](https://github.com/Mukund934/EasyTrip/actions/workflows/ci.yml/badge.svg)](https://github.com/Mukund934/EasyTrip/actions/workflows/ci.yml)
[![Tests](https://img.shields.io/badge/assertions-2%2C055-brightgreen)](#-testing--verification)
[![Routes](https://img.shields.io/badge/API%20routes-79%20documented-blue)](#-api-documentation)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-16.3-black?logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19.2-blue?logo=react)](https://reactjs.org/)
[![Express](https://img.shields.io/badge/Express-5.2-lightgrey?logo=express)](https://expressjs.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-13+-336791?logo=postgresql)](https://postgresql.org/)

![EasyTrip landing page](./preview1.png)

---

## What this is

A full-stack destination discovery and trip-planning app — Next.js, Express 5, PostgreSQL, Firebase
Auth — where a signed-in traveller can browse curated places, save them, build a day-by-day
itinerary, invite someone to edit it, and settle up the expenses afterwards. Admins manage the
catalogue through a panel with image upload and a moderation queue.

**The thing worth looking at is not the feature list.** It is that the project treats _"we don't
know"_ as a value it has to render honestly, and has the tests to prove it does:

|                                            |                                                                               |
| ------------------------------------------ | ----------------------------------------------------------------------------- |
| A place with no accessibility data         | says **"nobody has recorded enough about it"** — not "not accessible"         |
| A recommendation that can't rank a place   | **excludes it and shows the running count** on screen                         |
| An itinerary with a mixed-currency expense | **refuses to total it**, and says which two currencies                        |
| A settlement suggestion                    | ships `optimal: false`, because minimising transfers is NP-hard               |
| A weather panel with no reading            | shows an absence, after the original one was **deleted for being fabricated** |

That last row is the honest version of this repository's history, and it is the reason for the rest.

---

## Why this repo might be worth your time

- **2,055 assertions** — 1,094 API tests against a _real_ PostgreSQL, 807 component tests, 154
  browser journeys that really sign in through the Firebase Auth Emulator. Reproducible commands in
  [Testing & verification](#-testing--verification).
- **The counts above cannot go stale.** A CI job parses the runners' own JSON reports and fails the
  build if this README's numbers disagree with the suites. Same for the 79-route API table, the
  environment variables, the theme vocabularies, and module size.
- **Mutation testing is a habit, not a one-off.** Roughly _"here is the change, and here is the
  deliberate break that proves the test would have caught it"_ — including the runs that were
  **discarded** because a restore was not byte-identical.
- **The interesting bugs are written up, not buried.** Authentication was
  [broken by construction](#the-one-worth-leading-with-authentication-was-broken-by-construction)
  for most of this project's life. That section is the first thing a reviewer should read.
- **What is _not_ built has its own section.** [Not Yet Implemented](#-not-yet-implemented) exists so
  the feature list can be trusted.

**If you are evaluating this repository rather than running it, start with
[`CODE_TOUR.md`](CODE_TOUR.md)** — what to read, in what order, and why, in a five-minute, a
twenty-minute and an hour-long version. It ends with the caveats this README's length can hide.

---

## Quickstart

Needs Node 20+, PostgreSQL 13+, and a Firebase project (free tier). Full detail, including every
environment variable, is in [Installation & Setup](#-installation--setup).

```bash
git clone https://github.com/Mukund934/EasyTrip.git && cd EasyTrip
npm run install:all                       # root, backend, frontend
cp backend/.env.example backend/.env      # then fill it in — the server refuses to boot without it
cp frontend/.env.example frontend/.env.local
npm run migrate                           # 22 migrations, re-runnable
npm run dev                               # frontend :3000 · API :5000
```

Verify the checkout is sound before changing anything:

```bash
cd backend && npm test        # needs a throwaway DATABASE_URL — it truncates every table
cd frontend && npm test
npm run test:e2e              # starts the Firebase Auth Emulator itself
```

---

<details>
<summary><b>📸 More screenshots</b> — browse, search, a place page, weather and map</summary>

<br>

**Discover places (browse)**

![Discover amazing places](./preview2.png)

**Why Choose EasyTrip**

![Why Choose EasyTrip](./preview3.png)

**Search within browse**

![Search in browse section](./preview4.png)

**A destination page**

![Tourism spot](./preview5.png)

**Reading about the place**

![About place](./preview6.png)

**Weather widget and map**

![Weather and map](./preview7.png)

> ⚠️ **This screenshot predates two changes, and the caveat that replaced it also went stale.**
> The map is a Google Maps embed driven by the place's stored coordinates and works as shown.
>
> The weather panel in this shot was **fabricated** — a hardcoded forecast presented as real — and
> was deleted rather than left looking functional. It has since been **rebuilt for real** against
> Open-Meteo, keyed on the place's own coordinates, and it now states an absence instead of showing
> a number when there is no reading. So the panel is genuine again, but it does not look like this.

</details>

---

## 📋 Table of Contents

**Evaluating rather than running it?** [`CODE_TOUR.md`](CODE_TOUR.md) is the short way in — what to
read, in what order, and why, in a five-minute, twenty-minute and hour-long version.

**The product**
[Overview](#-overview) · [Features](#-features) · [Not Yet Implemented](#-not-yet-implemented) ·
[Data Sources & Attribution](#️-data-sources--attribution)

**The engineering**
[Technology Stack](#️-technology-stack) · [Project Architecture](#-project-architecture) ·
[How an Admin Request Is Authorised](#-how-an-admin-request-is-authorised) ·
[Database Schema](#️-database-schema) · [Architecture Patterns](#️-architecture-patterns) ·
[Testing & Verification](#-testing--verification)

**Running it**
[Quickstart](#quickstart) · [Installation & Setup](#-installation--setup) ·
[API Documentation](#-api-documentation) · [Deployment](#-deployment)

**The honest parts**
[Known Issues & Lessons Learned](#-known-issues--lessons-learned) ·
[Commit & Branch Hygiene](#-commit--branch-hygiene) · [Roadmap](#-roadmap)

**Meta**
[Contributing](#-contributing) · [License](#-license) · [Contact](#-contact)

---

## 🌟 Overview

**EasyTrip** is a travel destination discovery platform designed to help users explore destinations, read and write reviews, and browse places on an interactive map. Curated destination content is managed through an admin panel with full create/edit/delete and image upload.

> **Honest status:** the feature lists below describe what is actually implemented in this repository today. Anything advertised but not yet built lives in [Not Yet Implemented](#-not-yet-implemented) rather than being listed as a feature.

---

## 🚀 Features

### ✨ User Features

- 🏞️ **Destination Discovery** – Browse curated destinations with image-rich cards
- 🔍 **Ranked search with typeahead** – Postgres `tsvector` search weighted by field (name > place > tags > description), so `temples` finds `temple` and a place _named_ for your query outranks one that merely mentions it. Suggestions appear as you type, and filters for location, district, state and tags all run server-side
- ⭐ **Ratings & Reviews** – Read reviews and post a 1–5 star rating with a comment; one review per user per place (enforced by a `UNIQUE` constraint + upsert), with place averages maintained by a PostgreSQL trigger
- 📱 **Responsive Design** – Optimized for all devices
- 🖼️ **Magazine-Style Detail Pages** – Full-bleed hero, carousels, related places, and a Google Maps embed for the location
- 🗺️ **Explore Map** – Leaflet map with marker clustering, multiple tile layers, a geolocation radius filter, and in-map search
- ❤️ **Saved Places** – Heart any destination and find it again on `/saved`; persisted per user, server-side, and it follows you to another device
- 🚩 **Report a Review** – Reports are persisted and feed a real admin moderation queue
- 🗺️ **Trip Workspace** – Build an itinerary day by day: ordered items, times, notes, and transport legs between stops
- ✅ **Feasibility check** – A deterministic answer to "can this plan actually be done?": days outside the trip's dates, overlapping times, not enough time to travel between two stops, a day that doubles back on itself. It separates _cannot be done_ from _worth a look_, and every travel figure says it is an estimate — there is no routing service behind it, and the assumptions are printed rather than hidden
- 🧭 **Route ordering** – For a day of stops, it looks for a shorter way round the same places, shows which ones would move and how much driving that saves, and then waits: it suggests, and never rearranges anything on its own. Days that already have times on them are left alone, because the clock decides that order
- 🗺️ **The day on a map** – Draws a day's stops in the order you arranged them, so a day that doubles back looks like one. The line is dashed on purpose: it shows the order, not the road. Every leg says whether it was measured or estimated, and a stop with no coordinates is named rather than quietly left off. The map is decorative — the same order, distances and omissions are a list beside it, for readers who cannot see a shape
- ♿ **Step-free access, with its receipts** – Filter the catalogue to places somebody has actually checked for step-free access, and see the answer on the card **with the date it was checked** — never a bare tick. The place page says who checked and what they found. A place nobody has surveyed shows nothing at all rather than a greyed-out badge, because "not checked" and "not accessible" are different answers and only one of them is safe to guess
- 🧭 **Your trip, checked against your own needs** – Tell EasyTrip you need step-free access and the feasibility report names the stops that cannot accommodate you, with who checked and when. A place nobody has surveyed says nothing at all — warning on data that does not exist would put a caution on almost every stop and teach you to ignore all of them
- ☀️ **Real Weather** – A live Open-Meteo forecast on each place page, keyed on that place's own coordinates. When there is no reading it says so rather than showing a number
- 📴 **Installable & Offline** – A PWA: install it, and pages you have already visited still open with no connection
- 🔐 **Accounts** – Firebase email/password + Google sign-in, with an editable display name

### 🛡️ Admin Features

- 🖊️ **Content Management** – Create, edit, and delete destinations
- 📦 **Image Management** – Cloudinary-backed upload with a drag-and-drop admin UI, multi-image galleries, and an SVG placeholder fallback
- 👥 **User Management** – List users and grant or revoke admin rights, from the dashboard and over the API (`/api/admin/admins`)
- 🚩 **Moderation Queue** – Reported reviews, grouped one row per review however many people reported it. Reporter identity is never exposed, to the admin or anyone else
- 📊 **Analytics & monitoring** – Real catalogue figures and a _needs attention_ panel that links to the work, plus a monitoring page: daily activity across reviews, trips and moderation inflow (quiet days shown as zero, never skipped), the full rating distribution rather than just its average, and the specific places left to finish. The chart is decorative — the same numbers are a real table, so the information is not visual-only
- 📍 **Address Lookup** – Fill a place's coordinates from its address via OpenStreetMap. One match fills the form; several are offered for a choice rather than guessed at
- 🛡️ **Audit Log** – Every privilege change, moderation decision and admin review deletion, recorded **in the same transaction as the action** so an unlogged `is_admin` flip is not possible. Read-only: no route edits or deletes an entry, including for the admin who created it. A grant whose Firebase claim failed to sync is marked _partly applied_ rather than recorded as a success the API had already reported as a 500

### 🧪 Engineering

- ✅ **2,055 assertions across three layers** – 1,094 API tests against a real PostgreSQL, 807 component tests, and 154 browser journeys including ones that really sign in through the Firebase Auth Emulator and drive client-rendered pages as that user. All three were measured at Sprint 8.78, and the browser suite was genuinely **run**, not counted: 154 expected, **0 unexpected, 0 flaky, 0 skipped** — against real browsers and a real Firebase Auth Emulator, which is what actually proves the `firebase-admin` migration (see `ENV-001`). Reproduce with `cd backend && npm test`, `cd frontend && npm test`, `npm run test:e2e`
- ♿ **Accessibility gated on every run** – `axe-core` scans nine routes — six public and three behind sign-in — as part of the browser suite, failing on anything it reports except a short allowlist that carries a reason, a ceiling, and an assertion that it names nothing already clean. Its first run found four real defects — two `<main>` landmarks on one page, a heading skip, and two sign-in pages with no `<h1>` — none of which the other 131 journeys could see
- 🧬 **Mutation-tested invariants** – load-bearing behaviour is verified by deliberately breaking it and checking a test fails. Schema mutations run against a database dropped and recreated each time, because `CREATE TABLE IF NOT EXISTS` makes them invisible otherwise
- 🔎 **SEO** – server-rendered pages, `sitemap.xml` generated from the live catalogue, `robots.txt`, and schema.org `TouristAttraction` structured data
- ⚙️ **CI on every push** – seven jobs: lint and build, frontend tests, migrations, API tests, end-to-end, a job that checks the assertion counts above against what the suites actually ran, and a dependency-advisory gate at `high` across all three workspaces
- 🗄️ **Real migrations** – versioned, checksummed, and applied by a runner rather than at boot
- 📋 **Observability that survives the crash** – structured JSON logs (pino) with a per-request id echoed as `x-request-id`, URLs scrubbed of anything that ever authenticated, and no headers or bodies logged at all. Crashes and `SIGTERM` go through the same pipeline rather than around it — Node prints an unstructured stack to stderr by default, which made the one line explaining why a service stopped the only line that was not JSON. Shutdown drains the connection pool under a deadline and records whether it finished gracefully. A request slower than a threshold is promoted from `info` to `warn` so it **arrives** rather than merely being findable — and a slow health check is deliberately _not_ demoted, because it is the earliest sign the database is struggling. A pool connect-timeout carries the pool's occupancy, since _"timeout exceeded when trying to connect"_ is otherwise the same sentence whether the database is unreachable, cold-starting, or healthy and simply out of connections

---

## 🧭 Not Yet Implemented

Built-but-incomplete or not started. Listed here so the feature list above stays honest.

| Feature                       | Status today                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🌐 Multi-language (i18n)      | **Half true now.** The mechanism _is_ built (`IMP-114`): Next locale routing with `en` unprefixed and Hindi under `/hi`, one dictionary module, and seven browser journeys. What is not translated is the **catalogue** — place names, descriptions and reviews are English rows in PostgreSQL. A Hindi reader gets Hindi chrome around English place data, which is a stated boundary rather than a bug. `localeDetection` is off on purpose: a browser sending `Accept-Language: hi` should not be redirected into a partial translation it did not ask for |
| 🖼️ Link-preview card art      | `og:image` points at the place's own photo, which is real and correct, but not a generated card with the name composited onto it                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ✉️ Email verification         | Password reset works, but a new account's address is never confirmed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ⚡ Google One Tap             | Deliberately removed — it was configured with a Firebase API key where a Google OAuth Client ID belongs, so it could never work. Google **popup** sign-in is supported                                                                                                                                                                                                                                                                                                                                                                                        |
| 📴 Offline for signed-in data | Cached pages work offline; saved places, trips and profile do not. A service worker cache is per browser, not per person, so caching them would hand one user's data to the next person on a shared device — a deliberate refusal                                                                                                                                                                                                                                                                                                                             |

> **Why this table keeps changing.** Four rows were removed on 2026-08-15 because the features
> arrived: weather, trips, the moderation queue and the analytics dashboard. This is the second time
> the section has gone stale — an earlier commit is literally titled _"the honesty table had stopped
> being honest"_. The failure mode is structural rather than careless: a list of what is missing
> decays every time something ships, and nothing fails when it does. **Treat it as a release-checklist
> item, not a document that maintains itself** — `RELEASE_CHECKLIST.md` now says so.

---

## 🛠️ Technology Stack

### 🎨 Frontend

- **Next.js 16.3** - React framework, **Pages Router** (`frontend/src/pages`). Rendering is chosen per route rather than globally: the home page and `/places/[id]` are `getStaticProps` + ISR (`revalidate: 300`), `/browse` is `getServerSideProps` because its content is a function of eight filter dimensions crossed with free text and has no bounded set of paths to pre-render, and the four `/admin/*` pages are `getServerSideProps` for the auth gate
- **React 19.2** - Modern React with hooks and context
- **Tailwind CSS** - Utility-first CSS framework
- **Framer Motion** - Animation library for smooth interactions
- **Leaflet + markercluster** - Explore map on the browse page
- **React Icons** - Comprehensive icon library
- **Axios** - HTTP client for the API service layer

### ⚙️ Backend

- **Node.js** - JavaScript runtime (CommonJS)
- **Express.js 5** - Web application framework
- **PostgreSQL** - Relational database, accessed with `pg` (`SERIAL`, `TEXT[]`, `JSONB`, `plpgsql` triggers)
- **Multer** - File upload middleware
- **Helmet** - Security response headers
- **express-rate-limit** - Global ceiling plus tighter buckets on reviews, uploads, and admin writes
- **express-validator** - Request validation on review, place, profile, and admin writes
- **CORS** - Explicit origin allowlist from `CORS_ALLOWED_ORIGINS` (no wildcard)

### 🔐 Auth & Storage

- **Firebase Auth** - Email/password + Google sign-in on the client
- **Firebase Admin SDK** - Server-side verification of Firebase ID tokens (`Authorization: Bearer <idToken>`)
- **Cloudinary** - Image storage and optimization

### 🛠️ Dev Tools

- **PostCSS + Autoprefixer** - CSS processing
- **Nodemon** - Backend dev server reload
- **Git** - Version control

---

## 🏗️ Project Architecture

Three packages, three `package.json` files, one `concurrently` command — not an npm workspace, on
purpose (`ADR-010`): each tier resolves its own dependencies, so a frontend upgrade cannot silently
move a backend version.

```mermaid
flowchart LR
    subgraph browser["Browser"]
        UI["Next.js 16 · Pages Router<br/>React 19"]
    end
    subgraph next["Next server :3000"]
        SSR["getServerSideProps / getStaticProps<br/>ISR revalidate 300"]
    end
    subgraph api["Express 5 API :5000"]
        RT["routes"] --> CT["controllers"] --> MD["models<br/>parameterized SQL only"]
        MW["authMiddleware<br/>verifyIdToken then DB lookup"]
    end
    DB[("PostgreSQL<br/>plpgsql rating trigger")]
    FB["Firebase Auth<br/>identity only"]
    CL["Cloudinary<br/>images"]

    UI -->|"axios + Bearer token"| RT
    UI -->|"sign in"| FB
    SSR -->|"server-side fetch"| RT
    RT --> MW
    MW -->|"verify signature"| FB
    MW -->|"is_admin lookup"| DB
    MD --> DB
    CT -->|"upload"| CL
```

**The arrow that matters is `MW -> DB`.** Firebase answers _who_ this is; the database answers _what
they may do_. Those were the same question once, and that was the original defect (`IMP-002`).

```bash
EasyTrip/
├── backend/                    # Node.js + Express API
│   ├── app.js                  # Entry point: CORS, routes, health check, pg pool
│   ├── script/                 # make-admin.js (grant admin), migrate.js (the migration runner)
│   ├── tests/                  # Jest + supertest, against a real PostgreSQL
│   └── src/
│       ├── config/
│       │   ├── migrations/     # Numbered, checksummed .sql — the upgrade path
│       │   ├── schema.sql      # The fresh-database path
│       │   └── seed.js         # Deterministic fixtures, shared by tests and `npm run seed`
│       ├── controllers/        # Request handling / business logic
│       ├── models/             # SQL data access (parameterized queries)
│       ├── routes/             # Express routers
│       ├── services/           # Outbound integrations (weather, geocoding)
│       └── utils/              # Auth middleware & helpers
│
├── frontend/                   # Next.js app (Pages Router)
│   ├── public/                 # Static assets, manifest, service worker
│   ├── tests/                  # Jest + React Testing Library
│   └── src/
│       ├── components/         # UI components
│       ├── config/             # Firebase client config
│       ├── context/            # Auth / user context
│       ├── hooks/              # Custom hooks
│       ├── pages/              # Routes (incl. pages/api image helpers)
│       ├── services/           # API clients (axios)
│       ├── styles/             # Global styles
│       └── utils/              # Utilities
│
├── e2e/                        # Playwright journeys + the Firebase Auth Emulator harness
└── scripts/                    # Repository guards run in CI (see below)
```

`scripts/` holds the checks that keep this file and the codebase honest — module size,
credential-shaped strings, environment documentation, the theme and translation vocabularies, the
test counts quoted above, and the API route table below, which is compared against the real routers
in both directions. They are guards rather than tests: each one fails on a fact about the repository,
not on behaviour.

---

## 🔐 How an Admin Request Is Authorised

The sequence worth drawing, because it is the one this project got wrong first and the one every
`/admin` route depends on. Traced from `backend/src/utils/authMiddleware.js`, not sketched.

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser
    participant A as Express API
    participant F as Firebase Admin SDK
    participant D as PostgreSQL

    B->>A: GET /api/admin/... (Authorization: Bearer <idToken>)
    A->>A: extractToken - reject unless exactly "Bearer <token>"
    A->>F: verifyIdToken(token)
    alt signature, audience or expiry fails
        F--xA: throws
        A-->>B: 401 Unauthorized
    else verified
        F-->>A: decodedToken { uid, email, ...claims }
        A->>D: SELECT id, is_admin FROM users WHERE firebase_uid = $1
        D-->>A: row or nothing
        A->>A: dbIsAdmin = row?.is_admin === true
        opt token also carries an "admin" claim
            A->>A: claim disagrees with database -> log, deny
        end
        alt dbIsAdmin
            A-->>B: 200 with the admin payload
        else
            A-->>B: 403 Admin access required
        end
    end
```

**Step 8 is the whole point.** A verified token proves _identity_; it is never consulted for
_privilege_. If a correctly-signed token asserts `admin: true` while the database says otherwise, the
request is denied **and** the disagreement is logged as a privilege inconsistency — without the uid,
because that log line is the kind that gets exported further than ordinary logs.

That distinction cannot be proved by a unit test with a mocked verifier, so it is proved by a browser
journey that mints a genuine token carrying a real `admin: true` claim through the Admin SDK against
a user whose `is_admin` is `false`, and asserts the 403.

---

## 🗃️ Database Schema

Read out of a live database — `information_schema` on a freshly migrated instance — rather than
drawn from memory. **All eighteen application tables and every one of the thirteen `REFERENCES`
clauses are here** — and `npm run check:schema-docs` fails the build if that stops being true.

`\dt` on a migrated database shows **eighteen**. The extra one is `schema_migrations`, which
`migrate.js` creates to record what it has applied; it is the runner's bookkeeping rather than part
of the schema, so it is not drawn here.

```mermaid
erDiagram
    places ||--o{ place_images : "gallery"
    places ||--o{ place_reviews : "reviewed by"
    places ||--o{ user_saved_places : "saved as"
    places |o--o{ trip_items : "planned as"
    place_reviews ||--o{ review_reports : "reported by"
    trips ||--o{ trip_days : "runs over"
    trips ||--o{ trip_notes : "annotated by"
    trips ||--o{ trip_checklist_items : "packed with"
    trips ||--o{ trip_collaborators : "shared with"
    trips ||--o{ trip_expenses : "cost"
    trip_expenses ||--o{ trip_expense_participants : "split between"
    trip_days ||--o{ trip_items : "holds"
    trips ||--o{ trip_activity : "changed by"

    places {
        serial id PK
        varchar name
        text_array themes "closed vocabulary, checked in CI"
        int rating_sum "trigger-maintained"
        int rating_count "trigger-maintained"
        varchar accessibility_source "who checked, and when"
    }
    users {
        serial id PK
        varchar firebase_uid UK "the join key, not a FK"
        boolean is_admin "the ONLY authority on privilege"
    }
    place_reviews {
        serial id PK
        int place_id FK
        varchar user_id "Firebase uid"
        int rating
    }
    trips {
        serial id PK
        varchar user_id "Firebase uid"
        date start_date
        date end_date
        varchar status "draft | upcoming | completed"
    }
    trip_items {
        serial id PK
        int trip_day_id FK
        int place_id FK "SET NULL - a deleted place leaves the plan intact"
    }
    trip_collaborators {
        serial id PK
        int trip_id FK
        varchar user_id "Firebase uid - the invitee must already have an account"
        varchar role "viewer | editor, CHECKed"
    }
    trip_expenses {
        serial id PK
        int trip_id FK
        varchar paid_by "Firebase uid"
        bigint amount_minor "integer minor units - never a float, never NUMERIC"
        char currency "ISO 4217; a mixed-currency total is refused, not converted"
    }
    idempotency_keys {
        serial id PK
        varchar idempotency_key
        char request_fingerprint "so a reused key with a different body is a conflict"
        jsonb response_body "the original answer, replayed on retry"
    }
    newsletter_subscribers {
        serial id PK
        varchar email UK
        varchar status "subscribed | unsubscribed - never deleted, so a re-subscribe is one row"
    }
    trip_activity {
        serial id PK
        int trip_id FK "CASCADE - unlike the admin log, deleting the trip should take its history"
        varchar actor_uid "who changed it"
        varchar actor_label "a copy, so the row still names them after they lose access"
        varchar action "closed vocabulary - the six mutations an editor can perform"
        jsonb detail "the day number or the item title, so a line can name what moved"
    }
    admin_audit_log {
        serial id PK
        varchar actor_uid "who acted"
        varchar actor_email "a copy, not a join - the row outlives the account it names"
        varchar action "closed vocabulary, CHECKed and mirrored in constants/auditActions.js"
        varchar target_id "a uid for a user, a numeric id for a review - one column, not two half-null ones"
        varchar outcome "succeeded | partially_applied - see below"
        jsonb detail "small, action-specific, and read by the page"
    }
```

Seven tables carry no detail block above because nothing about them is surprising: `trip_days`,
`trip_notes`, `trip_checklist_items`, `place_images`, `user_saved_places` and `review_reports` are
plain children of their parent, and `trip_expense_participants` is the expense ↔ uid join.

**Three things in that diagram are decisions rather than shapes.**

`users.firebase_uid` is a **unique key, not a foreign key**, and nothing references it. Rows in
`users` are created lazily on first authenticated request, so a review can exist before its author's
row does. The uid is the join key everywhere; `users` exists only to answer _"is this person an
admin?"_ — and `is_admin` in that table is the single authority on privilege. A token claiming
`admin: true` does not get it (`IMP-002`), and there is a browser journey that forges exactly that
claim to prove the distinction holds.

`trip_items.place_id` is the **one `ON DELETE SET NULL`** among otherwise cascading relationships.
Deleting a place should not silently delete somebody's itinerary; the day survives with a gap it can
name. Everything else cascades, because a gallery image or a saved-place row pointing at a deleted
place is a broken card rather than a record worth keeping.

`admin_audit_log` is the **only table with no foreign key at all**, and its `actor_email` and
`target_label` are deliberate copies rather than joins. _"Who deleted this account?"_ is a question
asked precisely once the account is gone, so a joined audit log goes blank at the moment it matters,
and an FK would let a cascade elsewhere delete the evidence. Its `outcome` column exists for the
same kind of reason: granting admin writes the database row and _then_ syncs the Firebase claim, so
a failed sync returns `500` while the privilege change really happened. `partially_applied` records
that, because a trail that only agrees with the HTTP status is not a control.

---

## 🏛️ Architecture Patterns

> Patterns the codebase actually uses:

- 🗂️ **Routes → Controllers → Models** – Separation of concerns in the backend; all SQL is parameterized (`$1`, `$2`, …)
- ⚛️ **Component-Based UI** – Reusable and modular React/Next.js components
- 🌐 **Context API** – Centralized global state for authentication & user data, consumed via a `useAuth()` hook
- 🧮 **Denormalized rating aggregates** – `rating_sum` / `rating_count` on `places` are kept in sync by a `plpgsql` trigger on every review write, so list pages never aggregate at read time
- 🔗 **API-First Design** – RESTful endpoints consumed by an axios service layer

---

## 🧪 Testing & Verification

Three layers, all reproducible from a clean checkout, and none of them mocked where it matters.

| Layer     | Count     | What it runs against                                                                 |
| --------- | --------- | ------------------------------------------------------------------------------------ |
| API       | **1,094** | A **real PostgreSQL**. Every suite truncates and re-seeds, so `maxWorkers: 1`        |
| Component | **807**   | React Testing Library, pinned to `TZ=America/Los_Angeles`                            |
| Browser   | **154**   | Real Chromium/WebKit + a real **Firebase Auth Emulator** — journeys actually sign in |

```bash
cd backend  && DATABASE_URL=postgresql://…/throwaway npm test   # truncates every table
cd frontend && npm test
npm run test:e2e                                                # starts the emulator itself
```

**Why the database is real.** Every interesting property in this API _is_ a property of SQL — the
trigger keeping `places.rating_sum` in step with the reviews, the `UNIQUE (place_id, user_id)` that
turns a second review into an edit, the foreign key making a review of a nonexistent place
impossible. A mocked pool would assert only that the code sends the query it was written to send.

**Why Firebase is mocked in the API suite but real in the browser suite.** The middleware asks
Firebase exactly one question — decode this token. Everything after that is EasyTrip's own logic,
and that is what is worth testing. The end-to-end suite then uses the genuine emulator, because that
is the only thing that actually proves the `firebase-admin` integration.

### Mutation testing

Tests are checked by deliberately breaking the code and confirming they notice. Each run is: green
control → pristine snapshot → **one** mutation → test → restore → **byte-identical MD5 check** →
next. A run whose restore does not verify is **discarded entirely**, not salvaged — a contaminated
run produces numbers that are worse than none.

Survivors are recorded rather than hidden, and they have twice been the most useful output: a test
asserting a call count that was true of _every possible implementation_, and an `ORDER BY` tiebreak
whose test could never have failed on a four-row table.

### The guards — claims this README cannot make falsely

Ten scripts assert properties no test covers and no build breaks on. All ten run in CI.

| Guard                  | Fails the build when                                                       |
| ---------------------- | -------------------------------------------------------------------------- |
| `check:test-counts`    | The counts above disagree with the runners' own JSON reports               |
| `check:api-docs`       | A route exists that the API table omits, or vice versa (79 today)          |
| `check:schema-docs`    | A table exists that the ER diagram omits, or vice versa (18 today)         |
| `check:env-docs`       | The server reads an environment variable this README does not document     |
| `check:themes`         | A controlled vocabulary drifts between frontend, backend, or a SQL `CHECK` |
| `check:secrets`        | A credential is tracked in git                                             |
| `check:size`           | A module passes its size budget without a reasoned waiver                  |
| `check:i18n`           | A user-facing string bypasses the translation layer                        |
| `check:bundle-size`    | The shared JS baseline or any route's own code grows past its budget       |
| `check:stack-versions` | A badge or structure file states a framework version the manifests do not  |

`check:test-counts` deliberately does **not** count `test(` calls in the source: measured once, that
approach was off by fifty because `test.each` generates more cases than there are call sites, and a
guard reliably wrong by fifty is worse than none — the first person to see it fail would "fix" the
README to match.

Accessibility is gated too: six public routes and three authenticated ones are scanned with
`axe-core` on every E2E run, **at zero violations with an empty allowlist**. Target size
(WCAG 2.5.8) has its own spec beside it, because `axe-core` deliberately does not implement that
criterion.

The allowlist was not always empty, and how it emptied is the more useful half. It held eleven
contrast waivers described as _"a design decision rather than a defect ... the palette is the
product's"_. Measuring them in Phase 14 showed that ten were **one utility on plain white** —
`text-gray-400`, `#9ca3af` on `#ffffff`, **2.53:1** against a 4.5:1 requirement — and that the same
components already used `text-gray-500` (**4.83:1**) for identical muted text a few lines away. The
palette was not being defended; one token was being used inconsistently.

The eleventh was a real choice and not the one the waiver implied: a single class was colouring the
average-rating **numeral and its star together**, so the text failed at 1.91:1. Darkening the yellow
enough to pass would have turned a gold star olive to fix a problem the star does not have. The
colour moved off the text; the star keeps the brand yellow and is marked decorative.

**And the measurement found something worse than any of them.** Each forecast day rendered an
`aria-hidden` weather glyph and nothing else — while the API had been returning `condition` for
every day since the panel was built. A screen reader announced a weekday and two temperatures, and
whether it was going to rain reached nobody (WCAG 1.1.1). The words were already there; the client
chose a glyph from the same field and dropped the string.

### Performance, measured rather than estimated

`next build`, gzipped, reproducible with `npm run check:bundle-size`:

|                                                                        | gzip                                         |
| ---------------------------------------------------------------------- | -------------------------------------------- |
| **Shared baseline** — framework, `_app`, polyfills, paid by every page | **240.6 kB**                                 |
| Route-specific code                                                    | 7.7 kB (`/login`) → 51.5 kB (`/places/[id]`) |
| First load                                                             | 248.3 kB → 292.1 kB                          |

**97% of the login page is shared bundle**, and 32% of that baseline is two libraries most routes do
not need: `framer-motion` (39.5 kB) and the Firebase client SDK (36.7 kB), both loaded on `/about`
and `/404` as readily as anywhere else. Both reductions are specified and measured; neither is done,
because changing when code loads on every page in an app with **no visual-regression coverage** is
how a passing test suite ships a page that flashes.

**There is no Lighthouse gate, on purpose.** A lab score measures the machine as much as the page —
ten-point swings between identical runs on a shared CI runner — and the numbers that would matter
most (TTFB, real cache behaviour) are properties of a deployment that does not exist yet. Gzip
length does not vary by machine, so that is what is gated. The guard was falsified by importing
`leaflet` into `_app.jsx`: the baseline moved to 282.3 kB and the build failed.

---

## 🔧 Installation & Setup

<details>
<summary>▶️ Expand Installation Guide</summary>

---

### Prerequisites

- Node.js (v18.0 or higher)
- PostgreSQL (v13 or higher) — local, or a managed instance such as Supabase / Neon / RDS
- npm or yarn
- Firebase project (Authentication + a service account for the Admin SDK)
- Cloudinary account

---

### Environment Variables

Copy the environment template for each tier and fill in real values. `backend/.env` and
`frontend/.env.local` are gitignored, and **neither should ever be committed**.

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
```

Each template documents every variable and where to obtain it. Summary:

#### Backend (`backend/.env`)

```bash
# Database — connection string used by app.js, the models, and script/make-admin.js
DATABASE_URL=postgresql://user:password@host:5432/easytrip

# DATABASE_URL is the only database variable the server reads. The discrete
# POSTGRES_HOST/PORT/USER/PASSWORD/DB set that this file used to list belonged
# to a second connection pool, and that pool was deleted when IMP-044 collapsed
# nine of them into one. They are documented in docker-compose.yml because the
# Postgres *container* takes them; nothing in backend/ does.

# Firebase Admin SDK
FIREBASE_PROJECT_ID=your_firebase_project_id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=your_firebase_client_email
FIREBASE_STORAGE_BUCKET=your_project.appspot.com

# Cloudinary Configuration
CLOUDINARY_CLOUD_NAME=your_cloudinary_cloud_name
CLOUDINARY_API_KEY=your_cloudinary_api_key
CLOUDINARY_API_SECRET=your_cloudinary_api_secret

# Server Configuration
PORT=5000
NODE_ENV=development

# Comma-separated list of browser origins allowed by CORS.
# Falls back to http://localhost:3000 outside production.
CORS_ALLOWED_ORIGINS=http://localhost:3000

# Number of reverse proxies in front of the API. Leave UNSET for local development.
# Rate limiting buckets by client IP, which behind a proxy arrives in X-Forwarded-For.
# Set this to the hop count (1 on Render/Railway/Fly/Heroku) or every request is
# attributed to the proxy's IP and one busy visitor rate-limits everyone.
# Do not guess high: trusting more hops than actually exist lets a caller spoof its
# own IP via X-Forwarded-For and defeat the limiter entirely.
# TRUST_PROXY_HOPS=1
```

> **`DATABASE_URL` is the whole database configuration.** There is exactly one `new Pool()` in the
> server, in `src/config/db.js`, and it carries the TLS settings with it — which is what made
> verifying the certificate a one-line change instead of a nine-file one.
>
> _(This paragraph used to say both `DATABASE_URL` and a `POSTGRES_*` set were required, describing
> a second pool that `IMP-044` deleted when it collapsed nine pools into one. `db.js` and
> `backend/.env.example` had both said so for weeks. Since 2026-08-16 `npm run check:env-docs`
> fails on a documented variable that nothing reads, so this particular fiction cannot come back.)_

---

#### Frontend (`frontend/.env.local`)

```bash
# API Configuration
NEXT_PUBLIC_API_URL=http://localhost:5000/api

# Firebase Configuration
NEXT_PUBLIC_FIREBASE_API_KEY=your_firebase_api_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_firebase_auth_domain
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_firebase_project_id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_firebase_storage_bucket
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_firebase_messaging_sender_id
NEXT_PUBLIC_FIREBASE_APP_ID=your_firebase_app_id
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=your_firebase_measurement_id
```

---

### Database Setup

**Option A — Docker (recommended).** Starts Postgres and creates the schema on first run:

```bash
docker compose up -d
```

The matching `DATABASE_URL` for `backend/.env` is
`postgresql://easytrip:easytrip@localhost:5432/easytrip`. To start completely over:
`docker compose down -v && docker compose up -d`.

**Option B — an existing PostgreSQL install.** Create the database and apply the schema:

```bash
createdb easytrip
psql "$DATABASE_URL" -f backend/src/config/schema.sql
```

**Then, either way, bring the schema up to date:**

```bash
npm run migrate
```

This applies every unapplied file in `backend/src/config/migrations/` and records it in a
`schema_migrations` table. It is safe to re-run — every migration is idempotent — and safe on a
database whose migrations were previously applied by hand, which it will simply record.

```bash
npm run migrate:status
```

shows what is applied and what is pending without changing anything. The server also reports
unapplied migrations at boot, read-only. See
[`backend/src/config/migrations/README.md`](backend/src/config/migrations/README.md) for the
conventions, and `ADR-025` for why there is a hand-written runner rather than node-pg-migrate.

**Optional — sample data.** A migrated database is empty, so `/browse` shows nothing and there is
very little to look at:

```bash
cd backend && npm run seed
```

Four places, three users and a set of reviews. **Everything in it is fixed** — ids, ratings,
timestamps and uids are all hardcoded, and nothing derives from the clock, because a fixture that
changes between runs turns a real regression into _"probably just the seed"_. The same fixtures back
the API suite, so what you see locally is what the tests assert against.

The four places are chosen to cover the shapes the read paths branch on rather than to look
plausible: one fully populated, one with **no coordinates**, one with **no image**, one with neither
and no reviews. That is deliberate — the states where this app has to say _"we don't know"_ are the
ones worth being able to see.

> **It re-seeds destructively**, so point it at a development database. And note the seeded users
> are **database rows, not Firebase accounts** — they exist so reviews have authors. To sign in as
> yourself and get the admin panel, create a real account through the app and then run
> `make-admin.js` below.

---

### Backend Setup

1. **Install Dependencies:**

```bash
cd backend
npm install
```

2. **Start Development Server:**

```bash
npm run dev
```

The backend will run on `http://localhost:5000`

---

### Frontend Setup

1. **Install Dependencies:**

```bash
cd frontend
npm install
```

2. **Start Development Server:**

```bash
npm run dev
```

The frontend will run on `http://localhost:3000`

---

### Creating Admin User

The user must already have signed up through Firebase Authentication. The script then flips
`users.is_admin` and sets the matching Firebase custom claim:

```bash
cd backend/script
node make-admin.js user@example.com
```

> Run it from `backend/script/`: the script loads `../.env` relative to the current working
> directory, and it requires `DATABASE_URL` plus the `FIREBASE_*` service-account variables.

---

### Production Environment Variables

Update your environment variables for production:

```bash
# Backend
NODE_ENV=production
DATABASE_URL=postgresql://user:password@your-production-host:5432/easytrip
CORS_ALLOWED_ORIGINS=https://your-frontend-domain.com
TRUST_PROXY_HOPS=1

# Frontend
NEXT_PUBLIC_API_URL=https://your-domain.com/api
```

> `CORS_ALLOWED_ORIGINS` has **no fallback in production** — if you leave it unset the server
> **refuses to boot**, rather than starting up and rejecting every browser origin. Set it to your
> deployed frontend origin.

> `TRUST_PROXY_HOPS` must be set on any platform that terminates TLS in front of the app
> (Render, Railway, Fly, Heroku — almost always `1`). Without it every request is rate-limited
> under the proxy's IP, so a single busy visitor can 429 the whole site. Setting it higher than
> the real hop count is worse than leaving it unset: a caller can then forge `X-Forwarded-For`
> and bypass rate limiting entirely.

---

### Database Backup & Schema

1. **Backup existing data:**

```bash
pg_dump "$DATABASE_URL" > backup.sql
```

2. **Apply the schema — only for a database that does not exist yet:**

```bash
psql "$PRODUCTION_DATABASE_URL" -f backend/src/config/schema.sql
```

3. **Migrate — for every deploy, including the first:**

```bash
DATABASE_URL="$PRODUCTION_DATABASE_URL" npm run migrate
```

> Run this **before** starting the new build. The server no longer patches the schema at boot; it
> reports unapplied migrations and keeps running, so a deploy that skips this step looks healthy
> until the first request touches a column that is not there.
>
> Safe to run against a database whose migrations were previously applied by hand: every migration
> is idempotent, so the first run re-applies them as no-ops and records them. `npm run migrate:status`
> shows the state without changing anything. `schema.sql` is now fully re-runnable too — its
> `CREATE TRIGGER` statements are preceded by `DROP TRIGGER IF EXISTS`, which they were not before
> Sprint 5.2.

---

### Deployment Steps

1. **Build the application:**

```bash
# Frontend
cd frontend
npm run build

# Backend
cd backend
npm install --production
```

2. **Deploy to your hosting platform:**
   - **Frontend**: Deploy to Vercel, Netlify, or similar
   - **Backend**: Deploy to Render, Railway, or a VPS
   - **Database**: Use a managed PostgreSQL service (Supabase, Neon, AWS RDS, etc.)

3. **Configure environment variables** in your hosting platform

4. **Set up domain and SSL certificates**

</details>

---

## 📚 API Documentation

### Base URL

```
http://localhost:5000/api
```

**Authentication:** there are no login/register endpoints — sign-in happens client-side through
Firebase. Protected routes expect the resulting Firebase ID token as
`Authorization: Bearer <idToken>`, which the API verifies with the Firebase Admin SDK.
Admin routes additionally require the account to be an admin (`users.is_admin`).

The tables below are the complete set of Express routes the backend actually registers —
**79 of them, and `npm run check:api-docs` fails the build if this stops being true**, in both
directions: an undocumented route and a documented-but-nonexistent one each fail it.

<details>
<summary><b>▶️ All 79 endpoints</b> — health, places, reviews, profile, trips, admin, newsletter</summary>

<br>

### Health

| Method | Endpoint  | Auth | Description               |
| ------ | --------- | ---- | ------------------------- |
| GET    | `/health` | -    | Service + database status |

### Places - public reads

| Method | Endpoint                      | Auth | Description                                                                                                                                                                                                                         |
| ------ | ----------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/places`                     | -    | List places. Filters: `searchTerm`, `location`, `district`, `state`, `tags`, `themes`, `minRating`, `date`. Paged with `limit`/`offset`, ordered by `sort`                                                                          |
| GET    | `/places/search`              | -    | The same handler under a second name                                                                                                                                                                                                |
| GET    | `/places/suggest`             | -    | Typeahead suggestions (`q`, `limit` up to 10)                                                                                                                                                                                       |
| GET    | `/places/locations`           | -    | Distinct locations                                                                                                                                                                                                                  |
| GET    | `/places/districts`           | -    | Distinct districts                                                                                                                                                                                                                  |
| GET    | `/places/states`              | -    | Distinct states                                                                                                                                                                                                                     |
| GET    | `/places/tags`                | -    | Distinct tags                                                                                                                                                                                                                       |
| GET    | `/places/:id`                 | -    | One place                                                                                                                                                                                                                           |
| GET    | `/places/:id/image`           | -    | Primary image (redirect, with an SVG placeholder fallback)                                                                                                                                                                          |
| GET    | `/places/:id/images`          | -    | Gallery images                                                                                                                                                                                                                      |
| GET    | `/places/:id/images/:imageId` | -    | Same handler as `/places/:id/image`                                                                                                                                                                                                 |
| GET    | `/trips/shared/:token`        | -    | A trip by its share token (`FV-009` stage c). The **only** read of a trip without a signed-in owner. Returns the itinerary and never the trip's notes, its checklist, the owner's uid or the token itself; `noindex` and `no-store` |
| GET    | `/places/:id/fit`             | -    | Explainable fit score for `?month=` and `?interests=`. Returns every factor that counted, every one that could not, and the **coverage** the score was computed over - `score` is `null` when nothing is known (`FV-028` stage d)   |
| GET    | `/places/:id/quieter-nearby`  | -    | Places nearby that somebody judged **quieter than this one**. Empty unless both ends have a curated crowd level - a comparison needs two known values (`FV-028` stage c)                                                            |
| GET    | `/places/:id/weather`         | -    | Live forecast for that place's own coordinates. Deliberately **not** `?lat=&lon=`, which would be an open proxy to a third party at our IP                                                                                          |
| GET    | `/places/:id/reviews`         | -    | Reviews. Soft-authenticated: your own review is flagged for the edit UI, but no author id is ever returned                                                                                                                          |

### Reviews - writes

| Method | Endpoint                               | Auth   | Description                                                                                                                |
| ------ | -------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/places/:id/reviews`                  | Bearer | Create or update your review - `{ rating: 1-5, comment }`. A second review edits the first                                 |
| DELETE | `/places/:id/reviews/:reviewId`        | Bearer | Delete a review. Authors may delete their own; **admins may delete any**, through this same route rather than a second one |
| POST   | `/places/:id/reviews/:reviewId/report` | Bearer | Report a review for moderation. Idempotent per person                                                                      |

### Profile and personal data

| Method | Endpoint                   | Auth   | Description              |
| ------ | -------------------------- | ------ | ------------------------ |
| GET    | `/auth/profile`            | Bearer | Your profile row         |
| PUT    | `/auth/profile`            | Bearer | Update your profile      |
| GET    | `/auth/check-admin`        | Bearer | Whether you are an admin |
| GET    | `/auth/reviews`            | Bearer | Your review history      |
| GET    | `/auth/favorites`          | Bearer | Your saved places        |
| POST   | `/auth/favorites`          | Bearer | Save a place             |
| DELETE | `/auth/favorites/:placeId` | Bearer | Unsave a place           |

### Trips

Days and items carry no owner of their own - every query joins up to `trips.user_id`. A second
account cannot reach them even by addressing a victim's item through its own trip id.

| Method | Endpoint                                           | Auth   | Description                                                                                                                                                                                                                                                                      |
| ------ | -------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/auth/recommendations`                            | Bearer | Places picked from the tags on what you have saved (`FV-019`). Returns `basis` (the theme profile it was computed from) and `excluded` (how many places carry no tags and so could not be considered) beside the list — neither is optional                                      |
| GET    | `/auth/trips`                                      | Bearer | Your trips                                                                                                                                                                                                                                                                       |
| POST   | `/auth/trips`                                      | Bearer | Create a trip                                                                                                                                                                                                                                                                    |
| GET    | `/auth/trips/:tripId`                              | Bearer | One trip, with its days and items                                                                                                                                                                                                                                                |
| GET    | `/auth/trips/:tripId/activity`                     | Bearer | Who changed this itinerary and when — the six mutations an **editor** can perform. Read by anyone entitled to read the trip, not by an admin (`ADR-056`): a traveller asking what their friend did to their plan is a different reader from an administrator auditing moderators |
| GET    | `/auth/trips/:tripId/feasibility`                  | Bearer | Deterministic check that the plan can be executed — day bounds, overlaps, ordering, travel time (real road distance when a routing key is configured, otherwise a labelled estimate), daylight, wet outdoor days, backtracking, duplicates. Reports; never blocks a save         |
| PUT    | `/auth/trips/:tripId`                              | Bearer | Update a trip                                                                                                                                                                                                                                                                    |
| DELETE | `/auth/trips/:tripId`                              | Bearer | Delete a trip                                                                                                                                                                                                                                                                    |
| GET    | `/auth/trips/:tripId/replan-suggestion`            | Bearer | What to change when the forecast disagrees with the plan — which outdoor stops to move off a wet day, to which drier day, and why. Every proposal is validated against the whole trip first. Proposes only; applying goes through the item endpoint                              |
| GET    | `/auth/trips/:tripId/days/:dayId/route-suggestion` | Bearer | A shorter order for one day, with the distance saved. Proposes only — applying it goes through the reorder route                                                                                                                                                                 |
| GET    | `/auth/trips/:tripId/days/:dayId/route`            | Bearer | One day as it would be drawn: its stops in list order, the leg between each pair, and what the map is leaving out. Road distance when a routing key is configured, a labelled estimate otherwise                                                                                 |
| POST   | `/auth/trips/:tripId/days`                         | Bearer | Add a day                                                                                                                                                                                                                                                                        |
| DELETE | `/auth/trips/:tripId/days/:dayId`                  | Bearer | Remove a day                                                                                                                                                                                                                                                                     |
| POST   | `/auth/trips/:tripId/days/:dayId/items`            | Bearer | Add an item to a day                                                                                                                                                                                                                                                             |
| PUT    | `/auth/trips/:tripId/days/:dayId/items/order`      | Bearer | Reorder a day. Takes the **full** order; a partial list is rejected rather than partly applied                                                                                                                                                                                   |
| PUT    | `/auth/trips/:tripId/items/:itemId`                | Bearer | Update an item                                                                                                                                                                                                                                                                   |
| DELETE | `/auth/trips/:tripId/items/:itemId`                | Bearer | Remove an item                                                                                                                                                                                                                                                                   |
| POST   | `/auth/trips/:tripId/duplicate`                    | Bearer | Copy this trip (`FV-006` stage d). Keeps the days, the stops and the checklist — **unticked**. Drops the dates, the notes and the share link, and resets the status to `draft`. One transaction: all of it or none                                                               |
| GET    | `/auth/trips/:tripId/share`                        | Bearer | Whether this trip has a share link, and when it was made (`FV-009` stage c)                                                                                                                                                                                                      |
| POST   | `/auth/trips/:tripId/share`                        | Bearer | Create the link — and **rotate** it when one already exists, which is how a link that spread too far is killed                                                                                                                                                                   |
| DELETE | `/auth/trips/:tripId/share`                        | Bearer | Revoke. There is one token, so this ends every copy of the link at once                                                                                                                                                                                                          |
| GET    | `/auth/trips/:tripId/collaborators`                | Bearer | Who else can open this trip, and your own role on it. Readable by anyone who can read the trip (`FV-007` stage a)                                                                                                                                                                |
| POST   | `/auth/trips/:tripId/collaborators`                | Bearer | Add somebody by the email they registered with, at a role (`viewer` or `editor`, default `viewer`). **Owner only, and nothing is sent** — the address is a lookup key, so an unregistered one is a 422 that says so. Upserts, so it is also how a role changes                   |
| DELETE | `/auth/trips/:tripId/collaborators/:userId`        | Bearer | Remove somebody. Owner only; their access ends immediately                                                                                                                                                                                                                       |
| GET    | `/auth/trips/:tripId/expenses`                     | Bearer | What has been spent on this trip, with who shared each expense. Readable by anyone who can read the trip (`FV-008`)                                                                                                                                                              |
| POST   | `/auth/trips/:tripId/expenses`                     | Bearer | Record an expense in minor units (paise/cents) with an ISO currency. Follows the editor rule; `participants` defaults to everybody on the trip                                                                                                                                   |
| DELETE | `/auth/trips/:tripId/expenses/:expenseId`          | Bearer | Remove one — the **owner's or the payer's**, so nobody can erase what somebody else paid for                                                                                                                                                                                     |
| GET    | `/auth/trips/:tripId/settlement`                   | Bearer | Who owes whom, derived on read. **422 for a trip with mixed currencies** — EasyTrip does not convert, because it has no exchange rate it can stand behind. Carries `optimal: false`: the transfer count is small, not provably minimal                                           |
| GET    | `/auth/trips/:tripId/calendar.ics`                 | Bearer | The trip as an RFC 5545 calendar file (`FV-009` stage a). Times are **floating** — no `Z`, no `TZID` — because `trip_items.start_time` means local wall clock. A trip with no start date is a 422, not an empty file                                                             |
| GET    | `/auth/trips/:tripId/notes`                        | Bearer | Notes on this trip, newest first (`FV-006` stage b). An unknown trip is a 404, never an empty list                                                                                                                                                                               |
| POST   | `/auth/trips/:tripId/notes`                        | Bearer | Add a note. Trimmed and length-checked before it reaches the non-blank `CHECK` constraint                                                                                                                                                                                        |
| PUT    | `/auth/trips/:tripId/notes/:noteId`                | Bearer | Rewrite a note                                                                                                                                                                                                                                                                   |
| DELETE | `/auth/trips/:tripId/notes/:noteId`                | Bearer | Delete a note                                                                                                                                                                                                                                                                    |
| GET    | `/auth/trips/:tripId/checklist`                    | Bearer | The checklist, ordered by `(position, id)`                                                                                                                                                                                                                                       |
| POST   | `/auth/trips/:tripId/checklist`                    | Bearer | Append an item; the server assigns the position                                                                                                                                                                                                                                  |
| PUT    | `/auth/trips/:tripId/checklist/order`              | Bearer | Rewrite the whole order. Declared before `:itemId` so "order" is not read as an id. An id from another trip renumbers **nothing** - a partial reorder is worse than a refused one                                                                                                |
| PATCH  | `/auth/trips/:tripId/checklist/:itemId`            | Bearer | Change the label, the tick, or both. PATCH rather than PUT so ticking a box cannot blank the label beside it                                                                                                                                                                     |
| DELETE | `/auth/trips/:tripId/checklist/:itemId`            | Bearer | Remove an item                                                                                                                                                                                                                                                                   |

### Admin

| Method | Endpoint                            | Auth  | Description                                                                                                               |
| ------ | ----------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/admin/places`                     | Admin | Create a place (`multipart/form-data`, field `image`)                                                                     |
| PUT    | `/admin/places/:id`                 | Admin | Update a place (`multipart/form-data`, field `image`)                                                                     |
| DELETE | `/admin/places/:id`                 | Admin | Delete a place                                                                                                            |
| POST   | `/admin/places/:id/images`          | Admin | Add a gallery image                                                                                                       |
| DELETE | `/admin/places/:id/images/:imageId` | Admin | Remove a gallery image                                                                                                    |
| GET    | `/admin/admins`                     | Admin | List admin accounts                                                                                                       |
| POST   | `/admin/admins`                     | Admin | Grant admin rights                                                                                                        |
| DELETE | `/admin/admins/:email`              | Admin | Revoke admin rights                                                                                                       |
| GET    | `/admin/reports`                    | Admin | Moderation queue, one row per reported review. Filter by `status`. No reporter or author id is returned                   |
| PATCH  | `/admin/reports/reviews/:reviewId`  | Admin | Resolve every open report on a review - `{ resolution }`. `409` when another moderator already did                        |
| GET    | `/admin/analytics`                  | Admin | Catalogue figures, rating distribution, daily activity (reviews/trips/reports, `days` 1–90), and places needing attention |
| GET    | `/admin/geocode`                    | Admin | Forward geocoding (`q`), paced to 1 req/s as the OpenStreetMap usage policy requires                                      |
| GET    | `/admin/audit`                      | Admin | Admin audit log, newest first. Filter by `action`. Read-only — no route edits or deletes an entry                         |

### Newsletter

| Method | Endpoint      | Auth | Description                                    |
| ------ | ------------- | ---- | ---------------------------------------------- |
| POST   | `/newsletter` | -    | Subscribe. Rate-limited to 5 attempts per hour |

### Example API Usage

```javascript
// Fetch all places (public)
const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/places`);
const places = await res.json();

// Post a review (requires a Firebase ID token)
const idToken = await auth.currentUser.getIdToken();

await fetch(`${process.env.NEXT_PUBLIC_API_URL}/places/${placeId}/reviews`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${idToken}`
  },
  body: JSON.stringify({ rating: 5, comment: 'Stunning at sunrise.' })
});
```

> The reviewer's identity is taken from the verified token on the server — it is never read from
> the request body.

---

</details>

---

## 🗺️ Data Sources & Attribution

Two third-party datasets are rendered in this product, and both carry obligations that are part of
the software rather than a footnote.

| Source                                                                 | Used for                                                                         | Licence                  | What that requires of us                                                                                                                                                                                       |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) via Nominatim | Map tiles on the explore map, and coordinates filled by the admin address lookup | **ODbL**                 | Attribution — **for the tiles and, separately, for the geocoding output.** Max 1 request/second, an identifying `User-Agent`, results cached, and **no auto-complete**, which the usage policy forbids by name |
| [Open-Meteo](https://open-meteo.com/)                                  | The forecast panel on each place page                                            | **CC-BY 4.0**, free tier | Attribution, and the free tier is **non-commercial only**                                                                                                                                                      |

Three consequences that are easy to miss:

- **Geocoding attribution is a separate obligation from tile attribution** (ODbL §4.3). It is
  satisfied per place, not site-wide: `places.coordinates_source` records which pins a geocoder
  produced, so the notice appears on those and not on the ones an admin typed. A blanket notice
  would have been one line and would have credited OpenStreetMap for coordinates it never supplied.
- **Share-alike is not triggered.** Individual geocoding results are insubstantial extracts and may
  be stored beside proprietary data; aggregating them into a database that reproduces a substantial
  part of OpenStreetMap would be a different question.
- **Open-Meteo's free tier ends at monetisation, not at a request count.** Putting an advertisement
  or a subscription on this site would breach it without a line of code changing. That is a product
  decision with an API consequence, and it is on the release checklist rather than in someone's head.

The typeahead is **not** a geocoder call — it runs against this project's own PostgreSQL, which is
why an as-you-type suggestion list is compatible with a policy that forbids auto-complete.

---

## 🔬 Known Issues & Lessons Learned

This project began as a university team project and has been rebuilt in the open. The list below is
deliberate: **the defects are more interesting than the features**, and every one of them is a thing
this codebase now has a guard against.

### The one worth leading with: authentication was broken by construction

The original build never initialised the Firebase Admin SDK on the server. It compensated with a
development bypass — a request carrying the header `x-user: AdminX` was treated as an authenticated
administrator.

That is not a bug that slipped through review. It is a **dev/prod parity failure**: the local
experience was designed around not having working authentication, so nothing in day-to-day
development ever exercised the real path, and the bypass became load-bearing. Removing it in
isolation would have turned every request into a 401; initialising the SDK in isolation would have
left the bypass live. The three fixes had to land together.

**What replaced it:** the SDK initialises at boot and the process **exits** if its service-account
variables are missing — a server that cannot verify a token refuses to start rather than 401-ing
every request in production. `users.is_admin` in PostgreSQL is the authority for admin status; a
Firebase custom claim is treated as a cache of it, and a disagreement between the two is detected
rather than trusted.

**The lesson that generalises:** a convenience that only exists in development will be relied upon,
and the more useful it is the more load it silently takes. The verification for this one is 11
forged-token attacks rejected against a booted server, plus authenticated browser journeys driving
real tokens through the Firebase Auth Emulator.

### Six defects that shipped, and how each was found

None of these were found by reading the code. Each has a guard now.

| Defect                                                                                                                        | How it was found                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `og:url` was computed from `window.location`, so it shipped as `content=""` to every crawler — the one consumer that reads it | Writing an E2E assertion against the **raw response body** rather than the hydrated DOM. A browser-based check would have passed |
| A React state handler used the spread form, so two fields set in one batch lost the first                                     | A test that filled three form fields at once. No user had hit it, because typing is one event per tick                           |
| One of five admin pages had no server-side gate                                                                               | Adding a sixth page and looking for the pattern to copy — the page I might have copied was the broken one                        |
| A test suite was quietly calling a **live** third-party service on every run                                                  | A surviving mutation that pointed at a missing assertion, which turned out to be sitting on top of the real problem              |
| A database index test passed or failed depending on which pooled connection answered                                          | A mutation run, where it failed for changes that had nothing to do with indexing                                                 |
| Two backlog items were being implemented for reasons that had stopped being true                                              | Verifying the premise before the fix, rather than only afterwards                                                                |

### The habit behind most of those: mutation testing

Load-bearing behaviour is verified by **deliberately breaking it and checking that a test fails.**
Schema changes run against a database dropped and recreated each time — `CREATE TABLE IF NOT EXISTS`
makes a migration mutation invisible against a re-used one, which cost two survived mutations before
it was understood.

The genuinely useful output is not the score. It is the **attribution**: when an assertion fails for
a mutation it has no business detecting, that assertion is passing for the wrong reason. Two of the
defects above were found exactly that way.

### Documentation decays, so some of it is enforced

Three claims in this README were false at some point _because the code improved_: an endpoint table
that fell 23 routes behind, a "not yet implemented" list that kept describing shipped features, and
a test count that only ever went up.

A document nobody can fail is a document that drifts. So the falsifiable parts are now checked in
CI — `npm run check:api-docs` compares this file's route table against the routers in both
directions, and fails on an undocumented route _or_ a documented one that does not exist.

The test count is checked the same way, and it took a second attempt to do honestly. Counting
`test(`/`it(` in the source is the obvious approach and it is wrong — it reports 455/316/78 against
the runners' actual 509/330/81, because `test.each` and generated cases produce more tests than
there are call sites, and a guard that is reliably off by fifty teaches people to edit the README
until it matches the wrong number. So `npm run check:test-counts` reads `numTotalTests` from the
runners themselves: the three suites publish what they ran, and a dedicated CI job compares all three
against the sentence above. The headline total is also checked against its own three parts, which
needs no test run and catches the likelier edit — updating one layer and forgetting the sum.

---

## 🧾 Commit & Branch Hygiene

The early history contains bulk `Add files via upload` commits — the repository was originally
managed through the GitHub web UI. That history is **kept rather than rewritten**: it is honest
about how the project started, and rewriting shared history to look tidier is a worse habit than
having an untidy beginning.

Everything since adopts:

- **Conventional commits** — `feat:`, `fix:`, `docs:`, `chore:`, `test:`, `security:`, with a scope.
- **One cohesive change per commit**, with the reasoning in the body. The body explains _why_, and
  names the alternative that was rejected — that is the part which is expensive to reconstruct later.
- **A green tree at every commit.** Each lands with its tests, and the suites are run before it.

---

## 🚀 Deployment

**Deployment** is manual. CI is not: every push runs seven jobs (see [Engineering](#-engineering)), but nothing deploys automatically on green.

- **Frontend**: Vercel
- **Backend**: Render
- **Database**: Managed PostgreSQL

No public demo URL is published here yet; the screenshots above are from a local run.

**One thing to configure wherever it lands:** the API handles `SIGTERM` by refusing new
connections, finishing in-flight requests and draining the database pool, and it gives that
**10 seconds** before closing anyway. A host whose grace period is shorter will `SIGKILL`
mid-request; Render and Fly default to 30s, Kubernetes to 30s, and Heroku to 30s, so the
default is fine — it is only worth checking if someone has tightened it. `graceful: false` in
the shutdown log line is what tells you it was not enough.

---

## 🤝 Contributing

**[`CONTRIBUTING.md`](CONTRIBUTING.md) is the working manual** — setup in the order that works,
which test layer to reach for, the repository guards, and the house rules that are not obvious from
the code. Its goal is that you never have to ask a question to get from clone to pull request; a step
that needed one is a bug in that file.

The short version:

1. Fork the repo
2. Create a branch: `git checkout -b feat/amazing-feature`
3. Make the change **with its tests**, and run the suites for the tiers you touched
4. Commit in the conventional style described in
   [Commit & Branch Hygiene](#-commit--branch-hygiene) — `feat(scope): what changed`, with the
   _why_ and the rejected alternative in the body
5. Push the branch and open a Pull Request

Before pushing:

```bash
npm run lint          # all three tiers
npm run check:size    # no module over 500 lines outside the recorded waivers
npm run check:api-docs # this README's route table still matches the routers
npm run check:env-docs # the .env.example files still match what the code reads
```

_(Step 3 previously read `git commit -m "Add amazing feature"` — boilerplate that contradicted the
commit-hygiene section two headings below it. Corrected 2026-08-16.)_

---

## 📄 License

**MIT** — see [`LICENSE`](LICENSE).

All three `package.json` manifests declare `MIT` and the `LICENSE` file is present, so the
declaration and the file finally agree. They did not until now: the manifests said `ISC`, there was
no licence file at all, and an earlier version of this README claimed MIT — three different answers
to one question, which in practice meant nobody could reuse the code with confidence.

---

## 📞 Contact

EasyTrip is a **two-person team project**, not the work of a single author.

**Project Maintainers**  
👤 Dharmendra — [@dharmendra23101](https://github.com/dharmendra23101)  
👤 Mukund Thakur — [@Mukund934](https://github.com/Mukund934)

---

## 🧭 Roadmap

Near-term work is listed in [Not Yet Implemented](#-not-yet-implemented). The items below are
longer-term and **not started**.

### Next

- [x] **Itinerary feasibility** — shipped. It checks a planned day and says what does not fit,
      before any AI is allowed to generate one: the validator comes first precisely so a generated
      itinerary can be _checked_ rather than trusted. Travel times are estimates until a routing
      provider lands, and they say so
- [x] **Daylight-aware scheduling** — shipped. An outdoor stop scheduled before sunrise or after
      sunset is flagged, from the day's own coordinates and date. It stays quiet about a place
      nobody has classified and about any date past the forecast's seven-day horizon — an absent
      reading produces an absent finding, never an assumed one
- [x] **Weather-aware planning, the deterministic half** — shipped. A day the forecast says will be
      wet, carrying stops that are outdoors, is flagged with the stops named. That is the evidence a
      replanning proposal has to cite; proposing the move itself is the next stage, and it needs no
      model either
- [x] **Real road distances** — shipped, and optional. With an OpenRouteService key the travel-time
      check reports a measured road distance instead of a straight line inflated by a guess, and
      stops calling itself an estimate. Without one, nothing changes and nothing is requested
- [x] **Weather replanning** — shipped, as a proposal. When the forecast says a day will be wet and
      stops on it are outdoors, the app says which to move and to when, with the forecast either
      side. It proposes and never applies, and it says why it left things alone
- [ ] **Route optimisation** — reorder a day's stops to cut the backtracking, and show what changed
- [ ] **Collaborative trips** — invites, roles, and proposals rather than a shared password
- [ ] **Budget and expense splitting** — minimal-transaction settlement
- [ ] **Multi-language** — blocked on translation content, not on the mechanism
- [ ] **A live demo** — with working auth and seeded data

### Later, and deliberately vaguer

- [ ] Retrieval-grounded trip planning, with an evaluation harness built **before** the feature it
      measures
- [ ] Semantic search over the catalogue (`pgvector` on the database that already exists)
- [ ] Mobile app

### Ruled out

- **Autonomous booking or purchasing agents.** Spending someone's money without a human in the loop
  is not a feature this project wants, at any level of model quality.

> **This list used to advertise four things that had already shipped** — trip planning, offline
> support, weather, and a travel-content surface — because a roadmap decays every time an item lands
> and nothing fails when it does. Same failure as the
> [Not Yet Implemented](#-not-yet-implemented) table, same fix: it is a release-checklist item.

---

✨ _Happy Traveling with EasyTrip!_ 🌍✈️
