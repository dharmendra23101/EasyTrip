/**
 * The one place the API base URL is decided (IMP-072).
 *
 * There were three conventions before this, which is two more than a codebase can afford:
 *
 *   1. `placesApi.js`     — `API_URL || NEXT_PUBLIC_API_URL || 'http://localhost:5000/api'`,
 *                           server/client aware. The correct one; it is what this file is.
 *   2. `placeService.js`  — `NEXT_PUBLIC_API_URL || 'http://localhost:5000/api'`. No server-side
 *                           indirection, so it could not be pointed at an internal address.
 *   3. `adminService.js`  — `NEXT_PUBLIC_API_URL` and **nothing else**. With the variable unset,
 *                           every admin request went to the literal string
 *                           `undefined/admin/places`, which is a 404 from a URL that looks like a
 *                           typo rather than a missing configuration.
 *
 * Case 3 is the reason this file exists rather than a comment asking people to be careful.
 */

/** The last-resort default. Development-only in practice: production sets the variable. */
const DEFAULT_API_URL = 'http://localhost:5000/api';

/**
 * Resolve the API base URL for the current execution context.
 *
 * `API_URL` is **server-only and wins when set**. It is deliberately not a `NEXT_PUBLIC_` name, so
 * it is read at runtime rather than inlined at build time — which lets the Next server reach the
 * API over an internal address (a container name, a private IP) while the browser bundle keeps the
 * public one. A `NEXT_PUBLIC_` variable cannot do this: its value is compiled into the artifact.
 *
 * In the browser only `NEXT_PUBLIC_API_URL` is meaningful, because that is the only one that
 * survives into the bundle.
 */
export const resolveApiBaseUrl = () => {
  if (typeof window === 'undefined') {
    return process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || DEFAULT_API_URL;
  }
  return process.env.NEXT_PUBLIC_API_URL || DEFAULT_API_URL;
};

export { DEFAULT_API_URL };
