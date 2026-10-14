<!--
  Keep this short. The detail belongs in the commit message, which is where it stays readable in
  two years — CONTRIBUTING.md §5 has the house style and it is stricter than most.
-->

## What this changes

<!-- One or two sentences. What behaviour is different after this than before it? -->

## Why

<!--
  The reasoning, not the restatement. If there was a tempting simpler approach that turned out to be
  wrong, say what it was — that is usually the most useful paragraph in the whole PR.
-->

## Related

<!-- `IMP-xxx`, `BUG-xxx`, `TD-xxx`, `FV-xxx`, or an issue number. "None" is a fine answer. -->

---

## Verification

Tick what you actually ran. **An unticked box is fine; a wrongly ticked one is not** — this project
would rather read "I could not run the browser suite" than find out later that green was assumed.

- [ ] `cd backend && npm test` — API suite (needs a throwaway `DATABASE_URL`)
- [ ] `cd frontend && npm test` — component suite
- [ ] `npm run test:e2e` — browser journeys
- [ ] `npm run lint` and `npm run format:check`
- [ ] The repository guards: `check:size`, `check:secrets`, `check:api-docs`, `check:test-counts`,
      `check:themes`, `check:i18n`, `check:env-docs`

**Anything you could not run, and why:**

<!-- e.g. "E2E: the Auth Emulator would not start on this machine (ENV-001)." -->

## If this changes behaviour

- [ ] A test fails without the change — not just passes with it
- [ ] If a test was **mutation-checked**, say which mutation and whether it was killed. A survivor
      is a legitimate result; record it and say why it is equivalent, rather than deleting it
- [ ] Documentation that names the old behaviour has been updated — the README's API table, the
      environment docs and the test counts are all CI-enforced, so drift fails the build

## If this adds a claim

Anything a reader could check — a count, a supported feature, a guarantee — should either be
measured or labelled as planned. `check:api-docs`, `check:env-docs` and `check:test-counts` exist
because three README numbers had each been wrong at least once.
