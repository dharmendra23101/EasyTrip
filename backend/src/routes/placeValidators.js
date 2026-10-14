const { body, param, query } = require('express-validator');

const { SORT_KEYS, SUGGEST_MAX_LIMIT } = require('../models/placeModel');
const { SUPPORTED_GEOCODERS } = require('../controllers/helpers/coordinateSource');
const { THEME_IDS } = require('../constants/themes');
const { CROWD_LEVELS, SEASONALITY_SOURCES } = require('../constants/placeSeasonality');
const {
  ACCESS_LEVELS,
  ACCESSIBILITY_SOURCES,
  ACCESS_FIELDS,
  isClaimed
} = require('../constants/placeAccessibility');
const { PLACE_SETTINGS } = require('../constants/placeSetting');

/**
 * What a valid request to a place route looks like.
 *
 * Split out of `placeRoutes.js` when `check-module-size` stopped the run at 546 lines, and the seam
 * is a property rather than a line count: **this file says what a request must contain, and
 * `placeRoutes.js` says which handler receives it.** They change for different reasons — a new
 * column edits the rules and no route; a new endpoint edits the routes and reuses a rule set — and
 * the routes file had grown to four fifths validation.
 *
 * The first attempt at this split cut on a line range and silently took four small param rules with
 * it. ESLint caught it as twelve `no-undef` errors, which is the cheap way to find out; the fix was
 * to cut on the definitions rather than on the numbers.
 */

const parseJson = (value) => (typeof value === 'string' ? JSON.parse(value) : value);

