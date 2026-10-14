const tripShareModel = require('../models/tripShareModel');
const logger = require('../utils/logger');

/**
 * The read-only share link (`FV-009` stage c).
 *
 * Two halves with opposite rules, which is the reason they are in one file: the owner's half is
 * authenticated and answers 404 for a trip that is not theirs, and the public half has no caller
 * identity at all and must be read as though every response is world-readable, because it is.
 */

const notFound = (res) => res.status(404).json({ message: 'Trip not found' });

const failed = (res, error, what) => {
  logger.error({ err: error }, `Error ${what}`);
  return res.status(500).json({ message: `Error ${what}` });
};

// ---------------------------------------------------------------------------
// The owner's half — authenticated
// ---------------------------------------------------------------------------

/** GET /api/auth/trips/:tripId/share */
const getShare = async (req, res) => {
  try {
    const state = await tripShareModel.getShareState(req.user.uid, req.params.tripId);
    if (!state) return notFound(res);

    // `shared` as well as the token, so a client can render "not shared" without having to decide
    // what a null token means.
    return res.status(200).json({
      shared: Boolean(state.share_token),
      share_token: state.share_token,
      shared_at: state.shared_at
    });
  } catch (error) {
    return failed(res, error, 'loading this share link');
  }
};

/**
 * POST /api/auth/trips/:tripId/share
 *
 * Creates the link, and **rotates it if one already exists**. Rotation is the same action as sharing
 * on purpose: somebody who thinks a link has spread further than they meant should not have to find
 * a separate control while worried about it.
 */
const createShare = async (req, res) => {
  try {
    const state = await tripShareModel.shareTrip(req.user.uid, req.params.tripId);
    if (!state) return notFound(res);

    return res.status(201).json({
      shared: true,
      share_token: state.share_token,
      shared_at: state.shared_at
    });
  } catch (error) {
    return failed(res, error, 'creating this share link');
  }
};

/** DELETE /api/auth/trips/:tripId/share */
const revokeShare = async (req, res) => {
  try {
    const revoked = await tripShareModel.revokeShare(req.user.uid, req.params.tripId);
    if (!revoked) return notFound(res);

    return res.status(204).send();
  } catch (error) {
    return failed(res, error, 'revoking this share link');
  }
};

// ---------------------------------------------------------------------------
// The public half — no caller identity at all
// ---------------------------------------------------------------------------

/**
 * GET /api/trips/shared/:token
 *
 * **`noindex`, and it is set here rather than left to the page.** A share link is somebody's holiday
 * plans; it should not turn up in a search result because one recipient's browser extension
 * submitted the URL. The page sets a `robots` meta tag too — this header covers the case where the
 * JSON itself is fetched or linked directly, which a meta tag cannot.
 *
 * **`Cache-Control: private, no-store`.** A shared trip must not be held in a CDN or a proxy cache
 * where a later request for the same URL could be served to somebody whose link has since been
 * revoked. Revocation that takes effect everywhere is the whole reason the token lives on the trip.
 */
const getSharedTrip = async (req, res) => {
  try {
    const trip = await tripShareModel.getSharedTrip(req.params.token);
    // A revoked, mistyped or never-existing token are all the same answer. Distinguishing them would
    // say whether a token was ever real, which is information about somebody else's trip.
    if (!trip) return res.status(404).json({ message: 'This link is not valid' });

    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).json({ trip });
  } catch (error) {
    return failed(res, error, 'loading this shared trip');
  }
};

module.exports = { getShare, createShare, revokeShare, getSharedTrip };
