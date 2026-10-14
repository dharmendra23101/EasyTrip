import { fetchPlaces } from '../services/placesApi';
import { resolveSiteUrl } from '../services/siteUrl';

/**
 * `sitemap.xml`, generated from the live catalogue (`IMP-113`).
 *
 * **Server-rendered per request, not built.** `IMP-040` made `/places/[id]` ISR, so a place added
 * through the admin UI becomes a real page without a rebuild — and a sitemap baked at build time
 * would not list it until the next deploy. Generating it on request is the only version that stays
 * true of a catalogue that changes between builds.
 *
 * A sitemap is not a security boundary and this one lists exactly what the public API already
 * returns: the catalogue is browsable without an account, so nothing here is newly exposed.
 */

// A sitemap may hold 50,000 URLs; beyond that the format requires a sitemap *index*, which is a
// different document. The cap below is far under that and exists to bound the request, not to
// approach the limit — a catalogue that ever reaches it needs the index, and `truncated` below says
// so out loud rather than silently serving a partial map.
const PAGE_SIZE = 100;
const MAX_PAGES = 50;

/** XML text escaping. */
const escapeXml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/** `<lastmod>` wants a date, and an unparseable timestamp is omitted rather than guessed. */
const lastmod = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
};

/**
 * Every place in the catalogue, paged.
 *
 * The `map` projection would return all of them in one request, but it omits `updated_at`, and a
 * sitemap without `<lastmod>` gives a crawler no reason to re-fetch a page that changed. Paging the
 * list projection is the version that carries the timestamp.
 *
 * Returns `{ places, truncated }` — `truncated` is true when the cap was reached, so the caller can
 * say so rather than serving a short sitemap that looks complete.
 */
export const collectPlaces = async (fetcher = fetchPlaces) => {
  const places = [];

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = await fetcher({
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      sort: 'oldest'
    });

    places.push(...(response?.data || []));
    if (!response?.pagination?.hasMore) return { places, truncated: false };
  }

  return { places, truncated: true };
};

/** The document. Separated from the handler so it can be asserted without a Next response. */
export const buildSitemap = (places, origin) => {
  const urls = [
    // Static routes worth indexing. `/about` is the only other page with content of its own; the
    // account and workspace pages are the ones `robots.txt` excludes, and listing a page in a
    // sitemap that robots.txt disallows is a contradiction crawlers report as an error.
    { loc: `${origin}/`, changefreq: 'daily', priority: '1.0' },
    { loc: `${origin}/browse`, changefreq: 'daily', priority: '0.9' },
    { loc: `${origin}/about`, changefreq: 'monthly', priority: '0.5' },
    ...places.map((place) => ({
      loc: `${origin}/places/${place.id}`,
      lastmod: lastmod(place.updated_at),
      changefreq: 'weekly',
      priority: '0.8'
    }))
  ];

  const body = urls
    .map(({ loc, lastmod: modified, changefreq, priority }) =>
      [
        '  <url>',
        `    <loc>${escapeXml(loc)}</loc>`,
        modified ? `    <lastmod>${modified}</lastmod>` : null,
        `    <changefreq>${changefreq}</changefreq>`,
        `    <priority>${priority}</priority>`,
        '  </url>'
      ]
        .filter(Boolean)
        .join('\n')
    )
    .join('\n');

  // The namespace is `sitemaps.org` — plural. A validator rejects the singular, and it is the one
  // character in this file that nothing else would catch.
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;
};

export const getServerSideProps = async ({ res }) => {
  const origin = resolveSiteUrl();

  // With no configured origin every `<loc>` would be a relative path, which is invalid in a
  // sitemap — so this is a 404 rather than a document a crawler would reject as malformed.
  // `robots.txt` omits the `Sitemap:` line in the same situation, so nothing points here.
  if (!origin) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('sitemap unavailable: no site URL is configured\n');
    return { props: {} };
  }

  let places = [];
  let truncated = false;
  try {
    ({ places, truncated } = await collectPlaces());
  } catch {
    // The static routes are still worth serving. A sitemap missing its place URLs is a smaller
    // failure than a 500, which a crawler may treat as the sitemap being permanently gone.
    places = [];
  }

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
  if (truncated) {
    // Not silent: `MAX_PAGES` was reached, so this document is incomplete and the fix is a sitemap
    // index. A header rather than an XML comment, because a comment inside `<urlset>` is noise for
    // every consumer and this is a message for whoever is operating the site.
    res.setHeader('X-Sitemap-Truncated', `true; showing first ${MAX_PAGES * PAGE_SIZE} places`);
  }
  res.write(buildSitemap(places, origin));
  res.end();

  return { props: {} };
};

const Sitemap = () => null;
export default Sitemap;
