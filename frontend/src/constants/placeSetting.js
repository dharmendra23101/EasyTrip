/**
 * Where a place happens (`TD-023`, the admin half of `places.setting`).
 *
 * **This list is duplicated on purpose, and guarded because of it.** The authority is
 * `backend/src/constants/placeSetting.js`, which also backs a `CHECK` constraint on the column; the
 * frontend cannot import across the tier boundary, so `scripts/check-theme-vocabulary.mjs` asserts
 * the two lists are identical and in the same order. That is the same arrangement the fourteen theme
 * ids use, and it exists because the seed once drifted to `heritage` and `spiritual` — neither of
 * which was ever a theme — with nothing to notice.
 *
 * **The descriptions are not decoration.** `unknown` is the default for the entire catalogue, and
 * an admin choosing between four words with no guidance will guess. What they guess becomes the
 * input to `FV-031` (daylight) and `FV-027` (rain), and a wrong classification does not fail
 * loudly — it produces a confident warning about the wrong place, or silence about the right one.
 * So each option says what it commits the place to.
 */
export const PLACE_SETTINGS = ['outdoor', 'indoor', 'mixed', 'unknown'];

export const DEFAULT_PLACE_SETTING = 'unknown';

/**
 * What each value means, in the words an admin needs at the moment of choosing.
 *
 * `unknown` is described as a real answer rather than a failure to answer, because it is: the
 * engines treat it as "no evidence" and stay silent, which is strictly better than a guess. An
 * admin who feels pressured out of `unknown` produces exactly the data these features cannot use.
 */
export const PLACE_SETTING_OPTIONS = [
  {
    value: 'outdoor',
    label: 'Outdoors',
    description: 'Open to the sky — ruins, beaches, viewpoints, treks. Weather and daylight apply.'
  },
  {
    value: 'indoor',
    label: 'Indoors',
    description: 'Under a roof — museums, galleries, enclosed shrines. Rain and dark do not matter.'
  },
  {
    value: 'mixed',
    label: 'Both',
    description: 'A fort with a museum in it. Too ambiguous to warn about, so nothing is inferred.'
  },
  {
    value: 'unknown',
    label: 'Not classified',
    description:
      'Nobody has decided yet. The planner stays silent rather than guessing — this is a safe answer, not a missing one.'
  }
];
