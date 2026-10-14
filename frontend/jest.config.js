/**
 * Jest configuration for the component and unit suite (IMP-093).
 *
 * Built on `next/jest` rather than a hand-rolled Babel setup. The compiler that transforms these
 * tests is then *the same SWC pipeline `next build` uses*, with the project's `next.config.js`,
 * JSX runtime, path aliases and CSS-module stubs already wired. A separate Babel config would be a
 * second definition of "how this project compiles", and the two would drift — which is the class of
 * problem `TD-007` (a lint config nothing loaded) already cost this repo once.
 *
 * Unlike the backend suite there is no `maxWorkers: 1` here: nothing shares a database, so the
 * files are independent and parallelism is free.
 */
const nextJest = require('next/jest');

const createJestConfig = nextJest({ dir: './' });

/** @type {import('jest').Config} */
const customJestConfig = {
  testEnvironment: 'jest-environment-jsdom',
  // Two stages, deliberately: the time zone must be set before any module is evaluated, the DOM
  // matchers only need to exist before the first assertion.
  setupFiles: ['<rootDir>/jest.env.js'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],

  // Mirrors `backend/tests` so both tiers are found in the same place by the same convention.
  testMatch: ['<rootDir>/tests/**/*.test.{js,jsx}'],

  // `jsconfig.json` declares `@/*` -> `./src/*`. next/jest reads that, but declaring it here too
  // keeps the mapping true if a test is ever run outside the Next pipeline.
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1'
  },

  collectCoverageFrom: [
    'src/**/*.{js,jsx}',
    '!src/**/*.config.js',
    // A 1,013-line exported CSS string with no branches; see IMP-121.
    '!src/components/map/mapStyles.js'
  ]
};

module.exports = createJestConfig(customJestConfig);
