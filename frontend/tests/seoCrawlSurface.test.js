/**
 * @jest-environment node
 *
 * Node, not the project's default jsdom, and that is load-bearing rather than incidental.
 * `resolveSiteUrl` branches on `typeof window === 'undefined'` to decide whether the server-only
 * `SITE_URL` is readable — and under jsdom `window` exists, so the whole server branch is
 * unreachable and every assertion about it silently tests the browser one instead. Both documents
 * here are produced in `getServerSideProps`, so node is also the environment they actually run in.
 * The browser branch gets its own test below, which defines `global.window` explicitly.
 */
import { buildRobotsTxt } from '../src/pages/robots.txt';
import { buildSitemap, collectPlaces } from '../src/pages/sitemap.xml';
import { normaliseSiteUrl, resolveSiteUrl, absoluteUrl } from '../src/services/siteUrl';

/**
 * The crawl surface (`IMP-113` part one): `robots.txt`, `sitemap.xml`, and the origin both need.
 *
 * These documents are read by machines that never report a parse error to us. A malformed
 * `<urlset>` namespace, a relative `<loc>`, a canonical pointing at the wrong host — each one fails
 * silently, at a crawler, weeks later. Nothing else in the suite can see them, so the assertions
 * here are unusually literal about format.
 */

const ORIGIN = 'https://easytrip.example';

const withEnv = (vars, fn) => {
  const saved = { ...process.env };
  Object.assign(process.env, vars);
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
  }
  try {
    return fn();
  } finally {
    process.env = saved;
  }
};

describe('the site origin', () => {
  test('a bare host is refused, because it cannot be a <loc>', () => {
    // `easytrip.example/places/1` is not a URL. Rejecting it turns a misconfiguration into an
    // absent canonical rather than a sitemap full of invalid entries.
    expect(normaliseSiteUrl('easytrip.example')).toBeNull();
    expect(normaliseSiteUrl('//easytrip.example')).toBeNull();
    expect(normaliseSiteUrl(ORIGIN)).toBe(ORIGIN);
    expect(normaliseSiteUrl('http://localhost:3000')).toBe('http://localhost:3000');
  });

  test('a trailing slash is stripped, so callers can concatenate a path', () => {
    expect(normaliseSiteUrl('https://easytrip.example/')).toBe(ORIGIN);
    expect(normaliseSiteUrl('https://easytrip.example///')).toBe(ORIGIN);
  });

  test('empty, blank and non-string values are all "unset"', () => {
    expect(normaliseSiteUrl('')).toBeNull();
    expect(normaliseSiteUrl('   ')).toBeNull();
    expect(normaliseSiteUrl(undefined)).toBeNull();
    expect(normaliseSiteUrl(null)).toBeNull();
  });

  test('the server-only SITE_URL wins over the public one', () => {
    // Same rule as `API_URL` in apiConfig: read at runtime, so one built artifact can serve a
    // preview and production.
    withEnv({ SITE_URL: 'https://internal.example', NEXT_PUBLIC_SITE_URL: ORIGIN }, () => {
      expect(resolveSiteUrl()).toBe('https://internal.example');
    });
  });

  test('an unusable SITE_URL falls through to the public one rather than winning as null', () => {
    withEnv({ SITE_URL: 'not-a-url', NEXT_PUBLIC_SITE_URL: ORIGIN }, () => {
      expect(resolveSiteUrl()).toBe(ORIGIN);
    });
  });

  test('with nothing configured there is no origin, and no guess', () => {
    withEnv({ SITE_URL: undefined, NEXT_PUBLIC_SITE_URL: undefined }, () => {
      expect(resolveSiteUrl()).toBeFalsy();
      expect(absoluteUrl('/sitemap.xml')).toBeNull();
    });
  });

  test('in the browser only the NEXT_PUBLIC_ value is readable', () => {
    // `SITE_URL` is not inlined into the bundle by design, so a browser-side canonical tag must
    // not appear to work in a test merely because the variable happened to be in the environment.
    withEnv({ SITE_URL: 'https://internal.example', NEXT_PUBLIC_SITE_URL: ORIGIN }, () => {
      global.window = {};
      try {
        expect(resolveSiteUrl()).toBe(ORIGIN);
      } finally {
        delete global.window;
      }
    });
  });

  test('absoluteUrl joins without doubling or dropping the slash', () => {
    withEnv({ SITE_URL: ORIGIN, NEXT_PUBLIC_SITE_URL: undefined }, () => {
      expect(absoluteUrl('/sitemap.xml')).toBe(`${ORIGIN}/sitemap.xml`);
      expect(absoluteUrl('sitemap.xml')).toBe(`${ORIGIN}/sitemap.xml`);
    });
  });
});

describe('robots.txt', () => {
  test('crawling is allowed by default', () => {
    const body = buildRobotsTxt(`${ORIGIN}/sitemap.xml`);
    expect(body).toContain('User-agent: *');
    expect(body).toContain('Allow: /');
    // The catastrophic typo this guards: a stray `Disallow: /` de-indexes the whole site, and
    // nothing in the app would look any different.
    expect(body).not.toMatch(/^Disallow: \/$/m);
  });

  test('the account and workspace pages are excluded', () => {
    const body = buildRobotsTxt(null);
    for (const path of ['/admin/', '/login', '/signup', '/forgot-password', '/saved', '/trips']) {
      expect(body).toContain(`Disallow: ${path}`);
    }
  });

  test('the sitemap is advertised as an absolute URL', () => {
    // A relative `Sitemap:` value is invalid; crawlers ignore the line entirely.
    expect(buildRobotsTxt(`${ORIGIN}/sitemap.xml`)).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
  });

  test('with no origin the Sitemap line is absent, not a guess', () => {
    const body = buildRobotsTxt(null);
    expect(body).not.toContain('Sitemap:');
    // …and the rest of the file is still served, so the Disallow rules still apply.
    expect(body).toContain('Disallow: /admin/');
  });

  test('it ends with a newline, as a line-oriented format requires', () => {
    expect(buildRobotsTxt(null).endsWith('\n')).toBe(true);
  });
});

