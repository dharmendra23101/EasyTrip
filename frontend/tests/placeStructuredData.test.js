import {
  buildPlaceStructuredData,
  serializeStructuredData
} from '../src/utils/placeStructuredData';

/**
 * schema.org structured data for a place (`IMP-113` part two).
 *
 * Every assertion here is about a claim made to a machine that never reports back. A JSON-LD block
 * renders nothing, breaks no layout and fails no build — so "it looked fine in the browser" is
 * available as evidence for none of it.
 *
 * Two themes run through the file:
 *
 *   1. **An empty property is a false claim, not a placeholder.** `ratingValue: 0` says this
 *      attraction was rated zero. `GeoCoordinates {0, 0}` puts it in the Atlantic.
 *   2. **Postgres returns strings.** `DECIMAL` and `COUNT` both arrive as text, so `Number(x)`,
 *      truthiness checks and `x > 0` all behave differently from how they read.
 */

const PLACE = {
  id: 7,
  name: 'Hampi',
  description: 'The ruined capital of Vijayanagara.',
  location: 'Hampi',
  district: 'Ballari',
  state: 'Karnataka',
  locality: 'Hampi Bazaar',
  pin_code: '583239',
  latitude: '15.33500000',
  longitude: '76.46000000',
  themes: ['heritage'],
  tags: ['unesco', 'ruins'],
  rating_count: '2',
  average_rating: '4.5'
};

const build = (overrides = {}) =>
  buildPlaceStructuredData(
    { ...PLACE, ...overrides },
    'https://img.example/h.jpg',
    'https://e.example/places/7'
  );

describe('the shape', () => {
  test('it is a TouristAttraction in the schema.org context', () => {
    const data = build();
    expect(data['@context']).toBe('https://schema.org');
    expect(data['@type']).toBe('TouristAttraction');
    expect(data.name).toBe('Hampi');
  });

  test('a place with no name produces nothing at all', () => {
    // An entity with no name is not a description of anything; emitting it would claim an
    // attraction exists and say nothing true about it.
    expect(buildPlaceStructuredData({ id: 1 }, 'i', 'u')).toBeNull();
    expect(buildPlaceStructuredData(null, 'i', 'u')).toBeNull();
  });

  test('the url and image are carried through when they are known', () => {
    const data = build();
    expect(data.url).toBe('https://e.example/places/7');
    expect(data.image).toBe('https://img.example/h.jpg');
  });

  test('an unconfigured site origin drops the url rather than emitting an empty one', () => {
    // `absoluteUrl` returns null with no origin configured. A relative or empty `url` is worse than
    // an absent one: it is a claim about a location that does not resolve.
    const data = buildPlaceStructuredData(PLACE, 'https://img.example/h.jpg', null);
    expect(data).not.toHaveProperty('url');
    expect(data.name).toBe('Hampi');
  });
});

describe('aggregateRating — the property most likely to lie', () => {
  test('it is emitted for a rated place', () => {
    expect(build().aggregateRating).toEqual({
      '@type': 'AggregateRating',
      ratingValue: 4.5,
      reviewCount: 2,
      bestRating: 5,
      worstRating: 1
    });
  });

  test('an unrated place carries NO rating, rather than a zero one', () => {
    // The BUG M-2 rule, one layer down. `"ratingValue": 0` is the assertion that this attraction
    // was rated zero out of five — worse than silence, and invisible to every other test.
    const data = build({ rating_count: 0, average_rating: null });
    expect(data).not.toHaveProperty('aggregateRating');
  });

  test('the string "0" from Postgres does not read as truthy', () => {
    // `COUNT(*)` arrives as a string. `if (place.rating_count)` is true for "0", which is exactly
    // how a zero rating gets emitted by code that looks correct.
    const data = build({ rating_count: '0', average_rating: '0' });
    expect(data).not.toHaveProperty('aggregateRating');
  });

  test('a count without an average is not a rating', () => {
    expect(build({ average_rating: null }).aggregateRating).toBeUndefined();
    expect(build({ average_rating: undefined }).aggregateRating).toBeUndefined();
  });

  test('numbers are numbers, not the strings the driver returned', () => {
    // schema.org consumers type-check these. `"4.5"` is a string literal in JSON and is rejected
    // or coerced inconsistently depending on the consumer.
    const rating = build().aggregateRating;
    expect(typeof rating.ratingValue).toBe('number');
    expect(typeof rating.reviewCount).toBe('number');
  });
});

