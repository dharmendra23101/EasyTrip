const tripWorkspaceModel = require('../models/tripWorkspaceModel');
const tripModel = require('../models/tripModel');
const { buildTripCalendar, calendarFilename } = require('../services/icsService');
const tripDuplicateModel = require('../models/tripDuplicateModel');
const logger = require('../utils/logger');

/**
 * A trip's notes and checklist (`FV-006` stage b).
 *
 * ---------------------------------------------------------------------------
 * 404, never 403 — the same rule `tripController` states and for the same reason
 * ---------------------------------------------------------------------------
 * A note on somebody else's trip answers exactly as one that does not exist. A 403 would confirm the
 * id is real, turning sequential ids into an enumeration oracle for how many trips the site has. The
 * model returns `null`/`false` for both cases precisely so this file cannot tell them apart even by
 * accident — there is no branch here that *could* leak the difference, rather than a branch that
 * chooses not to.
 *
 * Its own file rather than more of `tripController`, which is at 393 of the 500 lines
 * `check-module-size` allows: the same answer `tripItemModel`, `placeAlternativesController` and
 * `placeFitController` each gave, taken before the guard forces it in a hurry.
 */

const NOT_FOUND = 'Trip not found';

const notFound = (res) => res.status(404).json({ message: NOT_FOUND });

/**
 * One error path for every handler here.
 *
 * The message says what failed and nothing about why; the stack goes to the log. An error string
 * echoed to the client is how a constraint name or a column list ends up in a browser.
 */
const failed = (res, error, what) => {
  logger.error({ err: error }, `Error ${what}`);
  return res.status(500).json({ message: `Error ${what}` });
};

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

/** GET /api/auth/trips/:tripId/notes */
const listNotes = async (req, res) => {
  try {
    // The trip is checked first so an unknown trip is a 404 rather than an empty list. "This trip
    // has no notes" and "there is no such trip" are different answers and only one is true.
    if (!(await tripWorkspaceModel.ownsTrip(req.user.uid, req.params.tripId))) return notFound(res);

    const notes = await tripWorkspaceModel.listNotes(req.user.uid, req.params.tripId);
    return res.status(200).json({ notes });
  } catch (error) {
    return failed(res, error, 'loading the notes for this trip');
  }
};

/** POST /api/auth/trips/:tripId/notes */
const createNote = async (req, res) => {
  try {
    const note = await tripWorkspaceModel.createNote(
      req.user.uid,
      req.params.tripId,
      req.body.body
    );
    if (!note) return notFound(res);

    return res.status(201).json({ note });
  } catch (error) {
    return failed(res, error, 'saving this note');
  }
};

/** PUT /api/auth/trips/:tripId/notes/:noteId */
const updateNote = async (req, res) => {
  try {
    const note = await tripWorkspaceModel.updateNote(
      req.user.uid,
      req.params.tripId,
      req.params.noteId,
      req.body.body
    );
    if (!note) return res.status(404).json({ message: 'Note not found' });

    return res.status(200).json({ note });
  } catch (error) {
    return failed(res, error, 'updating this note');
  }
};

/** DELETE /api/auth/trips/:tripId/notes/:noteId */
const deleteNote = async (req, res) => {
  try {
    const deleted = await tripWorkspaceModel.deleteNote(
      req.user.uid,
      req.params.tripId,
      req.params.noteId
    );
    if (!deleted) return res.status(404).json({ message: 'Note not found' });

    return res.status(204).send();
  } catch (error) {
    return failed(res, error, 'deleting this note');
  }
};

// ---------------------------------------------------------------------------
// Checklist
// ---------------------------------------------------------------------------

/** GET /api/auth/trips/:tripId/checklist */
const listChecklist = async (req, res) => {
  try {
    if (!(await tripWorkspaceModel.ownsTrip(req.user.uid, req.params.tripId))) return notFound(res);

    const items = await tripWorkspaceModel.listChecklist(req.user.uid, req.params.tripId);
    return res.status(200).json({ items });
  } catch (error) {
    return failed(res, error, 'loading the checklist for this trip');
  }
};

