const savedPlaceModel = require('../models/savedPlaceModel');
const logger = require('../utils/logger');

/**
 * The wishlist endpoints (`IMP-108`, `ADR-030`).
 *
 * **One rule governs every handler here:** the owner is `req.user.uid`, which the auth middleware
 * derived from a verified Firebase token. No handler reads a user id from the body, the query
 * string or the path, and none accepts one — so there is no request shape that reaches another
 * user's wishlist. That is `IMP-001/002/003`'s rule applied to a new resource, and it is the
 * invariant `savedPlaces.test.js` mutation-tests.
 *
 * Postgres error codes used below:
 *   23503 foreign_key_violation — the place id does not exist
 */
const FOREIGN_KEY_VIOLATION = '23503';

/** GET /api/auth/favorites — the caller's saved places, newest first. */
const listFavorites = async (req, res) => {
  try {
    const [places, placeIds] = await Promise.all([
      savedPlaceModel.listSavedPlaces(req.user.uid),
      savedPlaceModel.listSavedPlaceIds(req.user.uid)
    ]);

    // Both shapes in one response. The wishlist page renders `places`; the heart buttons scattered
    // across the home carousel and the detail page only need `placeIds`, and making them derive it
    // from `places` would mean every heart depends on the card projection staying stable.
    res.status(200).json({ places, placeIds });
  } catch (error) {
    logger.error({ err: error }, 'Error listing saved places');
    res.status(500).json({ message: 'Error loading your saved places' });
  }
};

/**
 * POST /api/auth/favorites — save a place. Idempotent.
 *
 * Answers 200 whether or not a row was created. Saving something already saved is what a
 * double-click or a retry after a dropped response looks like, and a 409 there would be a conflict
 * the UI has to special-case in order to arrive at the state it already wanted. `reportPlaceReview`
 * set this convention: *reporting the same review twice is a no-op server-side rather than an
 * error.*
 */
const addFavorite = async (req, res) => {
  const placeId = Number(req.body.place_id);

  try {
    const created = await savedPlaceModel.addSavedPlace(req.user.uid, placeId);

    // `created: false` is not an error and is not surfaced as one; it is there so a caller that
    // cares (an import, a metric) can tell, and so the tests can assert idempotency rather than
    // inferring it from a row count.
    res.status(200).json({ saved: true, created, place_id: placeId });
  } catch (error) {
    if (error.code === FOREIGN_KEY_VIOLATION) {
      // The foreign key rejected it, so no orphan row exists to clean up. 404 rather than 400:
      // the id was well-formed (the validator already proved that), it just names nothing.
      return res.status(404).json({ message: 'Place not found' });
    }

    logger.error({ err: error }, 'Error saving place');
    res.status(500).json({ message: 'Error saving this place' });
  }
};

/**
 * DELETE /api/auth/favorites/:placeId — unsave a place. Idempotent.
 *
 * Removing something that is not saved answers 200, for the same reason saving twice does — and
 * because the alternative leaks. A 404 for "not in your wishlist" versus a 200 for "removed" is a
 * one-bit oracle for *whether somebody else saved this*, if the row were ever addressed by its own
 * id. It is not — the model scopes the DELETE by uid — but the response shape should not depend on
 * that remaining true.
 */
const removeFavorite = async (req, res) => {
  const placeId = Number(req.params.placeId);

  try {
    const removed = await savedPlaceModel.removeSavedPlace(req.user.uid, placeId);

    res.status(200).json({ saved: false, removed, place_id: placeId });
  } catch (error) {
    logger.error({ err: error }, 'Error removing saved place');
    res.status(500).json({ message: 'Error removing this place' });
  }
};

module.exports = { listFavorites, addFavorite, removeFavorite };
