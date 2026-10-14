import {
  getPlaceImageUrl,
  getPlaceThumbnailUrl,
  hasPlaceImage,
  PLACEHOLDER_IMAGE
} from '../src/utils/placeImage';

/**
 * Place-image resolution (IMP-073, locking in the fix for BUG M-1).
 *
 * The bug this guards: five components each wrote
 * `place.primary_image_url || place.image_url || placeholder`, and **`image_url` is not a field on
 * a place row** — it is a column on `place_images`. The API resolves the gallery's first image into
 * `fallback_image_url` with a LATERAL join precisely so the client needs no second request, and no
 * component read it.
 *
 * The visible consequence: a place whose only image lived in the gallery rendered the *placeholder*,
 * with the correct URL sitting unread in the same payload. The admin place list had never rendered
 * a thumbnail at all.
 *
 * So the load-bearing test is the gallery-only place.
 */

const CLOUDINARY = 'https://res.cloudinary.com/demo/image/upload/v1/easytrip/places/1/primary.jpg';
const GALLERY = 'https://res.cloudinary.com/demo/image/upload/v1/easytrip/places/1/gallery1.jpg';

describe('the ladder: primary, then the API-resolved gallery fallback, then the placeholder', () => {
  test('a gallery-only place resolves to the gallery image, NOT the placeholder (BUG M-1)', () => {
    // This is the exact payload shape that used to render a placeholder.
    const place = { primary_image_url: null, fallback_image_url: GALLERY };
    expect(getPlaceImageUrl(place)).toBe(GALLERY);
    expect(getPlaceImageUrl(place)).not.toBe(PLACEHOLDER_IMAGE);
  });

  test('an explicitly chosen primary image wins over the gallery', () => {
    expect(getPlaceImageUrl({ primary_image_url: CLOUDINARY, fallback_image_url: GALLERY })).toBe(
      CLOUDINARY
    );
  });

  test('a place with genuinely no image gets the placeholder', () => {
    expect(getPlaceImageUrl({ primary_image_url: null, fallback_image_url: null })).toBe(
      PLACEHOLDER_IMAGE
    );
    expect(getPlaceImageUrl({})).toBe(PLACEHOLDER_IMAGE);
  });

  test('`image_url` is NOT consulted — it does not exist on a place row', () => {
    // The field the five broken copies read. If someone reintroduces it as a rung, this fails:
    // a place carrying only `image_url` has no usable image and must fall to the placeholder.
    const place = { image_url: 'https://example.com/should-be-ignored.jpg' };
    expect(getPlaceImageUrl(place)).toBe(PLACEHOLDER_IMAGE);
    expect(hasPlaceImage(place)).toBe(false);
  });

  test('never returns null or undefined, so callers need no second guard', () => {
    // The contract that lets `<img src={getPlaceImageUrl(p)} />` be written without a fallback.
    for (const input of [null, undefined, {}, { primary_image_url: '' }]) {
      expect(typeof getPlaceImageUrl(input)).toBe('string');
      expect(getPlaceImageUrl(input).length).toBeGreaterThan(0);
    }
  });

  test('an empty string is treated as absent, not as a URL', () => {
    // `''` reaches here from a cleared admin form field; rendering `src=""` re-requests the page.
    expect(getPlaceImageUrl({ primary_image_url: '', fallback_image_url: GALLERY })).toBe(GALLERY);
  });
});

describe('a caller-supplied fallback replaces the default placeholder', () => {
  test('the detail page can supply its own', () => {
    expect(getPlaceImageUrl({}, '/images/hero-fallback.jpg')).toBe('/images/hero-fallback.jpg');
  });
});

describe('hasPlaceImage answers "is there a real image"', () => {
  test('true for either rung, false for neither', () => {
    expect(hasPlaceImage({ primary_image_url: CLOUDINARY })).toBe(true);
    expect(hasPlaceImage({ fallback_image_url: GALLERY })).toBe(true);
    expect(hasPlaceImage({})).toBe(false);
    expect(hasPlaceImage(null)).toBe(false);
  });

  test('agrees with getPlaceImageUrl returning the placeholder', () => {
    // These two must never disagree — a component asking "is there an image" and then rendering
    // the resolved URL would otherwise show a placeholder inside an "has image" branch.
    const cases = [{ primary_image_url: CLOUDINARY }, { fallback_image_url: GALLERY }, {}, null];
    for (const place of cases) {
      expect(hasPlaceImage(place)).toBe(getPlaceImageUrl(place) !== PLACEHOLDER_IMAGE);
    }
  });
});

describe('the placeholder is never sent through a Cloudinary transform', () => {
  test('a local file is returned untouched', () => {
    // Cloudinary transforms only apply to Cloudinary URLs; transforming `/images/placeholder.jpg`
    // produces a broken src. Asserted on the identity, not on the transform's output format,
    // because the transform itself is cloudinaryHelper's contract, not this module's.
    expect(getPlaceThumbnailUrl({})).toBe(PLACEHOLDER_IMAGE);
    expect(getPlaceThumbnailUrl({}, '/images/custom.jpg')).toBe('/images/custom.jpg');
  });

  test('a real image IS transformed rather than passed through at full resolution', () => {
    // The performance property: a ~400px card must not pull the original. Asserted as "not the
    // raw URL" rather than matching an exact transform string, which would be an implementation
    // detail of cloudinaryHelper.
    const out = getPlaceThumbnailUrl({ primary_image_url: CLOUDINARY });
    expect(out).not.toBe(CLOUDINARY);
    expect(out).toContain('res.cloudinary.com');
  });
});
