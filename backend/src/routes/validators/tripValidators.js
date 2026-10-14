const { body, param } = require('express-validator');

/**
 * Request validation for the trip workspace (`IMP-109` / `FV-006`, `ADR-031`).
 *
 * Lifted out of `authRoutes.js` when that file crossed the 500-line exit criterion
 * (`check:size`) — three collaborator routes were the last straw, and the honest response to a
 * guard is to split the file rather than to widen the waiver.
 *
 * **This is the right seam.** These are pure functions that build `express-validator` chains; they
 * know nothing about routers, controllers or mounting, so moving them changes no route, no path
 * and no middleware order. What stays behind in `authRoutes.js` is the thing that file is actually
 * about — which URL reaches which handler.
 *
 * The rules themselves are unchanged, comments included. A file split that quietly edits the code
 * it moves is two changes wearing one diff.
 */

const idParam = (name) =>
  param(name).isInt({ min: 1 }).withMessage(`${name} must be a positive integer`).bail().toInt();

const tripBodyRules = (required) => [
  required
    ? body('title')
        .trim()
        .notEmpty()
        .withMessage('A trip needs a title')
        .bail()
        .isLength({ max: 200 })
    : body('title')
        .optional()
        .trim()
        .notEmpty()
        .withMessage('A trip needs a title')
        .bail()
        .isLength({ max: 200 }),
  body('description').optional({ values: 'null' }).isLength({ max: 5000 }),
  body('start_date')
    .optional({ values: 'falsy' })
    .isISO8601()
    .withMessage('start_date must be a date'),
  body('end_date').optional({ values: 'falsy' }).isISO8601().withMessage('end_date must be a date'),
  body('status')
    .optional({ values: 'falsy' })
    .isIn(['draft', 'upcoming', 'completed'])
    .withMessage('status must be draft, upcoming or completed'),
  // The database has the same CHECK; this exists so a typo is a readable 400 rather than a 500
  // carrying a constraint name the user cannot act on.
  body().custom((value) => {
    if (value.start_date && value.end_date && value.end_date < value.start_date) {
      throw new Error('A trip cannot end before it starts');
    }
    return true;
  })
];

/**
 * Validation for a trip item.
 *
 * **Takes `required` for the same reason `tripBodyRules` does, and it is a fix rather than
 * symmetry** (`BUG-052`). The last rule — *an item needs a title, or a place to take one from* — is
 * true when an item is **created** and false when one is **patched**: an item that already has a
 * title does not have to resend it to change its start time. Shared as a flat array, it made
 * `PUT /items/:id` with `{ start_time: '10:00' }` a 400 complaining about a title the item already
 * had.
 *
 * Nothing caught it because every existing update test happens to send a title. It surfaced when
 * `FV-027`'s proposals needed to move an item by day alone.
 */
const itemBodyRules = (required) => [
  body('place_id').optional({ values: 'falsy' }).isInt({ min: 1 }).toInt(),
  // Moving an item to another day of the same trip (Sprint 8.26). Shape only — that the day belongs
  // to this trip is enforced in the query, because a validator cannot know and a check here would
  // be a second source of truth about authorisation.
  body('trip_day_id').optional({ values: 'falsy' }).isInt({ min: 1 }).toInt(),
  body('item_type')
    .optional({ values: 'falsy' })
    .isIn(['place', 'transport', 'meal', 'activity', 'note'])
    .withMessage('item_type must be place, transport, meal, activity or note'),
  body('title').optional().trim().isLength({ max: 200 }),
  body('notes').optional({ values: 'null' }).isLength({ max: 2000 }),
  // HH:MM or HH:MM:SS. A TIME column would reject anything else anyway; this makes it a 400.
  body('start_time')
    .optional({ values: 'falsy' })
    .matches(/^\d{2}:\d{2}(:\d{2})?$/),
  body('end_time')
    .optional({ values: 'falsy' })
    .matches(/^\d{2}:\d{2}(:\d{2})?$/),
  // An item with neither a place nor a title has nothing to render — on creation. A patch is
  // allowed to touch one field and leave the rest of the row alone.
  ...(required
    ? [
        body().custom((value) => {
          if (!value.place_id && !String(value.title || '').trim()) {
            throw new Error('An item needs a title, or a place to take one from');
          }
          return true;
        })
      ]
    : [])
];

/**
 * Adding somebody to a trip (`FV-007`).
 *
 * `isEmail` **without** `normalizeEmail` — the address is a lookup key against `users.email`, and
 * normalising would rewrite it (stripping Gmail dots, lower-casing) into something that no longer
 * matches what somebody registered with. The model compares with `lower()` on both sides, which is
 * all the case-insensitivity this needs.
 *
 * `role` is optional because omitting it means `viewer`. The model defends the vocabulary too: it is
 * the only path to the table, and a CHECK violation surfaces as an unactionable 500.
 */
const collaboratorBodyRules = [
  idParam('tripId'),
  body('email')
    .isEmail()
    .withMessage('A valid email address is required')
    .bail()
    .isLength({ max: 255 })
    .withMessage('That email address is too long'),
  body('role')
    .optional()
    .isIn(['viewer', 'editor'])
    .withMessage('A collaborator is either a viewer or an editor')
];

/**
 * Recording an expense (`FV-008`).
 *
 * `amount_minor` is an integer in the currency's minor unit, and `<> 0` mirrors the CHECK in
 * `019_trip_expenses.sql`: a refund is a real expense with a negative sign, and zero is never a fact
 * anybody meant to record.
 *
 * `participants` is optional because omitting it means everybody on the trip — which is what a
 * dinner usually is. Sending it is how an expense for only some people gets recorded.
 */
const expenseBodyRules = [
  idParam('tripId'),
  body('description')
    .trim()
    .notEmpty()
    .withMessage('An expense needs a description')
    .bail()
    .isLength({ max: 200 }),
  body('amount_minor')
    .isInt()
    .withMessage('amount_minor must be a whole number of paise/cents')
    .bail()
    .custom((value) => Number(value) !== 0)
    .withMessage('An expense cannot be zero')
    .toInt(),
  body('currency')
    .isString()
    .trim()
    .matches(/^[A-Za-z]{3}$/)
    .withMessage('currency must be a 3-letter ISO code'),
  body('paid_by').optional().isString().trim().isLength({ min: 1, max: 255 }),
  body('participants').optional().isArray({ max: 50 }),
  body('participants.*').isString().trim().isLength({ min: 1, max: 255 })
];

module.exports = {
  idParam,
  tripBodyRules,
  itemBodyRules,
  collaboratorBodyRules,
  expenseBodyRules
};
