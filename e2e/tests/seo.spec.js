const { test, expect } = require('@playwright/test');

/**
 * The SEO surface, served (`IMP-113`).
 *
 * `seoCrawlSurface.test.js` and `placeStructuredData.test.js` prove what the *builders* produce.
 * Neither can prove the thing this file is for: that Next actually routes `/robots.txt` and
 * `/sitemap.xml`, that the handlers set a content type a crawler will accept, and — the one that
 * matters most — that the tags and the JSON-LD are in the **server-rendered HTML** rather than
 * added by React after hydration.
 *
 * That last distinction is the whole reason `IMP-113` exists. A crawler reads the response body. A
 * meta tag that only appears once JavaScript has run is, to it, not there. The previous `og:url`
 * shipped as `content=""` for exactly this reason: it was computed from `window.location`.
 *
 * `NEXT_PUBLIC_SITE_URL` is not set for the E2E server, so the origin-dependent tags are absent
 * here by design — and the assertions below check that the absence is *clean* (no empty
 * `content=""`, no relative `<loc>`), which is the behaviour `siteUrl.js` promises.
 */

test.describe('robots.txt', () => {
  test('it is served as plain text and allows crawling', async ({ request }) => {
    const response = await request.get('/robots.txt');

    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/plain');

    const body = await response.text();
    expect(body).toContain('User-agent: *');
    expect(body).toContain('Allow: /');
    // The one-line catastrophe: a blanket disallow de-indexes the site and looks like nothing.
    expect(body).not.toMatch(/^Disallow: \/$/m);
  });

  test('the admin and account areas are excluded', async ({ request }) => {
    const body = await (await request.get('/robots.txt')).text();
    expect(body).toContain('Disallow: /admin/');
    expect(body).toContain('Disallow: /login');
  });

  test('with no configured origin it omits the Sitemap line rather than inventing a host', async ({
    request
  }) => {
    // The E2E server has no NEXT_PUBLIC_SITE_URL. A `Sitemap:` line here would necessarily be a
    // guess — and a guess sends crawlers to a host this deployment does not serve.
    const body = await (await request.get('/robots.txt')).text();
    expect(body).not.toContain('Sitemap:');
    expect(body).not.toContain('undefined');
    expect(body).not.toContain('null');
  });
});

test.describe('sitemap.xml', () => {
  test('with no configured origin it 404s rather than serving relative <loc> entries', async ({
    request
  }) => {
    // Every `<loc>` must be absolute. Rather than emit a document a validator rejects, the route
    // reports that it is unavailable — and robots.txt does not advertise it, so nothing points here.
    const response = await request.get('/sitemap.xml');
    expect(response.status()).toBe(404);
  });
});

test.describe('what a crawler reads, before any JavaScript runs', () => {
  // `request` rather than `page`: this is the raw response body, with no browser and no hydration.
  // Using `page.content()` would return the DOM *after* React has run and would pass even for tags
  // that a crawler never sees.
  const headOf = async (request, path) => (await request.get(path)).text();

  test('the place page ships its title and description in the HTML', async ({ request }) => {
    const html = await headOf(request, '/places/1');
    // Attribute-tolerant, like every other assertion in this block — and it had to become so at
    // Next 16, which stamps `data-next-head=""` on the tags it manages. The exact string this used
    // to match (`<title>Hampi | EasyTrip Magazine</title>`) pinned Next's private head markup
    // rather than the thing a crawler reads, and the upgrade broke it while the title itself was
    // served correctly. What is being gated is unchanged: the text is in the **response body**,
    // before any JavaScript runs.
    expect(html).toMatch(/<title[^>]*>Hampi \| EasyTrip Magazine<\/title>/);
    expect(html).toMatch(/<meta name="description" content="[^"]+"/);
  });

  test('the Open Graph tags are server-rendered, and none of them is empty', async ({
    request
  }) => {
    const html = await headOf(request, '/places/1');

    expect(html).toMatch(/<meta property="og:title" content="Hampi \| EasyTrip Magazine"/);
    expect(html).toMatch(/<meta property="og:type" content="article"/);
    expect(html).toMatch(/<meta property="og:image" content="https?:[^"]+"/);

    // The BUG this sprint fixed: `og:url` was computed from `window.location.href`, which is
    // undefined during SSR, so every crawler received `content=""`. With no origin configured the
    // tag must now be ABSENT — never present-and-empty.
    expect(html).not.toContain('property="og:url" content=""');
    expect(html).not.toContain('rel="canonical" href=""');
  });

  test('the Twitter card declares a layout whose tags actually exist', async ({ request }) => {
    // `summary_large_image` was declared for months while title/description/image were never
    // emitted — a card type promising a layout the tags could not fill.
    const html = await headOf(request, '/places/1');
    expect(html).toMatch(/<meta name="twitter:card" content="summary_large_image"/);
    expect(html).toMatch(/<meta name="twitter:title" content="[^"]+"/);
    expect(html).toMatch(/<meta name="twitter:image" content="[^"]+"/);
  });

  test('the JSON-LD block is present, parses, and describes this place', async ({ request }) => {
    const html = await headOf(request, '/places/1');

    const match = html.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/);
    expect(match).not.toBeNull();

    const data = JSON.parse(match[1]);
    expect(data['@type']).toBe('TouristAttraction');
    expect(data.name).toBe('Hampi');
    expect(data.address.addressRegion).toBe('Karnataka');
  });

  test('an unrated place claims no rating', async ({ request }) => {
    // Badami is seeded with zero reviews. `"ratingValue": 0` would assert it was rated zero out of
    // five — the BUG M-2 rule, in the one place no human would ever notice it.
    const html = await headOf(request, '/places/4');
    const match = html.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/);
    const data = JSON.parse(match[1]);

    expect(data.name).toBe('Badami');
    expect(data).not.toHaveProperty('aggregateRating');
  });

  test('a rated place reports its real aggregate', async ({ request }) => {
    // Hampi: two reviews, 9/2 = 4.5.
    const html = await headOf(request, '/places/1');
    const match = html.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/);
    const data = JSON.parse(match[1]);

    expect(data.aggregateRating).toMatchObject({ ratingValue: 4.5, reviewCount: 2 });
  });
});
