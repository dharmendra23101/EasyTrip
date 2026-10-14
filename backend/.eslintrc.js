/**
 * Backend lint configuration (IMP-097).
 *
 * The backend had none at all. `.eslintrc.js` rather than `.eslintrc.json` because the rationale
 * below is worth keeping next to the rules, and ESLint 8 rejects unknown top-level keys — a `"//"`
 * comment property is a config error, not a comment.
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
    // Express error middleware must declare four parameters to be recognised as error middleware,
    // and route handlers routinely ignore `next` — flagging those would train people to ignore
    // this rule rather than fix anything.
    'no-unused-vars': [
      'warn',
      {
        argsIgnorePattern: '^(_|next$)',
        varsIgnorePattern: '^_',
        ignoreRestSiblings: true
      }
    ],

    // ON as of IMP-071 (Sprint 5.3), which is what the previous "deliberately off for now" note
    // was waiting for. Application code logs through `src/utils/logger.js`; a `console.*` call in
    // `src/` or `app.js` now means someone bypassed the logger, and with it the redaction of
    // Authorization headers and secrets. An error, not a warning — the whole value of routing logs
    // through one module is lost the moment there are two ways to log.
    //
    // The two exemptions are in `overrides` below, each with its reason.
    'no-console': 'error',

    'no-empty': ['error', { allowEmptyCatch: true }]
  },

  overrides: [
    {
      // CLI tools. Their stdout IS the user interface — a person runs `npm run migrate` and reads
      // the result. Structured JSON would make that output worse, and these do not run inside the
      // server process, so nothing collects their logs anyway.
      files: ['script/**/*.js'],
      rules: { 'no-console': 'off' }
    },
    {
      // Environment validation runs before the application exists, and its output is a
      // multi-line remediation message a human reads in a terminal or a failed-deploy log. It also
      // deliberately has no dependencies — including on the logger — so that a broken environment
      // reports itself rather than failing inside whatever the logger needs.
      files: ['src/config/env.js'],
      rules: { 'no-console': 'off' }
    },
    {
      // The API suite (IMP-092). `env: { jest: true }` declares describe/test/expect/jest rather
      // than switching `no-undef` off — the rule is the one that caught four missing imports
      // during the Sprint 5.14 controller split, and a test file is exactly where a typo'd
      // identifier should still fail.
      files: ['tests/**/*.js'],
      env: { jest: true },
      rules: {
        // A test's output is Jest's reporter, not a log stream.
        'no-console': 'off'
      }
    }
  ],

  ignorePatterns: ['node_modules/', 'tmp/']
};
