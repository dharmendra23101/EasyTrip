/**
 * Jest configuration for the API suite (IMP-092).
 *
 * `maxWorkers: 1` is deliberate and not a performance oversight. Every suite truncates and
 * re-seeds the same database in `beforeEach`, so two workers would wipe each other's fixtures
 * mid-test and produce failures that depend on scheduling. Parallelism here would need one
 * database per worker, which is a real option later — but a fast suite that lies is worse than a
 * slow one that does not.
 */
module.exports = {
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/tests/setup/env.js'],
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  maxWorkers: 1,
  // Surfaces a leaked pool or listener as a failure rather than a hang.
  detectOpenHandles: true,
  forceExit: false,
  testTimeout: 20000,
  collectCoverageFrom: ['src/**/*.js', '!src/config/seed.js']
};
