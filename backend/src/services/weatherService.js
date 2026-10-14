const logger = require('../utils/logger');

/**
 * Real weather, from Open-Meteo (`IMP-110`).
 *
 * **This replaces a fabrication.** The detail page used to render a hardcoded 24 °C "Partly cloudy"
 * with an icon path that did not exist, presented as real. `IMP-027` deleted it rather than leave
 * invented data on the page, and `PROJECT_CONSTITUTION.md` Article III leaves no room to bring it
 * back in any form. So: real forecast or nothing, and the "nothing" case says so out loud.
 *
 * **Why Open-Meteo.** No API key, no account, and a licence that permits non-commercial use — which
 * means nothing has to be added to `.env`, nothing can leak, and the boot-time environment gate
 * (`IMP-100`) does not grow a variable that a contributor must obtain before the app runs.
 *
 * **Why it is server-side.** The browser could call this directly and skip a hop. It does not,
 * because then the cache would be per-tab (so ten visitors to one place are ten upstream requests),
 * the timeout and failure shape would be the client's problem, and there would be no single place
 * to enforce a rate limit if the provider ever asked for one. The same reasoning `AI_ROADMAP.md`
 * §0.1 applies to model calls, minus the credential.
 */

const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast';

/**
 * How long a forecast is considered fresh.
 *
 * Fifteen minutes. Open-Meteo's own model updates hourly, so a shorter TTL buys nothing but load,
 * and a longer one starts showing yesterday's afternoon to this morning's visitor.
 */
const CACHE_TTL_MS = 15 * 60 * 1000;

/**
 * A timeout the user can wait through, not one the server can hang on.
 *
 * Six seconds. The place page renders without weather (see the controller), so the cost of giving
 * up is a missing panel; the cost of not giving up is a request that holds a connection until the
 * platform kills it.
 */
const REQUEST_TIMEOUT_MS = 6000;

/** Bounded so a long-running process cannot accumulate one entry per place forever. */
const MAX_CACHE_ENTRIES = 500;

const cache = new Map();

/**
 * Coordinates are rounded to ~1 km before they become a cache key.
 *
 * Two places in the same town share a forecast, and full `DECIMAL(10,8)` precision would give every
 * one of them its own upstream request for an identical answer. It also keeps the key from being a
 * precise location — this is a cache key, not a tracking identifier.
 */
const cacheKey = (latitude, longitude) =>
  `${Number(latitude).toFixed(2)},${Number(longitude).toFixed(2)}`;

/**
 * Open-Meteo's WMO weather code, as something a person can read.
 *
 * Mapped here rather than in the frontend because it is *data interpretation*, not presentation —
 * and because a UI-side map would have to be duplicated the first time anything else (a trip
 * summary, a packing suggestion) needed the same words.
 */
const WMO_CONDITIONS = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Freezing fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Heavy drizzle',
  56: 'Freezing drizzle',
  57: 'Heavy freezing drizzle',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  66: 'Freezing rain',
  67: 'Heavy freezing rain',
  71: 'Light snow',
  73: 'Snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Light showers',
  81: 'Showers',
  82: 'Violent showers',
  85: 'Snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with hail',
  99: 'Thunderstorm with heavy hail'
};

/**
 * An unmapped code is reported as unknown rather than guessed at.
 *
 * WMO can add codes; inventing a description for one we do not recognise would be a small
 * fabrication of exactly the kind this whole module exists to remove.
 */
const describe = (code) => WMO_CONDITIONS[code] || 'Unknown conditions';

/** Whether a condition means "do not plan this outdoors" — the input `FV-027` replanning needs. */
const isWet = (code) => code >= 51 && code <= 99;

const evict = () => {
  if (cache.size <= MAX_CACHE_ENTRIES) return;
  // Oldest insertion first; Map preserves insertion order, so the first key is the coldest.
  const oldest = cache.keys().next().value;
  cache.delete(oldest);
};

