const logger = require('../utils/logger');

/**
 * Forward geocoding via Nominatim / OpenStreetMap (`IMP-116`, `ADR-035`).
 *
 * **This replaces an admitted mock.** `usePlaceForm.handleLocationLookup` showed
 * *"🔍 Location lookup feature coming soon!"* next to a `// TODO: Implement geocoding API
 * integration`. The button existed, did nothing, and said so — which is more honest than a fake
 * result but still a control that lies about being a control.
 *
 * **Why Nominatim.** No API key and no account, like Open-Meteo (`IMP-110`) — so nothing is added to
 * `.env`, nothing can leak, and the boot-time environment gate (`IMP-100`) does not grow a variable
 * a contributor must obtain before the app runs. The cost is a strict usage policy, which is what
 * most of this file is about.
 *
 * **Why server-side, when the browser could call it directly.** Three reasons, and the first is not
 * optional:
 *
 *   1. Nominatim's usage policy **requires** an identifying `User-Agent`. A browser cannot set one —
 *      `User-Agent` is a forbidden header name for `fetch` — so a browser-side integration is
 *      unidentifiable traffic, which the policy treats as abuse and blocks.
 *   2. The policy caps callers at **one request per second**. That can only be enforced where the
 *      requests are serialised, which is here, not across every open admin tab.
 *   3. Results are extremely stable — an address does not move — so one shared cache is worth far
 *      more than a per-tab one.
 */

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

/**
 * The identifying User-Agent the usage policy requires.
 *
 * A generic string is treated as anonymous and blocked. This one names the application and links to
 * the repository, which is what the policy asks for: a way to contact whoever is responsible if the
 * traffic becomes a problem.
 */
const USER_AGENT = 'EasyTrip/1.0 (https://github.com/Mukund934/EasyTrip)';

/**
 * One request per second, enforced by serialising.
 *
 * Nominatim's policy is an absolute maximum of 1 req/s for the public instance, and exceeding it
 * gets an IP blocked rather than throttled. `express-rate-limit` cannot do this: it rejects the
 * *caller* over a window, where what is needed is to *pace our own outbound calls* regardless of how
 * many admins are typing. So the gap is measured against the last upstream call and the next one
 * waits.
 */
const MIN_INTERVAL_MS = 1100;
let lastRequestAt = 0;

/** Geocoding answers are stable for years, so this TTL is about memory, not freshness. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;
const REQUEST_TIMEOUT_MS = 6000;

/** More than a handful of candidates is a query that needs rewriting, not more results. */
const MAX_RESULTS = 5;

const cache = new Map();

const evict = () => {
  if (cache.size <= MAX_CACHE_ENTRIES) return;
  cache.delete(cache.keys().next().value);
};

/**
 * Normalise the query into a cache key.
 *
 * Case and internal whitespace do not change the answer, so `"Hampi , Karnataka"` and
 * `"hampi, karnataka"` must not be two upstream requests.
 */
const cacheKey = (query) => query.trim().toLowerCase().replace(/\s+/g, ' ');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Shape one upstream result into what EasyTrip uses. Returns `null` for anything unusable.
 *
 * Nominatim returns `lat`/`lon` as **strings**, which is the same trap `BL-007` hit in the map and
 * `IMP-113` hit in structured data: `Number(undefined)` is `NaN` and `Number(null)` is `0`, and a
 * `0` here would drop a pin in the Gulf of Guinea. Both must parse finite, or the result is
 * discarded rather than partially filled.
 */
const normaliseResult = (raw) => {
  const latitude = Number.parseFloat(raw?.lat);
  const longitude = Number.parseFloat(raw?.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;

  const address = raw.address || {};

  return {
    // What the admin reads to tell two candidates apart. Without it, an ambiguous query returns
    // several rows of identical-looking coordinates.
    label: raw.display_name || null,
    latitude,
    longitude,
    // Offered so the form can fill the address fields it already has, rather than only the pin.
    // Nominatim's key varies by settlement size; the first one present wins.
    locality: address.suburb || address.village || address.town || address.city_district || null,
    city: address.city || address.town || address.village || null,
    district: address.state_district || address.county || null,
    state: address.state || null,
    postcode: address.postcode || null,
    country_code: address.country_code ? address.country_code.toUpperCase() : null
  };
};

/**
 * Geocode a free-text place description.
 *
 * Returns an **array**, possibly empty. Never throws, and never returns a "best guess" for a query
 * that matched nothing: an empty array means the caller shows "no match", and a fabricated pin on an
 * admin form becomes a fabricated pin on a public map.
 *
 * `fetchImpl` is a seam so the suite can assert the request that goes out — the `User-Agent` and the
 * pacing are the two properties that matter most here and neither is visible in the response.
 */
const geocode = async (query, { fetchImpl = fetch } = {}) => {
  if (typeof query !== 'string') return [];
  const trimmed = query.trim();
  if (!trimmed) return [];

  const key = cacheKey(trimmed);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  // Pace ourselves before the call, not after: the policy is about the interval between requests
  // leaving this process, and a cache hit above correctly skips the wait entirely.
  const since = Date.now() - lastRequestAt;
  if (since < MIN_INTERVAL_MS) await sleep(MIN_INTERVAL_MS - since);
  lastRequestAt = Date.now();

  const url =
    `${NOMINATIM}?q=${encodeURIComponent(trimmed)}&format=jsonv2` +
    `&addressdetails=1&limit=${MAX_RESULTS}` +
    // The catalogue is India-only, which `KNOWN_LIMITATIONS.md` states as a product boundary.
    // Constraining upstream means "Hampi" cannot return Hampi, Ohio — which is the realistic
    // wrong answer, not a malicious one.
    '&countrycodes=in';

  try {
    const response = await fetchImpl(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT }
    });

    if (!response.ok) {
      logger.warn({ status: response.status }, 'Geocoding provider returned a non-200');
      return [];
    }

    const payload = await response.json();

    // Redundant for *behaviour*, and kept on purpose. Removing it is an equivalent mutation — the
    // catch below already turns `payload.map is not a function` into the same empty array — but the
    // two paths log different things, and "provider returned an unrecognised shape" is the line
    // that tells an operator the upstream contract changed rather than that the network blipped.
    // Proven equivalent in the IMP-116 mutation run (`G-9`) rather than assumed.
    if (!Array.isArray(payload)) {
      logger.warn('Geocoding provider returned an unrecognised shape');
      return [];
    }

    const results = payload.map(normaliseResult).filter(Boolean).slice(0, MAX_RESULTS);

    // A miss is cached too, and deliberately: a typo'd query re-typed is common, and re-asking
    // upstream for an answer already known to be empty spends the 1 req/s budget on nothing.
    cache.set(key, { at: Date.now(), value: results });
    evict();

    return results;
  } catch (error) {
    logger.warn({ name: error.name }, 'Geocoding lookup failed');
    return [];
  }
};

/** Test seam. Production never calls these; the cache is process-local and dies with the process. */
const clearCache = () => {
  cache.clear();
  lastRequestAt = 0;
};

module.exports = {
  geocode,
  clearCache,
  normaliseResult,
  USER_AGENT,
  MIN_INTERVAL_MS,
  MAX_RESULTS,
  CACHE_TTL_MS
};
