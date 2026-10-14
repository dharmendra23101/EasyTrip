import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import globals from 'globals';

/**
 * Frontend lint configuration, flat format (`IMP-097`, migrated for Next 16 / ESLint 9).
 *
 * The `.eslintrc.js` this replaces ended with a promise: *"When the project moves to Next 15 /
 * ESLint 9 (`IMP-075`), this becomes a flat config for real."* This is that. It is also **forced**
 * rather than chosen — `next lint` was deprecated in Next 15 and **removed in 16**, taking the
 * `--dir` flag the lint script depended on with it, so `package.json` now calls `eslint` directly.
 *
 * **Root and backend deliberately stay on `.eslintrc.js`.** Both are still on ESLint 8, which does
 * not require flat config, and converting them would mean re-verifying lint across a tier this
 * change does not otherwise touch. Two config formats in one repository is a smell worth naming,
 * and it is the smaller cost — the alternative is folding an unrelated tier into a Next upgrade
 * that `FRAMEWORK_UPGRADE_PLAN` §5 says to do alone.
 *
 * `eslint-config-next@16` **ships flat config natively**, so it is imported directly rather than
 * wrapped in `FlatCompat` — the compat shim fails on it with a circular-structure error, because it
 * is trying to normalise something that is already in the target format. Every rule below is the one
 * it replaced, with its reasoning intact: a lint config that loses its comments in a format
 * migration is one nobody can argue with afterwards.
 */

