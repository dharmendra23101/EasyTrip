/**
 * The Postgres TLS decision — `TD-001` / `IMP-063`, and the one line that repaid it.
 *
 * The original audit found `{ rejectUnauthorized: false }` in **production**, in five separate pool
 * configurations: encrypted, but unauthenticated, so unprotected against an active
 * man-in-the-middle. `IMP-063` replaced all of it with one pool and one decision function.
 *
 * **That function has never been tested.** `db.js` sits at 52.94%, and the uncovered block is
 * exactly `buildSslConfig`. A repaid security debt whose repair nothing guards is one careless
 * edit from being un-repaid, silently — flipping the default back changes no behaviour any other
 * suite can observe, because the whole test run is non-production and takes the `false` branch.
 *
 * **How this reads the value without changing the module.** `db.js` deliberately exports the pool
 * and nothing else — its closing comment records that exporting more once overwrote `pool.query`
 * with a function calling itself and blew the stack on the first query. So rather than widen that
 * surface, each case re-requires the module under different environment variables with
 * `jest.resetModules()` and reads `pool.options.ssl`, which is the config `pg` was actually
 * constructed with.
 */

/**
 * The logger is stubbed, for two reasons.
 *
 * The practical one: this file re-requires `db.js` under `jest.resetModules()` for every case, so
 * the real module would construct a **fresh pino instance each time**, and in a non-production
 * environment pino attaches a `pino-pretty` transport — which is a worker thread. Nothing closes
 * them, and the run ends reporting open handles. That is a warning worth keeping meaningful.
 *
 * The better one: it turns "the escape hatch is loud" from a claim in a `describe` name into an
 * assertion. The warning is the entire safety mechanism for an unverified TLS connection — if it
 * stopped being emitted, the connection would be silently unauthenticated, which is precisely the
 * state `TD-001` was about.
 */
const mockWarn = jest.fn();
jest.mock('../src/utils/logger', () => ({
  warn: (...args) => mockWarn(...args),
  info: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
  fatal: jest.fn()
}));

const ORIGINAL_ENV = { ...process.env };

/**
 * Every pool this file constructs, closed in `afterEach`.
 *
 * Nothing here connects — each pool is built and inspected — but `jest.config.js` sets
 * `detectOpenHandles`, and an unawaited `pool.end()` leaves the run reporting open workers. A
 * suite that leaves handles behind trains people to ignore that warning, which is the warning that
 * catches a real leak later.
 */
const openPools = [];

/** Build a pool under a given environment and return the ssl config `pg` received. */
const sslConfigUnder = (env) => {
  jest.resetModules();
  for (const key of ['NODE_ENV', 'DATABASE_SSL_NO_VERIFY', 'DATABASE_CA_CERT']) {
    delete process.env[key];
  }
  Object.assign(process.env, env);

  // eslint-disable-next-line global-require
  const pool = require('../src/config/db');
  openPools.push(pool);
  return pool.options.ssl;
};

beforeEach(() => {
  mockWarn.mockClear();
});

afterEach(async () => {
  process.env = { ...ORIGINAL_ENV };
  await Promise.all(openPools.splice(0).map((pool) => pool.end().catch(() => {})));
});

describe('production verifies the server certificate by default', () => {
  test('with no CA and no opt-out, verification is ON', () => {
    // The assertion `TD-001` exists for. If this ever reads `false` again, the audit finding is
    // back and nothing else in the suite would notice.
    expect(sslConfigUnder({ NODE_ENV: 'production' })).toEqual({ rejectUnauthorized: true });
  });

  test('a provider CA is used with verification still ON', () => {
    const ssl = sslConfigUnder({
      NODE_ENV: 'production',
      DATABASE_CA_CERT: '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----'
    });

    expect(ssl.rejectUnauthorized).toBe(true);
    expect(ssl.ca).toContain('BEGIN CERTIFICATE');
  });

  test('a CA pasted with literal \\n escapes is unescaped into real newlines', () => {
    // Providers hand the PEM out as a block; it usually arrives through a single-line .env or a
    // dashboard secret field, so the escaped form is the common case rather than the exotic one.
    // A PEM whose newlines stayed literal is not a parseable certificate.
    const ssl = sslConfigUnder({
      NODE_ENV: 'production',
      DATABASE_CA_CERT: '-----BEGIN CERTIFICATE-----\\nabc\\n-----END CERTIFICATE-----'
    });

    expect(ssl.ca).toBe('-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----');
    expect(ssl.ca).not.toContain('\\n');
  });
});

describe('the unverified escape hatch is explicit and loud', () => {
  test('DATABASE_SSL_NO_VERIFY=true turns verification off', () => {
    expect(sslConfigUnder({ NODE_ENV: 'production', DATABASE_SSL_NO_VERIFY: 'true' })).toEqual({
      rejectUnauthorized: false
    });
  });

  test('and it says so on every boot, naming the exposure', () => {
    // The warning is the whole safety mechanism here: the connection is encrypted but the peer is
    // unauthenticated, and the only thing distinguishing that from a verified one is this line in
    // the boot log. A silent opt-out is the state TD-001 was filed about.
    sslConfigUnder({ NODE_ENV: 'production', DATABASE_SSL_NO_VERIFY: 'true' });

    expect(mockWarn).toHaveBeenCalledTimes(1);
    const message = String(mockWarn.mock.calls[0][0]);
    expect(message).toMatch(/NOT being verified/i);
    expect(message).toMatch(/man-in-the-middle/i);
    expect(message).toMatch(/DATABASE_CA_CERT/);
  });

  test('a verified production boot warns about nothing', () => {
    // Or the warning above would be noise, and noise gets filtered.
    sslConfigUnder({ NODE_ENV: 'production' });
    expect(mockWarn).not.toHaveBeenCalled();
  });

  test('only the exact string "true" disables it', () => {
    // A truthy-but-not-'true' value must not silently disable certificate verification. `'false'`
    // is the one that matters: an operator setting it to turn the flag *off* would, under a loose
    // check, turn verification off instead.
    for (const value of ['false', '1', 'yes', 'TRUE', '']) {
      expect({
        value,
        ssl: sslConfigUnder({ NODE_ENV: 'production', DATABASE_SSL_NO_VERIFY: value })
      }).toEqual({ value, ssl: { rejectUnauthorized: true } });
    }
  });

  test('the opt-out wins over a supplied CA, rather than the two combining silently', () => {
    // Both set is a misconfiguration either way; what matters is that the result is one of the two
    // documented shapes and not a half-applied hybrid that looks verified.
    const ssl = sslConfigUnder({
      NODE_ENV: 'production',
      DATABASE_SSL_NO_VERIFY: 'true',
      DATABASE_CA_CERT: '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----'
    });

    expect(ssl).toEqual({ rejectUnauthorized: false });
    expect(ssl.ca).toBeUndefined();
  });
});

describe('outside production', () => {
  test.each([['test'], ['development'], [undefined]])(
    'NODE_ENV=%s disables TLS entirely, because loopback Postgres has no certificate',
    (nodeEnv) => {
      expect(sslConfigUnder(nodeEnv === undefined ? {} : { NODE_ENV: nodeEnv })).toBe(false);
    }
  );

  test('the escape hatch is ignored outside production, since there is nothing to opt out of', () => {
    expect(sslConfigUnder({ NODE_ENV: 'development', DATABASE_SSL_NO_VERIFY: 'true' })).toBe(false);
  });
});
