const pool = require('../config/db');
const logger = require('../utils/logger');

// Where a signup came from. Kept here rather than as a database CHECK so adding a surface is a
// one-line change with no migration; the API is the layer that knows which surfaces exist.
// Anything unrecognised is stored as 'unknown' rather than rejected — a caller getting the source
// wrong should not cost the user their subscription.
const KNOWN_SOURCES = new Set(['footer', 'place_page', 'landing', 'api']);

const normaliseSource = (source) => (KNOWN_SOURCES.has(source) ? source : 'unknown');

/**
 * Subscribe an email address to the newsletter.
 *
 * Public and unauthenticated, so it is deliberately incurious: it never reveals whether an address
 * was already on the list. Re-subscribing an existing address is a success, and re-subscribing one
 * that had unsubscribed reactivates it.
 */
const subscribe = async (req, res) => {
  try {
    const { email, source } = req.body;

    // Normalise before insert so UNIQUE(email) is a real duplicate guard. Postgres would otherwise
    // treat 'A@b.com' and 'a@b.com' as two different subscribers.
    const normalisedEmail = String(email).trim().toLowerCase();

    await pool.query(
      `INSERT INTO newsletter_subscribers (email, status, subscribed_at, source)
       VALUES ($1, 'subscribed', NOW(), $2)
       ON CONFLICT (email) DO UPDATE
       SET status = 'subscribed',
           subscribed_at = NOW(),
           unsubscribed_at = NULL,
           -- Keep the original source: where someone first signed up is the useful fact, and
           -- overwriting it would quietly rewrite history every time they resubscribe.
           updated_at = NOW()`,
      [normalisedEmail, normaliseSource(source)]
    );

    // Always the same response. A different message for "already subscribed" would turn this into
    // a way to test which addresses are on the list.
    res.status(200).json({ message: "Thanks for subscribing! We'll be in touch." });
  } catch (error) {
    logger.error({ err: error }, 'Error subscribing to newsletter');

    // 42P01: undefined_table — the endpoint cannot work until 003 is applied. Name the fix in the
    // server log rather than leaving a bare 500 to be diagnosed from scratch.
    if (error.code === '42P01') {
      logger.error('newsletter_subscribers does not exist. Run: npm run migrate');
      return res.status(500).json({
        message:
          'Subscriptions are temporarily unavailable — the server is missing a required table'
      });
    }

    res.status(500).json({ message: 'Could not complete your subscription. Please try again.' });
  }
};

module.exports = { subscribe };
