import { resolveApiBaseUrl } from './apiConfig';

/**
 * The server-side admin gate, in one place (IMP-072).
 *
 * This function was copy-pasted verbatim into four pages — `admin/index`, `admin/addPlace`,
 * `admin/managePlaces` and `admin/editPlace/[id]` — twenty-five identical lines each, including
 * four separate hand-built `Authorization` headers and four separate base-URL constructions. They
 * were byte-identical, which is the good case; the bad case is the one where someone fixes three
 * of them.
 *
 * It is a *security* gate, which is why it is worth deduplicating rather than tolerating: a
 * divergence here does not look like a bug, it looks like a page that loads.
 *
 * Uses `fetch` rather than the shared axios client on purpose. This runs only on the server, where
 * the token comes from a cookie rather than the Firebase SDK, so the client's browser-oriented auth
 * interceptor has nothing to contribute — and `fetch` keeps axios out of the paths that do not
 * already need it.
 *
 * A Firebase ID token lives in browser JS memory and is not sent with a document request, so it
 * only reaches `getServerSideProps` because the auth layer mirrors it into the `et_id_token`
 * cookie. The `useEffect` guards in the pages remain as defence in depth for client-side
 * navigations, which never re-run this.
 */

const LOGIN_REDIRECT = { redirect: { destination: '/login', permanent: false } };
const HOME_REDIRECT = { redirect: { destination: '/', permanent: false } };

/**
 * Verify the caller is an admin, and return the `getServerSideProps` result.
 *
 * @param {Object} context - the Next.js context; only `req.cookies` is read
 * @returns {Promise<{props: {}} | {redirect: {destination: string, permanent: boolean}}>}
 *
 * Every failure mode redirects rather than throwing: an unverifiable token, a non-admin, an
 * unreachable API. A 500 here would render an error page to someone who should simply be sent to
 * sign in, and it would say more about the deployment than an anonymous visitor needs to know.
 */
export const requireAdminPage = async ({ req }) => {
  const token = req.cookies?.et_id_token;

  if (!token) return LOGIN_REDIRECT;

  try {
    const response = await fetch(`${resolveApiBaseUrl()}/auth/check-admin`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!response.ok) return LOGIN_REDIRECT;

    const { isAdmin } = await response.json();
    if (!isAdmin) return HOME_REDIRECT;
  } catch (error) {
    // Server-side console: this is the Next server's log, not the browser's.
    console.error('Admin gate check failed:', error.message);
    return LOGIN_REDIRECT;
  }

  return { props: {} };
};

export default requireAdminPage;
