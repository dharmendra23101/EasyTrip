/**
 * The trip activity vocabulary, browser side (`BL-147`).
 *
 * The ids here are the values `023_trip_activity.sql` CHECKs and
 * `backend/src/constants/tripActivity.js` validates — a third copy of one list, held in step by
 * `npm run check:themes`. Without that guard an action the API writes but the page has no sentence
 * for renders as a raw string like `items.reordered` in a feed a traveller is trying to read.
 *
 * **The sentences live only here, because a sentence is a product decision the database has no
 * opinion about.** `day.removed` is an id; *"removed day 3"* is what a person reads.
 *
 * Each `sentence` takes the entry's `detail` and returns the predicate — the actor's name is
 * prepended by the component, so these read as the second half of *"Priya removed day 3"*. Written
 * as functions rather than templates because two of the six need the detail interpolated in the
 * middle and one needs a plural.
 */

export const TRIP_ACTIVITY_ACTIONS = [
  {
    id: 'day.added',
    label: 'Added a day',
    sentence: (detail) => `added day ${detail.dayNumber}`
  },
  {
    id: 'day.removed',
    label: 'Removed a day',
    // The number the day HAD. Every later day was renumbered down when it went, so this ordinal
    // matches nothing currently in the plan — which is exactly why it had to be recorded.
    sentence: (detail) => `removed day ${detail.dayNumber}`
  },
  {
    id: 'item.added',
    label: 'Added an item',
    sentence: (detail) => `added ${detail.title}`
  },
  {
    id: 'item.updated',
    label: 'Changed an item',
    // Names the fields rather than the values: the current value is on the itinerary beside this
    // feed, and the old one is deliberately not stored.
    sentence: (detail) =>
      detail.fields?.length
        ? `changed ${detail.title} (${detail.fields.join(', ')})`
        : `changed ${detail.title}`
  },
  {
    id: 'item.removed',
    label: 'Removed an item',
    sentence: (detail) => `removed ${detail.title}`
  },
  {
    id: 'items.reordered',
    label: 'Reordered a day',
    sentence: (detail) =>
      `reordered day ${detail.dayNumber} (${detail.count} ${detail.count === 1 ? 'item' : 'items'})`
  }
];

/** Id → entry, for the feed's per-row lookup. */
export const TRIP_ACTIVITY_BY_ID = Object.fromEntries(
  TRIP_ACTIVITY_ACTIONS.map((action) => [action.id, action])
);
