import axios from 'axios';

import { resolveApiBaseUrl } from './apiConfig';

/**
 * The one axios instance (IMP-072).
 *
 * Before this, `adminService`, `placeService` and `newsletterService` each called `axios.post(...)`
 * on the bare module with a hand-built URL, and **the Authorization header was constructed at
 * eleven separate call sites**. Eleven places to forget it, eleven places to get the `Bearer `
 * prefix wrong, and eleven places to update when token handling changes — which is exactly the
 * shape of `IMP-003`, where the admin write path sent no token at all and nobody noticed because
 * there was no single place the omission would have been visible.
 *
 * Now: one instance, one base URL (`apiConfig.js`), one interceptor that attaches the token.
 *
 * ---------------------------------------------------------------------------
 * Why the token is fetched per request rather than cached
 * ---------------------------------------------------------------------------
 * `getIdToken()` returns a cached token and refreshes it only when it is close to expiry, so
 * calling it per request is cheap and is the SDK's intended usage. Holding our own copy would
 * reintroduce the bug this replaces: a long-lived tab sending a token that expired an hour ago.
 *
 * ---------------------------------------------------------------------------
 * Why Firebase is imported lazily
 * ---------------------------------------------------------------------------
 * `../config/firebase` calls `initializeApp` at module scope. A static import here would pull that
 * into every module that touches the API — including pages with `getStaticProps`, which run on the
 * server, where there is no user and no reason to initialise a browser SDK. The dynamic import
 * below is inside a `typeof window` guard, so the server path never loads it at all.
 */

const apiClient = axios.create({
  baseURL: resolveApiBaseUrl(),
  // Long enough for a slow mobile upload, short enough that a hung request surfaces as an error
  // rather than a spinner that never resolves.
  timeout: 30_000,
  headers: { Accept: 'application/json' }
});

/**
 * A consistent error shape for every caller.
 *
 * The services used to throw three different things: `error.response?.data`, a hand-rolled
 * `{ success, message }`, and occasionally the raw axios error. Callers therefore had to guess
 * whether to read `.message`, `.data.message` or `.response.data.message`.
 */
export class ApiClientError extends Error {
  constructor(message, status, data) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.data = data;
  }
}

/** Resolve a fresh Firebase ID token, or null when there is no signed-in user. */
const getIdToken = async () => {
  if (typeof window === 'undefined') return null;

  try {
    const { auth } = await import('../config/firebase');
    if (!auth.currentUser) return null;
    return await auth.currentUser.getIdToken();
  } catch {
    // A Firebase failure must not become an unhandled rejection inside an interceptor. Returning
    // null lets `requireAuth` below produce the clear 401 instead.
    return null;
  }
};

apiClient.interceptors.request.use(async (config) => {
  // An explicit token on the request wins — the admin pages already hold one from AuthContext and
  // passing it avoids a second SDK round trip.
  const token = config.authToken || (await getIdToken());

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  } else if (config.requireAuth) {
    throw new ApiClientError('You must be signed in to perform this action.', 401);
  }

  // Not part of the HTTP request; strip so axios does not try to serialise them.
  delete config.authToken;
  delete config.requireAuth;

  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    // Thrown by the request interceptor above — already the right shape.
    if (error instanceof ApiClientError) return Promise.reject(error);

    const status = error.response?.status;
    const data = error.response?.data;

    // express-validator answers a 400 as `{ message: 'Validation failed', errors: [{ message }] }`.
    // The field message ("Please enter a valid email address") is the one worth showing a user;
    // the envelope message is not. Unwrapped here rather than in each service, because it is the
    // API's convention rather than any one endpoint's — four call sites were repeating this.
    const message =
      data?.errors?.[0]?.message ||
      data?.message ||
      (status ? `Request failed with status ${status}` : null) ||
      // No response at all: the server is unreachable, DNS failed, or the request timed out.
      // `error.message` here is axios's own text, which is more useful than a generic string.
      error.message ||
      'Request failed';

    return Promise.reject(new ApiClientError(message, status, data));
  }
);

export default apiClient;
