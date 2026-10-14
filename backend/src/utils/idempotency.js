const crypto = require('node:crypto');
const pool = require('../config/db');
const logger = require('./logger');

/**
 * Make a retried write safe to retry (`PE-007`).
 *
 * ---------------------------------------------------------------------------
 * Opt-in, and that is the whole reason it is safe to add to existing routes
 * ---------------------------------------------------------------------------
 * A request with no `Idempotency-Key` header passes straight through, unchanged. Every existing
 * client keeps working exactly as it did, and a client that wants the guarantee asks for it. That
 * makes this middleware additive rather than a behaviour change to 77 routes.
 *
 * ---------------------------------------------------------------------------
 * Claim first, then do the work
 * ---------------------------------------------------------------------------
 * The obvious implementation — look up the key, and if it is missing do the work and store the
 * result — has a window between the lookup and the store where a second copy of the same request
 * finds nothing and does the work again. That is exactly the case this exists to prevent, and a
 * retry from a flaky connection is the *most likely* thing to arrive in that window.
 *
 * So the key is **claimed** with an `INSERT ... ON CONFLICT DO NOTHING` before the handler runs.
 * Losing the race means somebody else is mid-flight with this key, which is answered **409** — the
 * honest response, because the result does not exist yet and inventing one would be worse than
 * asking the client to try again.
 *
 * ---------------------------------------------------------------------------
 * A key is a promise about one request
 * ---------------------------------------------------------------------------
 * The fingerprint is a hash of method, path and body. Reusing a key for a *different* request is a
 * client bug and gets a **422**, rather than being handed an earlier answer to a question it did not
 * ask this time. That distinction is the difference between idempotency and a cache.
 *
 * ---------------------------------------------------------------------------
 * Only successes are remembered
 * ---------------------------------------------------------------------------
 * A non-2xx response **releases** the claim. Storing a failure would turn one bad moment into a
 * permanent one: the client retries, gets the same 500 forever, and has no way to ask again.
 */

const HEADER = 'idempotency-key';

const fingerprint = (req) =>
  crypto
    .createHash('sha256')
    .update(`${req.method}\n${req.originalUrl}\n${JSON.stringify(req.body ?? {})}`)
    .digest('hex');

/**
 * Express middleware. Mount **after** `isAuthenticated`, because the key is scoped to the caller and
 * an unauthenticated request has nobody to scope it to.
 */
const idempotent = async (req, res, next) => {
  const key = req.get(HEADER);
  if (!key) return next();

  if (key.length > 255) {
    return res.status(400).json({ message: 'Idempotency-Key must be 255 characters or fewer' });
  }

  const userId = req.user?.uid;
  if (!userId) return next();

  const hash = fingerprint(req);

  try {
    const claimed = await pool.query(
      `INSERT INTO idempotency_keys
         (user_id, idempotency_key, request_fingerprint, status_code, response_body)
       VALUES ($1, $2, $3, 200, '{}'::jsonb)
       ON CONFLICT (user_id, idempotency_key) DO NOTHING
       RETURNING id`,
      [userId, key, hash]
    );

    if (claimed.rowCount === 0) {
      // Somebody already holds this key: either finished, or still working.
      const existing = await pool.query(
        `SELECT request_fingerprint, status_code, response_body, response_body = '{}'::jsonb AS pending
         FROM idempotency_keys WHERE user_id = $1 AND idempotency_key = $2`,
        [userId, key]
      );
      const row = existing.rows[0];

      if (!row) return next(); // Vanished between the two statements — treat it as a fresh request.

      if (row.request_fingerprint !== hash) {
        return res.status(422).json({
          message:
            'This Idempotency-Key was already used for a different request. Use a new key for a ' +
            'new request, or repeat the original one exactly.'
        });
      }

      if (row.pending) {
        return res.status(409).json({
          message: 'That request is still being processed. Retry in a moment with the same key.'
        });
      }

      return res.status(row.status_code).json(row.response_body);
    }

    // The claim is ours. Capture whatever the handler answers.
    //
    // `res.json` is wrapped to get the **body**, and `finish` is listened to for everything else —
    // because a 204 answered with `res.send()` never passes through `res.json` at all. Without the
    // second half, `DELETE /trips/:id/items/:id` would leave its claim pending forever and every
    // retry of it would get 409. Both paths settle the row exactly once, guarded by `settled`.
    let captured;
    let settled = false;

    const settle = (status, body) => {
      if (settled) return;
      settled = true;

      // Fire-and-forget: the client's response must not wait on bookkeeping, and a failure to
      // remember is a lost guarantee rather than a lost write.
      const query =
        status >= 200 && status < 300
          ? pool.query(
              `UPDATE idempotency_keys SET status_code = $1, response_body = $2
               WHERE user_id = $3 AND idempotency_key = $4`,
              [status, JSON.stringify(body ?? {}), userId, key]
            )
          : // A failure releases the key. Storing it would turn one bad moment into a permanent
            // one: the client retries and is handed the same 500 forever.
            pool.query('DELETE FROM idempotency_keys WHERE user_id = $1 AND idempotency_key = $2', [
              userId,
              key
            ]);

      query.catch((error) => logger.error({ err: error }, 'Idempotency bookkeeping failed'));
    };

    const originalJson = res.json.bind(res);
    res.json = (body) => {
      captured = body ?? {};
      return originalJson(body);
    };

    res.on('finish', () => settle(res.statusCode, captured ?? {}));

    return next();
  } catch (error) {
    // The guarantee is best-effort by design: a database problem here must not turn a working write
    // into a failed one. The request proceeds without protection, and the operator sees why.
    logger.error({ err: error }, 'Idempotency check failed — proceeding without it');
    return next();
  }
};

module.exports = { idempotent, fingerprint };
