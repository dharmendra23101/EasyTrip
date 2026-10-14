/**
 * The preference vocabularies, browser side (`FV-020`).
 *
 * The ids here are the values `021_travel_preferences.sql` CHECKs and
 * `backend/src/constants/travelPreferences.js` validates. **Two copies of a vocabulary is exactly
 * the shape `check:themes` exists to police**, and the same argument applies: an id that exists on
 * one side and not the other is a preference somebody can set and nothing can ever match.
 *
 * The themes vocabulary is already guarded that way across both tiers, and `interests` reuses it
 * rather than restating it — which is why there is no interests list in this file.
 *
 * The labels live only here, because a label is a product decision and the database has no opinion
 * about whether `mid` reads as "Mid-range" or "Comfortable".
 */

export const BUDGET_BANDS = [
  { id: 'budget', label: 'Budget' },
  { id: 'mid', label: 'Mid-range' },
  { id: 'premium', label: 'Premium' }
];

export const TRAVEL_PACES = [
  { id: 'relaxed', label: 'Relaxed — a couple of things a day' },
  { id: 'balanced', label: 'Balanced' },
  { id: 'packed', label: 'Packed — fit in as much as possible' }
];

export const PARTY_TYPES = [
  { id: 'solo', label: 'Solo' },
  { id: 'couple', label: 'As a couple' },
  { id: 'family', label: 'With family' },
  { id: 'friends', label: 'With friends' }
];

export const DIETARY_NEEDS = [
  { id: 'vegetarian', label: 'Vegetarian' },
  { id: 'vegan', label: 'Vegan' },
  { id: 'jain', label: 'Jain' },
  { id: 'halal', label: 'Halal' },
  { id: 'kosher', label: 'Kosher' },
  { id: 'gluten-free', label: 'Gluten-free' },
  { id: 'nut-allergy', label: 'Nut allergy' }
];
