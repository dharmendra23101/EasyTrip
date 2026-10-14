const tripModel = require('../models/tripModel');
const userModel = require('../models/userModel');
// Items live in their own model: they are the only rows reached through two joins, and that rule
// is easier to keep true in one file (Sprint 8.26).
const tripItemModel = require('../models/tripItemModel');
const tripActivityModel = require('../models/tripActivityModel');
const feasibilityService = require('../services/feasibilityService');
const routeOrderService = require('../services/routeOrderService');
const tripForecastService = require('../services/tripForecastService');
const tripRoutingService = require('../services/tripRoutingService');
const replanService = require('../services/replanService');
const dayRouteService = require('../services/dayRouteService');
const logger = require('../utils/logger');

/**
 * The trip workspace endpoints (`IMP-109` / `FV-006`, `ADR-031`).
 *
 * **One rule, as with the wishlist and the review history:** the owner is `req.user.uid`, derived
 * from a verified token, and no handler reads a user id from the body, the query or the path. The
 * model refuses to offer a query that is not scoped, so there is no arrangement of arguments that
 * reaches another person's trip.
 *
 * **404, never 403.** A trip that belongs to somebody else answers exactly as one that does not
 * exist. A 403 would confirm the id is real, which turns sequential ids into an enumeration oracle
 * for how many trips the site has and which ones exist — the same reasoning `SECURITY_AUDIT` used
 * for the deliberate 403-vs-404 split on reviews, applied in the opposite direction because a trip,
 * unlike a review, is not public in the first place.
 */
const FOREIGN_KEY_VIOLATION = '23503';

const notFound = (res) => res.status(404).json({ message: 'Trip not found' });

/**
 * Fold the road legs into the forecast-enriched trip.
 *
 * The two enrichments run concurrently and each returns its **own copy**, so they are merged by day
 * rather than chained. Chaining would mean whichever ran second silently discarded the other's
 * fields — and the symptom would be daylight warnings vanishing whenever a routing key was
 * configured, which is a bug nobody would connect to its cause.
 */
const mergeEnrichments = (withForecast, roads) => ({
  ...withForecast,
  days: withForecast.days.map((day, index) => ({
    ...day,
    ...(roads.days?.[index]?.road_legs
      ? {
          road_legs: roads.days[index].road_legs,
          routing_source: roads.days[index].routing_source
        }
      : {})
  }))
});

/** GET /api/auth/trips */
const listTrips = async (req, res) => {
  try {
    const trips = await tripModel.listTrips(req.user.uid);
    res.status(200).json({ trips });
  } catch (error) {
    logger.error({ err: error }, 'Error listing trips');
    res.status(500).json({ message: 'Error loading your trips' });
  }
};

/** GET /api/auth/trips/:tripId — the whole workspace: trip, days, items. */
const getTrip = async (req, res) => {
  try {
    const trip = await tripModel.getTripWorkspace(req.user.uid, Number(req.params.tripId));
    if (!trip) return notFound(res);

    res.status(200).json({ trip });
  } catch (error) {
    logger.error({ err: error }, 'Error loading trip');
    res.status(500).json({ message: 'Error loading this trip' });
  }
};

/**
 * GET /api/auth/trips/:tripId/activity
 *
 * Who changed this itinerary (`BL-147`).
 *
 * **The reader is why this is not on the admin audit page.** `ADR-056` split collaborator activity
 * out of `PE-013` because the entitled reader is different: an administrator asking what their
 * moderators did to other people's accounts, versus a traveller asking what their friend did to
 * their plan. Rendering one trip's edits on an admin screen would be `IMP-021`'s identity exposure
 * in a new place.
 *
 * **Entitlement is the trip's own read rule, not ownership.** Anyone who may see the plan may see
 * how it got that way, which includes the editors who produced the entries. A second access model
 * over a table that already sits behind one is how two rules drift apart and one turns out to be
 * wrong — `tripActivityModel`'s header has the longer argument.
 *
 * A trip that is not readable is a **404**, matching every other trip read: a 403 would confirm the
 * trip exists to somebody not entitled to know that.
 */
