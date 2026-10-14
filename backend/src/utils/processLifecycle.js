/**
 * What happens when the process is told to stop, or breaks (`FV-021`).
 *
 * ---------------------------------------------------------------------------
 * The gap this closes is an observability one, not a stability one
 * ---------------------------------------------------------------------------
 * `IMP-071` routed every application log line through pino: levels, redaction, a per-request id,
 * JSON on stdout for a collector to pick up. **Two classes of event bypassed all of it.**
 *
 * An unhandled promise rejection or an uncaught exception is printed by Node itself, to stderr, as
 * an unstructured stack trace. So the single most important line a service ever emits — the one
 * explaining why it stopped — was the one line that was not JSON, carried no request id, and did
 * not look like anything else in the log stream. A crash was harder to find than a 404.
 *
 * And a `SIGTERM` produced *nothing at all*. Every managed host sends one before stopping a
 * container, so a routine deploy and a hard crash were indistinguishable in the logs: both were a
 * service that simply stopped writing.
 *
 * ---------------------------------------------------------------------------
 * Why the process still exits
 * ---------------------------------------------------------------------------
 * Logging an uncaught exception and carrying on is worse than crashing. After one, the state of
 * the program is unknown by definition — the point of the handler is to say why it died in the
 * same format as everything else, not to survive.
 *
 * `unhandledRejection` is treated identically. Node's own default has been to terminate since v15,
 * and a rejection that reached the top level is a bug of exactly the same weight.
 *
 * ---------------------------------------------------------------------------
 * Why shutdown has a deadline
 * ---------------------------------------------------------------------------
 * `server.close()` stops accepting new connections and waits for in-flight ones — **and a
 * keep-alive connection sitting idle is in-flight**. Without a deadline a single open browser tab
 * can hold a deploy indefinitely, and the platform's own kill timer ends it far less politely. So
 * the graceful path is bounded and says which of the two happened.
 *
 * The pool is drained because an undrained one leaves server-side connections until the database
 * times them out. On a small managed Postgres with a low connection cap, a few rolling deploys is
 * all it takes to exhaust it.
 */

/** How long in-flight requests get before shutdown stops being graceful. */
const SHUTDOWN_TIMEOUT_MS = 10_000;

/**
 * Install the handlers.
 *
 * Everything is injected — the server, the pool, the logger, and even `exit` and the timer — so the
 * behaviour can be asserted in a test without terminating the test runner. A module that can only
 * be verified by killing the process that verifies it does not get verified.
 *
 * @returns {Function} a teardown that removes every listener this added, so tests do not leak them
 *   across files and a repeated call cannot register a second copy of each handler.
 */
const installProcessHandlers = ({
  server,
  pool,
  logger,
  exit = (code) => process.exit(code),
  timeoutMs = SHUTDOWN_TIMEOUT_MS,
  target = process
}) => {
  // A second SIGTERM while the first is still draining must not start a second shutdown: the
  // platform sends SIGTERM and then SIGKILL, and an impatient operator sends Ctrl-C twice.
  let shuttingDown = false;

  const shutdown = async (signal) => {
    if (shuttingDown) {
      logger.warn({ signal }, 'Shutdown already in progress — ignoring');
      return;
    }
    shuttingDown = true;

    logger.info({ signal }, 'Shutting down');

    let timer;
    const closed = await new Promise((resolve) => {
      // `server.close` may never call back (see the header). Whichever settles first wins.
      timer = setTimeout(() => resolve(false), timeoutMs);
      // `unref` so this timer cannot itself hold the event loop open once everything else is done.
      if (typeof timer.unref === 'function') timer.unref();

      if (!server) return resolve(true);
      server.close(() => resolve(true));
    });
    clearTimeout(timer);

    if (!closed) {
      logger.warn(
        { signal, timeoutMs },
        'In-flight requests did not finish in time — closing anyway'
      );
    }

    try {
      await pool.end();
    } catch (error) {
      // Reported rather than thrown: the process is going away regardless, and an error here must
      // not replace the shutdown log line with a stack trace about cleanup.
      logger.error({ err: error }, 'Error draining the database pool');
    }

    logger.info({ signal, graceful: closed }, 'Shutdown complete');
    exit(0);
  };

  /**
   * The two fatal cases, logged in the same shape as everything else and then fatal.
   *
   * No attempt to drain anything. The program's state is unknown, so the honest thing is to record
   * why and stop — a "cleanup" running on top of unknown state is how a crash becomes a corrupted
   * write.
   */
  const onUncaught = (error) => {
    logger.fatal({ err: error }, 'Uncaught exception — exiting');
    exit(1);
  };

  const onUnhandledRejection = (reason) => {
    // `reason` is whatever was rejected and need not be an Error, so it is normalised — a rejected
    // string logged as `err` serialises to an empty object and loses the only clue there was.
    const error = reason instanceof Error ? reason : new Error(String(reason));
    logger.fatal({ err: error }, 'Unhandled promise rejection — exiting');
    exit(1);
  };

  const onSigterm = () => shutdown('SIGTERM');
  const onSigint = () => shutdown('SIGINT');

  target.on('uncaughtException', onUncaught);
  target.on('unhandledRejection', onUnhandledRejection);
  target.on('SIGTERM', onSigterm);
  target.on('SIGINT', onSigint);

  return () => {
    target.removeListener('uncaughtException', onUncaught);
    target.removeListener('unhandledRejection', onUnhandledRejection);
    target.removeListener('SIGTERM', onSigterm);
    target.removeListener('SIGINT', onSigint);
  };
};

module.exports = { installProcessHandlers, SHUTDOWN_TIMEOUT_MS };