/** Shape the upstream payload into what EasyTrip renders. Never passes the raw response through. */
const normalise = (payload) => {
  const current = payload?.current;
  const daily = payload?.daily;
  if (!current || typeof current.temperature_2m !== 'number') return null;

  return {
    current: {
      temperature_c: Math.round(current.temperature_2m),
      feels_like_c:
        typeof current.apparent_temperature === 'number'
          ? Math.round(current.apparent_temperature)
          : null,
      humidity_pct: current.relative_humidity_2m ?? null,
      wind_kph:
        typeof current.wind_speed_10m === 'number' ? Math.round(current.wind_speed_10m) : null,
      precipitation_mm: current.precipitation ?? null,
      code: current.weather_code,
      condition: describe(current.weather_code),
      is_wet: isWet(current.weather_code),
      // The provider's own observation time, in the *place's* timezone — not the server's clock.
      observed_at: current.time || null
    },
    // Seven days is Open-Meteo's reliable horizon; asking for more would ship numbers that get
    // worse the further out they go without saying so.
    forecast: (daily?.time || []).map((date, index) => ({
      date,
      min_c: Math.round(daily.temperature_2m_min?.[index]),
      max_c: Math.round(daily.temperature_2m_max?.[index]),
      precipitation_mm: daily.precipitation_sum?.[index] ?? null,
      code: daily.weather_code?.[index],
      condition: describe(daily.weather_code?.[index]),
      is_wet: isWet(daily.weather_code?.[index]),
      // Local-time ISO strings, e.g. `2026-12-14T06:42`. Passed through rather than parsed: the
      // feasibility engine is a pure function with no clock and no zone database, so it compares
      // the wall-clock minutes in the string against an item's `TIME` and nothing else.
      sunrise: daily.sunrise?.[index] ?? null,
      sunset: daily.sunset?.[index] ?? null
    })),
    timezone: payload.timezone || null,
    source: 'Open-Meteo'
  };
};

/**
 * The forecast for a coordinate, cached.
 *
 * Returns `null` on any failure — a timeout, a non-200, a shape we do not recognise. **Never
 * throws, and never returns a partial or invented reading**: the caller's job is to render the
 * absence honestly, and giving it something to render would defeat that.
 */
const getWeather = async (latitude, longitude) => {
  const lat = Number(latitude);
  const lon = Number(longitude);

  // `places.latitude` is `DECIMAL`, which node-pg hands over as a **string**. Coercing and
  // range-checking here rather than trusting the caller is the same class of bug `BL-007` fixed in
  // the map, where a string coordinate silently failed a `typeof === 'number'` test.
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

  const key = cacheKey(lat, lon);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return { ...hit.value, cached: true };
  }

  const url =
    `${OPEN_METEO}?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    '&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m' +
    // `sunrise,sunset` are here for `FV-031`: the daylight rule needs the day's own boundaries
    // at the *place's* coordinates, and the provider returns them in the same `timezone=auto`
    // frame as everything else. `FUTURE_VISION` recorded that Open-Meteo "already returns"
    // them, which was half true — it can, and this query never asked.
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,sunrise,sunset' +
    // `timezone=auto` makes the provider return times in the *place's* zone. A traveller reading
    // "rain at 15:00" means three in the afternoon where they are standing — the same reasoning
    // that makes `trip_items.start_time` a `TIME` rather than a timestamp (`ADR-031`).
    '&timezone=auto&forecast_days=7';

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { Accept: 'application/json' }
    });

    if (!response.ok) {
      logger.warn({ status: response.status }, 'Weather provider returned a non-200');
      return null;
    }

    const normalised = normalise(await response.json());
    if (!normalised) {
      logger.warn('Weather provider returned an unrecognised shape');
      return null;
    }

    cache.set(key, { at: Date.now(), value: normalised });
    evict();

    return { ...normalised, cached: false };
  } catch (error) {
    // A provider outage is not an EasyTrip error. Logged at warn, not error: nothing here is
    // broken, and paging on somebody else's downtime is how alerts get ignored.
    logger.warn({ name: error.name }, 'Weather lookup failed');
    return null;
  }
};

/** Test seam. Production never calls this; the cache is process-local and dies with the process. */
const clearCache = () => cache.clear();

module.exports = { getWeather, clearCache, describe, isWet, CACHE_TTL_MS };
