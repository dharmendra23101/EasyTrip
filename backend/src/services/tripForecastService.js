const weatherService = require('./weatherService');
const logger = require('../utils/logger');

/**
 * The data half of `FV-031` and `FV-027` — where each day's forecast reaches the feasibility engine.
 *
 * Two pure checks read what this attaches and refuse to do anything without it: `checkDaylight`
 * needs `day.sunrise`/`day.sunset` (`FV-031`), and `checkWetOutdoor` needs `day.weather`
 * (`FV-027` stage a). **This is the only thing that puts either there**, and it lives outside the
 * engine for the reason the engine's own header gives: the moment a network call is inside the
 * validator, the validator stops being something you can prove. So the impure part is here, it is
 * small, and it hands the engine plain data.
 *
 * Both readings come from the **same forecast entry**, so a day costs one lookup no matter how many
 * rules end up consulting it.
 *
 * ---------------------------------------------------------------------------
 * Four decisions, each of which could have gone the lazy way
 * ---------------------------------------------------------------------------
 *
 * **1. A day that cannot produce a finding is never looked up.** Both rules need an `outdoor` item,
 * so a day of museums and meals asks the provider nothing. That is not only politeness toward
 * somebody else's free tier — it means the common case (a catalogue that is almost entirely
 * `unknown`, because nobody has classified it yet) costs zero requests.
 *
 * Note what the gate does **not** require: a start time. Daylight needs one, rain does not — being
 * outdoors in the rain at no particular hour is still being outdoors in the rain. Narrowing the gate
 * to timed items would have made `checkWetOutdoor` silently inapplicable to every untimed plan,
 * which is most half-built ones.
 *
 * **2. One coordinate per day: the day's first item that has any.** Sunrise moves about four
 * minutes per degree of longitude, so within a day's realistic travel the error is a few minutes on
 * a warning — recorded in `KNOWN_LIMITATIONS.md` rather than hidden. Deliberately *not* "the first
 * outdoor item": tying the choice to `setting` would mean re-classifying one place could silently
 * change which forecast a different day was judged against, and a finding you cannot reproduce from
 * the plan is a finding nobody can argue with.
 *
 * **3. Seven days is the horizon, and beyond it there is no reading.** Open-Meteo returns seven
 * days from today; a trip in three weeks matches no forecast entry, gets no sunrise, and therefore
 * gets no daylight finding at all. That silence is correct and it is also invisible, which is why
 * it is written down in three places rather than one. Extending it needs a different endpoint —
 * a provider decision (`EXTERNAL_APIS.md` §5), not a code one.
 *
 * **4. Nothing here may break the report.** Feasibility is useful with no weather at all: every
 * other check is arithmetic on the plan. So a provider outage, a timeout, or an outright throw
 * degrades to "no readings" and the caller still gets its overlaps, its travel times and its
 * backtracking. `getWeather` already promises never to throw; the guard is here because a promise
 * in a docstring is not a mechanism.
 */

const MS_PER_DAY = 86_400_000;

/**
 * `('2026-03-01', 2)` -> `'2026-03-03'`. `null` for anything that is not a calendar date.
 *
 * **Strict about the input on purpose.** `trips.start_date` is read as `YYYY-MM-DD` text by
 * `tripModel` precisely so no timezone gets to have an opinion about it (`BUG-050`); accepting a
 * `Date` here too would quietly paper over a regression in that query, and daylight would keep
 * working while every other consumer of the date went back to being a day out.
 */
