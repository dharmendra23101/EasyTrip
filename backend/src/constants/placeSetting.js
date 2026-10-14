/**
 * Where a place actually is — the dimension `FV-031` needs and nothing else carried.
 *
 * `themes` mixes season, audience and place character across fourteen ids, and not one of them
 * means "this happens outdoors": `historical` covers open ruins and an indoor museum alike. `tags`
 * is free text. `trip_items.item_type` says what a line in a plan *is*, not where it happens. So
 * this is a missing dimension rather than a fourth name for an existing one — the reasoning is in
 * `migrations/011_place_setting.sql`, next to the constraint that enforces it.
 *
 * **`unknown` is the default and it is load-bearing.** Every consumer must read it as *"do not
 * assert anything about this row"* rather than as a synonym for `indoor`. A daylight warning
 * produced from a guess is the `IMP-027` defect class with a scheduler's authority.
 */
const PLACE_SETTINGS = ['outdoor', 'indoor', 'mixed', 'unknown'];

/** What an unclassified row is, in the database and in the API. */
const DEFAULT_PLACE_SETTING = 'unknown';

/** True when a row has actually been classified — the guard every consumer should use. */
const isClassifiedSetting = (setting) =>
  typeof setting === 'string' &&
  PLACE_SETTINGS.includes(setting) &&
  setting !== DEFAULT_PLACE_SETTING;

module.exports = { PLACE_SETTINGS, DEFAULT_PLACE_SETTING, isClassifiedSetting };
