/**
 * Per-request logging (IMP-071).
 *
 * There was none. Individual controllers hand-rolled their own request lines — with their own
 * timestamp formats, and with the caller's Firebase UID or email embedded in the message
 * (`SECURITY_AUDIT` L5). This replaces all of that with one middleware that logs every request
 * once, consistently, and without recording who made it.
 *
 * **What is deliberately NOT logged:** request headers (the `Authorization` header is a usable
 * credential for the lifetime of the token), the request body (it carries review text, profile
 * fields and, on the auth routes, whatever the client sent), and any user identifier.
 *
 * Requests are correlated by `req.id` instead — a per-request id, echoed back in the
 * `x-request-id` response header. That links one user's requests to each other and to any error
 * thrown while serving them, without recording which user it was. When a report comes in, the id
 * from the response header is the lookup key.
 */

const crypto = require('crypto');
const pinoHttp = require('pino-http');

const logger = require('./logger');

/**
 * Query parameters scrubbed from the logged URL.
 *
 * The URL is worth logging — knowing that `/api/places?search=hampi&page=3` was slow is most of a
 * performance investigation. But query strings are the one part of a URL that has historically
 * carried identity in this codebase: `authMiddleware` used to accept `?user=` as an authentication
 * credential (removed in Phase 1). Anything that ever authenticated a request must never be logged,
 * including after it stops being honoured — logs outlive the code that wrote them.
 */
const SENSITIVE_QUERY_PARAMS = new Set([
  'user',
  'token',
  'idtoken',
  'access_token',
  'key',
  'apikey',
  'password'
]);

const sanitizeUrl = (url) => {
  if (typeof url !== 'string') return url;

  const queryStart = url.indexOf('?');
  if (queryStart === -1) return url;

  const path = url.slice(0, queryStart);
  // `URLSearchParams` rather than a hand-rolled split: it handles repeated keys, empty values and
  // percent-encoding, all of which a `split('&').split('=')` gets subtly wrong.
  const params = new URLSearchParams(url.slice(queryStart + 1));

  let mutated = false;
  for (const key of [...params.keys()]) {
    if (SENSITIVE_QUERY_PARAMS.has(key.toLowerCase())) {
      params.set(key, '[redacted]');
      mutated = true;
    }
  }

  if (!mutated) return url;
  return `${path}?${params.toString()}`;
};

/**
 * How slow a request has to be before it is worth interrupting somebody about (`FV-021`).
 *
 * A threshold rather than a dashboard, because a dashboard needs somewhere to run and this needs
 * nothing. `pino-http` already records `responseTime` on every line, which makes a slow request
 * *findable* — but only by someone who already suspects one and goes looking. Promoting it to
 * `warn` makes it **arrive**, which is the difference between having the data and having the
 * signal.
 *
 * One second is deliberately generous. This API's slowest legitimate route is a place search with
 * facets, and the point of the line is "something is wrong", not "something could be faster" —
 * a threshold that fires on healthy traffic is a threshold people filter out.
 */
const SLOW_REQUEST_MS = Number(process.env.SLOW_REQUEST_MS) || 1000;

/**
 * Milliseconds since `pino-http` started timing this request, or `null` if it never did.
 *
 * `pino-http` exports the symbol it stores the start time under, so this reads the number the
 * library is already keeping rather than starting a second clock that could disagree with the
 * `responseTime` on the same line.
 */
const elapsedMs = (res) => {
  const start = res[pinoHttp.startTime];
  return typeof start === 'number' ? Date.now() - start : null;
};

const isSlow = (res) => {
  const elapsed = elapsedMs(res);
  return elapsed !== null && elapsed >= SLOW_REQUEST_MS;
};

/**
 * Which lines an operator actually sees.
 *
 * Named and exported rather than written inline in the config, because this is a *rule* — and
 * testing it through the middleware would mean asserting on captured log output instead of on the
 * decision itself.
 */
const customLogLevel = (req, res, err) => {
  if (err || res.statusCode >= 500) return 'error';
  if (res.statusCode >= 400) return 'warn';
  // Checked BEFORE the health-check demotion, deliberately. A fast health check is noise and is
  // demoted below; a **slow** one is the earliest sign the database is struggling, and demoting
  // that to `debug` would hide the single most useful line this service can emit.
  if (isSlow(res)) return 'warn';
  // Uptime monitors poll /api/health continuously. At info level that is the only thing anyone
  // would see in the logs of a healthy, idle service.
  if (req.url === '/api/health') return 'debug';
  return 'info';
};

// The message says it was slow, because a `warn` line that reads exactly like the `info` lines
// around it is a level nobody learns to trust.
const customSuccessMessage = (req, res) =>
  `${req.method} ${sanitizeUrl(req.url)} ${res.statusCode}` +
  (isSlow(res) ? ` — SLOW (>=${SLOW_REQUEST_MS}ms)` : '');

const requestLogger = pinoHttp({
  logger,

  // Honour an upstream id when a proxy or client supplies one, so a request can be traced across
  // service boundaries; otherwise mint one. randomUUID is cheap and collision-free, which a
  // counter is not once there is more than one process.
  genReqId: (req, res) => {
    const existing = req.headers['x-request-id'];
    const id =
      typeof existing === 'string' && existing.length > 0 && existing.length <= 200
        ? existing
        : crypto.randomUUID();
    // Echoed back so a user reporting a problem can quote something that finds the log line.
    res.setHeader('x-request-id', id);
    return id;
  },

  // Serialisers decide what a `req`/`res` object becomes in the log. The defaults include headers;
  // these do not. That is the whole point.
  serializers: {
    req: (req) => ({
      id: req.id,
      method: req.method,
      url: sanitizeUrl(req.url)
    }),
    res: (res) => ({
      statusCode: res.statusCode
    }),
    err: (err) => ({
      type: err.type,
      message: err.message,
      // Stack traces in development only. In production they are noise in the common case and a
      // disclosure risk if logs are ever surfaced to a user-facing tool.
      ...(process.env.NODE_ENV === 'production' ? {} : { stack: err.stack })
    })
  },

  customLogLevel,
  customSuccessMessage,
  customErrorMessage: (req, res, err) =>
    `${req.method} ${sanitizeUrl(req.url)} ${res.statusCode} — ${err.message}`
});

module.exports = requestLogger;
module.exports.sanitizeUrl = sanitizeUrl;
module.exports.SENSITIVE_QUERY_PARAMS = SENSITIVE_QUERY_PARAMS;
module.exports.SLOW_REQUEST_MS = SLOW_REQUEST_MS;
module.exports.customLogLevel = customLogLevel;
module.exports.customSuccessMessage = customSuccessMessage;