const addDays = (isoDate, days) => {
  if (typeof isoDate !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(isoDate)) return null;
  const base = Date.parse(`${isoDate.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(base)) return null;
  return new Date(base + days * MS_PER_DAY).toISOString().slice(0, 10);
};

/** Whether any item on this day could possibly produce a weather finding. */
const hasOutdoorItem = (day) => (day?.items || []).some((item) => item.place_setting === 'outdoor');

/**
 * The day's first item with coordinates, in the order the plan puts them.
 *
 * The workspace query already returns items ordered by position then id; sorting again here means
 * this does not depend on that, because "which coordinate did we ask about" is exactly the kind of
 * thing that must not change because a different query grew a different `ORDER BY`.
 */
const dayCoordinates = (day) => {
  const item = [...(day?.items || [])]
    .sort((a, b) => a.position - b.position || a.id - b.id)
    .find((candidate) => candidate.place_latitude != null && candidate.place_longitude != null);

  return item ? { latitude: item.place_latitude, longitude: item.place_longitude } : null;
};

/**
 * A copy of the trip whose days carry the sunrise and sunset that apply to them.
 *
 * Never mutates the trip it is given: the workspace object is what every other read returns, and a
 * function that quietly decorates its argument is how a field ends up in a response nobody meant to
 * change.
 *
 * @param {Object} trip - a `tripModel.getTripWorkspace` result
 * @returns {Promise<Object>} the same trip, with `sunrise`/`sunset`/`weather`/`forecast_source` on
 *   any day that has a reading. A day with no reading is returned exactly as it arrived.
 */
const attachForecast = async (trip) => {
  const days = trip?.days || [];
  if (!trip?.start_date || days.length === 0) return trip;

  const lookups = days.map(async (day) => {
    if (!hasOutdoorItem(day)) return day;

    const date = addDays(trip.start_date, day.day_number - 1);
    const at = dayCoordinates(day);
    if (!date || !at) return day;

    // Concurrent across days, and cheap: `weatherService` caches on coordinates rounded to ~1 km,
    // so a week in one region is one upstream request rather than seven. Open-Meteo's free tier
    // allows 600 calls/minute (`EXTERNAL_APIS.md` §3), which no single trip can approach.
    const weather = await weatherService.getWeather(at.latitude, at.longitude);
    const entry = weather?.forecast?.find((forecast) => forecast.date === date);
    if (!entry) return day;

    return {
      ...day,
      // Each field is attached only if the provider actually supplied it. A day can legitimately
      // arrive with weather and no sun times, or the reverse, and each rule then runs or does not
      // on its own evidence rather than on the other's.
      ...(entry.sunrise && entry.sunset ? { sunrise: entry.sunrise, sunset: entry.sunset } : {}),
      ...(typeof entry.is_wet === 'boolean'
        ? {
            weather: {
              is_wet: entry.is_wet,
              condition: entry.condition,
              precipitation_mm: entry.precipitation_mm
            }
          }
        : {}),
      // Carried through to the finding so a warning can attribute the data it rests on.
      // Open-Meteo is CC-BY 4.0, and attribution follows the data rather than the page it first
      // appeared on (`EXTERNAL_APIS.md` §3, and `IMP-127` for what skipping it costs).
      forecast_source: weather.source
    };
  });

  try {
    return { ...trip, days: await Promise.all(lookups) };
  } catch (error) {
    // Decision 4. The report is worth more than the enrichment, so this is a warn and a plain trip
    // rather than a 500 on a check that needs no weather to be useful.
    logger.warn({ name: error.name }, 'Forecast lookup failed; reporting without it');
    return trip;
  }
};

// Only `attachForecast` is exported. The three helpers are deliberately private: they are proved
// through the endpoint, where an off-by-one in the date or the wrong coordinate is observable as a
// wrong finding, and exporting them would invite a unit test that agrees with them in isolation
// while the wiring stays broken — which is exactly the state Sprint 8.18 found `FV-031` in.
/**
 * The forecast a **replan** needs, which is a different question from the one a report needs
 * (`FV-027` stage b).
 *
 * `attachForecast` above answers *"what is the weather on this day?"*, using the day's first stop as
 * its location. That is right for a report, and wrong for a move — twice over:
 *
 * 1. **An empty day has no coordinates**, so it can never have a reading. "Move it to the free day
 *    on Thursday" is the single most obvious thing a replanner should suggest, and a day-shaped
 *    model can never evaluate it.
 * 2. **A move does not change where the stop is, only when.** The question is not *"is Thursday
 *    dry?"* but *"will it be raining at Matanga Hill on Thursday?"* — same place, different date.
 *
 * So this looks up the forecast **per outdoor stop**, at that stop's own coordinates, and keeps the
 * whole horizon rather than one date. One lookup answers every candidate date at once, and
 * `weatherService` caches on coordinates rounded to ~1 km, so stops in the same town share it.
 *
 * @returns {Promise<Object>} the trip, plus `day_dates` (`day_number` -> `YYYY-MM-DD`) and
 *   `item_forecasts` (`item_id` -> `date` -> `{ is_wet, condition, precipitation_mm }`).
 */
const attachReplanContext = async (trip) => {
  const days = trip?.days || [];
  if (!trip?.start_date || days.length === 0) return trip;

  const day_dates = {};
  for (const day of days) {
    const date = addDays(trip.start_date, day.day_number - 1);
    if (date) day_dates[day.day_number] = date;
  }

  const outdoor = days.flatMap((day) =>
    (day.items || []).filter(
      (item) =>
        item.place_setting === 'outdoor' &&
        item.place_latitude != null &&
        item.place_longitude != null
    )
  );

  const item_forecasts = {};
  try {
    await Promise.all(
      outdoor.map(async (item) => {
        const weather = await weatherService.getWeather(item.place_latitude, item.place_longitude);
        if (!weather?.forecast) return;

        const byDate = {};
        for (const entry of weather.forecast) {
          if (typeof entry.is_wet !== 'boolean') continue;
          byDate[entry.date] = {
            is_wet: entry.is_wet,
            condition: entry.condition,
            precipitation_mm: entry.precipitation_mm ?? null,
            source: weather.source
          };
        }
        item_forecasts[item.id] = byDate;
      })
    );
  } catch (error) {
    logger.warn({ name: error.name }, 'Replan forecast lookup failed; proposing nothing');
    return { ...trip, day_dates, item_forecasts: {} };
  }

  return { ...trip, day_dates, item_forecasts };
};

module.exports = { attachForecast, attachReplanContext };