export default [
  {
    // Flat config replaces `ignorePatterns`, and unlike it, `ignores` in a config object with no
    // other keys applies globally.
    ignores: ['node_modules/**', '.next/**', 'out/**', 'build/**', 'next-env.d.ts']
  },

  ...nextCoreWebVitals,

  {
    files: ['**/*.{js,jsx,mjs}'],
    languageOptions: {
      // Needed by `no-undef` below, and only by it: without globals the rule cannot tell `window`
      // or `localStorage` from a typo. `next/core-web-vitals` sets a parser but no globals, because
      // it never enables a rule that needs them.
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2022
      }
    },
    rules: {
      // ON as of IMP-070 (Sprint 5.8), after a real defect got through: the browse page called
      // `setRecentSearches` — a setter that had been replaced by a hook two commits earlier and no
      // longer existed. `next build` compiled it, `next lint` passed it, and the SSR suite missed it
      // because the reference sits inside an onClick that only renders once the browser has search
      // history. It would have thrown on the first click.
      'no-undef': 'error',

      // The rule that would have caught the dead imports Sprint 5.8 removed by hand.
      'no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true
        }
      ],

      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'react-hooks/exhaustive-deps': 'warn',

      // Off until the remaining raw `<img>` tags are migrated (deferred from IMP-049). Leaving it on
      // would emit 19 warnings on every run for work that is already tracked, and a lint run that is
      // always noisy is a lint run nobody reads.
      '@next/next/no-img-element': 'off',

      /**
       * The React Compiler rules — **worked through, not switched off** (`BL-146`, Sprint 8.56).
       *
       * `eslint-plugin-react-hooks` v6 arrived with Next 16 and reported **37** findings across
       * seven rules. All were pre-existing; none was upgrade breakage. They were parked here for one
       * commit with the whole list written down, on the ground that a refactor of working code does
       * not belong inside a dependency upgrade. That work is now done, and **six of the seven rules
       * are back on**, so what was fixed cannot come back:
       *
       *   - **`purity`** — `PlaceCard.jsx` called `Date.now()` during render, which made a
       *     server-rendered component's output depend on *when* it rendered. On an ISR page cached
       *     for five minutes that is a hydration mismatch waiting for a day boundary: the
       *     `BUG-044`/`BUG-046` family a third time, on the axis `no-restricted-syntax` below cannot
       *     see. Fixed as `BUG-059` — the logic moved into `dateFormat.js` as a pure function
       *     taking `now`, which also pays off half of what that module's header calls "the rest of
       *     `IMP-122`".
       *   - **`immutability` ×2** — `ExploreMap.jsx` called `useMarkerLayer` *below* the two effects
       *     that used it, so both had to omit it from their dependency arrays and carry an
       *     `exhaustive-deps` waiver explaining why the rule was wrong. It was not wrong; the
       *     ordering was. Moving one call up deleted two waivers.
       *   - **`refs`** — `useDismissable.js` wrote a ref during render. The latest-ref pattern as it
       *     is usually written, correct today because this project renders synchronously, and
       *     correct *by accident*. The write is now in an effect.
       *   - **`preserve-manual-memoization` ×2** — `useSharePlace.jsx` read a property while
       *     declaring its optional form as the dependency. The optional half was the correct one:
       *     the caller invokes the hook above its own null guard, so this was a live null-dereference
       *     resting on the callbacks not firing until a click.
       *   - **`static-components`** — the one finding that was a **false positive**, and it has an
       *     inline disable at the single line it fires on rather than the rule being left off for the
       *     whole codebase. `PlaceWeather.jsx` selects one of five module-scope icons; the rule
       *     cannot tell selecting from creating.
       *   - **`globals`** — fired only in a test probe that writes to an outer variable to capture
       *     what a context published. That is what a probe is for, so the rule is on for `src` and
       *     off for `tests/` in the block below — scoped, not disabled.
       */
      'react-hooks/purity': 'error',
      'react-hooks/static-components': 'error',
      'react-hooks/refs': 'error',
      'react-hooks/immutability': 'error',
      'react-hooks/preserve-manual-memoization': 'error',
      'react-hooks/globals': 'error',

      /**
       * The one that stays off, and the reason is architectural rather than an appetite question.
       *
       * **30 findings across 29 files**, every one of them the same shape: an effect that fetches
       * and calls `setState` with the result. That is not an oversight, it is `ADR-027` — which
       * measured the alternative and **decided against a data-fetching library**, because seven
       * pages already fetch their primary data in `getServerSideProps`/`getStaticProps` and a client
       * cache would sit behind an `s-maxage` contract rather than replace it.
       *
       * Clearing this rule means either adopting the library that ADR rejected, or moving to
       * `use()` and Suspense, which is an App Router shape this project deliberately does not have.
       * Turning it on today would mean 30 `eslint-disable` comments, which is a lint rule nobody
       * reads plus a diff nobody can review. Off, with the count stated, is the honest position —
       * and revisiting it means reopening `ADR-027`, not editing this line.
       *
       * **It was 29 when this block was written and the thirtieth is ours.** Fixing `BUG-059`
       * required `PlaceCard` to read the clock from state written in an effect, which is this exact
       * pattern. Worth stating rather than quietly re-counting: the rule and the fix for a real
       * hydration bug pull in opposite directions here, and the bug won.
       */
      'react-hooks/set-state-in-effect': 'off',

      /**
       * One date policy, enforced rather than agreed (`IMP-122`).
       *
       * `toLocaleDateString` and friends silently inherit **two** things from the runtime — the
       * locale and the time zone — and this project has shipped a bug from each. `BUG-044` was Node
       * rendering "1 Jan 2026" while the browser rendered "Jan 1, 2026", failing hydration on every
       * card. `BUG-046` was a UTC-midnight value showing the previous day to everyone behind UTC.
       * `BUG-058` was a third, in the same family.
       *
       * So the rule, not the intention. `utils/dateFormat.js` is the only module allowed to call
       * these, and it names both the locale and the zone every time.
       */
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'CallExpression[callee.property.name=/^toLocale(String|DateString|TimeString)$/]',
          message:
            'Use the helpers in utils/dateFormat.js — they pin the locale AND the time zone. ' +
            'Calling toLocale*String directly inherits both from the runtime, which is BUG-044 ' +
            '(hydration mismatch) and BUG-046 (date off by one) waiting to happen.'
        }
      ]
    }
  },

  {
    // The one module allowed to format a date, and the reason the rule above can be an error
    // everywhere else.
    //
    // `dateFormat.test.js` is listed for the opposite reason: it must call the **unpinned**
    // formatter to prove the pinned one gives a different answer. That assertion — "the local clock
    // says otherwise, which is the whole point" — is what stops the timezone tests from passing
    // against a fixture that was never a boundary case. Banning the raw call there would delete the
    // guard on the guard.
    files: ['src/utils/dateFormat.js', 'tests/dateFormat.test.js'],
    rules: { 'no-restricted-syntax': 'off' }
  },

  {
    // The component and unit suite (IMP-093). Declaring the jest globals rather than switching
    // `no-undef` off — the same choice the backend made, and for the same reason: a typo'd
    // identifier in a test should still fail, and `no-undef` is exactly the rule that catches it.
    //
    // Under `next lint` this directory was invisible until `--dir tests` was added to the script.
    // Flat config has no such default, and `package.json` now names both directories explicitly.
    files: ['tests/**/*.{js,jsx}', 'jest.config.js', 'jest.setup.js', 'jest.env.js'],
    languageOptions: {
      globals: {
        ...globals.jest,
        ...globals.node
      }
    },
    rules: {
      /**
       * Off **here only** (`BL-146`). `react-hooks/globals` forbids a component reassigning a
       * variable declared outside it, because in application code that is a render side effect
       * whose timing nobody controls.
       *
       * In a test it is the instrument. `AuthContext.test.jsx` renders a probe whose entire job is
       * to capture what the real provider published, and the only way out of a component is a
       * variable in the enclosing scope. Rewriting the probe to satisfy the rule would mean
       * building state plumbing to observe state plumbing.
       *
       * Scoped rather than disabled: the rule is an error across `src`, which is where the
       * behaviour it describes would actually be a defect.
       */
      'react-hooks/globals': 'off'
    }
  }
];
