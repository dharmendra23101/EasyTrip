import { getPlaceImageUrl, PLACEHOLDER_IMAGE } from './placeImage';

/**
 * Pure helpers for the place detail page (IMP-070).
 *
 * These were inline in `pages/places/[id].jsx`. They are plain functions of their arguments, so
 * moving them out is what makes them reachable from a test without mounting the page.
 */

/**
 * Compose the gallery: the primary image first, then the gallery rows, de-duplicated by URL.
 *
 * Shared by `getStaticProps` and the client refresh path so the two cannot disagree about what
 * the first image is — which matters, because the first image is the hero.
 */
export const composeGallery = (place, galleryImages) => {
  const all = [
    { id: 'primary', image_url: getPlaceImageUrl(place, PLACEHOLDER_IMAGE) },
    ...(galleryImages || [])
  ].filter((img) => img.image_url);

  const seen = new Set();
  return all.filter((img) => {
    if (seen.has(img.image_url)) return false;
    seen.add(img.image_url);
    return true;
  });
};

/**
 * The bullet list under "Essential Facts".
 *
 * Two of the five entries have a stated fallback and always appear; the rest drop out when the
 * place has no value for them.
 */
export const buildPlaceFacts = (place) =>
  [
    place.district
      ? `Located in the ${place.district} district of ${place.state || 'the region'}`
      : null,
    place.custom_keys?.['Best Time to Visit']
      ? `Best time to visit: ${place.custom_keys['Best Time to Visit']}`
      : 'Suitable for year-round visits',
    place.custom_keys?.['Opening Hours']
      ? `Open hours: ${place.custom_keys['Opening Hours']}`
      : null,
    place.custom_keys?.['Entrance Fee']
      ? `Entrance fee: ${place.custom_keys['Entrance Fee']}`
      : 'Contact for current entrance fees',
    'Perfect for photography enthusiasts and nature lovers'
  ].filter(Boolean);

/** The opening paragraph: the admin's description, or a stand-in when there is none. */
export const buildEditorialExcerpt = (place) =>
  place.description ||
  `${place.name} offers travelers a unique blend of experiences, with local culture and natural beauty combining to create unforgettable memories.`;

/** The sections the table of contents and the scroll observer both walk. */
export const PLACE_SECTIONS = [
  { id: 'about', title: 'About This Place' },
  { id: 'details', title: 'Essential Details' },
  { id: 'when', title: 'When To Go' },
  { id: 'access', title: 'Getting In' },
  { id: 'gallery', title: 'Photo Gallery' },
  { id: 'reviews', title: 'Traveler Reviews' },
  { id: 'related', title: 'Similar Places' }
];

/**
 * The sections this particular place actually renders (`BL-139`).
 *
 * **The full list was being handed to the table of contents whether or not the sections existed**,
 * so a place with no images has always carried a "Photo Gallery" link that scrolls nowhere. Nothing
 * failed and nothing logged; the link simply did not work, which is why it survived.
 *
 * It is also what kept `FV-029`'s panel out of the contents. That section is absent far more often
 * than the gallery — today it is absent for the entire catalogue — so registering it before this
 * would have turned one rare dead link into a universal one.
 *
 * `useActiveSection` needs a **stable reference**, so callers must memoise the result: a fresh array
 * each render tears down and re-registers the observer every time.
 */
export const visiblePlaceSections = ({ hasImages, hasAccessibility, hasSeasonality }) =>
  PLACE_SECTIONS.filter((section) => {
    if (section.id === 'gallery') return Boolean(hasImages);
    if (section.id === 'access') return Boolean(hasAccessibility);
    // `FV-028`. Absent for the whole catalogue on the day it ships, exactly as `access` was, and
    // registered here for the same reason: the contents must list what the page renders.
    if (section.id === 'when') return Boolean(hasSeasonality);
    return true;
  });
