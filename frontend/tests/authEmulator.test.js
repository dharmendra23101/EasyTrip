import { refusalMessage, resolveAuthEmulator } from '../src/config/authEmulator';

/**
 * The browser's Auth Emulator switch (`TD-024`).
 *
 * This is the one guard in the repository that sits on the **production authentication path**, so
 * the tests that matter most are the ones proving it does nothing. `TECH_DEBT_BUDGET` recorded the
 * change as a stop-and-ask precisely because "a branch added to auth for the benefit of tests" is a
 * shape worth being suspicious of — and the answer to a suspicious shape is assertions, not
 * assurances.
 *
 * Three properties, in the order they matter:
 *
 *   1. Absent variable → no emulator, no log, nothing.
 *   2. A host that is not loopback → refused, and the refusal is audible.
 *   3. Only then, the happy path.
 */

describe('with the variable absent, which is every deployment', () => {
  // The whole safety argument rests on this one: production is not a configuration of this feature,
  // it is the total absence of it.
  test.each([undefined, null, '', '   '])('%p connects to nothing and reports nothing', (value) => {
    expect(resolveAuthEmulator(value)).toEqual({ connect: false, reason: 'not_configured' });
  });

  test('"not configured" is distinguishable from "configured and refused"', () => {
    // `firebase.js` logs one and stays silent about the other, so they must not be the same reason.
    expect(resolveAuthEmulator(undefined).reason).not.toBe(
      resolveAuthEmulator('emulator.example.com:9099').reason
    );
  });
});

describe('a host that is not loopback is refused', () => {
  test.each([
    'emulator.example.com:9099',
    'auth.evil.test:9099',
    '10.0.0.5:9099',
    '192.168.1.10:9099',
    '169.254.169.254',
    '0.0.0.0:9099',
    // Reads as loopback to a skim and is not: the registrable domain is `example.com`.
    '127.0.0.1.example.com:9099',
    'localhost.evil.test:9099'
  ])('%s does not connect', (value) => {
    const result = resolveAuthEmulator(value);
    expect(result.connect).toBe(false);
    expect(result.reason).toBe('not_loopback');
  });

  test('the refusal names the host it rejected, so the misconfiguration is findable', () => {
    const result = resolveAuthEmulator('auth.evil.test:9099');
    expect(result.hostname).toBe('auth.evil.test');
    expect(refusalMessage(result)).toContain('auth.evil.test');
    expect(refusalMessage(result)).toContain('loopback');
  });
});

describe('anything that is not a bare host:port is refused', () => {
  // Each of these would parse into *some* hostname if fed to a lenient parser, and the one that
  // matters is the userinfo form: `http://127.0.0.1@evil.test` has hostname `evil.test`, which a
  // loopback check written after a naive split on ':' would wave straight through.
  test.each([
    'http://127.0.0.1:9099',
    'https://127.0.0.1:9099',
    '127.0.0.1@evil.test',
    'http://127.0.0.1@evil.test:9099',
    '127.0.0.1:9099/identitytoolkit',
    '//127.0.0.1:9099'
  ])('%s does not connect', (value) => {
    expect(resolveAuthEmulator(value)).toMatchObject({
      connect: false,
      reason: 'not_host_port'
    });
  });

  test('its message says what the format is, rather than only that it was wrong', () => {
    expect(refusalMessage(resolveAuthEmulator('http://127.0.0.1:9099'))).toContain(
      '127.0.0.1:9099'
    );
  });

  test('the rejected value is carried, but the message never repeats it back', () => {
    // The value is developer-supplied text on a page that may be public. Naming the variable is
    // enough to fix it; echoing arbitrary input into the console is not something a guard needs.
    const result = resolveAuthEmulator('http://127.0.0.1@evil.test:9099');
    expect(result.value).toBe('http://127.0.0.1@evil.test:9099');
    expect(refusalMessage(result)).not.toContain('evil.test');
  });
});

describe('the loopback hosts, which is what the E2E suite actually sets', () => {
  test.each([
    ['127.0.0.1:9099', 'http://127.0.0.1:9099'],
    ['localhost:9099', 'http://localhost:9099'],
    ['[::1]:9099', 'http://[::1]:9099'],
    // No port: the emulator's default is not this module's business to invent.
    ['127.0.0.1', 'http://127.0.0.1']
  ])('%s connects to %s', (value, url) => {
    expect(resolveAuthEmulator(value)).toEqual({ connect: true, url });
  });

  test('surrounding whitespace is tolerated, because .env files collect it', () => {
    expect(resolveAuthEmulator('  127.0.0.1:9099  ')).toEqual({
      connect: true,
      url: 'http://127.0.0.1:9099'
    });
  });

  test('the port is preserved exactly, not defaulted', () => {
    // E2E_AUTH_EMULATOR_PORT exists, so 9099 is a default and not a constant. A module that
    // normalised the port would silently send the suite to the wrong emulator on a machine where
    // 9099 was taken — which is a situation `auth-emulator.js` explicitly handles.
    expect(resolveAuthEmulator('127.0.0.1:9411').url).toBe('http://127.0.0.1:9411');
  });
});
