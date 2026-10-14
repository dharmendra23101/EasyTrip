/**
 * Root lint configuration — the workspace files the tiers do not own (`TD-021`).
 *
 * `backend/` and `frontend/` each carry their own config and are linted by their own scripts —
 * `backend/.eslintrc.js` on ESLint 8, and, since the Next 16 upgrade, `frontend/eslint.config.mjs`
 * in flat format on ESLint 9 (`next lint` was removed in 16, so that tier had no choice).
 *
 * What nothing covered until now was everything *between* them: `e2e/`, `scripts/` and
 * `playwright.config.js`. That is roughly 600 lines of JavaScript — including the code that
 * provisions a database and starts a server — with no static checking at all.
 *
 * This is the same gap `TD-007` described (a lint config nothing loaded) and the same one Sprint
 * 6.2 closed for `frontend/tests`, where `next lint` turned out to walk only its default
 * directories. A directory nothing checks is where a mistake lives longest, and this repo has
 * already paid for that twice.
 *
 * **`root: true` and the ignore list matter.** Without them ESLint would walk up into the tier
 * configs, or this config would apply to files that already have one — two configs disagreeing
 * about the same file is worse than one config missing it.
 */
module.exports = {
  root: true,

  env: {
    node: true,
    es2022: true
  },

  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'script'
  },

  extends: 'eslint:recommended',

  rules: {
    // The rule this config mainly exists for. These files run a database, spawn a server and tear
    // both down — a typo'd identifier in an error path would surface as a mysterious hang in CI
    // rather than as an error.
    'no-undef': 'error',

    'no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }
    ],

    // Deliberately allowed here, unlike the backend: `global-setup.js` and
    // `check-module-size.mjs` report progress and failures to a terminal. That IS their output.
    'no-console': 'off',

    // An empty catch is how "not on PATH, fall through" and "already stopped" are expressed in the
    // teardown. Each one carries a comment saying so, which `allowEmptyCatch` permits.
    'no-empty': ['error', { allowEmptyCatch: true }]
  },

  overrides: [
    {
      // `scripts/` is ESM (`.mjs`), the rest of the workspace is CommonJS.
      files: ['scripts/**/*.mjs'],
      parserOptions: { sourceType: 'module' }
    },
    {
      // Playwright's `test`/`expect` are imported rather than global, so no extra env is needed —
      // but the specs do use `Buffer` and the Node globals, which `env.node` already supplies.
      files: ['e2e/**/*.spec.js'],

      /**
       * A spec file is two runtimes in one file. Its body is Node, but the callback passed to
       * `page.evaluate()` is serialised and executed *in the browser*, where `window` and
       * `document` are the whole point. ESLint sees one flat file and cannot tell the two apart.
       *
       * **Why not `env: { browser: true }`.** That is the usual answer and it is too broad here: it
       * would declare roughly a thousand globals, including bare `name`, `length`, `status`,
       * `close`, `open` and `event`. This config exists to make a typo'd identifier an error rather
       * than a mysterious CI hang — and every one of those names is a plausible typo that would
       * then resolve silently. Two names, declared explicitly, keep `no-undef` sharp everywhere
       * else. Anything a future spec genuinely needs gets added here deliberately.
       *
       * Scoped to `*.spec.js` on purpose: `global-setup.js` and `auth-emulator.js` are pure Node,
       * and `window` appearing in one of them is a real error that must stay caught.
       */
      globals: {
        window: 'readonly',
        document: 'readonly',
        // Added deliberately, as the paragraph above asks. `touch-target.spec.js` reads
        // `getComputedStyle` inside `page.evaluate` to skip controls that are hidden rather than
        // small — a distinction `getBoundingClientRect` alone cannot make.
        getComputedStyle: 'readonly'
      },

      rules: {
        // A spec that builds a locator and never asserts on it is a real mistake, but the pattern
        // `const x = page.locator(...)` used only inside `expect(x)` reads as unused to ESLint in
        // some shapes. Kept as an error anyway — there are no such cases today, and a warning
        // nobody reads is the thing this file exists to prevent.
        'no-unused-vars': 'error'
      }
    }
  ],

  // Everything with its own config, plus build output and dependencies. This file must not reach
  // into a tier that already declares its own rules.
  ignorePatterns: [
    'node_modules/',
    'backend/',
    'frontend/',
    'test-results/',
    'playwright-report/',
    'docs/',
    '*.md'
  ]
};