/** POST /api/auth/trips/:tripId/checklist */
const createChecklistItem = async (req, res) => {
  try {
    const item = await tripWorkspaceModel.createChecklistItem(
      req.user.uid,
      req.params.tripId,
      req.body.label
    );
    if (!item) return notFound(res);

    return res.status(201).json({ item });
  } catch (error) {
    return failed(res, error, 'adding this checklist item');
  }
};

/** PATCH /api/auth/trips/:tripId/checklist/:itemId */
const updateChecklistItem = async (req, res) => {
  try {
    const item = await tripWorkspaceModel.updateChecklistItem(
      req.user.uid,
      req.params.tripId,
      req.params.itemId,
      // `undefined` rather than a default, so "not sent" reaches the model as "not sent". Ticking a
      // box must not blank the label beside it.
      { label: req.body.label, isDone: req.body.is_done }
    );
    if (!item) return res.status(404).json({ message: 'Checklist item not found' });

    return res.status(200).json({ item });
  } catch (error) {
    return failed(res, error, 'updating this checklist item');
  }
};

/** DELETE /api/auth/trips/:tripId/checklist/:itemId */
const deleteChecklistItem = async (req, res) => {
  try {
    const deleted = await tripWorkspaceModel.deleteChecklistItem(
      req.user.uid,
      req.params.tripId,
      req.params.itemId
    );
    if (!deleted) return res.status(404).json({ message: 'Checklist item not found' });

    return res.status(204).send();
  } catch (error) {
    return failed(res, error, 'deleting this checklist item');
  }
};

/** PUT /api/auth/trips/:tripId/checklist/order */
const reorderChecklist = async (req, res) => {
  try {
    const items = await tripWorkspaceModel.reorderChecklist(
      req.user.uid,
      req.params.tripId,
      req.body.item_ids
    );
    // `null` covers both "not your trip" and "an id in that list is not in this trip". The second is
    // a 400-shaped mistake, but distinguishing them here would answer whether an id exists, which is
    // the question the 404-never-403 rule exists to refuse.
    if (!items) return notFound(res);

    return res.status(200).json({ items });
  } catch (error) {
    return failed(res, error, 'reordering this checklist');
  }
};

// ---------------------------------------------------------------------------
// Calendar export (`FV-009` stage a)
// ---------------------------------------------------------------------------

/** GET /api/auth/trips/:tripId/calendar.ics */
const exportCalendar = async (req, res) => {
  try {
    const trip = await tripModel.getTripWorkspace(req.user.uid, req.params.tripId);
    if (!trip) return notFound(res);

    const calendar = buildTripCalendar(trip);
    // A trip with no start date has no position on any calendar. **422, not 404 and not an empty
    // file**: the trip exists and the request was well formed, but the thing being asked for cannot
    // be made from it. An empty `.ics` would download and open as a working export of nothing.
    if (!calendar) {
      return res.status(422).json({
        message: 'This trip has no start date, so its days are not on any calendar yet'
      });
    }

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    // The filename is slugified in the service, which is what keeps a quote or a newline in a
    // user-supplied trip title out of this header.
    res.setHeader('Content-Disposition', `attachment; filename="${calendarFilename(trip.title)}"`);
    return res.status(200).send(calendar);
  } catch (error) {
    return failed(res, error, 'exporting this trip');
  }
};

// ---------------------------------------------------------------------------
// Duplication (`FV-006` stage d)
// ---------------------------------------------------------------------------

/** POST /api/auth/trips/:tripId/duplicate */
const duplicateTrip = async (req, res) => {
  try {
    const trip = await tripDuplicateModel.duplicateTrip(req.user.uid, req.params.tripId, {
      title: req.body?.title
    });
    if (!trip) return notFound(res);

    // 201 with the new trip, so the client can navigate straight to it rather than guessing its id
    // from a list it would have to re-fetch.
    return res.status(201).json({ trip });
  } catch (error) {
    return failed(res, error, 'duplicating this trip');
  }
};

module.exports = {
  duplicateTrip,
  exportCalendar,
  listNotes,
  createNote,
  updateNote,
  deleteNote,
  listChecklist,
  createChecklistItem,
  updateChecklistItem,
  deleteChecklistItem,
  reorderChecklist
};