const getTripActivity = async (req, res) => {
  try {
    const entries = await tripActivityModel.listForTrip(req.user.uid, Number(req.params.tripId), {
      limit: req.query.limit,
      before: req.query.before
    });
    if (entries === null) return notFound(res);

    res.status(200).json({ activity: entries });
  } catch (error) {
    logger.error({ err: error }, 'Error loading trip activity');
    res.status(500).json({ message: 'Error loading this activity feed' });
  }
};

/**
 * GET /api/auth/trips/:tripId/feasibility
 *
 * The deterministic answer to *"can this plan actually be completed?"* (`FV-025`).
 *
 * A **read**, not a gate on saving. The workspace lets somebody build a plan in whatever order
 * suits them, and an editor that refuses a half-finished day is an editor people stop using — the
 * item's own kill criteria warn against exactly that ("validation becomes slow enough to make
 * saving a trip feel broken"). So this reports; the caller decides what to do with the report.
 *
 * Ownership comes from the same `getTripWorkspace` every other trip read uses, so a trip that is
 * not yours is a 404 here for the same reason and by the same query.
 *
 * **The one thing here that is not pure arithmetic is the weather** (`FV-031` daylight, `FV-027`
 * rain). Both rules need a fact about a coordinate on a date rather than anything the plan
 * contains — so `tripForecastService` fetches it and hands the engine plain data, and the engine
 * stays a function of its argument. A day with no reading (no outdoor item, no coordinates, or a
 * date past the provider's seven-day horizon) simply arrives without one, and produces no
 * weather-derived finding rather than an assumed one.
 */
const getTripFeasibility = async (req, res) => {
  try {
    const trip = await tripModel.getTripWorkspace(req.user.uid, Number(req.params.tripId));
    if (!trip) return notFound(res);

    // Three independent reads, run together rather than in sequence: none of them looks at another's
    // output. The forecast and the road distances come from different providers; the access needs
    // come from the caller's own profile and are the one input that is about the traveller rather
    // than the plan (`FV-029` stage d).
    const [withForecast, roads, accessNeeds] = await Promise.all([
      tripForecastService.attachForecast(trip),
      tripRoutingService.attachRoadLegs(trip),
      userModel.getAccessNeeds(req.user.uid)
    ]);
    res.status(200).json({
      feasibility: feasibilityService.checkTrip(
        mergeEnrichments(withForecast, roads),
        // Passed as data rather than looked up inside the engine, which `ADR-041` requires: the
        // check has to be replayable, and a validator that consults the world cannot be.
        accessNeeds
      )
    });
  } catch (error) {
    logger.error({ err: error }, 'Error checking trip feasibility');
    res.status(500).json({ message: 'Error checking this trip' });
  }
};

/**
 * GET /api/auth/trips/:tripId/replan-suggestion
 *
 * What to change when the weather disagrees with the plan (`FV-027` stage b).
 *
 * **A proposal, never a write** — the same rule `getDayRouteSuggestion` follows and for the same
 * reason: the item's kill criteria say to stop if the replan cannot be shown as a reviewable diff,
 * because silently rewriting somebody's trip is worse than not having the feature. Applying a
 * proposal goes through `PUT /trips/:tripId/items/:itemId`, which already exists, so **this adds no
 * new way to change a trip**.
 *
 * It reads the same enriched workspace the feasibility report does, because a proposal is only as
 * good as the evidence under it: forecast for *why*, and road legs — when a routing key is
 * configured — for whether the move it suggests is physically possible.
 */
const getTripReplanSuggestion = async (req, res) => {
  try {
    const trip = await tripModel.getTripWorkspace(req.user.uid, Number(req.params.tripId));
    if (!trip) return notFound(res);

    // A different question from the feasibility report's, so a different attach: the forecast at
    // each outdoor stop's own place across the whole horizon, because a move changes when and not
    // where. Road legs come along so `FV-025` can judge the proposed day against real driving.
    const [withContext, roads] = await Promise.all([
      tripForecastService.attachReplanContext(trip),
      tripRoutingService.attachRoadLegs(trip)
    ]);

    res
      .status(200)
      .json({ replan: replanService.suggestReplan(mergeEnrichments(withContext, roads)) });
  } catch (error) {
    logger.error({ err: error }, 'Error suggesting a replan');
    res.status(500).json({ message: 'Error checking this trip' });
  }
};