describe('sitemap.xml', () => {
  const places = [
    { id: 1, name: 'Hampi', updated_at: '2026-08-01T10:00:00.000Z' },
    { id: 2, name: 'Coorg', updated_at: null }
  ];

  test('the urlset namespace is sitemaps.org — plural', () => {
    // One character, no runtime symptom, and a validator rejects the document outright. Written
    // wrong the first time this file was authored.
    expect(buildSitemap(places, ORIGIN)).toContain(
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
    );
  });

  test('every <loc> is absolute', () => {
    const xml = buildSitemap(places, ORIGIN);
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs.length).toBeGreaterThan(0);
    for (const loc of locs) expect(loc).toMatch(/^https?:\/\//);
  });

  test('it lists the public pages and every place', () => {
    const xml = buildSitemap(places, ORIGIN);
    expect(xml).toContain(`<loc>${ORIGIN}/</loc>`);
    expect(xml).toContain(`<loc>${ORIGIN}/browse</loc>`);
    expect(xml).toContain(`<loc>${ORIGIN}/about</loc>`);
    expect(xml).toContain(`<loc>${ORIGIN}/places/1</loc>`);
    expect(xml).toContain(`<loc>${ORIGIN}/places/2</loc>`);
  });

  test('it does NOT list anything robots.txt disallows', () => {
    // A URL that is both submitted and disallowed is a contradiction crawlers report as an error.
    const xml = buildSitemap(places, ORIGIN);
    const robots = buildRobotsTxt(null);
    const disallowed = [...robots.matchAll(/^Disallow: (.+)$/gm)].map((m) => m[1].trim());

    expect(disallowed.length).toBeGreaterThan(0);
    for (const path of disallowed) {
      expect(xml).not.toContain(`<loc>${ORIGIN}${path}`);
    }
  });

  test('lastmod is a date, and absent when the timestamp is', () => {
    const xml = buildSitemap(places, ORIGIN);
    expect(xml).toContain('<lastmod>2026-08-01</lastmod>');
    // Coorg has no `updated_at`. An invented date would tell a crawler the page changed today.
    expect([...xml.matchAll(/<lastmod>/g)]).toHaveLength(1);
  });

  test('an unparseable timestamp is omitted rather than rendered as Invalid Date', () => {
    const xml = buildSitemap([{ id: 3, updated_at: 'not a date' }], ORIGIN);
    expect(xml).not.toContain('<lastmod>');
    expect(xml).not.toContain('NaN');
    expect(xml).not.toContain('Invalid');
  });

  test('XML metacharacters in data are escaped', () => {
    // Not reachable through a place id, which is an integer — but `buildSitemap` takes whatever it
    // is handed, and the day it takes a slug this is the assertion that already exists.
    const xml = buildSitemap([{ id: 'a&b<c>"d\'', updated_at: null }], ORIGIN);
    expect(xml).toContain('a&amp;b&lt;c&gt;&quot;d&apos;');

    // Assert on the <loc> *contents*, extracted — a regex spanning the element matches the `<` of
    // the closing tag and reports every correctly escaped document as broken.
    const locs = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toHaveLength(4);
    for (const loc of locs) expect(loc).not.toMatch(/[<>"']/);
  });

  test('an empty catalogue still produces a valid document with the static routes', () => {
    const xml = buildSitemap([], ORIGIN);
    expect(xml).toContain('<urlset');
    expect(xml).toContain('</urlset>');
    expect(xml).toContain(`<loc>${ORIGIN}/browse</loc>`);
  });
});

describe('collecting the catalogue', () => {
  test('it pages until the server says there is no more', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValueOnce({ data: [{ id: 1 }], pagination: { hasMore: true } })
      .mockResolvedValueOnce({ data: [{ id: 2 }], pagination: { hasMore: false } });

    const { places, truncated } = await collectPlaces(fetcher);

    expect(places.map((p) => p.id)).toEqual([1, 2]);
    expect(truncated).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][0]).toMatchObject({ offset: 100 });
  });

  test('it orders by oldest, so a new place cannot shift the pages under it', async () => {
    // With `newest` (the default), inserting a place between two requests shifts every later
    // offset by one and the sitemap silently loses a row. Ascending by creation is stable.
    const fetcher = jest.fn().mockResolvedValue({ data: [], pagination: { hasMore: false } });
    await collectPlaces(fetcher);
    expect(fetcher.mock.calls[0][0]).toMatchObject({ sort: 'oldest' });
  });

  test('it stops at the cap and SAYS it stopped', async () => {
    // A silent cap serves a short sitemap that looks complete. The flag is what lets the handler
    // set a header instead.
    const fetcher = jest
      .fn()
      .mockResolvedValue({ data: [{ id: 1 }], pagination: { hasMore: true } });
    const { truncated, places } = await collectPlaces(fetcher);

    expect(truncated).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(50);
    expect(places).toHaveLength(50);
  });

  test('a response with no pagination block ends the loop rather than spinning', async () => {
    const fetcher = jest.fn().mockResolvedValue({ data: [{ id: 1 }] });
    const { places, truncated } = await collectPlaces(fetcher);
    expect(places).toHaveLength(1);
    expect(truncated).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