const isStringArray = (label, maxEntries, maxLength, allowed) => (value) => {
  let parsed;
  try {
    parsed = parseJson(value);
  } catch (error) {
    throw new Error(`${label} must be a JSON array of strings`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON array of strings`);
  }
  if (parsed.length > maxEntries) {
    throw new Error(`${label} may contain at most ${maxEntries} entries`);
  }
  if (parsed.some((entry) => typeof entry !== 'string' || entry.length > maxLength)) {
    throw new Error(`${label} entries must be strings of at most ${maxLength} characters`);
  }
  // Membership is opt-in, and only the WRITE paths ask for it. Applying it to a query filter would
  // turn a stale bookmark into a 400; `places.test.js` pins the opposite ("an unmatched filter
  // returns an empty list, not an error"), which is the friendlier contract for a read.
  if (allowed) {
    const unknown = [...new Set(parsed.filter((entry) => !allowed.includes(entry)))];
    if (unknown.length > 0) {
      throw new Error(
        `${label} contains unknown ${label}: ${unknown.join(', ')}. Allowed: ${allowed.join(', ')}`
      );
    }
  }
  return true;
};

const isFlatObject = (value) => {
  let parsed;
  try {
    parsed = parseJson(value);
  } catch (error) {
    throw new Error('custom_keys must be a JSON object');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('custom_keys must be a JSON object');
  }
  const entries = Object.entries(parsed);
  if (entries.length > 30) {
    throw new Error('custom_keys may contain at most 30 entries');
  }
  if (entries.some(([key, entry]) => key.length > 60 || String(entry).length > 500)) {
    throw new Error('custom_keys entries are too long');
  }
  return true;
};

/**
 * `FV-028` stage (d). Both optional, and both validated rather than coerced: `?month=13` is a caller
 * error worth a 400, and silently clamping it to 12 would answer a different question convincingly.
 */
const fitQueryRules = [
  query('month')
    .optional({ values: 'falsy' })
    .isInt({ min: 1, max: 12 })
    .withMessage('month must be a month number from 1 to 12'),
  query('interests')
    .optional({ values: 'falsy' })
    .isString()
    .isLength({ max: 300 })
    .withMessage('interests must be a comma-separated list')
];

const placeIdParam = param('id')
  .isInt({ min: 1 })
  .withMessage('Place id must be a positive integer');

const requiredText = (field, label, max) =>
  body(field)
    .trim()
    .notEmpty()
    .withMessage(`${label} is required`)
    .bail()
    .isLength({ max })
    .withMessage(`${label} must be at most ${max} characters`);

// Empty strings count as "not supplied": the admin form posts every field it has,
// blank ones included, and an update patches only what it is actually given.
const optionalText = (field, label, max) =>
  body(field)
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max })
    .withMessage(`${label} must be at most ${max} characters`);

const optionalUrl = (field) =>
  body(field)
    .optional({ values: 'falsy' })
    .isURL({ protocols: ['http', 'https'], require_protocol: true })
    .withMessage(`${field} must be a valid http(s) URL`);

// Shared across create and update; `required` decides whether name/location may be
// omitted, since update patches only the fields it is given.
const placeBodyRules = (required) => [
  required ? requiredText('name', 'Name', 200) : optionalText('name', 'Name', 200),
  required ? requiredText('location', 'Location', 200) : optionalText('location', 'Location', 200),
  optionalText('description', 'Description', 5000),
  optionalText('district', 'District', 120),
  optionalText('state', 'State', 120),
  optionalText('locality', 'Locality', 120),
  optionalText('pin_code', 'Pin code', 20),
  // Not converted with toFloat(): the controllers treat a falsy value as "no
  // coordinate", and a sanitized 0 would read as absent.
  body('latitude')
    .optional({ values: 'falsy' })
    .isFloat({ min: -90, max: 90 })
    .withMessage('Latitude must be between -90 and 90'),
  body('longitude')
    .optional({ values: 'falsy' })
    .isFloat({ min: -180, max: 180 })
    .withMessage('Longitude must be between -180 and 180'),
  // Which geocoder produced those coordinates, when one did (IMP-127). Rejected rather than
  // silently dropped: this field decides whether an attribution notice appears, so a typo that
  // quietly removed one would be invisible in exactly the way a licence obligation must not be.
  // The allowlist is `SUPPORTED_GEOCODERS`, which the 010 migration's CHECK constraint mirrors.
  body('coordinates_source')
    .optional({ values: 'falsy' })
    .isIn(SUPPORTED_GEOCODERS)
    .withMessage(`coordinates_source must be one of: ${SUPPORTED_GEOCODERS.join(', ')}`),
  optionalUrl('primary_image_url'),
  optionalUrl('image_url'),
  body('themes')
    .optional({ values: 'falsy' })
    .custom(isStringArray('themes', 20, 60, THEME_IDS)),
  // `values: 'falsy'` matches every other optional here: an omitted key and an empty string both
  // mean "leave it alone", and the column default supplies `unknown`.
  body('setting')
    .optional({ values: 'falsy' })
    .isIn(PLACE_SETTINGS)
    .withMessage(`setting must be one of: ${PLACE_SETTINGS.join(', ')}`),
  body('tags')
    .optional({ values: 'falsy' })
    .custom(isStringArray('tags', 50, 60)),
  body('custom_keys').optional({ values: 'falsy' }).custom(isFlatObject),

  // ---------------------------------------------------------------------------
  // Accessibility (`FV-029` stage a)
  // ---------------------------------------------------------------------------
  ...ACCESS_FIELDS.map((field) =>
    body(field)
      .optional({ values: 'falsy' })
      .isIn(ACCESS_LEVELS)
      .withMessage(`${field} must be one of: ${ACCESS_LEVELS.join(', ')}`)
  ),
  body('accessibility_notes')
    .optional({ values: 'falsy' })
    .isString()
    .bail()
    .trim()
    .isLength({ max: 2000 })
    .withMessage('accessibility_notes must be 2000 characters or fewer'),
  body('accessibility_source')
    .optional({ values: 'falsy' })
    .isIn(ACCESSIBILITY_SOURCES)
    .withMessage(`accessibility_source must be one of: ${ACCESSIBILITY_SOURCES.join(', ')}`),
  body('accessibility_checked_on')
    .optional({ values: 'falsy' })
    .isISO8601({ strict: true })
    .withMessage('accessibility_checked_on must be a date, as YYYY-MM-DD')
    .bail()
    .custom((value) => {
      // The same rule as `places_accessibility_checked_on_not_future`, restated here so a typo in
      // the year is a readable message rather than a 500 from a constraint violation. The
      // constraint remains the thing that is true — this route is not the only possible writer.
      if (value.slice(0, 10) > new Date().toISOString().slice(0, 10)) {
        throw new Error('accessibility_checked_on cannot be in the future');
      }
      return true;
    }),

  // ---------------------------------------------------------------------------
  // Seasonality (`FV-028` stage a)
  // ---------------------------------------------------------------------------
  body('best_months')
    .optional({ values: 'falsy' })
    .custom((value) => {
      const months = parseJson(value);
      if (!Array.isArray(months)) throw new Error('best_months must be an array of month numbers');
      if (months.length > 12) throw new Error('best_months may contain at most 12 entries');
      if (!months.every((month) => Number.isInteger(Number(month)) && month >= 1 && month <= 12)) {
        throw new Error('best_months entries must be month numbers from 1 to 12');
      }
      return true;
    }),
  body('crowd_level')
    .optional({ values: 'falsy' })
    .isIn(CROWD_LEVELS)
    .withMessage(`crowd_level must be one of: ${CROWD_LEVELS.join(', ')}`),
  body('typical_visit_minutes')
    .optional({ values: 'falsy' })
    .isInt({ min: 1, max: 1440 })
    .withMessage(
      'typical_visit_minutes must be between 1 and 1440 — longer is a trip, not a visit'
    ),
  body('seasonality_source')
    .optional({ values: 'falsy' })
    .isIn(SEASONALITY_SOURCES)
    .withMessage(`seasonality_source must be one of: ${SEASONALITY_SOURCES.join(', ')}`),
  body('seasonality_checked_on')
    .optional({ values: 'falsy' })
    .isISO8601({ strict: true })
    .withMessage('seasonality_checked_on must be a date, as YYYY-MM-DD')
    .bail()
    .custom((value) => {
      if (value.slice(0, 10) > new Date().toISOString().slice(0, 10)) {
        throw new Error('seasonality_checked_on cannot be in the future');
      }
      return true;
    }),

  /**
   * Curated seasonality needs a source and a date too (`FV-028`).
   *
   * The same rule as accessibility's below, restated for the same reason: the database enforces it,
   * and this exists so a caller gets a sentence rather than a constraint violation. The stakes are
   * lower — a wrong month costs a disappointing trip rather than stranding somebody — but two
   * adjacent column groups with different honesty rules is worse than one rule applied twice.
   */
  body().custom((payload) => {
    const months = parseJson(payload?.best_months);
    const claims =
      (Array.isArray(months) && months.length > 0) ||
      (payload?.crowd_level && payload.crowd_level !== 'unknown') ||
      payload?.typical_visit_minutes;
    if (!claims) return true;
    if (payload.seasonality_source && payload.seasonality_checked_on) return true;
    throw new Error(
      'Seasonality needs seasonality_source and seasonality_checked_on. A crowd level nobody ' +
        'recorded, shown as though somebody had, is the dark pattern this feature exists to avoid.'
    );
  }),

  /**
   * A claim must say who says so, and when (`FV-029`'s kill criterion).
   *
   * `places_accessibility_is_attributed` enforces this in the database, which is where it has to be
   * — the API is not the only possible writer, and this is a safety claim rather than a formatting
   * one. Restating it here buys a 400 with a sentence instead of a 500 from a constraint the caller
   * cannot read.
   *
   * Checked on the **body**, so it only fires when the request actually sets an axis. A patch that
   * touches neither leaves an existing claim and its provenance exactly as they were.
   */
  body().custom((payload) => {
    const claims = ACCESS_FIELDS.some((field) => isClaimed(payload?.[field]));
    if (!claims) return true;
    if (payload.accessibility_source && payload.accessibility_checked_on) return true;
    throw new Error(
      'An accessibility claim needs accessibility_source and accessibility_checked_on. ' +
        'Unverified access information is worse than none — leave the answer as "unknown" instead.'
    );
  })
];

// Search accepts the same collection shapes as the write routes (JSON arrays as query text).
// `date` is a season key, not a calendar date — see SEASON_MONTHS in placeModel.
const searchRules = [
  query('searchTerm')
    .optional({ values: 'falsy' })
    .isString()
    .bail()
    .trim()
    .isLength({ max: 200 })
    .withMessage('searchTerm must be at most 200 characters'),
  query('location')
    .optional({ values: 'falsy' })
    .isString()
    .bail()
    .trim()
    .isLength({ max: 120 })
    .withMessage('location must be at most 120 characters'),
  query('district')
    .optional({ values: 'falsy' })
    .isString()
    .bail()
    .trim()
    .isLength({ max: 120 })
    .withMessage('district must be at most 120 characters'),
  query('state')
    .optional({ values: 'falsy' })
    .isString()
    .bail()
    .trim()
    .isLength({ max: 120 })
    .withMessage('state must be at most 120 characters'),
  query('tags')
    .optional({ values: 'falsy' })
    .custom(isStringArray('tags', 50, 60)),
  query('themes')
    .optional({ values: 'falsy' })
    .custom(isStringArray('themes', 20, 60)),
  // `FV-029`. **Deliberately not allowlisted**, unlike the write rule for the same column.
  //
  // The first draft passed `ACCESS_LEVELS` here, on the argument that a filter silently matching
  // nothing reads to a traveller as "there are no accessible places". `isStringArray`'s own comment
  // answers that: membership is opt-in and only the write paths ask for it, because applying it to a
  // query turns a stale bookmark into a 400 — and `places.test.js` pins the opposite contract for
  // reads. The concern is real and it is identical for `themes`; making this one filter behave
  // differently would be a special case with no property to justify it. An empty result is the
  // browse page's job to explain (`IMP-031` already separates "nothing matched" from "failed").
  query('stepFree')
    .optional({ values: 'falsy' })
    .custom(isStringArray('stepFree', 4, 20)),
  query('minRating')
    .optional({ values: 'falsy' })
    .isFloat({ min: 0, max: 5 })
    .withMessage('minRating must be between 0 and 5'),
  query('date')
    .optional({ values: 'falsy' })
    .isIn(['summer', 'monsoon', 'winter'])
    .withMessage('date must be one of: summer, monsoon, winter')
];

// Pagination, sorting and projection (IMP-038). `limit` is capped in the model as well; this
// rule exists so an out-of-range value is a 400 the caller can see rather than a silent clamp.
// `sort` and `projection` are enumerations because both index into server-side SQL fragments —
// rejecting anything unrecognised here keeps that lookup total.
const listRules = [
  query('limit')
    .optional({ values: 'falsy' })
    .isInt({ min: 1, max: 100 })
    .withMessage('limit must be between 1 and 100'),
  query('offset')
    .optional({ values: 'falsy' })
    .isInt({ min: 0 })
    .withMessage('offset must be zero or greater'),
  // Enumerated from the model rather than restated, so adding a sort cannot leave the validator
  // rejecting a value the model supports (or accepting one it does not).
  query('sort')
    .optional({ values: 'falsy' })
    .isIn(SORT_KEYS)
    .withMessage(`sort must be one of: ${SORT_KEYS.join(', ')}`),
  query('projection')
    .optional({ values: 'falsy' })
    .isIn(['list', 'map'])
    .withMessage('projection must be one of: list, map'),
  query('withStats')
    .optional({ values: 'falsy' })
    .isIn(['true', '1', 'false', '0'])
    .withMessage('withStats must be a boolean')
];

// Typeahead (IMP-112). `q` is deliberately NOT `notEmpty()`: the browser sends an empty one the
// instant the box is cleared, and that is an empty result, not a client error. The length cap
// matches `searchTerm`'s so the two search surfaces cannot disagree about what is too long.
const suggestRules = [
  query('q')
    .optional({ values: 'falsy' })
    .isString()
    .bail()
    .trim()
    .isLength({ max: 200 })
    .withMessage('q must be at most 200 characters'),
  query('limit')
    .optional({ values: 'falsy' })
    .isInt({ min: 1, max: SUGGEST_MAX_LIMIT })
    .withMessage(`limit must be between 1 and ${SUGGEST_MAX_LIMIT}`)
];

const reviewRules = [
  placeIdParam,
  body('rating')
    .exists({ values: 'falsy' })
    .withMessage('Rating is required')
    .bail()
    .isInt({ min: 1, max: 5 })
    .withMessage('Rating must be an integer between 1 and 5')
    .toInt(),
  body('comment')
    .optional({ values: 'falsy' })
    .isString()
    .withMessage('Comment must be text')
    .bail()
    .trim()
    .isLength({ max: 2000 })
    .withMessage('Comment must be at most 2000 characters')
];

const reviewIdParam = param('reviewId')
  .isInt({ min: 1 })
  .withMessage('Review id must be a positive integer');

const imageIdParam = param('imageId')
  .isInt({ min: 1 })
  .withMessage('Image id must be a positive integer');

// Caption arrives as multipart alongside the file, so it is optional and length-capped to the
// column width rather than validated as structured input.
const galleryCaptionRule = body('caption')
  .optional({ values: 'falsy' })
  .trim()
  .isLength({ max: 255 })
  .withMessage('Caption must be at most 255 characters');

const reportRules = [
  placeIdParam,
  reviewIdParam,
  // The current UI reports with a single click and sends no reason; the column and this rule
  // exist so a reason box can be added without touching the schema or the route.
  body('reason')
    .optional({ values: 'falsy' })
    .isString()
    .withMessage('Reason must be text')
    .bail()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Reason must be at most 500 characters')
];

module.exports = {
  fitQueryRules,
  placeIdParam,
  reviewIdParam,
  imageIdParam,
  galleryCaptionRule,
  placeBodyRules,
  searchRules,
  listRules,
  suggestRules,
  reviewRules,
  reportRules
};
