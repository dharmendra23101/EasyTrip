const pinoHttp = require('pino-http');
const {
  sanitizeUrl,
  SENSITIVE_QUERY_PARAMS,
  SLOW_REQUEST_MS,
  customLogLevel,
  customSuccessMessage
} = require('../src/utils/requestLogger');
const { poolStats, isConnectionTimeout } = require('../src/config/db');

/**
 * Request logging rules (`IMP-071`, extended by `FV-021`).
 *
 * **`sanitizeUrl` had no test at all before this file**, which is worth stating plainly: it is the
 * function that keeps credentials out of the log stream, and *"anything that ever authenticated a
 * request must never be logged, including after it stops being honoured — logs outlive the code
 * that wrote them"* is its whole reason for existing. A security control with no test is a
 * security control nobody has checked.
 *
 * The `FV-021` half is the level rule. `pino-http` has always recorded `responseTime`, so a slow
 * request was *findable* by someone who already suspected one; promoting it to `warn` is what makes
 * it **arrive**. That is the difference between having the data and having the signal, and it is a
 * rule about what an operator sees, so it is asserted directly rather than through captured output.
 */

/** A response as `pino-http` leaves it: the start time under the library's own symbol. */
const res = (statusCode, elapsedMs = 0) => ({
  statusCode,
  [pinoHttp.startTime]: Date.now() - elapsedMs
});

const req = (url = '/api/places', method = 'GET') => ({ url, method });

