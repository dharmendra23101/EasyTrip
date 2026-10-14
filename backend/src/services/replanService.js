const { checkTrip } = require('./feasibilityService');

/**
 * `FV-027` stage (b) — the replan, as a reviewable diff.
 *
 * ---------------------------------------------------------------------------
 * What this is, in one sentence
 * ---------------------------------------------------------------------------
 * Stage (a) says *"day 2 is wet and three of its stops are outdoors."* This says *"move these two to
 * day 4, which is clear; the third cannot move because it is scheduled at 17:00."*
 *
 * **It computes a proposal and never applies one.** The item's own kill criteria say to stop if the
 * replan cannot be presented as a reviewable diff, because *"silently rewriting somebody's trip is
 * worse than having no feature at all"*. So this is a pure function reached by a `GET`, and applying
 * a proposal goes through `PUT /trips/:id/items/:itemId`, with the authorisation and validation that
 * endpoint already has. **This adds no new way to change a trip**, which is the same discipline
 * `routeOrderService` follows for reordering.
 *
 * > **Correction, Sprint 8.26.** When stage (b) shipped, this paragraph said applying went through
 * > "the endpoint that already exists" — and that endpoint **could not move an item between days**.
 * > `trip_day_id` was neither a validated field nor an updatable column, so every proposal here was
 * > unappliable and the claim was false. The gap was real and older than this feature: the workspace
 * > had no way to move an item between days at all. `updateItem` now accepts `trip_day_id`,
 * > constrained to a day of the same trip, and appends at the destination — the same placement this
 * > file *simulates* when it validates a move.
 *
 * ---------------------------------------------------------------------------
 * Why no model, and why that is not a compromise
 * ---------------------------------------------------------------------------
 * `AI_ROADMAP.md`'s pipeline is *trigger → affected window → candidates → **model call** → validate
 * with `FV-025` → diff → apply*. Six of seven steps are arithmetic. The model is needed only to
 * **compose** an item nobody put in the plan; **rearranging stops the traveller already chose is not
 * composition**, and it is the case that actually happens.
 *
 * ---------------------------------------------------------------------------
 * `FV-025` is the acceptance test — and today it never rejects anything
 * ---------------------------------------------------------------------------
 * Every candidate move is applied **to a copy**, the copy is run through `checkTrip`, and the move is
 * offered only if it introduces no new error.
 *
 * ⚠️ **That filter is currently unreachable, and saying so is more useful than pretending
 * otherwise.** Every item-level error the engine can raise — `items_overlap`,
 * `order_disagrees_with_times`, `insufficient_travel_time` — requires a `start_time`, and this only
 * ever moves items that have none. An untimed stop has no clock to conflict with, so **moving one
 * cannot raise the error count**. `move_would_break_another_day` therefore exists and does not fire.
 *
 * It is kept rather than deleted for two stated reasons, not out of caution:
 *
 * 1. It is the step `AI_ROADMAP.md`'s pipeline specifies (*"`FV-025` validates the revised plan"*),
 *    and removing it means re-deriving it the moment either precondition changes.
 * 2. **Both preconditions are things the roadmap intends to change.** The day a timed item becomes
 *    movable, or the day a rule appears that an untimed stop can violate — `FV-032`'s closures are
 *    the obvious candidate, since a closed day does not care what time you arrive — this filter
 *    becomes load-bearing with no new code.
 *
 * There is deliberately **no test claiming it fires**, because none can be written honestly. The
 * test that exists asserts the true property instead: an already-broken destination day does *not*
 * block a move, because an untimed stop cannot make it worse. That is what stops the obvious failure: moving a stop
 * out of the rain and into a day it cannot physically be reached on. It is also where real road
 * distance enters — `checkTravelTime` consumes `road_legs` when `tripRoutingService` attached them,
 * so a proposal validated with a key is validated against measured driving, and without one against
 * the labelled estimate. **Same code path, better evidence.**
 *
 * ---------------------------------------------------------------------------
 * The three refusals
 * ---------------------------------------------------------------------------
 * **1. A timed item is never moved.** `trip_items` has no `completed` or `pinned` column, and this
 * deliberately does not add one — a start time is the strongest signal the schema actually carries
 * that a human chose this hour on this day. `routeOrderService` already declines a day whose items
 * have times, for the same reason: two features fighting over one plan is worse than one declining.
 * **The decline is reported, not hidden** — a traveller who cannot see why their wet day was left
 * alone will assume the feature is broken.
 *
 * **2. A day with no reading is never a destination.** Beyond the provider's seven-day horizon there
 * is no forecast, and *absence of rain in the data is not evidence of a dry day*. Moving a stop onto
 * one would be a guess wearing a recommendation's authority.
 *
 * **3. Nothing is proposed without evidence attached.** Every proposal carries the condition it is
 * moving away from and the condition it is moving toward, plus the source that supplied both.
 */

/**
 * The forecast for one stop on one day, at that stop's own coordinates.
 *
 * This is the whole reason `attachReplanContext` exists rather than reusing the day-level reading:
 * a move changes *when*, never *where*, so the question is always "at this place, on that date".
 */