/**
 * GET /api/auth/trips/:tripId/days/:dayId/route-suggestion
 *
 * What a better order for this day would be, and by how much (`FV-026` stage a).
 *
 * **A proposal, not a write.** The item's kill criteria say to stop if *"optimisation starts
 * overriding what the user deliberately chose"*, so applying a suggestion goes through the reorder
 * endpoint that already exists — same authorisation, same validation, and the user's decision in
 * between. It also means this route adds no new way to change a trip.
 */
const getDayRouteSuggestion = async (req, res) => {
  try {
    const trip = await tripModel.getTripWorkspace(req.user.uid, Number(req.params.tripId));
    if (!trip) return notFound(res);

    const day = trip.days.find((candidate) => candidate.id === Number(req.params.dayId));
    if (!day) return notFound(res);

    res.status(200).json({ suggestion: routeOrderService.suggestDayOrder(day) });
  } catch (error) {
    logger.error({ err: error }, 'Error suggesting a day order');
    res.status(500).json({ message: 'Error checking this day' });
  }
};

/**
 * GET /api/auth/trips/:tripId/days/:dayId/route
 *
 * One day as a line on a map (`FV-026` stage c).
 *
 * **A read, and the last one this feature needs.** Stages (a), (b) and (d) all produced numbers
 * about a day; this produces the picture, which is what the item's user problem is actually about —
 * a zig-zag is obvious as a shape and invisible as a list.
 *
 * Per day rather than per trip, matching `getDayRouteSuggestion` beside it: a route is a property
 * of one day, and drawing six of them on a page load would put six matrix calls behind a screen the
 * reader may never scroll to. The client asks for the day it is showing.
 *
 * The road lookup is the same one the feasibility report makes, in the order this day is **listed**
 * rather than the order its clock implies — see `dayRouteService`. On a day whose list and clock
 * agree, that is the identical request, so it comes back off the cache `attachRoadLegs` filled.
 */
const getDayRoute = async (req, res) => {
  try {
    const trip = await tripModel.getTripWorkspace(req.user.uid, Number(req.params.tripId));
    if (!trip) return notFound(res);

    const day = trip.days.find((candidate) => candidate.id === Number(req.params.dayId));
    if (!day) return notFound(res);

    // The service's own ordering, not a second copy of it: the measurement and the drawing have to
    // describe the same sequence, and two sorts written out twice is how they stop doing so.
    const roads = await tripRoutingService.roadLegsForItems(dayRouteService.orderedItems(day));

    res.status(200).json({ route: dayRouteService.buildDayRoute(day, roads) });
  } catch (error) {
    logger.error({ err: error }, 'Error building a day route');
    res.status(500).json({ message: 'Error drawing this day' });
  }
};

/** POST /api/auth/trips */
const createTrip = async (req, res) => {
  try {
    const trip = await tripModel.createTrip(req.user.uid, req.body);
    res.status(201).json({ trip });
  } catch (error) {
    logger.error({ err: error }, 'Error creating trip');
    res.status(500).json({ message: 'Error creating this trip' });
  }
};

/** PUT /api/auth/trips/:tripId */
const updateTrip = async (req, res) => {
  try {
    const trip = await tripModel.updateTrip(req.user.uid, Number(req.params.tripId), req.body);
    if (!trip) return notFound(res);

    res.status(200).json({ trip });
  } catch (error) {
    logger.error({ err: error }, 'Error updating trip');
    res.status(500).json({ message: 'Error updating this trip' });
  }
};

