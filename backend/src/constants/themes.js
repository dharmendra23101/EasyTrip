/**
 * The theme vocabulary, backend copy.
 *
 * **Why a copy exists at all.** `frontend/src/constants/themes.js` is the canonical list and calls a
 * theme id "a data contract" — it is stored in `places.themes` and is what the browse filter is
 * built from. The backend had no copy, so the write validator checked `themes` for *shape* only
 * (an array of short strings) and accepted anything: `spiritual`, `heritage`, a typo, a sentence.
 * Nothing rejected a value no filter would ever offer.
 *
 * The two files cannot share a module. The frontend is ESM inside its own package; the backend is
 * CommonJS inside another, and there is no workspace linking them. So the list is duplicated and
 * **`scripts/check-theme-vocabulary.mjs` fails CI if the two ever differ** — the same arrangement
 * `check-api-docs` and `check-env-docs` use for the other facts that live on both sides of a
 * boundary. A duplicate with a guard is honest; a duplicate without one is how this drifted.
 *
 * Order is part of the comparison, so keep it identical to the frontend file.
 */
const THEME_IDS = [
  'hot',
  'cold',
  'rainy',
  'romantic',
  'religious',
  'historical',
  'science',
  'tech',
  'adventure',
  'nature',
  'beach',
  'mountain',
  'family',
  'weekend'
];

const isValidThemeId = (id) => THEME_IDS.includes(id);

module.exports = { THEME_IDS, isValidThemeId };