// ---------------------------------------------------------------------------
// The security control that had no test
// ---------------------------------------------------------------------------
describe('sanitizeUrl keeps credentials out of the logs', () => {
  test('every parameter that ever authenticated a request is redacted', () => {
    // `authMiddleware` once accepted `?user=` as a credential. It no longer does, and it must still
    // never be logged: the log outlives the code, and an old line is still a disclosure.
    for (const param of SENSITIVE_QUERY_PARAMS) {
      const sanitized = sanitizeUrl(`/api/places?${param}=secret-value`);
      expect(sanitized).not.toContain('secret-value');
      // `%5Bredacted%5D`, not `[redacted]`: the URL is rebuilt through `URLSearchParams`, which
      // percent-encodes the brackets. That is correct — it round-trips back to `[redacted]` for
      // anything that re-parses the line — and asserting the pretty spelling instead would be
      // asserting a string this function does not produce.
      expect(decodeURIComponent(sanitized)).toContain('[redacted]');
    }
  });

  test('the parameter name is matched case-insensitively', () => {
    // `?Token=` and `?TOKEN=` are the same credential to a server and a different string to a
    // `Set.has`. A redactor that only catches the lower-case spelling is one query string from
    // leaking.
    expect(sanitizeUrl('/api/places?Token=abc')).not.toContain('abc');
    expect(sanitizeUrl('/api/places?TOKEN=abc')).not.toContain('abc');
    expect(sanitizeUrl('/api/places?ApiKey=abc')).not.toContain('abc');
  });

  test('the useful part of the query string survives', () => {
    // The URL is logged because knowing *which* request was slow is most of an investigation.
    // A redactor that scrubbed the whole query string would remove the reason for logging it.
    const sanitized = sanitizeUrl('/api/places?search=hampi&page=3&token=secret');
    expect(sanitized).toContain('search=hampi');
    expect(sanitized).toContain('page=3');
    expect(sanitized).not.toContain('secret');
  });

  test('a URL with no query string is returned unchanged, not rebuilt', () => {
    // Rebuilding through URLSearchParams would append a bare `?` to every clean URL in the logs.
    expect(sanitizeUrl('/api/places')).toBe('/api/places');
  });

  test('repeated and percent-encoded keys are handled', () => {
    // The reason this uses URLSearchParams rather than split('&').split('='), stated as a test.
    const sanitized = sanitizeUrl('/api/places?token=a&token=b&search=hampi%20fort');
    expect(sanitized).not.toContain('token=a');
    expect(sanitized).not.toContain('token=b');
    expect(sanitized).toContain('hampi');
  });

  test('a URL with nothing to redact is returned byte-identical, not re-encoded', () => {
    // Found by mutation: removing the `!mutated` early return left every assertion green, because
    // a rebuild through `URLSearchParams` produces the same string for most inputs. It does not
    // for percent-encoded spaces — `%20` comes back as `+` — and a logged URL that differs from
    // the one the client sent is exactly the URL somebody cannot find when matching a log line to
    // a bug report.
    const clean = '/api/places?search=hampi%20fort&page=3';
    expect(sanitizeUrl(clean)).toBe(clean);
  });

  test('a non-string is passed through rather than thrown on', () => {
    expect(sanitizeUrl(undefined)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The level rule
// ---------------------------------------------------------------------------
describe('what gets logged at which level', () => {
  test('a normal request is info', () => {
    expect(customLogLevel(req(), res(200, 5), null)).toBe('info');
  });

  test('a 4xx is warn and a 5xx is error', () => {
    expect(customLogLevel(req(), res(404, 5), null)).toBe('warn');
    expect(customLogLevel(req(), res(500, 5), null)).toBe('error');
  });

  test('an error wins over the status code', () => {
    // A thrown error with a 200 already written is still an error.
    expect(customLogLevel(req(), res(200, 5), new Error('boom'))).toBe('error');
  });

  test('a fast health check is demoted to debug', () => {
    // Uptime monitors poll it continuously; at info it is the only thing in an idle service's log.
    expect(customLogLevel(req('/api/health'), res(200, 5), null)).toBe('debug');
  });
});

describe('a slow request arrives instead of merely being findable', () => {
  test('crossing the threshold promotes info to warn', () => {
    expect(customLogLevel(req(), res(200, SLOW_REQUEST_MS + 50), null)).toBe('warn');
  });

  test('the threshold is inclusive, and just under it stays info', () => {
    // Asserted at both sides, because an off-by-one here is invisible: the level simply never
    // changes and the feature looks like it works.
    expect(customLogLevel(req(), res(200, SLOW_REQUEST_MS), null)).toBe('warn');
    expect(customLogLevel(req(), res(200, SLOW_REQUEST_MS - 50), null)).toBe('info');
  });

  test('a SLOW health check is NOT demoted to debug', () => {
    // The ordering that matters. A fast health check is noise; a slow one is the earliest sign the
    // database is struggling, and demoting it would hide the most useful line the service emits.
    expect(customLogLevel(req('/api/health'), res(200, SLOW_REQUEST_MS + 50), null)).toBe('warn');
  });

  test('a slow error is still an error, not downgraded to warn', () => {
    expect(customLogLevel(req(), res(500, SLOW_REQUEST_MS + 50), null)).toBe('error');
  });

  test('the message says it was slow', () => {
    // A `warn` line that reads exactly like the `info` lines around it is a level nobody learns to
    // trust — the promotion is only useful if the reason is on the line.
    const message = customSuccessMessage(req(), res(200, SLOW_REQUEST_MS + 50));
    expect(message).toMatch(/SLOW/);
    expect(message).toContain(String(SLOW_REQUEST_MS));
  });

  test('a normal message is unchanged, and still redacts', () => {
    const message = customSuccessMessage(req('/api/places?token=secret'), res(200, 5));
    expect(message).not.toMatch(/SLOW/);
    expect(message).not.toContain('secret');
    expect(message).toBe('GET /api/places?token=%5Bredacted%5D 200');
  });

  test('a response with no start time is not treated as slow', () => {
    // `Date.now() - undefined` is NaN, and `NaN >= threshold` is false — but only by luck. Asserted
    // so a refactor to `elapsed > threshold ? ... ` cannot silently mark every untimed request slow.
    expect(customLogLevel(req(), { statusCode: 200 }, null)).toBe('info');
    expect(customSuccessMessage(req(), { statusCode: 200 })).not.toMatch(/SLOW/);
  });
});

// ---------------------------------------------------------------------------
// Telling three identical-looking database failures apart
// ---------------------------------------------------------------------------
describe('pool occupancy makes a connect timeout diagnosable', () => {
  test('poolStats reports the numbers the pool itself keeps', () => {
    const stats = poolStats();
    expect(stats).toMatchObject({
      total: expect.any(Number),
      idle: expect.any(Number),
      waiting: expect.any(Number)
    });
    // `waiting > 0` is the one that says the pool is the bottleneck rather than the database.
    expect(stats.waiting).toBeGreaterThanOrEqual(0);
    expect(stats.max).toBeGreaterThan(0);
  });

  test('a pool timeout is recognised', () => {
    // The message pg-pool actually constructs. It carries no `code`, which is why this matches on
    // the string at all.
    expect(isConnectionTimeout(new Error('timeout exceeded when trying to connect'))).toBe(true);
  });

  test('an unrelated database error is not mistaken for pool exhaustion', () => {
    // The failure mode of a loose match: a wrong annotation sends an incident response at the pool
    // when the database is simply down.
    expect(isConnectionTimeout(new Error('connection refused'))).toBe(false);
    expect(isConnectionTimeout(new Error('The server does not support SSL connections'))).toBe(
      false
    );
    expect(isConnectionTimeout(undefined)).toBe(false);
    expect(isConnectionTimeout({ message: 42 })).toBe(false);
  });
});
