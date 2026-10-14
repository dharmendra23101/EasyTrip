const { DEFAULT_CROWD_LEVEL } = require('../constants/placeSeasonality');

/**
 * How well a place fits what somebody asked for, and **why** (`FV-028` stage d).
 *
 * ---------------------------------------------------------------------------
 * The problem this has to solve, which is not the arithmetic
 * ---------------------------------------------------------------------------
 * Almost nothing in this catalogue is curated. A place typically has no months, no crowd level and
 * often no ratings. **A score of "72% fit" computed from three unknown inputs is a confident number
 * built from nothing**, and it is the exact harm every earlier stage of `FV-028` was designed to
 * avoid, arriving at the one layer where it is hardest to see: a percentage looks like a measurement.
 *
 * Two rules follow, and they are the whole design:
 *
 * **1. An unknown input is excluded, not neutralised.** The tempting shortcut is to score a missing
 * crowd level as 0.5 and fold it in. That manufactures certainty - it moves the total toward the
 * middle and makes an unmeasured place look *averagely* good, which is a claim nobody made. Unknown
 * inputs leave the denominator entirely and are named in `unavailable`.
 *
 * **2. The score travels with its coverage.** `coverage` is the share of the total possible weight
 * that was actually known. A place scoring 0.9 on coverage 0.2 and one scoring 0.9 on coverage 1.0
 * are not comparable, and a caller that shows the first as "90% match" without the second number is
 * lying with our arithmetic. When nothing is known the score is **null** - not zero, and not fifty.
 *
 * ---------------------------------------------------------------------------
 * It is a rule-based score and it says so
 * ---------------------------------------------------------------------------
 * `FP-012` rejects relabelling rule-based features as AI. There is no model here: it is a weighted
 * mean of at most four comparisons, every one of which is returned in `factors` with its own value,
 * weight and a sentence explaining it. "Shows its working" is the requirement, so the working is the
 * return value rather than a debug log.
 *
 * ---------------------------------------------------------------------------
 * Two of the six inputs `FV-028` lists are absent, and neither is an oversight
 * ---------------------------------------------------------------------------
 * The roadmap names six: season fit, crowd, rating, distance, budget band and matched interests.
 * Four are scored here. The other two have no honest source, and a factor with no honest source is
 * the thing this whole item exists to refuse.
 *
 * **Budget band.** This schema has no such column - not on `places`, not anywhere. Approximating it
 * from something else would be inventing the one input a traveller would most obviously check
 * against reality, and being caught inventing it is worse than not offering it.
 *
 * **Distance.** It needs somewhere to measure *from*, and there is no such point. This endpoint is
 * public and unauthenticated, so there is no user on the request at all; and even for a signed-in
 * traveller `users.location` is a free-text city name, not coordinates - geocoding it to a latitude
 * would manufacture a precision the user never gave. Note that this is not the same distance
 * `quieter-nearby` computes: that one measures between two places whose coordinates are both known,
 * from an origin the caller named in the URL. Reusing that number here would answer "how far is this
 * from itself".
 *
 * Both are recoverable later - a budget column, or an explicit `?from=` the caller opts into - and
 * the shape above absorbs them without changing: a new factor either has a value or names itself in
 * `unavailable`, and `coverage` re-normalises around it.
 */

/**
 * What each factor is worth when it is known.
 *
 * Season leads because this whole feature is about *when*, and because it is the only factor that can
 * be flatly wrong rather than merely disappointing - arriving in the monsoon is a different class of
 * mistake from arriving somewhere slightly busier than hoped.
 *
 * The numbers are a judgement, not a measurement, and nothing downstream should present them as one.
 * They are exported so a caller can show them rather than restate them.
 */
const WEIGHTS = { season: 0.4, interests: 0.25, crowd: 0.2, rating: 0.15 };

/** Quieter scores higher. `unknown` is absent on purpose - it is not a level, it is the lack of one. */
const CROWD_SCORES = { low: 1, moderate: 0.6, high: 0.25 };

/**
 * Is this a crowd level somebody actually chose?
 *
 * **`hasOwnProperty` rather than `in`, and that is not pedantry.** `in` walks the prototype chain, so
 * `'constructor' in CROWD_SCORES` is `true` and the lookup then returns a *function* as the factor's
 * value. The weighted sum becomes `NaN`, `JSON.stringify` renders `NaN` as `null`, and the endpoint
 * emits `score: null` beside a non-zero `coverage` and a counted factor - "we cannot score this
 * place" printed next to the working that scored it. The invariant this module is built on is that
 * **`score` is `null` exactly when `coverage` is 0**, and `in` breaks it.
 *
 * The `CHECK` constraint on the column means the database cannot produce such a row today. This is an
 * exported pure function whose contract is stated above it, and a contract that holds only because
 * one caller happens to be careful is not a contract. Found by mutation `D8`.
 */
const isCurated = (level) =>
  typeof level === 'string' &&
  level !== DEFAULT_CROWD_LEVEL &&
  Object.prototype.hasOwnProperty.call(CROWD_SCORES, level);

