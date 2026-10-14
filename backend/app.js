require('dotenv').config();

// Validate the environment before anything reads it (IMP-100). This must stay above the config
// requires below: firebase-admin and cloudinary both consume these variables at require time, so
// validating after them means the SDK's own error arrives first — and the SDK's error describes a
// malformed credential, not the missing variable that produced it.
require('./src/config/env').validateEnv();

// Initialize configurations first. Firebase Admin must be initialized before any
// route is mounted, otherwise admin.auth() throws on every authenticated request.
require('./src/config/firebase-admin');
// Cloudinary configures itself on require; the controllers import the helpers they need.
require('./src/config/cloudinary');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const pool = require('./src/config/db');
const { listMigrationFiles } = require('./src/config/migrationFiles');
const { errorHandler } = require('./src/utils/errorHandler');
const logger = require('./src/utils/logger');
const requestLogger = require('./src/utils/requestLogger');
const { installProcessHandlers } = require('./src/utils/processLifecycle');

// Import routes
const placeRoutes = require('./src/routes/placeRoutes');
const authRoutes = require('./src/routes/authRoutes');
const adminRoutes = require('./src/routes/adminRoutes');
const newsletterRoutes = require('./src/routes/newsletterRoutes');

const app = express();
const PORT = process.env.PORT || 5000;

// Behind a hosting proxy the client IP arrives in X-Forwarded-For; rate limiting
// buckets by IP, so this must be set there and only there (trusting the header
// without a proxy in front lets any caller spoof its own IP).
const trustProxyHops = Number.parseInt(process.env.TRUST_PROXY_HOPS || '', 10);
if (Number.isInteger(trustProxyHops) && trustProxyHops > 0) {
  app.set('trust proxy', trustProxyHops);
}

// gzip/brotli for every response above the threshold. Place lists are large, highly repetitive
// JSON — the same ~20 keys repeated per row — which compresses extremely well. Registered before
// the routers so it wraps their output (IMP-038).
app.use(
  compression({
    // Below ~1 KB the compression header overhead outweighs the saving.
    threshold: 1024,
    // Honour an explicit opt-out, which image redirects and already-compressed payloads can set.
    filter: (req, res) => (res.getHeader('x-no-compression') ? false : compression.filter(req, res))
  })
);

// Security headers
app.disable('x-powered-by');
app.use(
  helmet({
    // This API serves place images cross-origin to the frontend, so the default
    // same-origin resource policy would block them.
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  })
);

// Per-request logging (IMP-071). Registered here — after the security headers, before CORS and the
// rate limiters — so that rejected requests are logged too. A 403 from the origin check and a 429
// from a rate limiter are exactly the requests worth seeing, and a logger mounted after them would
// record neither. It logs on response finish, so it captures the status either way.
app.use(requestLogger);

