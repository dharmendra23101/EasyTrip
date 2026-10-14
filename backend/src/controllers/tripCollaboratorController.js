const tripModel = require('../models/tripModel');
const tripAccessModel = require('../models/tripAccessModel');
const logger = require('../utils/logger');

/**
 * Who else can open this trip (`FV-007` stage (a)).
 *
 * ---------------------------------------------------------------------------
 * Managing collaborators is an owner's power, and reading the list is not
 * ---------------------------------------------------------------------------
 * Every handler here proves the caller's relationship to the trip through `tripAccessModel`, and
 * they do not all demand the same one:
 *
 *   - **Listing** needs read access. A viewer seeing who else has the trip is the same information
 *     they get from the trip itself, and hiding it would mean somebody could be added to a trip and
 *     never know who else was on it.
 *   - **Adding and removing** are owner-only. There is no `editor` yet, and even when there is, the
 *     ability to grant access is not the ability to edit an itinerary — conflating them is how a
 *     viewer eventually adds themselves an accomplice.
 *
 * The check is `roleOnTrip` rather than "did `getTrip` return something", because these handlers
 * need to distinguish *owner* from *reader*, and a read that succeeds cannot tell them apart.
 *
 * ---------------------------------------------------------------------------
 * A trip you cannot see and a trip that does not exist answer alike
 * ---------------------------------------------------------------------------
 * 404 for both, as everywhere else in this surface. Answering 403 for "exists but not yours" turns
 * every endpoint into an oracle for which trip ids are real.
 */

const notFound = (res) => res.status(404).json({ message: 'Trip not found' });

/**
 * GET /api/auth/trips/:tripId/collaborators
 *
 * The owner is deliberately **not** in this list. They are `trips.user_id`, the list is the people
 * added to it, and including them would invite a client to render "shared with: you".
 */
const listCollaborators = async (req, res) => {
  try {
    const tripId = Number(req.params.tripId);
    const role = await tripAccessModel.roleOnTrip(req.user.uid, tripId);
    if (!role) return notFound(res);

    const collaborators = await tripAccessModel.listCollaborators(tripId);
    res.status(200).json({ collaborators, your_role: role });
  } catch (error) {
    logger.error({ err: error }, 'Error listing trip collaborators');
    res.status(500).json({ message: 'Error loading the people on this trip' });
  }
};

/**
 * POST /api/auth/trips/:tripId/collaborators   { email }
 *
 * **Nothing is emailed.** The address is a lookup key against `users.email`, which is how this
 * avoids `FV-007`'s stated kill criterion rather than escalating to a mail provider — see
 * `tripAccessModel`. The consequence is a real limitation and it gets its own status code: adding
 * somebody with no EasyTrip account is a **422 with a sentence that says exactly that**, not a
 * silent success that leaves the owner believing a stranger can see their trip.
 *
 * **This is also how a role is changed**, because the insert upserts: posting the same address with
 * a different `role` promotes or demotes them. A separate PATCH would be a second way to write one
 * column, and the two would eventually disagree about who may do it.
 *
 * `role` is optional and defaults to `viewer` — the safe end of the vocabulary is what you get by
 * not choosing.
 */
const addCollaborator = async (req, res) => {
  try {
    const tripId = Number(req.params.tripId);

    // Owner-only, and proved before the email is looked up: resolving an address for somebody who
    // does not own the trip would answer "is this person registered?" for any caller.
    const trip = await tripModel.getTrip(req.user.uid, tripId);
    const role = await tripAccessModel.roleOnTrip(req.user.uid, tripId);
    if (!trip || role !== 'owner') return notFound(res);

    const result = await tripAccessModel.addCollaborator({
      tripId,
      ownerId: req.user.uid,
      email: req.body.email,
      // Defaults to the weaker role. Somebody adding a person in a hurry, or a client that has not
      // been updated for `FV-007` stage (c), grants read access rather than write — the safe end of
      // the vocabulary is the one you get by not choosing (`018_trip_editors.sql`).
      role: req.body.role || 'viewer'
    });

    if (!result.ok && result.reason === 'not_found') {
      return res.status(422).json({
        message:
          'Nobody is registered with that email address. They need an EasyTrip account before ' +
          'they can be added to a trip.'
      });
    }

    if (!result.ok && result.reason === 'is_owner') {
      return res.status(422).json({ message: 'That is you — this is already your trip.' });
    }

    if (!result.ok && result.reason === 'bad_role') {
      return res.status(400).json({ message: 'A collaborator is either a viewer or an editor.' });
    }

    // 200 rather than 201 even on the first add, because the endpoint is idempotent: adding the
    // same person twice is the same fact stated twice, and a double-click should not read as a
    // failure. `ON CONFLICT DO UPDATE` makes both calls return the same row.
    res.status(200).json({ collaborator: result.collaborator });
  } catch (error) {
    logger.error({ err: error }, 'Error adding a trip collaborator');
    res.status(500).json({ message: 'Error adding that person to this trip' });
  }
};

/**
 * DELETE /api/auth/trips/:tripId/collaborators/:userId
 *
 * Owner-only. A viewer removing themselves is a reasonable thing to want and is **not** built here:
 * it is a different action ("leave") with a different confirmation, and giving `DELETE` two meanings
 * depending on who calls it is how one of them gets tested and the other does not.
 */
const removeCollaborator = async (req, res) => {
  try {
    const tripId = Number(req.params.tripId);
    const role = await tripAccessModel.roleOnTrip(req.user.uid, tripId);
    if (role !== 'owner') return notFound(res);

    const removed = await tripAccessModel.removeCollaborator(tripId, req.params.userId);
    if (!removed) return res.status(404).json({ message: 'They are not on this trip' });

    res.status(204).send();
  } catch (error) {
    logger.error({ err: error }, 'Error removing a trip collaborator');
    res.status(500).json({ message: 'Error removing that person from this trip' });
  }
};

module.exports = { listCollaborators, addCollaborator, removeCollaborator };