/**
 * Does the requested month fall in the curated best months?
 *
 * Binary rather than graded. A "close to a good month" score would need a notion of how far one month
 * is from a season, which is a thing the data does not say - `best_months` is a set, not a curve, and
 * inventing a gradient over it would be exactly the guessing `BUG-056` was about.
 */
const seasonFactor = (place, month) => {
  const months = Array.isArray(place.best_months) ? place.best_months : [];
  if (months.length === 0) {
    return { unavailable: 'Nobody has recorded which months are best here.' };
  }

  const hit = months.includes(month);
  return {
    value: hit ? 1 : 0,
    detail: hit
      ? 'This is one of the months somebody recommended.'
      : 'Not one of the months somebody recommended — which is not the same as a bad month.'
  };
};

const crowdFactor = (place) => {
  if (!isCurated(place.crowd_level)) {
    return { unavailable: 'Nobody has judged how busy this place is.' };
  }
  return {
    value: CROWD_SCORES[place.crowd_level],
    detail: `Somebody judged this place ${place.crowd_level === 'low' ? 'quiet' : place.crowd_level === 'moderate' ? 'steady' : 'crowded'}.`
  };
};

/**
 * The average rating, normalised.
 *
 * **`rating_count === 0` is unavailable, not zero.** A place nobody has reviewed is unrated, and
 * scoring it as the worst possible place is how a new entry gets buried by its own newness.
 */
const ratingFactor = (place) => {
  const count = Number(place.rating_count) || 0;
  if (count === 0) return { unavailable: 'Nobody has reviewed this place yet.' };

  const average = Number(place.rating_sum) / count;
  return {
    // 1-5 mapped onto 0-1. A one-star place scores 0, which is a real review rather than an absence.
    value: Math.min(1, Math.max(0, (average - 1) / 4)),
    detail: `Rated ${average.toFixed(1)} out of 5 by ${count} ${count === 1 ? 'traveller' : 'travellers'}.`
  };
};

/**
 * How many of the traveller's interests this place matches.
 *
 * Unavailable when **either** side is empty: a place with no themes cannot be matched, and a
 * traveller who named no interests has not expressed a preference to match against. The second is the
 * commoner case and the easier one to get wrong - scoring "no interests given" as a perfect match
 * would let an empty request rank every place at 100%.
 */
const interestsFactor = (place, interests) => {
  const themes = Array.isArray(place.themes) ? place.themes : [];
  if (interests.length === 0) {
    return { unavailable: 'You have not said what you are interested in.' };
  }
  if (themes.length === 0) {
    return { unavailable: 'This place has no themes recorded.' };
  }

  const matched = interests.filter((interest) => themes.includes(interest));
  return {
    value: matched.length / interests.length,
    detail:
      matched.length === 0
        ? 'None of your interests are recorded for this place.'
        : `Matches ${matched.length} of your ${interests.length}: ${matched.join(', ')}.`
  };
};

const LABELS = {
  season: 'Time of year',
  interests: 'Your interests',
  crowd: 'How busy it is',
  rating: 'What travellers said'
};

/**
 * Score a place against a request, with the working shown.
 *
 * @param {Object} place                 a place row
 * @param {Object} criteria
 * @param {number} [criteria.month]      1-12, the month being considered
 * @param {string[]} [criteria.interests] theme ids the traveller cares about
 * @returns {{score: number|null, coverage: number, factors: Array, unavailable: Array}}
 *   `score` is 0-1 over the **known** factors only, or `null` when none were known.
 *   `coverage` is the share of total weight that was known — always report it beside the score.
 */
const scoreFit = (place = {}, { month, interests = [] } = {}) => {
  const wanted = Array.isArray(interests) ? interests.filter(Boolean) : [];

  const computed = {
    // A request with no month cannot be scored on season. Defaulting to "today" here would answer a
    // question the caller did not ask, and would make the same place score differently in April.
    season: month ? seasonFactor(place, month) : { unavailable: 'No month was given.' },
    interests: interestsFactor(place, wanted),
    crowd: crowdFactor(place),
    rating: ratingFactor(place)
  };

  const factors = [];
  const unavailable = [];
  let weighted = 0;
  let known = 0;

  for (const [key, result] of Object.entries(computed)) {
    if (result.unavailable) {
      unavailable.push({ key, label: LABELS[key], reason: result.unavailable });
      continue;
    }
    weighted += result.value * WEIGHTS[key];
    known += WEIGHTS[key];
    factors.push({
      key,
      label: LABELS[key],
      weight: WEIGHTS[key],
      value: result.value,
      detail: result.detail
    });
  }

  return {
    // `null`, not 0 and not 0.5. Nothing is known, so there is nothing to say — and a caller that
    // renders `null` as a bar at zero has misread it, which is why there is no numeric fallback to
    // fall into by accident.
    score: known === 0 ? null : weighted / known,
    coverage: known,
    factors,
    unavailable
  };
};

module.exports = { scoreFit, WEIGHTS, CROWD_SCORES };
