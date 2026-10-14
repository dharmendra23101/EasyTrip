/**
 * Assembling the accessibility half of a place write (`FV-029` stage a).
 *
 * Five columns that behave as **one set**, because their validity is a property of the row rather
 * than of any field: `places_accessibility_is_attributed` says a claim must carry a source and a
 * date. That is what makes them worth a module instead of five more lines in `placeController` —
 * the rule is about how they move together, and it is exercisable with no database, no token and no
 * multipart body.
 *
 * Extracted when `check-module-size` put `placeController.js` at 513 lines. The guard named the
 * seam rather than merely the line count, which is the same thing it did for `tripItemModel`
 * (Sprint 8.27) and `geoDistance` before that.
 */
const { DEFAULT_ACCESS_LEVEL } = require('../../constants/placeAccessibility');
const { isProvided } = require('./writeFields');

/** The five keys, in the order the column comments and the admin form use. */
const ACCESSIBILITY_KEYS = [
  'step_free_access',
  'accessible_restroom',
  'accessibility_notes',
  'accessibility_source',
  'accessibility_checked_on'
];

/**
 * The one field of the five where an empty string is a **value** rather than an absence
 * (`BL-140`).
 *
 * `isProvided` treats `''` as "the caller said nothing", which is what `BUG-055` needed: an
 * untouched `<select>` submits `name=""`, and passing that to a column with a `CHECK` constraint is
 * a 500 on an ordinary edit. Three of these columns are constrained and the fourth is a `DATE` that
 * `''` cannot parse into, so all four must keep that reading.
 *
 * **`accessibility_notes` is free text, and applying the same rule to it was a mistake of mine.**
 * It made a saved note impossible to erase: a cleared textarea submits `''`, which was read as
 * silence, so the old note survived every attempt to remove it. It is also inconsistent with the
 * file it sits beside — `updatePlace` writes `description !== undefined`, so an empty description
 * has always cleared the field.
 *
 * So the rule is per column *kind*, not global: an empty string is absence where the database would
 * reject it, and a value where the database accepts it.
 */
const CLEARABLE_KEYS = new Set(['accessibility_notes']);

/** Did the caller supply this particular field? */
const suppliedFor = (key, value) =>
  CLEARABLE_KEYS.has(key) ? value !== undefined : isProvided(value);

/**
 * What a create should write.
 *
 * Defaults rather than pass-through for the two enumerated axes: a create that omits accessibility
 * must produce an **unsurveyed** row, and saying so here means the returned payload says `unknown`
 * instead of depending on what the DDL happens to hold. The other three are genuinely absent, and
 * `null` is the honest representation of that.
 */
const accessibilityForCreate = (body = {}) => ({
  step_free_access: isProvided(body.step_free_access)
    ? body.step_free_access
    : DEFAULT_ACCESS_LEVEL,
  accessible_restroom: isProvided(body.accessible_restroom)
    ? body.accessible_restroom
    : DEFAULT_ACCESS_LEVEL,
  accessibility_notes: isProvided(body.accessibility_notes) ? body.accessibility_notes : null,
  accessibility_source: isProvided(body.accessibility_source) ? body.accessibility_source : null,
  accessibility_checked_on: isProvided(body.accessibility_checked_on)
    ? body.accessibility_checked_on
    : null
});

/**
 * What an update should write — **only the keys the caller actually sent.**
 *
 * `updatePlace` keys on `column in placeData` rather than on the value, so including a key with
 * `undefined` sends NULL. For an ordinary column that is `BUG-048`; here it is worse, because these
 * five are checked against each other. An edit to a place's *description* that carried all five as
 * `undefined` would strip the provenance from a row that still claimed step-free access, and the
 * database would reject the whole edit — a rejected description change with a message about
 * accessibility, which is the kind of error nobody can act on.
 *
 * So absence means *leave the survey alone*, and it is expressed by the key not being there — for
 * every field except the notes, where an empty string is how a note is erased (`CLEARABLE_KEYS`).
 */
const accessibilityPatch = (body = {}) =>
  Object.fromEntries(
    ACCESSIBILITY_KEYS.filter((key) => suppliedFor(key, body[key])).map((key) => [key, body[key]])
  );

module.exports = { ACCESSIBILITY_KEYS, accessibilityForCreate, accessibilityPatch };
