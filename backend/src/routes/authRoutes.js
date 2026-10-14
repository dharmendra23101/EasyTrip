const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');
const { isAuthenticated, isAuthenticatedStrict } = require('../utils/authMiddleware');
const { handleValidationErrors } = require('../utils/errorHandler');
const { profileRules } = require('./validators/profileValidators');
// PE-007. Opt-in per request: without an `Idempotency-Key` header it does nothing at all, which is
// what makes it safe to put in front of every mutation at once.
const { idempotent } = require('../utils/idempotency');

const { getProfile, updateProfile, checkAdmin } = require('../controllers/authController');
const {
  listFavorites,
  addFavorite,
  removeFavorite
} = require('../controllers/savedPlaceController');
const { getMyReviews } = require('../controllers/myReviewController');
const tripController = require('../controllers/tripController');
const tripWorkspaceController = require('../controllers/tripWorkspaceController');
const tripShareController = require('../controllers/tripShareController');
const tripCollaboratorController = require('../controllers/tripCollaboratorController');
const tripExpenseController = require('../controllers/tripExpenseController');
const recommendationController = require('../controllers/recommendationController');

// The wishlist id, wherever it arrives. Bounded to a positive integer so a malformed id is a 400
// the caller can read rather than a 500 from `INT` overflowing or a `NaN` reaching the query.
const savedPlaceIdRule = (source) =>
  source.isInt({ min: 1 }).withMessage('Place id must be a positive integer').bail().toInt();

// Auth routes
router.get('/profile', isAuthenticated, getProfile);
router.put('/profile', isAuthenticated, profileRules, handleValidationErrors, updateProfile);
// Strict (revocation-checking) auth: this answer decides whether the admin pages are
// rendered at all, so it has to cost the same verification the isAdmin API gate pays.
router.get('/check-admin', isAuthenticatedStrict, checkAdmin);

/**
 * The wishlist (`IMP-108`, `ADR-030`).
 *
 * Mounted here rather than at `/api/users/favorites` — which is what `IMP-108`'s text says,
 * inherited from a README claim the README no longer makes. `/api/auth/profile` is already "the
 * caller's own record, keyed by the verified token", these are the same category, and a second
 * mount for one resource would split "my data" across two prefixes. If a third such resource
 * appears, extract `/api/me` and move all three at once.
 *
 * Every route is behind `isAuthenticated`, and no handler accepts a user id from the request.
 * The owner is `req.user.uid` and there is no other way to name one.
 */
router.get('/favorites', isAuthenticated, listFavorites);
router.post(
  '/favorites',
  isAuthenticated,
  savedPlaceIdRule(body('place_id')),
  handleValidationErrors,
  addFavorite
);
router.delete(
  '/favorites/:placeId',
  isAuthenticated,
  savedPlaceIdRule(param('placeId')),
  handleValidationErrors,
  removeFavorite
);

/**
 * The caller's own review history (`IMP-117`).
 *
 * Deliberately separate from `GET /places/:id/reviews`, which anonymises authors so a stranger
 * cannot correlate one person's reviews across the site. This read *is* that correlation, for the
 * one person entitled to it — see `myReviewController` for why they are not one endpoint with a
 * flag. Writes reuse `IMP-019`'s owner-gated place routes; there is nothing new to guard.
 */
router.get('/reviews', isAuthenticated, getMyReviews);

/**
 * The trip workspace (`IMP-109` / `FV-006`, `ADR-031`).
 *
 * Nested under the trip on purpose: a day and an item are only ever addressable *through* the trip
 * that owns them, and the URL says so. `/api/auth/items/:id` would be a shape where forgetting the
 * ownership join is one careless handler away — this one cannot be written without the trip id.
 */
const {
  idParam,
  tripBodyRules,
  itemBodyRules,
  collaboratorBodyRules,
  expenseBodyRules
} = require('./validators/tripValidators');

