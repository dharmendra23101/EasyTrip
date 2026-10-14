# Component and unit suite

Jest + React Testing Library in jsdom (`IMP-093`). The backend's counterpart is
`backend/tests/README.md`.

## Running them

```bash
cd frontend && npm test
```

No database, no service container, no environment variables. Firebase is mocked at the module
boundary; everything else under test is either a pure function or a component rendered into jsdom.

## Why the suite does not run in UTC

`npm test` pins `TZ=America/Los_Angeles` through `cross-env`, and that is the most important line in
the configuration.

`dateFormat.js` names `timeZone: 'UTC'` on every call because `BUG-046` was a value rendering one
day early for everyone behind UTC. **If the suite ran in UTC, deleting that option would change
nothing and every test would still pass** — and CI runs in UTC, so the bug would ship. Los Angeles is
far enough behind that a UTC-midnight timestamp falls on the previous day, month _and_ year locally,
which is exactly the condition the formatters must be immune to.

`dateFormat.test.js` opens with a test asserting the effective zone is not UTC — a guard on the
guard. It earned its place immediately: it caught that assigning `process.env.TZ` from a setup file
has no effect on Windows, which had the whole suite passing for the wrong reason.

## How it is put together

| File             | Role                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------ |
| `jest.config.js` | Built on `next/jest`, so tests compile through the same SWC pipeline as `next build` |
| `jest.env.js`    | `setupFiles` — anything that must exist before a module is evaluated                 |
| `jest.setup.js`  | `setupFilesAfterEnv` — jest-dom matchers and an `IntersectionObserver` stand-in      |

**Why `next/jest` rather than a Babel config.** A hand-rolled Babel setup would be a second
definition of "how this project compiles", and the two would drift. `next/jest` reuses
`next.config.js`, the JSX runtime, the `@/*` alias from `jsconfig.json` and the CSS-module stubs.
`TD-007` — a lint config nothing could load — is what that class of drift costs.

**Why there is no `maxWorkers: 1`.** Unlike the API suite, nothing here shares a database, so the
files are independent and parallelism is free.

## What is covered

| Suite                       | Locks in                                                                                                                           |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `browseFilters.test.js`     | `IMP-011`/`IMP-070` — the shared-link round trip, `undefined`-not-empty-string criteria, the shallow-copy bug in `EMPTY_FILTERS`   |
| `ReviewForm.test.jsx`       | `BUG C1` — `onSubmit` gets `{rating, comment}`, not the DOM event; star clicks reach the handler; the `IMP-081` radio semantics    |
| `dateFormat.test.js`        | `BUG-046` — the timezone pin, and three distinct empty-input contracts                                                             |
| `rating.test.js`            | `BUG M-2` — unrated is `null`, never `0`                                                                                           |
| `placeImage.test.js`        | `BUG M-1` — a gallery-only place resolves to its gallery image                                                                     |
| `AuthContext.test.jsx`      | `BUG C1 defect 1` — the provider publishes every name its consumers destructure                                                    |
| `PlaceCard.test.jsx`        | That the card _uses_ the shared helpers rather than hand-rolling them again                                                        |
| `isrContracts.test.js`      | `TD-018` — what `getStaticProps`/`getStaticPaths` hand to Next: ISR intervals, the error retry, `notFound` **with** `revalidate`   |
| `useManagePlaces.test.jsx`  | `TD-018`/`IMP-038` — the admin list walks every page, and reports it when the runaway cap stops it early                           |
| `placeFormSteps.test.jsx`   | `IMP-125` — the wizard's in-flight panel names only services the request uses, and the shared step navigation points where it says |
| `reviewAvatarSink.test.jsx` | `SECURITY_AUDIT` L8 — a review author avatar is never rendered as an image, in any form                                            |
| `useWishlist.test.jsx`      | `IMP-108` — the seam between two storage backends: the signed-out key contract, restore-before-write, the one-shot sign-in import  |
| `savedPage.test.jsx`        | `IMP-108`/`IMP-031` — empty, loading and failed-to-load are three distinct states; "nothing saved yet" never renders over an error |
| `myReviews.test.jsx`        | `IMP-117` — a failed _delete_ keeps the list on screen; a failed _load_ replaces it. Two errors, two treatments                    |
| `trips.test.jsx`            | `IMP-109` — the three states, a non-optimistic delete, and the end-before-start guard that fires while typing                      |
| `placeWeather.test.jsx`     | `IMP-110` — the negative assertions: no degree sign appears anywhere in the unavailable state                                      |

The component tests are deliberately weighted toward **contracts between modules**, because that is
where this codebase's worst bugs lived: every helper was correct and the callers each reimplemented
them wrongly.

## What it does not cover

- **End-to-end flow.** Nothing drives a real browser across pages, so a break _between_ correct
  units is still invisible. That is `IMP-094`.
- **Page components as rendered trees.** `browse`, `places/[id]` and the admin pages are not
  rendered here. Their _data_ functions are (`isrContracts.test.js`) and so are their hooks
  (`useManagePlaces.test.jsx`), but nothing asserts the markup those pages produce; that is the E2E
  suite's job.
- **Visual regression.** Nothing asserts layout or styling. `placeFormSteps.test.jsx` compares two
  step components' navigation classes _against each other_, which catches drift between the copies —
  it does not know whether either is correct.
- **The real Firebase SDK.** Mocked at the module boundary, exactly as far as the contract needs.

## One known console warning, deliberately left alone

`ReviewForm.test.jsx` prints `An update to ReviewForm inside a test was not wrapped in act(...)`.
It is noise, and it is not hiding anything: `user.click` on a star dispatches a pointer _move_ on
the way in, `onMouseEnter` sets `hoverRating`, and `@testing-library/user-event` 14.5.2 does not
route that particular internal dispatch through React's act environment. `hoverRating` is
purely visual, no assertion depends on it, and all 16 assertions in the file pass.

Both available remedies are worse than the warning. Restructuring the test to avoid pointer movement
would stop exercising the click, which is the behaviour under test; upgrading `user-event` to chase
a cosmetic message would move a dependency for no behavioural gain. **Recorded here rather than
silently skipped**, so the next person does not spend an afternoon on it.

## Assertion style

Prefer the accessible query (`getByRole`, `getByLabelText`) over test ids or class names: it asserts
what a user or a screen reader can actually reach, and it is what caught the `IMP-081` radio-group
regression. Avoid asserting implementation details — `placeImage.test.js` checks that a thumbnail is
_not_ the raw URL rather than matching an exact Cloudinary transform string, because the transform
format is `cloudinaryHelper`'s contract, not the caller's.
