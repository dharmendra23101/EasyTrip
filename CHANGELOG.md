# Changelog

All notable changes to EasyTrip are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **No version has been tagged yet.** `v1.0.0` is gated on a live deployment and a manual QA pass
> against the production URL — see `docs/RELEASE_CHECKLIST.md`. Everything below is therefore
> `Unreleased`, and this file starts here rather than being back-filled: reconstructing 250 commits
> of history into release notes after the fact would produce a document that looks authoritative and
> is partly guesswork. The git log is the record for everything before this file existed.

## [Unreleased]

### Added

- **Travel preference profile** (`FV-020`) — interests, budget band, travel pace, party type and
  dietary needs on the profile, as typed and `CHECK`-constrained columns rather than a JSONB blob.
  Every scalar is nullable with no default, because _not said is not a default_: someone who has
  never opened the form has not told us they want a mid-range, balanced, solo trip.
- **Collaborative trips** (`FV-007`) — invite by email as a lookup against an existing account,
  with `viewer` and `editor` roles enforced in SQL rather than in handlers.
- **Trip expenses and settlement** (`FV-008`) — money as integers in minor units throughout;
  mixed-currency totals are refused rather than converted, because an exchange rate is a fact about
  a moment this project has no source for.
- **Personalised recommendations** (`FV-019`) — ranked by theme overlap with saved places, with
  untagged places excluded and the exclusion count shown on screen.
- **Idempotency keys** on the five creating endpoints, so a retried write stays one write.
- `CODE_OF_CONDUCT.md`, `SECURITY.md`, this changelog, and issue/PR templates.
- A **dependency-advisory CI gate** at `high` across all three workspaces, dev dependencies
  included.
- `check:themes` now guards the four preference vocabularies across frontend, backend **and** the
  `CHECK` constraints in migration 021.
- **Slow-request and pool-saturation signals** (`FV-021`, part) — a request over a threshold
  (`SLOW_REQUEST_MS`, default 1000) is logged at `warn` instead of `info`; a slow `/api/health`
  check is deliberately not demoted to `debug` like a fast one. A pool connect-timeout now
  carries the pool's occupancy, which is what distinguishes an exhausted pool from an
  unreachable database — the error message alone does not.
- **Crash and shutdown handling** (`FV-021`, part) — uncaught exceptions, unhandled rejections
  and `SIGTERM`/`SIGINT` now go through the same structured logger as everything else, instead
  of Node printing an unstructured stack to stderr and a signal logging nothing at all.
  Shutdown stops accepting connections, drains the database pool under a deadline, and records
  whether it completed gracefully. Error monitoring (`ADR-020`) and uptime/performance
  dashboards remain out of scope until a vendor is chosen and something is deployed.
- **Analytics & monitoring page** (`FV-022`) — daily activity across reviews, trips and
  moderation inflow; the full rating distribution rather than only its average; and the specific
  places left to finish, each linking to that place. Two of these datasets were already being
  computed on every dashboard load and rendered nowhere. The chart is `aria-hidden` decoration
  over a real table, so the information is not visual-only, and no charting dependency was
  added.
- **Admin audit log** (`PE-013`, half of `FV-023`) — privilege changes, moderation decisions and
  admin review deletions, written in the same transaction as the action they record so an
  unlogged `is_admin` flip cannot happen. Read-only, with no route that edits or deletes an
  entry. Feature flags — the other half of `FV-023` — are deliberately deferred; see
  `ADR-056`.

### Fixed

- `BUG-060` — a place added six hours ago rendered as "Yesterday", and the `'Today'` branch was
  unreachable in every real render. `Math.ceil` over a millisecond difference rounded any elapsed
  time up to a whole day.
- `BUG-062` — a dropped request during profile load caused the **next save to erase the stored
  profile**. The form submits cleared preferences as explicit empty values, which made the un-loaded
  state indistinguishable from a deliberate wipe.
- `fast-uri` high-severity advisories (host confusion, SSRF) reachable via `firebase-tools`.

### Changed

- `GET /admin/analytics` returns `activity` as `{ date, reviews, trips, reports }` rather than
  `{ date, count }`. `count` never said what it counted, which was survivable with one series.

- README restructured around a 30-second read: what it is, why it might be credible, and how to run
  it, before the deep reference material. Its test counts are now guarded in **four** places rather
  than one.
- `BUG-061` renumbered from a duplicate `BUG-060` in the defect register.

[Unreleased]: https://github.com/Mukund934/EasyTrip/commits/main