// `FV-019`. Authenticated because the answer is derived entirely from this traveller's saved
// places, which are private - there is no public version of the question. `limit` is capped rather
// than trusted: an unbounded one would let a caller ask for the whole catalogue sorted.
router.get(
  '/recommendations',
  isAuthenticated,
  query('limit')
    .optional({ values: 'falsy' })
    .isInt({ min: 1, max: 24 })
    .withMessage('limit must be between 1 and 24'),
  handleValidationErrors,
  recommendationController.getRecommendations
);

router.get('/trips', isAuthenticated, tripController.listTrips);
router.post(
  '/trips',
  isAuthenticated,
  idempotent,
  tripBodyRules(true),
  handleValidationErrors,
  tripController.createTrip
);
router.get(
  '/trips/:tripId',
  isAuthenticated,
  idParam('tripId'),
  handleValidationErrors,
  tripController.getTrip
);
// Read-only, and nested like every other trip route so ownership is proved by the trip id rather
// than by a handler remembering to check (`FV-025`).
/**
 * The people who can open a trip (`FV-007` stage (a)).
 *
 * Nested under the trip id like every other trip route, so the caller's relationship to the trip is
 * proved from the path rather than by a handler remembering to check. The handlers distinguish
 * *owner* from *reader* themselves, because listing needs only read access while adding and removing
 * are the owner's alone.
 */
router.get(
  '/trips/:tripId/collaborators',
  isAuthenticated,
  idParam('tripId'),
  handleValidationErrors,
  tripCollaboratorController.listCollaborators
);
router.post(
  '/trips/:tripId/collaborators',
  isAuthenticated,
  idempotent,
  collaboratorBodyRules,
  handleValidationErrors,
  tripCollaboratorController.addCollaborator
);
router.delete(
  '/trips/:tripId/collaborators/:userId',
  isAuthenticated,
  [
    idParam('tripId'),
    // A Firebase uid, not an integer, so `idParam` does not apply. Bounded and non-empty is the
    // whole contract: it is compared against a stored value, never interpolated.
    param('userId').isString().trim().isLength({ min: 1, max: 255 })
  ],
  handleValidationErrors,
  tripCollaboratorController.removeCollaborator
);

/**
 * What the trip cost, and who owes whom (`FV-008`).
 *
 * Reading is for anybody on the trip; recording follows the editor rule; deleting is the owner's or
 * the payer's. The settlement is **derived on read** rather than stored — it is a function of the
 * expenses, and a cached one goes quietly wrong the moment somebody records a dinner.
 */
router.get(
  '/trips/:tripId/expenses',
  isAuthenticated,
  idParam('tripId'),
  handleValidationErrors,
  tripExpenseController.listExpenses
);
router.post(
  '/trips/:tripId/expenses',
  isAuthenticated,
  idempotent,
  expenseBodyRules,
  handleValidationErrors,
  tripExpenseController.createExpense
);
router.delete(
  '/trips/:tripId/expenses/:expenseId',
  isAuthenticated,
  [idParam('tripId'), idParam('expenseId')],
  handleValidationErrors,
  tripExpenseController.deleteExpense
);
router.get(
  '/trips/:tripId/settlement',
  isAuthenticated,
  idParam('tripId'),
  handleValidationErrors,
  tripExpenseController.getSettlement
);

// `BL-147`. Gated by the trip's own read rule inside the model, so this needs no extra middleware
// beyond the id validation every trip route has.
router.get(
  '/trips/:tripId/activity',
  isAuthenticated,
  idParam('tripId'),
  handleValidationErrors,
  tripController.getTripActivity
);

