import { absoluteUrl } from '../services/siteUrl';

/**
 * `robots.txt` (`IMP-113`).
 *
 * A route rather than a file in `public/`, for one reason: the `Sitemap:` directive must be an
 * absolute URL, and the origin differs between a preview deployment and production. A static file
 * would have to hard-code one of them, and the wrong one is worse than none — it points crawlers at
 * a host this deployment does not serve.
 *
 * `buildRobotsTxt` is exported separately so it can be asserted without a Next request/response
 * pair; the handler below is the two lines that turn it into a response.
 */

/**
 * The body, for a given origin (or `null` when none is configured).
 *
 * **What is disallowed and why each one.** This is not a security control — `robots.txt` is a
 * request, it is public, and it tells a hostile reader exactly which paths exist. Nothing here is
 * secret: `/admin` is already gated server-side (`IMP-054`) and returns a redirect to anyone
 * without an admin token. These entries exist to keep pages that are useless in an index *out* of
 * one:
 *
 *   /admin/     — a curation UI. Every route under it redirects a crawler to /login.
 *   /login,     — authentication pages. Indexing them competes with the real content for the
 *   /signup,      site's own brand queries, which is the standard reason to exclude them.
 *   /forgot-password
 *   /saved,     — per-user pages. They render nothing for a signed-out crawler, so an indexed copy
 *   /trips        would be an empty page carrying the site's name.
 *
 * `/api` is deliberately **not** listed: it is served by Express on a different origin, so a rule
 * here would not apply to it, and writing one would suggest a protection that is not in place.
 */
export const buildRobotsTxt = (origin) => {
  const lines = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin/',
    'Disallow: /login',
    'Disallow: /signup',
    'Disallow: /forgot-password',
    'Disallow: /saved',
    'Disallow: /trips'
  ];

  // Omitted rather than guessed when no origin is configured — see `siteUrl.js`.
  if (origin) lines.push('', `Sitemap: ${origin}`);

  return `${lines.join('\n')}\n`;
};

export const getServerSideProps = ({ res }) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  // An hour at the CDN. Long enough that crawlers do not re-fetch it constantly, short enough that
  // correcting a mistaken Disallow does not need a purge.
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
  res.write(buildRobotsTxt(absoluteUrl('/sitemap.xml')));
  res.end();

  return { props: {} };
};

// Next requires a default export from a page module. This one never renders: `getServerSideProps`
// has already ended the response.
const Robots = () => null;
export default Robots;
