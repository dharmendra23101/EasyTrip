/**
 * The closed vocabularies behind the travel-preference profile (`FV-020`).
 *
 * `021_travel_preferences.sql` CHECKs the three scalars in the database and deliberately does **not**
 * CHECK the two arrays, on the same ground `places.themes` does not: the theme vocabulary lives in
 * the application and is enforced across tiers by `npm run check:themes`, and a second copy in SQL
 * is a second thing to update.
 *
 * This module is that application-side enforcement for `dietary_needs`. Interests reuse the theme
 * ids directly, so they are validated against the same list the rest of the product uses rather than
 * against a parallel one that would drift.
 *
 * **A closed vocabulary rather than free text, and that is a product decision.** "Vegetarian" typed
 * five ways is five preferences that can never be matched against anything; the point of recording a
 * dietary need is that something can eventually act on it.
 */

/** Matched, not merely displayed. Additions are a migration-free change to this list plus a test. */
const DIETARY_NEEDS = [
  'vegetarian',
  'vegan',
  'jain',
  'halal',
  'kosher',
  'gluten-free',
  'nut-allergy'
];

const BUDGET_BANDS = ['budget', 'mid', 'premium'];
const TRAVEL_PACES = ['relaxed', 'balanced', 'packed'];
const PARTY_TYPES = ['solo', 'couple', 'family', 'friends'];

module.exports = { DIETARY_NEEDS, BUDGET_BANDS, TRAVEL_PACES, PARTY_TYPES };
