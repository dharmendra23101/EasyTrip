/**
 * The application logger (IMP-071).
 *
 * Replaces ~120 `console.*` calls in application code. Three things were wrong with those, in
 * increasing order of seriousness:
 *
 *   1. No levels. `console.log` and `console.error` were the whole vocabulary, so there was no way
 *      to turn debug chatter down in production without deleting lines.
 *   2. No structure. `console.log(\`[${timestamp}] Getting place by ID: ${id}\`)` produces a string
 *      a human can read and a log aggregator cannot query. Several call sites hand-built their own
 *      timestamp prefix, in two different formats.
 *   3. **PII on every request.** `authController` logged email addresses; `placeController` logged
 *      Firebase UIDs on every read, create, update and delete (`SECURITY_AUDIT` L5). Those went to
 *      stdout, which on a managed host means they go to a log aggregator, get retained on someone
 *      else's retention schedule, and are readable by anyone with dashboard access.
 *
 * Point 3 is not fixed by redaction alone. Redaction protects against *accidentally* serialising a
 * sensitive field; it does nothing about a message that was deliberately built to contain an email
 * address. So those identifiers were removed from the messages themselves, and correlation is done
 * with the per-request id that `pino-http` attaches instead — which links a user's requests together
 * without recording who they are.
 *
 * `redact` below is the second layer: it catches the fields nobody meant to log, on the assumption
 * that someone will eventually log an entire `req` or `error.config` object.
 */

const pino = require('pino');

const isProduction = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

/**
 * Paths scrubbed from anything that reaches the logger, however it got there.
 *
 * `authorization` is the important one: a Bearer token in a log line is a usable credential for the
 * rest of its lifetime, and log aggregators are not credential stores. The rest are the fields most
 * likely to ride along inside a serialised request, error or config object.
 */
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-user"]',
  'req.headers["x-user-name"]',
  'res.headers["set-cookie"]',
  'headers.authorization',
  'headers.cookie',
  // Both of these also appear bare, for the case where someone logs a plain object they built
  // themselves rather than a request. `authorization` without `cookie` would be an odd asymmetry.
  'authorization',
  'cookie',
  'token',
  'idToken',
  'password',
  'apiKey',
  'api_key',
  'secret',
  'client_secret',
  'private_key',
  'FIREBASE_PRIVATE_KEY',
  'CLOUDINARY_API_SECRET',
  'DATABASE_URL'
];

const level =
  process.env.LOG_LEVEL ||
  // Silent under test so a suite's output is its assertions, not the app's boot chatter.
  (isTest ? 'silent' : isProduction ? 'info' : 'debug');

const logger = pino({
  level,

  redact: {
    paths: REDACT_PATHS,
    censor: '[redacted]',
    // Missing paths are not an error — most of these are absent from most log calls.
    remove: false
  },

  // `msg` and `time` are pino defaults. Renaming the level to a word rather than a number is worth
  // the negligible cost: `"level":30` is unreadable to anyone grepping raw output.
  formatters: {
    level: (label) => ({ level: label })
  },

  base: {
    service: 'easytrip-api'
  },

  // ISO timestamps rather than epoch millis. Slightly slower, and worth it — every consumer of
  // these logs, including a person tailing them, can read an ISO string without conversion.
  timestamp: pino.stdTimeFunctions.isoTime,

  // Pretty output in development only. In production the JSON goes straight to stdout, which is
  // what a container platform expects to collect. pino-pretty is a devDependency, so this branch
  // must never be taken in production — it would throw on a missing module.
  ...(isProduction || isTest
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss',
            ignore: 'pid,hostname,service'
          }
        }
      })
});

module.exports = logger;
module.exports.REDACT_PATHS = REDACT_PATHS;