/** DELETE /api/auth/trips/:tripId */
const deleteTrip = async (req, res) => {
  try {
    const removed = await tripModel.deleteTrip(req.user.uid, Number(req.params.tripId));
    if (!removed) return notFound(res);

    res.status(204).end();
  } catch (error) {
    logger.error({ err: error }, 'Error deleting trip');
    res.status(500).json({ message: 'Error deleting this trip' });
  }
};

/** POST /api/auth/trips/:tripId/days */
const addDay = async (req, res) => {
  try {
    const day = await tripModel.addDay(req.user.uid, Number(req.params.tripId));
    if (!day) return notFound(res);

    res.status(201).json({ day });
  } catch (error) {
    logger.error({ err: error }, 'Error adding day');
    res.status(500).json({ message: 'Error adding a day' });
  }
};

/** DELETE /api/auth/trips/:tripId/days/:dayId */
const deleteDay = async (req, res) => {
  try {
    const removed = await tripModel.deleteDay(
      req.user.uid,
      Number(req.params.tripId),
      Number(req.params.dayId)
    );
    if (!removed) return notFound(res);

    res.status(204).end();
  } catch (error) {
    logger.error({ err: error }, 'Error deleting day');
    res.status(500).json({ message: 'Error deleting this day' });
  }
};

/** POST /api/auth/trips/:tripId/days/:dayId/items */
const addItem = async (req, res) => {
  try {
    const item = await tripItemModel.addItem(
      req.user.uid,
      Number(req.params.tripId),
      Number(req.params.dayId),
      req.body
    );
    if (!item) return notFound(res);

    res.status(201).json({ item });
  } catch (error) {
    if (error.code === FOREIGN_KEY_VIOLATION) {
      // The place id names nothing. The foreign key rejected it, so no orphan row exists.
      return res.status(404).json({ message: 'Place not found' });
    }

    logger.error({ err: error }, 'Error adding trip item');
    res.status(500).json({ message: 'Error adding this item' });
  }
};

/** PUT /api/auth/trips/:tripId/items/:itemId */
const updateItem = async (req, res) => {
  try {
    const item = await tripItemModel.updateItem(
      req.user.uid,
      Number(req.params.tripId),
      Number(req.params.itemId),
      req.body
    );
    if (!item) return res.status(404).json({ message: 'Item not found' });

    res.status(200).json({ item });
  } catch (error) {
    logger.error({ err: error }, 'Error updating trip item');
    res.status(500).json({ message: 'Error updating this item' });
  }
};

/** DELETE /api/auth/trips/:tripId/items/:itemId */
const deleteItem = async (req, res) => {
  try {
    const removed = await tripItemModel.deleteItem(
      req.user.uid,
      Number(req.params.tripId),
      Number(req.params.itemId)
    );
    if (!removed) return res.status(404).json({ message: 'Item not found' });

    res.status(204).end();
  } catch (error) {
    logger.error({ err: error }, 'Error deleting trip item');
    res.status(500).json({ message: 'Error deleting this item' });
  }
};

/**
 * PUT /api/auth/trips/:tripId/days/:dayId/items/order — the drag-and-drop write.
 *
 * Takes the full ordered id list. A rejected reorder is a 400 rather than a 404, because the caller
 * *did* find the day — it sent a list that does not describe it, which is a different mistake and a
 * different fix.
 */
const reorderItems = async (req, res) => {
  try {
    const ok = await tripItemModel.reorderItems(
      req.user.uid,
      Number(req.params.tripId),
      Number(req.params.dayId),
      req.body.item_ids
    );

    if (!ok) {
      return res.status(400).json({
        message: 'The order must list exactly the items in this day, once each'
      });
    }

    res.status(200).json({ reordered: true });
  } catch (error) {
    logger.error({ err: error }, 'Error reordering trip items');
    res.status(500).json({ message: 'Error reordering these items' });
  }
};

module.exports = {
  getTripActivity,
  listTrips,
  getTrip,
  getTripFeasibility,
  getTripReplanSuggestion,
  getDayRouteSuggestion,
  getDayRoute,
  createTrip,
  updateTrip,
  deleteTrip,
  addDay,
  deleteDay,
  addItem,
  updateItem,
  deleteItem,
  reorderItems
};
