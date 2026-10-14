const { body } = require('express-validator');
const { BUDGET_BANDS, TRAVEL_PACES, PARTY_TYPES } = require('../../constants/travelPreferences');

/**
 * Validation for the traveller's own profile (`IMP-008`, `FV-029` stage (c), `FV-020` stage (a)).
 *
 * Lifted out of `authRoutes.js` when the preference fields took that file past the 500-line exit
 * criterion — the third time this has happened and the third time the answer was a split rather
 * than a waiver. The seam is the same one as `tripValidators`: pure `express-validator` builders
 * that know nothing about routers, so no route, path or middleware order moves.
 *
 * **The `optional()` variants here are load-bearing and easy to get wrong**, which is most of why
 * these rules deserve a file with room to say so. Three different meanings of "optional" appear
 * below, each chosen deliberately:
 *
 *   - `optional({ values: 'falsy' })` on `location` and `dob` — an empty string means "cleared",
 *     and both are stored as NULL either way.
 *   - `optional({ values: 'null' })` on the access-need booleans — `false` is a real answer, and it
 *     is how somebody *removes* a stated requirement. `'falsy'` would drop it and leave the
 *     requirement set forever.
 *   - `optional()` (the default, `values: 'undefined'`) on the preference fields — `[]` and `null`
 *     are real answers, for the same reason `false` is above.
 */

const profileRules = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Name is required')
    .bail()
    .isLength({ max: 100 })
    .withMessage('Name must be at most 100 characters'),
  body('location')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 120 })
    .withMessage('Location must be at most 120 characters'),
  // `FV-029` stage (c). `values: 'null'` rather than `'falsy'`, and the distinction is the whole
  // point: `false` is a real answer here — it is how somebody *removes* a stated requirement — and
  // `optional({ values: 'falsy' })` would silently drop it, leaving the requirement set forever.
  ...['requires_step_free', 'requires_accessible_restroom'].map((field) =>
    body(field)
      .optional({ values: 'null' })
      .isBoolean()
      .withMessage(`${field} must be true or false`)
      .toBoolean()
  ),
  /**
   * `FV-020` stage (a).
   *
   * `optional()` with the default (`values: 'undefined'`) rather than `'falsy'`, and the difference
   * is the whole of how a preference gets **cleared**: `[]` and `null` are real answers here —
   * "I have no dietary needs" is a statement — and `'falsy'` would drop them, leaving a preference
   * set forever with no way to unset it. Exactly the distinction the access-needs booleans above
   * needed, for the same reason.
   */
  body('interests').optional().isArray({ max: 14 }).withMessage('interests must be a list'),
  body('interests.*').isString().trim().isLength({ min: 1, max: 40 }),
  body('dietary_needs').optional().isArray({ max: 10 }).withMessage('dietary_needs must be a list'),
  body('dietary_needs.*').isString().trim().isLength({ min: 1, max: 40 }),
  ...[
    ['budget_band', BUDGET_BANDS],
    ['travel_pace', TRAVEL_PACES],
    ['party_type', PARTY_TYPES]
  ].map(([field, allowed]) =>
    body(field)
      .optional({ nullable: true })
      // `''` is admitted as well as `null`, because an HTML `<select>` with no choice made submits
      // an empty string and the controller turns that into NULL. Rejecting it would mean the form
      // could set a preference and never unset one.
      .custom((value) => value === null || value === '' || allowed.includes(value))
      .withMessage(`${field} must be one of: ${allowed.join(', ')}`)
  ),
  body('dob')
    .optional({ values: 'falsy' })
    .isISO8601()
    .withMessage('Date of birth must be a valid date')
];

module.exports = { profileRules };
