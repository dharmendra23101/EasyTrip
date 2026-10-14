/**
 * The single theme vocabulary for EasyTrip.
 *
 * Before this file existed the list was maintained by hand in three places — `browse.jsx`,
 * `admin/addPlace.jsx` and `admin/editPlace/[id].jsx` — and they had drifted apart in both
 * directions (IMP-118, IMP-020):
 *
 *   - `beach` and `mountain` were filterable in browse and linked from the home page, but no admin
 *     form could assign them, so both filters were guaranteed to return zero results.
 *   - `weekend` was assignable in addPlace but absent from browse, so places tagged with it could
 *     never be found by it.
 *   - `editPlace` accepted free text, so an edit could write a theme no filter would ever match.
 *
 * A theme id is a value stored in `places.themes` and matched by the server-side `themes` filter,
 * so **the id is a data contract** — renaming one orphans every place already carrying it. Labels,
 * icons and colours are presentation and safe to change.
 *
 * Icons are deliberately NOT here: the three consumers use different icon sets and sizing, and
 * putting JSX in a constants module would force this file to be a component. Each consumer maps
 * `id` to its own icon.
 */

export const THEMES = [
  { id: 'hot', label: 'Hot Weather', description: 'Perfect for summer visits' },
  { id: 'cold', label: 'Cold Weather', description: 'Ideal for winter experiences' },
  { id: 'rainy', label: 'Rainy Season', description: 'Beautiful during monsoons' },
  { id: 'romantic', label: 'Romantic', description: 'Perfect for couples' },
  { id: 'religious', label: 'Religious', description: 'Spiritual destinations' },
  { id: 'historical', label: 'Historical', description: 'Rich in history' },
  { id: 'science', label: 'Science', description: 'Educational and scientific' },
  { id: 'tech', label: 'Technology', description: 'Modern tech hubs' },
  { id: 'adventure', label: 'Adventure', description: 'Thrilling activities' },
  { id: 'nature', label: 'Nature', description: 'Natural beauty' },
  { id: 'beach', label: 'Beach', description: 'Coastal and seaside' },
  { id: 'mountain', label: 'Mountain', description: 'Hills and high altitude' },
  { id: 'family', label: 'Family Friendly', description: 'Great for families' },
  { id: 'weekend', label: 'Weekend Getaway', description: 'Perfect for short trips' }
];

/** Every valid theme id, for validation and membership tests. */
export const THEME_IDS = THEMES.map((theme) => theme.id);

/** Fast membership check — used to drop unknown ids read back from older rows. */
export const isValidThemeId = (id) => THEME_IDS.includes(id);

/** Human label for an id, falling back to the raw id so unknown values stay visible, not blank. */
export const themeLabel = (id) => THEMES.find((theme) => theme.id === id)?.label || id;

/**
 * Season filter values. These are NOT themes — they filter `best_time_to_visit` rather than
 * `places.themes` — but they live here because they are the other hand-maintained vocabulary the
 * browse filters depend on, and the server validates them against exactly this set
 * (`searchRules` in `placeRoutes.js` allows summer/monsoon/winter; `any` means "no filter").
 */
export const SEASONS = [
  { id: 'any', label: 'Anytime' },
  { id: 'summer', label: 'Summer (Apr-Jun)' },
  { id: 'monsoon', label: 'Monsoon (Jul-Sep)' },
  { id: 'winter', label: 'Winter (Oct-Mar)' }
];