// Middleware
const allowedOrigins = String(process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

if (allowedOrigins.length === 0) {
  if (process.env.NODE_ENV === 'production') {
    // An empty allowlist in production 403s every browser request. Refusing to boot
    // surfaces that as one obvious error instead of a site-wide CORS mystery.
    logger.fatal(
      'CORS_ALLOWED_ORIGINS is not set. In production every browser origin would be rejected. ' +
        'Set it to a comma-separated origin list, e.g. ' +
        'CORS_ALLOWED_ORIGINS=https://easytrip-psi.vercel.app'
    );
    process.exit(1);
  }
  allowedOrigins.push('http://localhost:3000');
}

// Requests with no Origin header (curl, server-to-server, same-origin) are not subject
// to CORS and pass through.
const isAllowedOrigin = (origin) => !origin || allowedOrigins.includes(origin);

app.use(
  cors({
    origin: (origin, callback) => callback(null, isAllowedOrigin(origin)),
    credentials: true,
    // Without this the browser re-runs a preflight OPTIONS before *every* cross-origin request that
    // carries an Authorization header — doubling the request count on an authenticated page for no
    // information gain. 24h is the maximum Chromium honours; Firefox caps at 24h too (IMP-039).
    maxAge: 86400,
    // Named explicitly so the preflight response is cacheable and stable. The client sends only
    // Authorization and Content-Type; the former X-User header is gone (IMP-003).
    allowedHeaders: ['Content-Type', 'Authorization'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
  })
);

// A disallowed origin gets a clean 403 rather than a thrown error surfacing as a 500.
// Registered AFTER cors() on purpose: Express runs middleware in registration order, so
// rejecting first would send a response with no Access-Control-Allow-Origin header and
// the calling page would see an opaque CORS failure instead of this message.
app.use((req, res, next) => {
  if (!isAllowedOrigin(req.headers.origin)) {
    return res.status(403).json({ message: 'Origin not allowed' });
  }
  next();
});

// Rate limiting: a global ceiling plus tighter buckets on the abuse-prone writes
// (review spam, uploads against the Cloudinary quota, admin mutations). Mounted
// ahead of the body parsers and the routers so a flood is rejected before a
// 10 MB payload is parsed, and so the buckets also cover the /api/admin/places
// handlers that placeRoutes serves.
const limiterOptions = (windowMs, limit, message) => ({
  windowMs,
  limit,
  standardHeaders: true,
  legacyHeaders: false,
  // CORS preflights are browser overhead, not caller intent.
  skip: (req) => req.method === 'OPTIONS',
  message: { message }
});

// `BUG-049`, resolved in Sprint 6.17: the image reads are bucketed like everything else.
//
// There used to be an `isImageRead` exemption here, taking GET /places/:id/image and
// /places/:id/images/:imageId out of the global bucket entirely. The reason was specific and, at
// the time, correct: the card-image fallback was fetched once per place *through a server-side
// Next proxy*, so one /browse load arrived as dozens of hits from a single IP — the Next server's
// — and bucketing them would have 429'd every user behind it.
//
// `IMP-037` removed that architecture: the API returns an absolute CDN url or null, and
// `getPlaceImageUrl` falls back to a local placeholder, so the frontend stopped requesting these
// routes. Sprint 6.16 then deleted the proxy itself as dead code. Nothing can concentrate hits any
// more — `next/image` cannot either, since `remotePatterns` admits only `res.cloudinary.com`.
//
// So the exemption had inverted: with no proxy, the only callers are direct ones, and it was
// lifting the ceiling from exactly the end-user IPs it existed to protect from each other. These
// are public, unauthenticated, and cost one to three queries each. They are back under the same
// 1000-per-15-minutes ceiling as the rest of the API.
const globalLimiter = rateLimit(
  limiterOptions(15 * 60 * 1000, 1000, 'Too many requests, please try again later')
);
const reviewWriteLimiter = rateLimit(
  limiterOptions(60 * 60 * 1000, 10, 'Too many reviews submitted, please try again later')
);
const uploadLimiter = rateLimit(
  limiterOptions(60 * 60 * 1000, 30, 'Too many uploads, please try again later')
);
const adminWriteLimiter = rateLimit(
  limiterOptions(15 * 60 * 1000, 60, 'Too many admin requests, please try again later')
);
// The newsletter endpoint is the only unauthenticated write in the API, so the rate limit is the
// only thing bounding it. Deliberately tighter than the review limiter: a person subscribes once,
// not ten times an hour.
const newsletterLimiter = rateLimit(
  limiterOptions(60 * 60 * 1000, 5, 'Too many subscription attempts, please try again later')
);
// Reporting is authenticated and idempotent per review, but one account can still report many
// different reviews; this bounds that without getting in a genuine user's way.
const reportLimiter = rateLimit(
  limiterOptions(60 * 60 * 1000, 20, 'Too many reports submitted, please try again later')
);

// The limiters, reachable by name. `app.locals` is Express's own place for application-level
// references, so this is introspection rather than a test hook — but the reason it exists is the
// API suite (IMP-092): the stores are in-memory and per-process, so without a way to reset them
// between tests the fifth newsletter assertion 429s and every test after it depends on how many
// requests the ones before it happened to make.
const rateLimiters = {
  global: globalLimiter,
  reviewWrite: reviewWriteLimiter,
  upload: uploadLimiter,
  adminWrite: adminWriteLimiter,
  newsletter: newsletterLimiter,
  report: reportLimiter
};

const writeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const onWrites = (limiter) => (req, res, next) =>
  writeMethods.has(req.method) ? limiter(req, res, next) : next();

app.locals.rateLimiters = rateLimiters;

app.use(globalLimiter);
app.post('/api/places/:id/reviews', reviewWriteLimiter);
app.post('/api/places/:id/reviews/:reviewId/report', reportLimiter);
app.post('/api/newsletter', newsletterLimiter);
app.post('/api/admin/places', uploadLimiter);
app.put('/api/admin/places/:id', uploadLimiter);
// Gallery uploads are the same cost as a primary-image upload, so they share its budget.
app.post('/api/admin/places/:id/images', uploadLimiter);
app.use('/api/admin', onWrites(adminWriteLimiter));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Cache policy for public read-only JSON (IMP-047).
//
// Express already generates an ETag per response, but it could never match: every place payload
// carried a `fetched_at` timestamp that changed on each request, so the body — and therefore the
// ETag — differed every time. With that removed, identical data now produces an identical ETag and
// a repeat request can be answered with a 304 and no body at all.
//
// `must-revalidate` with a short max-age rather than a long one: place data is admin-edited and an
// edit should surface quickly. The win here is the conditional request, not the freshness window.
//
// Scoped to GET on public place reads. Authenticated and admin routes are deliberately excluded —
// caching a per-user response in a shared proxy is how one user ends up seeing another's data.
const PUBLIC_CACHEABLE = /^\/api\/places(\/\d+)?(\/(images|reviews))?\/?$/;
app.use((req, res, next) => {
  if (req.method === 'GET' && PUBLIC_CACHEABLE.test(req.path) && !req.headers.authorization) {
    res.set('Cache-Control', 'public, max-age=60, must-revalidate');
  } else if (req.method === 'GET' && req.path.startsWith('/api/')) {
    // Everything else is either user-specific or admin-only. Say so explicitly rather than
    // leaving it to a proxy's default heuristics.
    res.set('Cache-Control', 'private, no-cache');
  }
  next();
});

// Report unapplied migrations at boot — READ-ONLY (IMP-069).
//
// This replaces `ensureDatabaseSchema()`, which used to run `ALTER TABLE ... IF NOT EXISTS` on
// every start. That was self-healing, which is a real property to give up, so this is what takes
// its place: boot no longer *fixes* schema drift, but it still *notices* it. Removing the DDL
// without adding this would mean a deploy that forgot `npm run migrate` looks completely healthy
// until the first request touches a missing column.
//
// Two deliberate choices:
//   - It only SELECTs. The whole point of retiring boot-time DDL is that the runtime database role
//     no longer needs DDL privileges (TD-004); a boot check that wrote would hand them straight
//     back.
//   - A pending migration warns, it does not exit. During a rolling deploy the new process can
//     legitimately start seconds before the migration job finishes, and refusing to boot would
//     turn a routine ordering gap into an outage.
async function warnIfMigrationsPending() {
  try {
    const applied = await pool
      .query('SELECT filename FROM schema_migrations')
      .then(({ rows }) => new Set(rows.map((row) => row.filename)))
      // 42P01 = undefined_table. The migrations table itself is created by the runner, so its
      // absence means the runner has never run here — every migration is pending.
      .catch((error) => {
        if (error.code === '42P01') return new Set();
        throw error;
      });

    const pending = listMigrationFiles()
      .map((file) => file.name)
      .filter((name) => !applied.has(name));

    if (pending.length === 0) {
      logger.info({ applied: applied.size }, 'Database schema is up to date');
      return;
    }

    logger.warn(
      { pending, count: pending.length },
      `${pending.length} unapplied migration(s) — the schema this build expects is not the ` +
        'schema the database has. Run: npm run migrate'
    );
  } catch (error) {
    // A database that is unreachable is already reported by the connection check below; this
    // should not add a second, more confusing error about migrations on top of it.
    logger.error({ err: error }, 'Could not check migration status');
  }
}

warnIfMigrationsPending();

// Health check endpoint — deliberately minimal: environment name, driver error
// text, and provider configuration are all reconnaissance material.
app.get('/api/health', async (req, res) => {
  const database = await pool
    .query('SELECT 1')
    .then(() => true)
    .catch(() => false);

  res.status(database ? 200 : 503).json({
    status: database ? 'ok' : 'degraded',
    database
  });
});

// Routes
app.use('/api', placeRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/newsletter', newsletterRoutes);

// 404 handler.
//
// **No path argument, deliberately.** Express 5 moved to path-to-regexp v8, which rejects a bare
// `'*'` — it would have to become `'/{*splat}'`. A pathless `app.use` matches everything that
// reached here without being handled, which is the same thing this always meant and does not depend
// on a wildcard dialect that has now changed twice. `platform.test.js` asserts the behaviour ("an
// unknown route 404s as JSON rather than an HTML stack page"), so a regression here fails by name.
app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// Error handler. Shared with the routers so a thrown error carrying an explicit
// status (multer's 400s, for instance) is not flattened into a 500.
app.use(errorHandler);

// Test database connection
pool
  .query('SELECT NOW() as current_time')
  .then((result) => {
    logger.info({ serverTime: result.rows[0].current_time }, 'PostgreSQL connected');
  })
  .catch((err) => {
    logger.error({ err }, 'Database connection failed');

    // The specific failure introduced by turning on certificate verification (IMP-063). Managed
    // providers commonly issue certificates from their own root, which Node does not trust out of
    // the box, and the raw driver message ("self-signed certificate in certificate chain") reads
    // like a broken database rather than a missing CA bundle.
    if (/self[- ]signed certificate|unable to verify the first certificate/i.test(err.message)) {
      logger.error(
        'This is TLS certificate verification, not a connectivity problem. Either set ' +
          "DATABASE_CA_CERT to your provider's CA certificate (preferred), or set " +
          'DATABASE_SSL_NO_VERIFY=true to accept an unverified certificate. See backend/.env.example.'
      );
    }
  });

// Listen only when this file is the process entry point (IMP-092).
//
// The API test suite imports this module to drive it with supertest, which needs the configured
// app but must not bind a port: an open listener keeps the Node event loop alive, so Jest hangs
// after the last assertion instead of exiting. `npm start`, `npm run dev` and `node app.js` are
// unaffected — this file is still the entry point, it just no longer listens when required.
if (require.main === module) {
  const server = app.listen(PORT, () => {
    // One line, not six. The old banner printed every route's base URL on every boot — a
    // development convenience that cost six lines in every production log, and that went stale the
    // moment a router was added or removed.
    logger.info(
      { port: PORT, env: process.env.NODE_ENV || 'development' },
      `Server listening on port ${PORT}`
    );
  });

  // Crash and shutdown handling (`FV-021`), installed here and only here — for the same reason
  // `listen` is: the API suite imports this module, and a test process that installed a SIGINT
  // handler or an `uncaughtException` handler would be intercepting signals Jest relies on.
  //
  // Until this existed, the two events that matter most bypassed `IMP-071` entirely: a crash was
  // printed by Node as an unstructured stack on stderr, and a SIGTERM — which every managed host
  // sends before stopping a container — logged nothing at all, so a routine deploy and a hard
  // crash looked identical in the log stream.
  installProcessHandlers({ server, pool, logger });
}

module.exports = app;