router.get(
  '/trips/:tripId/feasibility',
  isAuthenticated,
  idParam('tripId'),
  handleValidationErrors,
  tripController.getTripFeasibility
);
router.get(
  '/trips/:tripId/replan-suggestion',
  isAuthenticated,
  idParam('tripId'),
  handleValidationErrors,
  tripController.getTripReplanSuggestion
);
router.get(
  '/trips/:tripId/days/:dayId/route-suggestion',
  isAuthenticated,
  [idParam('tripId'), idParam('dayId')],
  handleValidationErrors,
  tripController.getDayRouteSuggestion
);
// The day as it would be drawn (`FV-026` stage c). Nested identically, so a day that is not
// yours is a 404 by the same query rather than by a second check that has to remember.
router.get(
  '/trips/:tripId/days/:dayId/route',
  isAuthenticated,
  [idParam('tripId'), idParam('dayId')],
  handleValidationErrors,
  tripController.getDayRoute
);
router.put(
  '/trips/:tripId',
  isAuthenticated,
  [idParam('tripId'), ...tripBodyRules(false)],
  handleValidationErrors,
  tripController.updateTrip
);
router.delete(
  '/trips/:tripId',
  isAuthenticated,
  idParam('tripId'),
  handleValidationErrors,
  tripController.deleteTrip
);

router.post(
  '/trips/:tripId/days',
  isAuthenticated,
  idempotent,
  idParam('tripId'),
  handleValidationErrors,
  tripController.addDay
);
router.delete(
  '/trips/:tripId/days/:dayId',
  isAuthenticated,
  [idParam('tripId'), idParam('dayId')],
  handleValidationErrors,
  tripController.deleteDay
);

router.post(
  '/trips/:tripId/days/:dayId/items',
  isAuthenticated,
  [idParam('tripId'), idParam('dayId'), ...itemBodyRules(true)],
  handleValidationErrors,
  tripController.addItem
);
router.put(
  '/trips/:tripId/days/:dayId/items/order',
  isAuthenticated,
  [
    idParam('tripId'),
    idParam('dayId'),
    body('item_ids').isArray({ min: 0 }).withMessage('item_ids must be an array'),
    body('item_ids.*').isInt({ min: 1 }).withMessage('item_ids must contain positive integers')
  ],
  handleValidationErrors,
  tripController.reorderItems
);
router.put(
  '/trips/:tripId/items/:itemId',
  isAuthenticated,
  [idParam('tripId'), idParam('itemId'), ...itemBodyRules(false)],
  handleValidationErrors,
  tripController.updateItem
);
router.delete(
  '/trips/:tripId/items/:itemId',
  isAuthenticated,
  [idParam('tripId'), idParam('itemId')],
  handleValidationErrors,
  tripController.deleteItem
);

// ---------------------------------------------------------------------------
// Notes and checklist (`FV-006` stage b)
// ---------------------------------------------------------------------------
// Nested under `/trips/:tripId` like every other child collection here, and for the same reason:
// ownership is proved by the trip id inside the query rather than by a handler remembering to
// check. Neither table carries a uid of its own, so there is no shape in which one could be read
// without its trip.
//
// The length caps are enforced here **as well as** by the column types, because a `VARCHAR(200)`
// answers an oversized label with a 500 from the driver while a validator answers it with a 400
// naming the field. `body` is TEXT and has no such backstop, so its cap exists only here.

// Trimmed before it is stored, so " " cannot become a note the CHECK constraint would then reject
// with a 500. The validator is where a blank body is a 400.
const noteBodyRule = body('body')
  .isString()
  .withMessage('A note needs a body')
  .bail()
  .trim()
  .isLength({ min: 1, max: 5000 })
  .withMessage('A note must be between 1 and 5000 characters');

const checklistLabelRule = (required) =>
  (required ? body('label') : body('label').optional())
    .isString()
    .withMessage('A checklist item needs a label')
    .bail()
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage('A checklist label must be between 1 and 200 characters');

// `FV-006` stage (d). POST because it creates a trip; nested under the source so ownership is proved
// by the same query everything else here uses. The optional title is validated with the same rule a
// new trip's is - a copy is a trip, and a 201-character name must fail the same way.
router.post(
  '/trips/:tripId/duplicate',
  isAuthenticated,
  idempotent,
  [
    idParam('tripId'),
    body('title')
      .optional()
      .trim()
      .notEmpty()
      .withMessage('A trip needs a title')
      .bail()
      .isLength({ max: 200 })
  ],
  handleValidationErrors,
  tripWorkspaceController.duplicateTrip
);

