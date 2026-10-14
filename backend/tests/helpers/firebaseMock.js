/**
 * A stand-in for `firebase-admin`, so the API suite can exercise real auth paths (IMP-092).
 *
 * The middleware's only question of Firebase is "decode this bearer token". Everything that
 * follows — is this user an admin, does the claim agree with the database, is the token revoked —
 * is EasyTrip's own logic, and that is the logic worth testing. Mocking the SDK is what makes
 * those paths reachable without a real Firebase project.
 *
 * A test token is just a JSON payload: `token('{"uid":"seed-admin-uid"}')`. Two magic values
 * simulate failure, because those are the cases the real SDK expresses by throwing:
 *   - `INVALID`  -> auth/argument-error, i.e. a malformed or forged token
 *   - `EXPIRED`  -> auth/id-token-expired
 */

const INVALID = 'INVALID';
const EXPIRED = 'EXPIRED';

/** Build a bearer token carrying an arbitrary decoded payload. */
const tokenFor = (payload) => Buffer.from(JSON.stringify(payload)).toString('base64');

/** `Authorization` header value for a payload. */
const authHeader = (payload) => `Bearer ${tokenFor(payload)}`;

const makeError = (code, message) => {
  const err = new Error(message);
  err.code = code;
  return err;
};

const verifyIdToken = jest.fn(async (token) => {
  if (token === INVALID)
    throw makeError('auth/argument-error', 'Decoding Firebase ID token failed');
  if (token === EXPIRED) throw makeError('auth/id-token-expired', 'Firebase ID token has expired');

  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(token, 'base64').toString('utf8'));
  } catch {
    throw makeError('auth/argument-error', 'Decoding Firebase ID token failed');
  }
  if (!decoded || typeof decoded.uid !== 'string') {
    throw makeError('auth/argument-error', 'Token carries no uid');
  }
  return decoded;
});

const getUser = jest.fn(async (uid) => ({ uid, email: `${uid}@easytrip.test`, displayName: uid }));
const revokeRefreshTokens = jest.fn(async () => undefined);
const setCustomUserClaims = jest.fn(async () => undefined);

/**
 * Look a user up by email, as `adminController` does when granting or revoking admin.
 *
 * Added in Sprint 6.14. Its absence is the whole reason `addAdmin`/`removeAdmin` had **zero**
 * coverage: without it, every request to those endpoints died inside the mock rather than in the
 * code under test, so nobody could reach the privilege-change logic at all.
 *
 * The mapping is deliberately reversible against the seed (`admin@easytrip.test` ↔ `seed-admin-uid`)
 * so a test can name either side. `customClaims` is settable per-user, because `syncAdminClaim`
 * merges the existing set and `setCustomUserClaims` *replaces* it — an invariant that is
 * untestable if every user is claimless.
 */
const seededUsers = new Map();

/** Register (or replace) a Firebase user the mock will resolve by email. */
const registerFirebaseUser = ({ uid, email, displayName = '', customClaims }) => {
  seededUsers.set(email, { uid, email, displayName, customClaims });
  return seededUsers.get(email);
};

/** Forget every registered user — call between tests so state does not leak across them. */
const resetFirebaseUsers = () => seededUsers.clear();

const getUserByEmail = jest.fn(async (email) => {
  if (seededUsers.has(email)) return seededUsers.get(email);
  throw makeError(
    'auth/user-not-found',
    'There is no user record corresponding to this identifier'
  );
});

const auth = () => ({
  verifyIdToken,
  getUser,
  getUserByEmail,
  revokeRefreshTokens,
  setCustomUserClaims
});

/**
 * A non-empty `getApps()` plus a working `getApp()` is what makes `initializeFirebaseAdmin`
 * short-circuit: it returns the existing app rather than reading the three service-account
 * variables and calling `process.exit(1)` when they are absent.
 */
const fakeApp = { name: '[DEFAULT]', options: {} };

/**
 * **Two shapes, because `firebase-admin` v13 split into subpaths.** The old single namespace
 * (`admin.auth()`, `admin.apps`, `admin.credential`) is gone; the package root is now the modular
 * app API and Auth lives at `firebase-admin/auth`. `tests/setup/env.js` mocks both paths from this
 * one module, so the fake user store below is shared between them rather than duplicated.
 */
const appModule = {
  initializeApp: jest.fn(() => fakeApp),
  getApp: jest.fn(() => fakeApp),
  getApps: jest.fn(() => [fakeApp]),
  cert: jest.fn(() => ({}))
};

const authModule = {
  getAuth: jest.fn(() => auth())
};

module.exports = {
  appModule,
  authModule,
  auth,
  // Test-only exports
  __mock: {
    verifyIdToken,
    getUser,
    getUserByEmail,
    revokeRefreshTokens,
    setCustomUserClaims,
    registerFirebaseUser,
    resetFirebaseUsers
  },
  INVALID,
  EXPIRED,
  tokenFor,
  authHeader,
  registerFirebaseUser,
  resetFirebaseUsers
};