describe('geo — the other place a zero is a lie', () => {
  test('coordinates are parsed from the driver strings into numbers', () => {
    expect(build().geo).toEqual({
      '@type': 'GeoCoordinates',
      latitude: 15.335,
      longitude: 76.46
    });
  });

  test('a place with no coordinates is not placed at null island', () => {
    // `Number(null)` is 0, so a naive conversion puts every uncoordinated attraction at 0°N 0°E —
    // in the Gulf of Guinea. A fabricated location, and a plausible-looking one. Same string-decimal
    // trap as IMP-007's marker eligibility.
    expect(build({ latitude: null, longitude: null })).not.toHaveProperty('geo');
    expect(build({ latitude: '', longitude: '' })).not.toHaveProperty('geo');
  });

  test('one coordinate without the other is not a position', () => {
    expect(build({ longitude: null })).not.toHaveProperty('geo');
    expect(build({ latitude: undefined })).not.toHaveProperty('geo');
  });

  test('a genuine zero coordinate survives', () => {
    // The equator is a real latitude. Rejecting `0` as "missing" is the mirror-image bug, and it is
    // the one a `!latitude` guard would introduce.
    expect(build({ latitude: '0', longitude: '0' }).geo).toEqual({
      '@type': 'GeoCoordinates',
      latitude: 0,
      longitude: 0
    });
  });
});

describe('address', () => {
  test('it maps the columns onto PostalAddress', () => {
    expect(build().address).toEqual({
      '@type': 'PostalAddress',
      streetAddress: 'Hampi Bazaar',
      addressLocality: 'Hampi',
      addressRegion: 'Karnataka',
      postalCode: '583239',
      addressCountry: 'IN'
    });
  });

  test('missing components are dropped, not emitted empty', () => {
    const address = build({ locality: null, pin_code: '' }).address;
    expect(address).not.toHaveProperty('streetAddress');
    expect(address).not.toHaveProperty('postalCode');
    expect(address.addressLocality).toBe('Hampi');
  });

  test('a place with no address at all carries none', () => {
    // The country constant alone is not an address — it would claim an address exists and describe
    // nothing but "India", which is true of every row in the catalogue.
    const data = build({ locality: null, location: null, state: null, pin_code: null });
    expect(data).not.toHaveProperty('address');
  });
});

describe('serialisation — the security-relevant part', () => {
  test('a name that closes the script tag cannot escape the block', () => {
    // Stored XSS reachable by anyone who can name a place. The HTML parser ends
    // `<script type="application/ld+json">` at the first `</script`, inside a JSON string or not,
    // and `JSON.stringify` has no reason to escape `<`. Same class as IMP-056.
    const hostile = '</script><script>alert(1)</script>';
    const json = serializeStructuredData(build({ name: hostile }));

    expect(json).not.toContain('</script');
    expect(json).not.toContain('<');
    expect(json).not.toContain('>');
    expect(json).toContain('\\u003c');
  });

  test('the escaping is still valid JSON that round-trips exactly', () => {
    // An escape that broke the payload would trade one silent failure for another.
    const hostile = '</script>&<>"\'';
    const json = serializeStructuredData(build({ name: hostile }));
    expect(JSON.parse(json).name).toBe(hostile);
  });

  test('a description containing markup is escaped too, not only the name', () => {
    const json = serializeStructuredData(build({ description: 'a </script> b' }));
    expect(json).not.toContain('</script');
    expect(JSON.parse(json).description).toBe('a </script> b');
  });

  test('nothing in produces nothing out', () => {
    expect(serializeStructuredData(null)).toBeNull();
    expect(serializeStructuredData(undefined)).toBeNull();
  });
});

describe('themes and tags', () => {
  test('themes become touristType and tags become keywords', () => {
    const data = build();
    expect(data.touristType).toEqual(['heritage']);
    expect(data.keywords).toBe('unesco, ruins');
  });

  test('empty collections are omitted rather than emitted as empty', () => {
    const data = build({ themes: [], tags: [] });
    expect(data).not.toHaveProperty('touristType');
    expect(data).not.toHaveProperty('keywords');
  });

  test('a missing collection does not throw', () => {
    const data = build({ themes: undefined, tags: null });
    expect(data.name).toBe('Hampi');
    expect(data).not.toHaveProperty('touristType');
  });
});