// `FV-009` stage (c), the owner's half. The public half is NOT here - it is on the unauthenticated
// router, because the whole point is that the reader is not signed in. POST both creates and
// **rotates**: somebody who thinks a link has spread further than they meant should not have to find
// a separate control while worried about it.
router.get(
  '/trips/:tripId/share',
  isAuthenticated,
  idParam('tripId'),
  handleValidationErrors,
  tripShareController.getShare
);
router.post(
  '/trips/:tripId/share',
  isAuthenticated,
  idParam('tripId'),
  handleValidationErrors,
  tripShareController.createShare
);
router.delete(
  '/trips/:tripId/share',
  isAuthenticated,
  idParam('tripId'),
  handleValidationErrors,
  tripShareController.revokeShare
);

// `FV-009` stage (a). A literal segment, declared before nothing that could shadow it, and GET-only
// because it is a read. Authenticated like the rest: a trip is not public, so neither is its export.
router.get(
  '/trips/:tripId/calendar.ics',
  isAuthenticated,
  idParam('tripId'),
  handleValidationErrors,
  tripWorkspaceController.exportCalendar
);

router.get(
  '/trips/:tripId/notes',
  isAuthenticated,
  idParam('tripId'),
  handleValidationErrors,
  tripWorkspaceController.listNotes
);
router.post(
  '/trips/:tripId/notes',
  isAuthenticated,
  [idParam('tripId'), noteBodyRule],
  handleValidationErrors,
  tripWorkspaceController.createNote
);
router.put(
  '/trips/:tripId/notes/:noteId',
  isAuthenticated,
  [idParam('tripId'), idParam('noteId'), noteBodyRule],
  handleValidationErrors,
  tripWorkspaceController.updateNote
);
router.delete(
  '/trips/:tripId/notes/:noteId',
  isAuthenticated,
  [idParam('tripId'), idParam('noteId')],
  handleValidationErrors,
  tripWorkspaceController.deleteNote
);

router.get(
  '/trips/:tripId/checklist',
  isAuthenticated,
  idParam('tripId'),
  handleValidationErrors,
  tripWorkspaceController.listChecklist
);
router.post(
  '/trips/:tripId/checklist',
  isAuthenticated,
  [idParam('tripId'), checklistLabelRule(true)],
  handleValidationErrors,
  tripWorkspaceController.createChecklistItem
);
// Declared before `/checklist/:itemId`, like every literal segment in this repository - Express
// matches in declaration order, so a `:itemId` route above this would swallow "order" and hand it
// to a handler expecting an integer (`BUG C2`, guarded by `routeShadowing.test.js`).
router.put(
  '/trips/:tripId/checklist/order',
  isAuthenticated,
  [
    idParam('tripId'),
    body('item_ids').isArray({ min: 0 }).withMessage('item_ids must be an array'),
    body('item_ids.*').isInt({ min: 1 }).withMessage('item_ids must contain positive integers')
  ],
  handleValidationErrors,
  tripWorkspaceController.reorderChecklist
);
// PATCH rather than PUT: a tick sends `is_done` alone and must not blank the label beside it.
// `is_done` is validated as a real boolean rather than coerced, so `"maybe"` is a 400 instead of
// quietly becoming `true`.
router.patch(
  '/trips/:tripId/checklist/:itemId',
  isAuthenticated,
  [
    idParam('tripId'),
    idParam('itemId'),
    checklistLabelRule(false),
    body('is_done').optional().isBoolean().withMessage('is_done must be true or false').toBoolean()
  ],
  handleValidationErrors,
  tripWorkspaceController.updateChecklistItem
);
router.delete(
  '/trips/:tripId/checklist/:itemId',
  isAuthenticated,
  [idParam('tripId'), idParam('itemId')],
  handleValidationErrors,
  tripWorkspaceController.deleteChecklistItem
);

module.exports = router;
