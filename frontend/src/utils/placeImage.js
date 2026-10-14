import { getCloudinaryThumbnail, getCloudinaryLargeImage } from './cloudinaryHelper';

/**
 * One place-image URL resolver (IMP-073).
 *
 * The ladder was re-implemented in five components, and **every copy was wrong in the same way**:
 *
 *     place.primary_image_url || place.image_url || placeholder
 *
 * `place.image_url` does not exist. It is a column on `place_images`, not on `places`; a place row
 * has `primary_image_url` and — since `IMP-037` — `fallback_image_url`, which the API resolves with
 * a LATERAL join precisely so the client does not need a second request for the gallery's first
 * image. The comments beside those ladders even said so ("the API already resolved the fallback"),
 * while the code checked a field that is always `undefined`.
 *
 * The visible consequence: **a place whose only image is in the gallery rendered the placeholder**,
 * on the cards, the carousel and the browse grid, with the correct URL sitting unread in the same
 * payload.
 *
 * Fixing it in five files independently is how it would go wrong again in a sixth. Hence one
 * function.
 */

/** Shipped in `public/images/`. Used when a place genuinely has no image. */
export const PLACEHOLDER_IMAGE = '/images/placeholder.jpg';

/**
 * The raw image URL for a place, or the placeholder.
 *
 * Order: the explicitly chosen primary image, then the gallery's first image as resolved by the
 * API, then the placeholder.
 *
 * @param {Object|null|undefined} place
 * @param {String} [fallback] - substitute for the default placeholder (the detail page uses its own)
 * @returns {String} always a usable src — never null, so callers need no second guard
 */
export const getPlaceImageUrl = (place, fallback = PLACEHOLDER_IMAGE) =>
  place?.primary_image_url || place?.fallback_image_url || fallback;

/**
 * Card-sized delivery URL. Never pulls a full-resolution original into a ~400px slot.
 *
 * The placeholder is returned untransformed: it is a local file, and Cloudinary transforms only
 * apply to Cloudinary URLs.
 */
export const getPlaceThumbnailUrl = (place, fallback = PLACEHOLDER_IMAGE) => {
  const url = getPlaceImageUrl(place, fallback);
  return url === fallback ? url : getCloudinaryThumbnail(url);
};

/** Hero / social-card sized delivery URL. */
export const getPlaceLargeImageUrl = (place, width = 1600, fallback = PLACEHOLDER_IMAGE) => {
  const url = getPlaceImageUrl(place, fallback);
  return url === fallback ? url : getCloudinaryLargeImage(url, width);
};

/** True when the place has a real image rather than the placeholder. */
export const hasPlaceImage = (place) =>
  Boolean(place?.primary_image_url || place?.fallback_image_url);
