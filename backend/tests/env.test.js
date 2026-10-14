const { collectEnvProblems } = require('../src/config/env');

/**
 * Environment validation (IMP-100), and one security property in particular.
 *
 * `collectEnvProblems` is exported separately from `validateEnv` precisely so it can be exercised
 * without spawning a process — `validateEnv` calls `process.exit(1)`, which would take the test
 * runner with it.
 */

/** A complete, valid production environment. Each test breaks exactly one thing. */
const productionEnv = () => ({
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://user:pass@db.example.com:5432/easytrip',
  FIREBASE_PROJECT_ID: 'easytrip',
  FIREBASE_CLIENT_EMAIL: 'sa@easytrip.iam.gserviceaccount.com',
  FIREBASE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----\n',
  CLOUDINARY_CLOUD_NAME: 'easytrip',
  CLOUDINARY_API_KEY: 'key',
  CLOUDINARY_API_SECRET: 'secret',
  CORS_ALLOWED_ORIGINS: 'https://easytrip.example.com'
});

describe('the production environment gate', () => {
  test('a complete production environment passes', () => {
    // The control. Without it, a test asserting "this env is rejected" could be passing because the
    // fixture was broken for some unrelated reason.
    expect(collectEnvProblems(productionEnv()).errors).toEqual([]);
  });
});

describe('FIREBASE_AUTH_EMULATOR_HOST must never reach production', () => {
  /**
   * Why this is a security test and not a config nicety.
   *
   * The Firebase Admin SDK reads this variable itself. When it is set, `verifyIdToken()` stops
   * verifying signatures and accepts anything the named emulator would issue — the emulator mints
   * `alg: none` tokens on request. Setting it against a real deployment disables authentication
   * entirely, with no code change and nothing in the logs to say so.
   *
   * The E2E suite uses it deliberately (`TD-020`), which is exactly why the guard exists: it is now
   * a value that lives in a test environment and could be copied into a real one.
   */
  test('production refuses to start when it is set', () => {
    const { errors } = collectEnvProblems({
      ...productionEnv(),
      FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099'
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/FIREBASE_AUTH_EMULATOR_HOST/);
    // The message has to say *why*, not just "unset it" — the reader needs to know an unset
    // variable is the difference between verified and forged tokens.
    expect(errors[0]).toMatch(/signature/i);
  });

  test('an empty value is not treated as set', () => {
    // A shell exporting `FIREBASE_AUTH_EMULATOR_HOST=` yields an empty string, which the SDK
    // ignores. Refusing to boot on that would be a false alarm.
    expect(
      collectEnvProblems({ ...productionEnv(), FIREBASE_AUTH_EMULATOR_HOST: '' }).errors
    ).toEqual([]);
    expect(
      collectEnvProblems({ ...productionEnv(), FIREBASE_AUTH_EMULATOR_HOST: '   ' }).errors
    ).toEqual([]);
  });

  test('it is allowed outside production, which is what the E2E suite needs', () => {
    for (const nodeEnv of ['test', 'development', undefined]) {
      const { errors } = collectEnvProblems({
        ...productionEnv(),
        NODE_ENV: nodeEnv,
        FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099'
      });
      expect(errors.filter((e) => /FIREBASE_AUTH_EMULATOR_HOST/.test(e))).toEqual([]);
    }
  });
});
