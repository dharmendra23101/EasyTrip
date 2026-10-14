const { EventEmitter } = require('node:events');
const { installProcessHandlers } = require('../src/utils/processLifecycle');

/**
 * Crash and shutdown handling (`FV-021`).
 *
 * **The gap this closed was in observability, not stability.** `IMP-071` routed every application
 * log line through pino — levels, redaction, a per-request id, JSON on stdout. Two classes of event
 * went around all of it: an uncaught exception or unhandled rejection was printed by *Node* as an
 * unstructured stack on stderr, and a `SIGTERM` produced nothing whatsoever. So the one line
 * explaining why a service stopped was the one line that did not look like any other, and a routine
 * deploy was indistinguishable from a crash.
 *
 * **Every dependency is injected — including `exit`, the timer and the event target — because the
 * alternative is a test that verifies the handler by terminating the process running the test.**
 * A module that can only be checked by killing its own test runner does not get checked.
 */

const makeLogger = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  fatal: jest.fn()
});

/** A server whose `close` callback fires on demand, so a slow shutdown can be held open. */
const makeServer = ({ closes = true } = {}) => {
  const server = { close: jest.fn((cb) => closes && cb()) };
  return server;
};

const setup = (over = {}) => {
  const target = new EventEmitter();
  const logger = makeLogger();
  const pool = { end: jest.fn(async () => undefined) };
  const exit = jest.fn();
  const server = over.server ?? makeServer();

  const teardown = installProcessHandlers({
    server,
    pool,
    logger,
    exit,
    target,
    timeoutMs: over.timeoutMs ?? 50
  });

  return { target, logger, pool, exit, server, teardown };
};

/** Signal handlers are async; let the microtask queue and the shutdown timer drain. */
const settle = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms));

describe('a crash is logged in the same shape as everything else', () => {
  test('an uncaught exception is logged at fatal and exits non-zero', async () => {
    const { target, logger, exit, teardown } = setup();

    target.emit('uncaughtException', new Error('boom'));

    expect(logger.fatal).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringMatching(/uncaught exception/i)
    );
    expect(exit).toHaveBeenCalledWith(1);
    teardown();
  });

  test('an unhandled rejection is logged at fatal and exits non-zero', async () => {
    const { target, logger, exit, teardown } = setup();

    target.emit('unhandledRejection', new Error('nope'));

    expect(logger.fatal).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringMatching(/unhandled promise rejection/i)
    );
    expect(exit).toHaveBeenCalledWith(1);
    teardown();
  });

  test('a rejection with a non-Error reason still carries its message', async () => {
    // `Promise.reject('a string')` is legal and common in third-party code. Logged as `err`
    // directly, a bare string serialises to `{}` and the only clue there was is gone.
    const { target, logger, teardown } = setup();

    target.emit('unhandledRejection', 'database exploded');

    const [payload] = logger.fatal.mock.calls[0];
    expect(payload.err).toBeInstanceOf(Error);
    expect(payload.err.message).toBe('database exploded');
    teardown();
  });

  test('a crash does NOT try to drain the pool', async () => {
    // After an uncaught exception the state of the program is unknown by definition. "Cleanup"
    // running on top of unknown state is how a crash becomes a corrupted write; the honest thing
    // is to say why and stop.
    const { target, pool, teardown } = setup();

    target.emit('uncaughtException', new Error('boom'));
    await settle();

    expect(pool.end).not.toHaveBeenCalled();
    teardown();
  });
});

describe('SIGTERM is a deploy, and says so', () => {
  test('it closes the server, drains the pool, and exits zero', async () => {
    const { target, logger, pool, exit, server, teardown } = setup();

    target.emit('SIGTERM');
    await settle();

    expect(server.close).toHaveBeenCalled();
    expect(pool.end).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ signal: 'SIGTERM', graceful: true }),
      expect.stringMatching(/shutdown complete/i)
    );
    teardown();
  });

  test('SIGINT takes the same path, and the log says which signal it was', async () => {
    const { target, logger, exit, teardown } = setup();

    target.emit('SIGINT');
    await settle();

    expect(exit).toHaveBeenCalledWith(0);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ signal: 'SIGINT' }),
      expect.stringMatching(/shutting down/i)
    );
    teardown();
  });

  test('a second signal does not start a second shutdown', async () => {
    // The platform sends SIGTERM then SIGKILL, and an impatient operator sends Ctrl-C twice.
    // Draining the pool twice would throw on the second call.
    const { target, pool, logger, teardown } = setup({ server: makeServer({ closes: false }) });

    target.emit('SIGTERM');
    target.emit('SIGTERM');
    await settle();

    expect(pool.end).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ signal: 'SIGTERM' }),
      expect.stringMatching(/already in progress/i)
    );
    teardown();
  });
});

describe('shutdown is bounded', () => {
  test('a server that never finishes closing is abandoned, loudly, and still drains', async () => {
    // `server.close()` waits for in-flight connections — and an idle keep-alive connection counts.
    // Without a deadline one open browser tab holds a deploy until the platform's own kill timer
    // ends it far less politely.
    const { target, logger, pool, exit, teardown } = setup({
      server: makeServer({ closes: false }),
      timeoutMs: 30
    });

    target.emit('SIGTERM');
    await settle();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMs: 30 }),
      expect.stringMatching(/did not finish in time/i)
    );
    // The point of the deadline is that the rest still happens.
    expect(pool.end).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
    teardown();
  });

  test('the completion log distinguishes a graceful shutdown from an abandoned one', async () => {
    // Both exit 0, so `graceful` is the only thing that tells a reader which happened — and "did
    // every deploy drop requests?" is exactly the question this log exists to answer.
    const { target, logger, teardown } = setup({
      server: makeServer({ closes: false }),
      timeoutMs: 30
    });

    target.emit('SIGTERM');
    await settle();

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ graceful: false }),
      expect.stringMatching(/shutdown complete/i)
    );
    teardown();
  });

  test('a pool that fails to drain is reported, and shutdown still completes', async () => {
    // The process is going away regardless. An error here must not replace the shutdown line with
    // a stack trace about cleanup.
    const target = new EventEmitter();
    const logger = makeLogger();
    const exit = jest.fn();
    const teardown = installProcessHandlers({
      server: makeServer(),
      pool: { end: jest.fn(async () => Promise.reject(new Error('pool gone'))) },
      logger,
      exit,
      target,
      timeoutMs: 50
    });

    target.emit('SIGTERM');
    await settle();

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringMatching(/draining the database pool/i)
    );
    expect(exit).toHaveBeenCalledWith(0);
    teardown();
  });
});

describe('the handlers can be removed', () => {
  test('teardown unregisters everything it added', async () => {
    // Not housekeeping: without this, importing this module in two test files would register two
    // copies of each handler and the second would exit the runner.
    const { target, teardown, exit } = setup();

    expect(target.listenerCount('SIGTERM')).toBe(1);
    expect(target.listenerCount('uncaughtException')).toBe(1);

    teardown();

    expect(target.listenerCount('SIGTERM')).toBe(0);
    expect(target.listenerCount('uncaughtException')).toBe(0);
    expect(target.listenerCount('unhandledRejection')).toBe(0);
    expect(target.listenerCount('SIGINT')).toBe(0);

    target.emit('SIGTERM');
    await settle(40);
    expect(exit).not.toHaveBeenCalled();
  });
});
