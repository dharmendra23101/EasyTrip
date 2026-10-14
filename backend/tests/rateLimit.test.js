const request = require('supertest');
const app = require('../app');
const { createSchema, resetData, closeDb, resetRateLimits } = require('./helpers/testDb');
const { authHeader } = require('./helpers/firebaseMock');

/**
 * Rate limiting (IMP-092, covering the buckets added in Phase 1).
 *
 * Worth its own file because it is the only thing bounding the one unauthenticated write in the
 * API, and because a limiter is trivially easy to disable by accident — reordering middleware, or
 * mounting a router above `app.use(globalLimiter)`, silently removes it and nothing else notices.
 */

const ADMIN = { uid: 'seed-admin-uid' };

beforeAll(async () => {
  await createSchema();
});
beforeEach(async () => {
  await resetData();
  resetRateLimits(app);
});
afterAll(async () => {
  await closeDb();
});

/** Fire `n` requests in sequence and return the status codes. */
const fire = async (n, make) => {
  const codes = [];
  for (let i = 0; i < n; i += 1) codes.push((await make(i)).status);
  return codes;
};

describe('the newsletter bucket — 5 per hour', () => {
  test('allows five and rejects the sixth with 429', async () => {
    const codes = await fire(6, (i) =>
      request(app)
        .post('/api/newsletter')
        .send({ email: `reader${i}@example.com` })
    );
    expect(codes.slice(0, 5).every((c) => c < 400)).toBe(true);
    expect(codes[5]).toBe(429);
  });

  test('a rejected request does not reach the database', async () => {
    await fire(6, (i) =>
      request(app)
        .post('/api/newsletter')
        .send({ email: `r${i}@example.com` })
    );
    const { pool } = require('./helpers/testDb');
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM newsletter_subscribers');
    // Five accepted, the sixth rejected before the handler.
    expect(rows[0].n).toBe(5);
  });

  test('the 429 carries a JSON message, not an HTML error page', async () => {
    await fire(5, (i) =>
      request(app)
        .post('/api/newsletter')
        .send({ email: `x${i}@example.com` })
    );
    const res = await request(app).post('/api/newsletter').send({ email: 'over@example.com' });
    expect(res.status).toBe(429);
    expect(res.body.message).toMatch(/too many/i);
  });

  test('standard RateLimit headers are advertised', async () => {
    const res = await request(app).post('/api/newsletter').send({ email: 'headers@example.com' });
    // `standardHeaders: true` — a client can back off politely instead of hammering until 429.
    const names = Object.keys(res.headers).join(',');
    expect(names).toMatch(/ratelimit/i);
    expect(res.headers['x-ratelimit-limit']).toBeUndefined(); // legacyHeaders: false
  });
});

describe('the review bucket — 10 per hour', () => {
  test('the eleventh review write is rejected', async () => {
    const codes = await fire(11, () =>
      request(app)
        .post('/api/places/4/reviews')
        .set({ Authorization: authHeader({ uid: 'seed-user-uid' }) })
        .send({ rating: 5, comment: 'spam' })
    );
    expect(codes[10]).toBe(429);
  });
});

