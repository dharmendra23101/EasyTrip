/**
 * schema.org `TouristAttraction` for one place (`IMP-113`).
 *
 * Kept out of the component so the *shape* can be asserted directly. A JSON-LD block is invisible
 * to every other kind of test — it renders nothing, changes no layout, and a malformed one is
 * reported by a search engine weeks later, to nobody.
 *
 * **The rule this file exists to enforce: emit a property or omit it, never emit an empty one.**
 * Structured data is a set of claims made to a machine, and `"ratingValue": 0` on a place nobody
 * has reviewed is not a placeholder — it is the assertion that this attraction has been rated zero.
 * That is the same defect as `BUG M-2` (a zero-star display for an unrated place), one layer down
 * where no human will ever see it. Google's own guidance treats a review-less `aggregateRating` as
 * a violation, but the reason to leave it out is that it is false.
 */

/** Drop keys whose value is null/undefined/empty, so no empty claim survives into the output. */
const compact = (object) =>
  Object.fromEntries(
    Object.entries(object).filter(([, value]) => {
      if (value === null || value === undefined) return false;
      if (typeof value === 'string') return value.trim() !== '';
      if (Array.isArray(value)) return value.length > 0;
      if (typeof value === 'object') return Object.keys(value).length > 0;
      return true;
    })
  );

/**
 * `PostalAddress`, or nothing.
 *
 * Every sub-field is optional in the database, so the object is built from what exists. An address
 * with no components at all is omitted entirely rather than shipped as `{"@type":"PostalAddress"}`,
 * which claims an address exists while describing none of it.
 */
const buildAddress = (place) => {
  const address = compact({
    streetAddress: place.locality,
    addressLocality: place.location,
    addressRegion: place.state,
    postalCode: place.pin_code,
    // The catalogue is India-only, which `KNOWN_LIMITATIONS.md` states as a product boundary. This
    // is the one hardcoded value here, and it is hardcoded because it is true of every row rather
    // than because a country column is missing.
    addressCountry: 'IN'
  });

  // `addressCountry` alone is not an address — it is the constant above. Require something else.
  return Object.keys(address).length > 1 ? { '@type': 'PostalAddress', ...address } : null;
};

/**
 * `GeoCoordinates`, or nothing.
 *
 * `latitude`/`longitude` arrive from pg as **strings** (`DECIMAL` is not a JS number), and
 * schema.org wants numbers. `Number()` on a null returns 0, which would place every uncoordinated
 * attraction at the intersection of the equator and the prime meridian — a fabricated location, and
 * a plausible-looking one. Both must parse, or neither is emitted. This is the string-decimal trap
 * that `IMP-007` hit in the map's marker eligibility.
 */
const buildGeo = (place) => {
  const latitude = Number.parseFloat(place.latitude);
  const longitude = Number.parseFloat(place.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { '@type': 'GeoCoordinates', latitude, longitude };
};

/**
 * `AggregateRating`, or nothing — the property this module is most careful about.
 *
 * `rating_count` also arrives as a string from pg's `COUNT`/`INT`, so it is parsed rather than
 * trusted to be truthy: `"0"` is a truthy string, and a bare `if (place.rating_count)` would emit
 * the zero rating this whole file exists to prevent.
 */
const buildRating = (place) => {
  const count = Number.parseInt(place.rating_count, 10);
  const value = Number.parseFloat(place.average_rating);
  if (!Number.isFinite(count) || count < 1) return null;
  if (!Number.isFinite(value) || value <= 0) return null;

  return {
    '@type': 'AggregateRating',
    ratingValue: value,
    reviewCount: count,
    bestRating: 5,
    worstRating: 1
  };
};

/**
 * The JSON-LD object for a place, or `null` when there is not enough to describe one.
 *
 * @param {Object}  place
 * @param {String}  [imageUrl] absolute URL of the primary image
 * @param {String}  [pageUrl]  absolute URL of this page; omitted when no site origin is configured
 */
export const buildPlaceStructuredData = (place, imageUrl, pageUrl) => {
  if (!place || !place.name) return null;

  return compact({
    '@context': 'https://schema.org',
    '@type': 'TouristAttraction',
    name: place.name,
    description: place.description,
    // Relative URLs are legal in JSON-LD but useless to a consumer that did not fetch this page.
    // `siteUrl.js` returns null when no origin is configured, and null is dropped by `compact`.
    url: pageUrl,
    image: imageUrl,
    address: buildAddress(place),
    geo: buildGeo(place),
    aggregateRating: buildRating(place),
    // `touristType` is the schema.org field the curated themes actually map to.
    touristType: Array.isArray(place.themes) ? place.themes : null,
    keywords: Array.isArray(place.tags) && place.tags.length > 0 ? place.tags.join(', ') : null
  });
};

/**
 * The JSON string for `dangerouslySetInnerHTML`, with `<` escaped.
 *
 * **This is the security-relevant line in the file.** JSON-LD is injected inside
 * `<script type="application/ld+json">`, and the HTML parser ends that element at the first
 * `</script` it sees — inside a JSON string literal or not. A place named
 * `Foo</script><script>…` would therefore break out of the block and execute, which is stored XSS
 * reachable by anyone who can name a place.
 *
 * `JSON.stringify` does not escape `<`; it has no reason to, since it knows nothing about HTML.
 * Escaping it as `\u003c` is valid JSON — a consumer parses the identical string back — and the
 * sequence `</script` can no longer appear in the output at all. This is the same class of defect
 * as `IMP-056`, which was reflected XSS through an SVG placeholder.
 */
export const serializeStructuredData = (data) =>
  data === null || data === undefined
    ? null
    : JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
