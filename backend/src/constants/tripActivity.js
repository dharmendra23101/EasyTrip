/**
 * The closed vocabulary behind the trip activity feed (`BL-147`).
 *
 * `023_trip_activity.sql` CHECKs this in the database, so a value only the application knows is **a
 * 500 from Postgres**, not a rejected request — the same hazard `AUDIT_ACTIONS`, `FV-020`'s
 * preferences and `places.setting` all carry.
 *
 * **Three tiers, so `check:themes` guards it.** `frontend/src/constants/tripActivity.js` holds the
 * browser copy, because the feed renders a sentence per action and therefore has to know the list.
 * That is the difference from `AUDIT_TARGET_TYPES`, which deliberately has no browser copy: the
 * admin page branches on `action` instead, so inventing a frontend list nothing reads would have
 * been the wrong way round.
 *
 * **Why namespaced strings rather than integers.** The rows outlive the code that wrote them.
 * `'day.removed'` still means something to a human reading the table in three years; `4` means
 * whatever the constant said at the time, which is exactly what a renumbering loses.
 *
 * ---------------------------------------------------------------------------
 * What each action puts in `detail`
 * ---------------------------------------------------------------------------
 *
 * | action | detail |
 * | --- | --- |
 * | `day.added` / `day.removed` | `{ dayNumber }` — the ordinal, which is what `trip_days` keys on |
 * | `item.added` / `item.removed` | `{ title }` — copied for the same reason `actor_label` is |
 * | `item.updated` | `{ title, fields: ['notes', 'start_time'] }` — which moved, not what to |
 * | `items.reordered` | `{ dayNumber, count }` — which day, and how many items were resequenced |
 *
 * **Nothing writes a key no reader looks at.** `ADR-022`'s rule one level down: the feed renders
 * every key above, so adding one here means adding it to the page.
 *
 * `item.updated` stores field **names** and not values on purpose. The current value is on the page
 * the reader is already looking at, and keeping the old ones would make this table a shadow copy of
 * the itinerary — with its own retention question and its own way of disagreeing with it.
 *
 * **The list is six because six is what an editor can do.** It was read out of the access rules
 * rather than chosen: every action here is gated on `editableBy`, and every trip mutation gated on
 * `trips.user_id` is absent, because only the owner can reach those and the owner is the reader.
 * `trip.updated` was on the first draft and came off when the gates were checked — renaming a trip
 * is owner-only, so recording it produces a feed whose every line says "you did this".
 *
 * The notes live above the array rather than inside it because `check:themes` parses this literal
 * with a regex over quoted strings, and a comment between the entries donates its own quotes to the
 * vocabulary — a phantom id and a guard failure pointing at the wrong file, which is what happened
 * in Sprint 8.66.
 */
const TRIP_ACTIVITY_ACTIONS = [
  'day.added',
  'day.removed',
  'item.added',
  'item.updated',
  'item.removed',
  'items.reordered'
];

module.exports = { TRIP_ACTIVITY_ACTIONS };