const forecastFor = (trip, item, dayNumber) =>
  trip.item_forecasts?.[item.id]?.[trip.day_dates?.[dayNumber]] ?? null;

const outdoorItems = (day) => (day?.items || []).filter((item) => item.place_setting === 'outdoor');

/**
 * The trip as it would be if `item` moved from one day to another.
 *
 * Structural, not mutating: the result goes to `checkTrip`, which must see a trip shaped exactly
 * like a real one or its verdict means nothing.
 */
const tripWithMove = (trip, item, fromDayNumber, toDayNumber) => ({
  ...trip,
  days: trip.days.map((day) => {
    if (day.day_number === fromDayNumber) {
      return { ...day, items: day.items.filter((candidate) => candidate.id !== item.id) };
    }
    if (day.day_number === toDayNumber) {
      // Appended at the end of the destination day, the only position that cannot displace
      // something the user placed deliberately.
      const position = Math.max(-1, ...day.items.map((existing) => existing.position)) + 1;
      return { ...day, items: [...day.items, { ...item, position }] };
    }
    return day;
  })
});

const errorCount = (trip) => checkTrip(trip).counts.errors;

/**
 * Candidate destination days for one stop, nearest first.
 *
 * Nearest by day number rather than "best": a plan is a sequence somebody reasoned about, and moving
 * a stop three days is a bigger change to it than moving it one. Ties break toward the later day,
 * because moving something forward preserves what has already happened in a trip underway.
 *
 * A day qualifies only if the forecast **says** it is dry at this stop's place. No reading is not a
 * dry day — beyond the provider's horizon there is simply no answer, and moving a stop onto silence
 * would be a guess with a recommendation's authority.
 */
const destinationsFor = (trip, item, fromDayNumber) =>
  (trip.days || [])
    .filter((day) => {
      if (day.day_number === fromDayNumber) return false;
      const forecast = forecastFor(trip, item, day.day_number);
      return forecast?.is_wet === false;
    })
    .sort(
      (a, b) =>
        Math.abs(a.day_number - fromDayNumber) - Math.abs(b.day_number - fromDayNumber) ||
        b.day_number - a.day_number
    );

/**
 * Proposals for a trip, and the reason for everything not proposed.
 *
 * @param {Object} trip - a workspace enriched by `attachReplanContext` (and optionally road legs)
 * @returns {{proposals: Array, declined: Array, considered: number}}
 */
const suggestReplan = (trip) => {
  const days = trip?.days || [];
  const proposals = [];
  const declined = [];
  let considered = 0;

  // Evaluated once, up front. Every comparison below is against the plan as it stands, not as
  // previous proposals would have left it: these are independent suggestions, and compounding them
  // would offer a diff nobody could reason about.
  const baselineErrors = errorCount(trip);

  for (const day of days) {
    for (const item of outdoorItems(day)) {
      const here = forecastFor(trip, item, day.day_number);
      // Only a stop the forecast says will be rained on is a problem worth solving.
      if (!here?.is_wet) continue;

      considered += 1;

      if (item.start_time) {
        declined.push({
          item_id: item.id,
          day_number: day.day_number,
          reason: 'scheduled_at_a_fixed_time',
          message: `"${item.title}" is scheduled at ${String(item.start_time).slice(0, 5)}, so it is left where you put it.`
        });
        continue;
      }

      const destinations = destinationsFor(trip, item, day.day_number);
      if (destinations.length === 0) {
        declined.push({
          item_id: item.id,
          day_number: day.day_number,
          reason: 'no_day_known_to_be_dry',
          message: `No other day of this trip is forecast dry at "${item.title}", so there is nowhere better to move it.`
        });
        continue;
      }

      const workable = destinations.find(
        (destination) =>
          errorCount(tripWithMove(trip, item, day.day_number, destination.day_number)) <=
          baselineErrors
      );

      if (!workable) {
        declined.push({
          item_id: item.id,
          day_number: day.day_number,
          reason: 'move_would_break_another_day',
          message: `Moving "${item.title}" to any drier day of this trip makes that day impossible to complete.`
        });
        continue;
      }

      const there = forecastFor(trip, item, workable.day_number);

      proposals.push({
        item_id: item.id,
        title: item.title,
        from_day_number: day.day_number,
        to_day_number: workable.day_number,
        // The id as well as the ordinal, so the proposal is appliable on its own. A client that
        // had to map "day 3" back to a row id would be re-deriving something this function already
        // holds, and would get it wrong the first time a day was deleted between the two requests.
        to_day_id: workable.id,
        // The citation. A proposal that cannot say why is a proposal nobody should accept.
        because: {
          from_condition: here.condition,
          from_precipitation_mm: here.precipitation_mm ?? null,
          to_condition: there.condition,
          source: here.source ?? null
        },
        message: `Day ${day.day_number} is forecast ${String(here.condition).toLowerCase()} at "${item.title}" — day ${workable.day_number} is ${String(there.condition).toLowerCase()}.`
      });
    }
  }

  return { proposals, declined, considered };
};

module.exports = { suggestReplan };
