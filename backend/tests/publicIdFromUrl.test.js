const { publicIdFromUrl } = require('../src/config/cloudinary');

/**
 * `publicIdFromUrl` — the function that decides which remote asset gets deleted.
 *
 * **Why it needed its own suite.** It had **0% coverage**. Every test that touches an upload mocks
 * `../src/config/cloudinary` wholesale, so the real implementation had never executed once — and it
 * is the input to `destroyImage`, which issues an irreversible delete against a third party. A
 * mis-parse here does not throw and does not fail a request: it quietly deletes the wrong asset, or
 * silently deletes nothing while the row disappears. Neither shows up in a response.
 *
 * **The contract, from its own docstring.** Given a Cloudinary delivery URL, return everything after
 * `/upload/` minus an optional `v<digits>/` version segment, with the file extension removed. Return
 * `null` for anything that is not a recognisable Cloudinary upload URL.
 *
 * The load-bearing case is the round trip: this project stores `secure_url` and `public_id` as
 * separate columns, and for rows written before `public_id` existed the id has to be *recovered*
 * from the URL. Those two must agree, or cleanup targets something other than what was uploaded.
 */

/** The exact URL shape `uploadImage` produces — folder, place id, generated name, extension. */
const GALLERY_URL =
  'https://res.cloudinary.com/demo/image/upload/v1712345678/easytrip/places/9/place_9_gallery_1712345678901.jpg';
const GALLERY_PUBLIC_ID = 'easytrip/places/9/place_9_gallery_1712345678901';

describe('the round trip that cleanup depends on', () => {
  test('a stored delivery URL recovers exactly the public_id Cloudinary issued', () => {
    // If these two ever disagree, `destroyImage` is pointed at an asset that is not the one the
    // row refers to. This is the assertion the whole function exists to satisfy.
    expect(publicIdFromUrl(GALLERY_URL)).toBe(GALLERY_PUBLIC_ID);
  });

  test('the recovered id sits under the place folder prefix-deletion relies on', () => {
    // `destroyPlaceAssets` deletes by the prefix `easytrip/places/<id>/`, so an id recovered
    // outside that prefix would be missed by the place-level cleanup as well as the row-level one.
    expect(publicIdFromUrl(GALLERY_URL).startsWith('easytrip/places/9/')).toBe(true);
  });
});

describe('the URL shapes Cloudinary actually returns', () => {
  test('the version segment is dropped', () => {
    expect(publicIdFromUrl('https://res.cloudinary.com/d/image/upload/v1/folder/name.png')).toBe(
      'folder/name'
    );
  });

  test('a URL with no version segment is handled too', () => {
    // Cloudinary omits the version on some delivery URLs, and `v` is not special otherwise.
    expect(publicIdFromUrl('https://res.cloudinary.com/d/image/upload/folder/name.png')).toBe(
      'folder/name'
    );
  });

  test('nested folders are preserved, not flattened', () => {
    expect(publicIdFromUrl('https://res.cloudinary.com/d/image/upload/v9/a/b/c/name.webp')).toBe(
      'a/b/c/name'
    );
  });

  test('a public_id at the root of the cloud has no folder', () => {
    expect(publicIdFromUrl('https://res.cloudinary.com/d/image/upload/v9/name.jpg')).toBe('name');
  });

  test('only the last segment loses an extension — folder names may contain dots', () => {
    // The docstring calls this out specifically, and a naive `replace(/\..*$/, '')` would return
    // `my` here, deleting from a folder that does not exist rather than the intended asset.
    expect(publicIdFromUrl('https://res.cloudinary.com/d/image/upload/v9/my.folder/name.jpg')).toBe(
      'my.folder/name'
    );
  });

  test('a name containing dots keeps all but the final extension', () => {
    expect(publicIdFromUrl('https://res.cloudinary.com/d/image/upload/v9/a/n.a.m.e.jpg')).toBe(
      'a/n.a.m.e'
    );
  });

  test('a name with no extension is returned unchanged', () => {
    expect(publicIdFromUrl('https://res.cloudinary.com/d/image/upload/v9/folder/name')).toBe(
      'folder/name'
    );
  });
});

describe('what must return null rather than a guess', () => {
  // Every one of these reaches `destroyImage`, which returns early on a falsy id. Returning a
  // *wrong* id instead of null is the dangerous outcome, because it deletes something.
  test.each([
    ['a non-Cloudinary URL with no /upload/ segment', 'https://example.com/images/name.jpg'],
    ['an empty string', ''],
    ['a URL that ends at /upload/', 'https://res.cloudinary.com/d/image/upload/'],
    ['null', null],
    ['undefined', undefined],
    ['a number', 12345],
    ['an object', { url: 'x' }]
  ])('%s returns null', (_label, input) => {
    expect(publicIdFromUrl(input)).toBeNull();
  });

  test('a non-string never throws — the caller has no try/catch around it', () => {
    // `placeImageController.js:171` calls this on a database column with no guard. A throw here
    // would 500 a delete that had already removed the row.
    for (const input of [null, undefined, 12345, {}, [], true]) {
      expect(() => publicIdFromUrl(input)).not.toThrow();
    }
  });
});