describe('what the limiters deliberately do NOT block', () => {
  test('reads are not bucketed with writes', async () => {
    // The newsletter bucket is exhausted; a GET must still work. A limiter mounted on the wrong
    // path would take the whole API down with one abusive poster.
    await fire(6, (i) =>
      request(app)
        .post('/api/newsletter')
        .send({ email: `y${i}@example.com` })
    );
    expect((await request(app).get('/api/places')).status).toBe(200);
  });

  test('a CORS preflight is never counted as caller intent', async () => {
    const codes = await fire(20, () =>
      request(app).options('/api/newsletter').set({ Origin: 'http://localhost:3000' })
    );
    expect(codes.every((c) => c !== 429)).toBe(true);
  });

  /**
   * `BUG-049` — the image reads are inside the global bucket again (Sprint 6.17).
   *
   * **Why this is asserted through headers rather than by exhausting the bucket.** The ceiling is
   * 1000 per 15 minutes, so firing 30 requests and finding no 429 proves nothing at all — that is
   * exactly what the *exempt* route did, and what the previous version of this test measured.
   * `standardHeaders: true` makes the counter observable directly: an exempt route emitted **no
   * `ratelimit-*` headers and consumed nothing**, while a bucketed one both advertises the policy
   * and decrements `ratelimit-remaining`.
   */
  test('an image read is counted against the global bucket', async () => {
    const res = await request(app).get('/api/places/3/image');

    // Under the old exemption this object was empty.
    expect(res.headers['ratelimit-limit']).toBe('1000');
    expect(res.headers['ratelimit-remaining']).toBe('999');
  });

  test('and it consumes from the same bucket the JSON routes use', async () => {
    // The property that matters is not "this route has a limit" but "it shares the ceiling", so a
    // flood of image reads cannot leave the rest of the API unprotected. Two different routes, one
    // counter, counting down.
    const first = await request(app).get('/api/places');
    const second = await request(app).get('/api/places/3/image');
    const third = await request(app).get('/api/places/3/images/1');

    expect([
      first.headers['ratelimit-remaining'],
      second.headers['ratelimit-remaining'],
      third.headers['ratelimit-remaining']
    ]).toEqual(['999', '998', '997']);
  });

  test('a burst of image reads is still nowhere near the ceiling', async () => {
    // Bucketing them must not make ordinary browsing fail: 1000 per 15 minutes is roughly one
    // request per second sustained, and a page load is nothing like that.
    const codes = await fire(30, () => request(app).get('/api/places/3/image'));
    expect(codes.every((c) => c !== 429)).toBe(true);
  });
});

describe('admin writes are bucketed but admin reads are not', () => {
  const header = { Authorization: authHeader(ADMIN) };

  test('a burst of admin reads is not rate limited', async () => {
    const codes = await fire(15, () => request(app).get('/api/admin/admins').set(header));
    expect(codes.every((c) => c === 200)).toBe(true);
  });
});

/**
 * The limiter buckets by client IP, so what counts as "the client IP" is the whole ceiling.
 *
 * `app.js` sets `trust proxy` **only** when `TRUST_PROXY_HOPS` is a positive integer, and its
 * comment states the reason exactly: *"trusting the header without a proxy in front lets any caller
 * spoof its own IP."* If Express trusted `X-Forwarded-For` unconditionally, every request could
 * present a fresh address and receive a fresh bucket — the limiter would still be mounted, still
 * emit headers, still pass every other test in this file, and bound nothing at all.
 *
 * That became load-bearing in Sprint 6.17: `BUG-049` put the two public image reads back under this
 * ceiling, and a spoofable key would hand them straight back.
 */
describe('the rate-limit key cannot be chosen by the caller', () => {
  test('trust proxy is off unless a hop count is configured', async () => {
    // Introspection rather than behaviour, because this is the setting the behaviour below depends
    // on — and `TRUST_PROXY_HOPS` is deliberately unset in the test environment.
    expect(app.get('trust proxy')).toBeFalsy();
  });

  test('a spoofed X-Forwarded-For does not earn a fresh bucket', async () => {
    // Two different claimed addresses, one real connection. The counter must keep going down: if
    // the header were honoured, each request would look like a new client and `ratelimit-remaining`
    // would read 999 both times.
    const first = await request(app).get('/api/places').set('X-Forwarded-For', '203.0.113.1');
    const second = await request(app).get('/api/places').set('X-Forwarded-For', '198.51.100.7');

    expect([first.headers['ratelimit-remaining'], second.headers['ratelimit-remaining']]).toEqual([
      '999',
      '998'
    ]);
  });

  test('and the same holds for the image reads BUG-049 just re-bucketed', async () => {
    const first = await request(app)
      .get('/api/places/3/image')
      .set('X-Forwarded-For', '203.0.113.1');
    const second = await request(app)
      .get('/api/places/3/image')
      .set('X-Forwarded-For', '198.51.100.7');

    expect([first.headers['ratelimit-remaining'], second.headers['ratelimit-remaining']]).toEqual([
      '999',
      '998'
    ]);
  });
});
