/**
 * Places: read and write.
 *
 * Split from a single 958-line controller in Sprint 5.14. Images, reviews and taxonomy moved to
 * sibling modules; this file re-exports all of them so `placeRoutes.js` keeps one import and the
 * public surface is unchanged.
 */
const placeModel = require('../models/placeModel');
const logger = require('../utils/logger');
const { getCurrentUser } = require('./helpers/currentUser');
const { criteriaFromQuery } = require('./helpers/placeQuery');
const { sameCoordinate, resolveCoordinateSource } = require('./helpers/coordinateSource');
const { accessibilityForCreate, accessibilityPatch } = require('./helpers/placeAccessibility');
const {
  seasonalityForCreate,
  seasonalityPatch,
  seasonalityBody
} = require('./helpers/placeSeasonality');
const { provided, parseJsonField } = require('./helpers/writeFields');

const fs = require('fs');
const {
  uploadImage,
  destroyImage,
  destroyPlaceAssets,
  publicIdFromUrl
} = require('../config/cloudinary');

// Re-exported so `placeRoutes.js` keeps a single import and the surface stays identical.
const alternatives = require('./placeAlternativesController');
const images = require('./placeImageController');
const reviews = require('./placeReviewController');
const taxonomy = require('./placeTaxonomyController');

const listPlacesHandler = async (req, res) => {
  try {
    const { sort, limit, offset, projection, withStats } = req.query;
    const filters = criteriaFromQuery(req.query);

    const result = await placeModel.listPlaces({
      filters,
      sort,
      limit,
      offset,
      projection: projection === 'map' ? 'map' : 'list',
      withStats: withStats === 'true' || withStats === '1'
    });

    const data = result.rows.map(({ fallback_image_url, ...place }) => ({
      ...place,
      image_url: place.primary_image_url || fallback_image_url || null
    }));

    const body = {
      data,
      pagination: {
        total: result.total,
        limit: result.limit,
        offset: result.offset,
        hasMore: result.offset + data.length < result.total,
        // The sort that actually ran, from the model, not a second guess at it here. A search with
        // no explicit `sort` resolves to `relevance` (IMP-112) and `relevance` with no search term
        // resolves back to `newest`; re-deriving that rule in the controller is how the response
        // ends up claiming an order the query did not use.
        sort: result.sort
      }
    };

    // Present only when asked for, so a caller cannot mistake its absence for zeroes.
    if (result.stats) body.stats = result.stats;

    res.status(200).json(body);
  } catch (error) {
    logger.error({ err: error }, 'Error listing places');
    res.status(500).json({
      message: 'Error getting places',
      // Safe by default: only an explicit NODE_ENV=development exposes driver text.
      // The old `=== 'production' ? safe : leak` test leaked whenever NODE_ENV was
      // unset, which is exactly what `npm start` does (SECURITY_AUDIT 10.4).
      error: process.env.NODE_ENV === 'development' ? error.message : 'Server error',
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * Get place by ID
 */

const getPlaceById = async (req, res) => {
  try {
    const { id } = req.params;
    const timestamp = new Date().toISOString();
    const user = getCurrentUser(req);

    if (isNaN(parseInt(id))) {
      return res.status(400).json({ message: 'Invalid place ID format' });
    }

    const place = await placeModel.getPlaceById(id);

    if (!place) {
      return res.status(404).json({
        message: 'Place not found',
        timestamp,
        requested_by: user
      });
    }

    const { fallback_image_url, ...placeFields } = place;
    const formattedPlace = {
      ...placeFields,
      image_url: place.primary_image_url || fallback_image_url || null
    };

    res.status(200).json(formattedPlace);
  } catch (error) {
    logger.error({ err: error }, 'Error getting place');
    res.status(500).json({
      message: 'Error getting place',
      // Safe by default: only an explicit NODE_ENV=development exposes driver text.
      // The old `=== 'production' ? safe : leak` test leaked whenever NODE_ENV was
      // unset, which is exactly what `npm start` does (SECURITY_AUDIT 10.4).
      error: process.env.NODE_ENV === 'development' ? error.message : 'Server error',
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * Get image for a place
 */

const createPlace = async (req, res) => {
  try {
    const timestamp = new Date().toISOString();
    const user = getCurrentUser(req);

    const {
      name,
      description,
      location,
      district,
      state,
      locality,
      pin_code,
      latitude,
      longitude,
      coordinates_source,
      setting,
      themes,
      tags,
      custom_keys
    } = req.body;

    // Validate required fields
    if (!name || !location) {
      logger.warn('Place create rejected: missing required fields');
      return res.status(400).json({
        message: 'Name and location are required',
        timestamp
      });
    }

    // A falsy coordinate means "no coordinate" throughout this controller, and the validator skips
    // `toFloat()` so a sanitized 0 cannot read as absent. Parsed once here because the provenance
    // decision below needs to know whether a pair actually survived (IMP-127).
    const nextLatitude = latitude ? parseFloat(latitude) : null;
    const nextLongitude = longitude ? parseFloat(longitude) : null;

    // Create place data without image initially
    const placeData = {
      name: name.trim(),
      description: description?.trim() || null,
      location: location.trim(),
      district: district?.trim() || null,
      state: state?.trim() || null,
      locality: locality?.trim() || null,
      pin_code: pin_code?.trim() || null,
      latitude: nextLatitude,
      longitude: nextLongitude,
      // Every create sets its coordinates, so `coordinatesChanged` is unconditionally true — the
      // same rule as an update, with no prior claim to inherit.
      coordinates_source: resolveCoordinateSource({
        requested: coordinates_source,
        hasCoordinates: nextLatitude !== null && nextLongitude !== null,
        coordinatesChanged: true
      }),
      primary_image_url: null, // Will be updated after upload
      themes: parseJsonField(themes, []),
      tags: parseJsonField(tags, []),
      custom_keys: parseJsonField(custom_keys, {}),
      setting,
      // An omitted accessibility section creates an unsurveyed row, never an unattributed claim.
      ...accessibilityForCreate(req.body),
      // `FV-028`, same contract: an omitted section creates an uncurated row, never a claim.
      ...seasonalityForCreate(seasonalityBody(req.body)),
      created_by: user,
      updated_by: user
    };

    // Insert place into database first
    const newPlace = await placeModel.createPlace(placeData);
    logger.info({ placeId: newPlace.id }, 'Place created');

    // Process image upload if present
    let imageUrl = null;
    if (req.file) {
      try {
        // Check if file exists and has size
        if (!req.file.path || !fs.existsSync(req.file.path)) {
          throw new Error(`File not found at path: ${req.file.path}`);
        }

        // Upload to Cloudinary
        const result = await uploadImage(req.file.path, {
          folder: `easytrip/places/${newPlace.id}`,
          public_id: `place_${newPlace.id}_primary_${Date.now()}`,
          tags: ['place', `id_${newPlace.id}`, 'primary'],
          context: `place_id=${newPlace.id}|user=${user}|name=${encodeURIComponent(newPlace.name)}`
        });

        imageUrl = result.url;
        logger.debug({ imageUrl }, 'Image uploaded to Cloudinary');

        // Update the place record with the image URL
        await placeModel.updatePlace(newPlace.id, { primary_image_url: imageUrl });

        // Update the newPlace object with the image URL
        newPlace.primary_image_url = imageUrl;
      } catch (uploadError) {
        // Don't fail the request; the place is created without an image.
        logger.error(
          { err: uploadError },
          'Cloudinary upload failed; place created without an image'
        );
      }
    }

    const response = {
      ...newPlace,
      image_url: newPlace.primary_image_url || null,
      success: true
    };

    res.status(201).json(response);
  } catch (error) {
    logger.error({ err: error }, 'Error creating place');
    res.status(500).json({
      message: 'Error creating place',
      // Safe by default: only an explicit NODE_ENV=development exposes driver text.
      // The old `=== 'production' ? safe : leak` test leaked whenever NODE_ENV was
      // unset, which is exactly what `npm start` does (SECURITY_AUDIT 10.4).
      error: process.env.NODE_ENV === 'development' ? error.message : 'Server error',
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * Update a place with Cloudinary
 */

const updatePlace = async (req, res) => {
  try {
    const { id } = req.params;
    const user = getCurrentUser(req);

    if (isNaN(parseInt(id))) {
      return res.status(400).json({ message: 'Invalid place ID format' });
    }

    const currentPlace = await placeModel.getPlaceById(id);
    if (!currentPlace) {
      return res.status(404).json({ message: 'Place not found' });
    }

    const {
      name,
      description,
      location,
      district,
      state,
      locality,
      pin_code,
      latitude,
      longitude,
      coordinates_source,
      setting,
      themes,
      tags,
      custom_keys
    } = req.body;

    // Process image upload if present
    let imageUrl = currentPlace.primary_image_url;
    if (req.file) {
      try {
        // Check if file exists and has size
        if (!req.file.path || !fs.existsSync(req.file.path)) {
          throw new Error(`File not found at path: ${req.file.path}`);
        }

        // Upload to Cloudinary
        const result = await uploadImage(req.file.path, {
          folder: `easytrip/places/${id}`,
          public_id: `place_${id}_primary_${Date.now()}`,
          tags: ['place', `id_${id}`, 'primary', 'updated'],
          context: `place_id=${id}|user=${user}|updated=true|name=${encodeURIComponent(currentPlace.name)}`
        });

        const previousImageUrl = imageUrl;
        imageUrl = result.url;
        logger.debug({ imageUrl }, 'Replacement image uploaded to Cloudinary');

        // Replacing the primary image orphans the old asset. Every upload uses a fresh
        // timestamped public_id, so the replacement never overwrites its predecessor — without
        // this, editing a place's photo N times left N-1 assets paid for and unreachable.
        // Only after the new upload succeeded, so a failed replace keeps the existing image.
        const previousPublicId = publicIdFromUrl(previousImageUrl);
        if (previousPublicId && previousPublicId !== result.public_id) {
          const wasRemoved = await destroyImage(previousPublicId);
          logger.debug({ previousPublicId, removed: wasRemoved }, 'Previous image cleanup');
        }
      } catch (uploadError) {
        // Keep the old image URL rather than failing the whole update.
        logger.error({ err: uploadError }, 'Cloudinary upload failed; keeping the existing image');
      }
    }

    const nextLatitude =
      latitude !== undefined ? (latitude ? parseFloat(latitude) : null) : currentPlace.latitude;
    const nextLongitude =
      longitude !== undefined ? (longitude ? parseFloat(longitude) : null) : currentPlace.longitude;

    // Compared by value, not by whether the field was sent (IMP-127). The edit form posts every
    // field on every save, so "was latitude in the body?" is true even when the admin only touched
    // the description — and treating that as a coordinate change would revoke OSM attribution on
    // an unrelated edit. What matters is whether the pin actually moved.
    const coordinatesChanged =
      !sameCoordinate(nextLatitude, currentPlace.latitude) ||
      !sameCoordinate(nextLongitude, currentPlace.longitude);

    const placeData = {
      name: name || currentPlace.name,
      description: description !== undefined ? description : currentPlace.description,
      location: location || currentPlace.location,
      district: district !== undefined ? district : currentPlace.district,
      state: state !== undefined ? state : currentPlace.state,
      locality: locality !== undefined ? locality : currentPlace.locality,
      pin_code: pin_code !== undefined ? pin_code : currentPlace.pin_code,
      latitude: nextLatitude,
      longitude: nextLongitude,
      coordinates_source: resolveCoordinateSource({
        requested: coordinates_source,
        hasCoordinates: nextLatitude !== null && nextLongitude !== null,
        coordinatesChanged,
        current: currentPlace.coordinates_source
      }),
      primary_image_url: imageUrl,
      themes: parseJsonField(themes, currentPlace.themes || []),
      tags: parseJsonField(tags, currentPlace.tags || []),
      custom_keys: parseJsonField(custom_keys, currentPlace.custom_keys || {}),
      // Spread conditionally, because `updatePlace` keys on `column in placeData` rather than on
      // the value. Writing `setting,` unconditionally would put the key there with `undefined`,
      // node-pg would send NULL, and the NOT NULL column would reject the whole edit — the
      // BUG-048 shape, one column over. Omitted means "leave the classification alone".
      // `provided`, not `!== undefined`: an untouched <select> submits `setting=""`, the validator
      // reads that as "said nothing", and passing it through put an empty string against a CHECK
      // constraint — a 500 on an ordinary edit (`BUG-055`). One predicate for both halves now.
      ...provided('setting', setting),
      // Sparse for the same reason `setting` is, and for one more of its own: these five are
      // checked against each other by the database, so sending NULL for the keys a request omitted
      // would strip the provenance from a row that still claims step-free access. See the helper.
      ...accessibilityPatch(req.body),
      ...seasonalityPatch(seasonalityBody(req.body)),
      updated_by: user
    };

    const updatedPlace = await placeModel.updatePlace(id, placeData);
    logger.info({ placeId: updatedPlace.id }, 'Place updated');

    const response = {
      ...updatedPlace,
      image_url: updatedPlace.primary_image_url || null
    };

    res.status(200).json(response);
  } catch (error) {
    logger.error({ err: error }, 'Error updating place');
    res.status(500).json({
      message: 'Error updating place',
      // Safe by default: only an explicit NODE_ENV=development exposes driver text.
      // The old `=== 'production' ? safe : leak` test leaked whenever NODE_ENV was
      // unset, which is exactly what `npm start` does (SECURITY_AUDIT 10.4).
      error: process.env.NODE_ENV === 'development' ? error.message : 'Server error',
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * Delete a place
 */

const deletePlace = async (req, res) => {
  try {
    const { id } = req.params;
    const timestamp = new Date().toISOString();
    const user = getCurrentUser(req);

    if (isNaN(parseInt(id))) {
      return res.status(400).json({ message: 'Invalid place ID format' });
    }

    const place = await placeModel.getPlaceById(id);
    if (!place) {
      return res.status(404).json({ message: 'Place not found' });
    }

    const success = await placeModel.deletePlace(id);
    if (!success) {
      throw new Error('Failed to delete place');
    }

    // Remote media is cleaned up only AFTER the row is gone. Doing it first would risk destroying
    // the images of a place that then fails to delete. The call never throws — an orphaned asset
    // costs storage, whereas failing the request after the row is already deleted would leave the
    // caller believing the delete failed when it succeeded (IMP-024).
    const removed = await destroyPlaceAssets(id);
    logger.debug({ placeId: id, removed }, 'Cloudinary cleanup for deleted place');

    logger.info({ placeId: id }, 'Place deleted');

    res.status(200).json({
      message: 'Place deleted successfully',
      id,
      name: place.name,
      deleted_by: user,
      deleted_at: timestamp
    });
  } catch (error) {
    logger.error({ err: error }, 'Error deleting place');
    res.status(500).json({
      message: 'Error deleting place',
      // Safe by default: only an explicit NODE_ENV=development exposes driver text.
      // The old `=== 'production' ? safe : leak` test leaked whenever NODE_ENV was
      // unset, which is exactly what `npm start` does (SECURITY_AUDIT 10.4).
      error: process.env.NODE_ENV === 'development' ? error.message : 'Server error',
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * Search suggestions (`IMP-112` / `ADR-033`).
 *
 * Public and unauthenticated, like every other place read. Returns a bare array rather than the
 * `{ data, pagination }` envelope the list endpoints use: there is no pagination here by
 * construction — the cap is the point — and an envelope would invite a client to ask for page two
 * of a typeahead.
 *
 * An empty or whitespace-only `q` is `[]` with a 200, not a 400. The browser sends one the moment
 * the box is cleared, and a 400 there is an error the client has to special-case to ignore.
 */
const suggestPlaces = async (req, res) => {
  try {
    const suggestions = await placeModel.suggestPlaces({
      term: req.query.q,
      limit: req.query.limit
    });
    res.status(200).json({ data: suggestions });
  } catch (error) {
    logger.error({ err: error }, 'Error building search suggestions');
    res.status(500).json({
      message: 'Error getting suggestions',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Server error',
      timestamp: new Date().toISOString()
    });
  }
};

module.exports = {
  listPlaces: listPlacesHandler,
  suggestPlaces,
  getPlaceById,
  createPlace,
  updatePlace,
  deletePlace,
  ...alternatives,
  ...images,
  ...reviews,
  ...taxonomy
};
