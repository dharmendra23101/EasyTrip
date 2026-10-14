/** Serving a place's primary image, and the gallery write path (IMP-014). */
const fs = require('fs');
const pool = require('../config/db');
const placeModel = require('../models/placeModel');
const logger = require('../utils/logger');
const { getCurrentUser } = require('./helpers/currentUser');
const { sendDefaultImage } = require('./helpers/placeholderImage');
const { uploadImage, destroyImage, publicIdFromUrl } = require('../config/cloudinary');

const getPlaceImage = async (req, res) => {
  try {
    const { id, imageId } = req.params;
    const timestamp = new Date().toISOString();

    if (isNaN(parseInt(id))) {
      return sendDefaultImage(res, timestamp, id);
    }

    // Get place data
    const place = await placeModel.getPlaceById(id);

    if (!place) {
      return sendDefaultImage(res, timestamp, id);
    }

    // If specific image ID requested
    if (imageId) {
      try {
        const image = await pool.query(
          'SELECT image_url FROM place_images WHERE id = $1 AND place_id = $2',
          [imageId, id]
        );

        if (image.rows.length > 0 && image.rows[0].image_url) {
          // A 302 with no cache policy is re-requested every time. The destination for a given
          // place/image id is stable, so let the browser remember it.
          res.set('Cache-Control', 'public, max-age=3600');
          return res.redirect(image.rows[0].image_url);
        }
      } catch (err) {
        logger.debug({ err }, 'No specific image row; falling through');
      }
    }

    // Use primary image URL if available
    if (place.primary_image_url) {
      // A 302 with no cache policy is re-requested every time. The destination for a given
      // place/image id is stable, so let the browser remember it.
      res.set('Cache-Control', 'public, max-age=3600');
      return res.redirect(place.primary_image_url);
    }

    // Try to get first available image
    try {
      const fallbackImage = await pool.query(
        'SELECT image_url FROM place_images WHERE place_id = $1 ORDER BY display_order, created_at LIMIT 1',
        [id]
      );

      if (fallbackImage.rows.length > 0 && fallbackImage.rows[0].image_url) {
        // A 302 with no cache policy is re-requested every time. The destination for a given
        // place/image id is stable, so let the browser remember it.
        res.set('Cache-Control', 'public, max-age=3600');
        return res.redirect(fallbackImage.rows[0].image_url);
      }
    } catch (err) {
      logger.debug({ err }, 'No fallback image row available');
    }

    // No image found, return default
    return sendDefaultImage(res, timestamp, id);
  } catch (error) {
    logger.error({ err: error }, 'Error getting place image');
    return sendDefaultImage(res, new Date().toISOString(), req.params.id);
  }
};

const getPlaceImages = async (req, res) => {
  try {
    const { id } = req.params;

    if (isNaN(parseInt(id))) {
      return res.status(400).json({ message: 'Invalid place ID format' });
    }

    const images = await pool.query(
      'SELECT id, place_id, image_url, caption, display_order, created_at FROM place_images WHERE place_id = $1 ORDER BY display_order, created_at',
      [id]
    );

    res.status(200).json(images.rows);
  } catch (error) {
    logger.error({ err: error }, 'Error getting place images');
    res.status(500).json({
      message: 'Error getting place images',
      // Safe by default: only an explicit NODE_ENV=development exposes driver text.
      // The old `=== 'production' ? safe : leak` test leaked whenever NODE_ENV was
      // unset, which is exactly what `npm start` does (SECURITY_AUDIT 10.4).
      error: process.env.NODE_ENV === 'development' ? error.message : 'Server error',
      timestamp: new Date().toISOString()
    });
  }
};

const addPlaceImage = async (req, res) => {
  try {
    const { id } = req.params;
    const { caption } = req.body;

    if (!req.file) {
      return res.status(400).json({ message: 'An image file is required' });
    }

    const place = await placeModel.getPlaceById(id);
    if (!place) {
      return res.status(404).json({ message: 'Place not found' });
    }

    if (!req.file.path || !fs.existsSync(req.file.path)) {
      return res.status(400).json({ message: 'Uploaded file could not be read' });
    }

    // Same folder convention as the primary image, which is what lets destroyPlaceAssets clean up
    // an entire place by prefix without tracking individual ids.
    const result = await uploadImage(req.file.path, {
      folder: `easytrip/places/${id}`,
      public_id: `place_${id}_gallery_${Date.now()}`,
      tags: ['place', `id_${id}`, 'gallery'],
      context: `place_id=${id}|user=${getCurrentUser(req)}`
    });

    // New images go last. COALESCE handles the first image, where MAX over no rows is NULL.
    const inserted = await pool.query(
      `INSERT INTO place_images (place_id, image_url, caption, display_order, created_at)
       VALUES ($1, $2, $3,
               (SELECT COALESCE(MAX(display_order), -1) + 1 FROM place_images WHERE place_id = $1),
               NOW())
       RETURNING id, place_id, image_url, caption, display_order, created_at`,
      [id, result.url, caption?.trim() || null]
    );

    logger.info({ placeId: id, publicId: result.public_id }, 'Gallery image added');
    res.status(201).json(inserted.rows[0]);
  } catch (error) {
    logger.error({ err: error }, 'Error adding gallery image');
    res.status(500).json({ message: 'Error adding gallery image' });
  }
};

/**
 * Remove a gallery image from a place (admin).
 *
 * Deletes the row first, then the remote asset — the row is the source of truth, and an orphaned
 * asset is a storage cost rather than a broken gallery. The reverse order risks destroying an
 * image that is still referenced.
 */

const deletePlaceImage = async (req, res) => {
  try {
    const { id, imageId } = req.params;

    const deleted = await pool.query(
      'DELETE FROM place_images WHERE id = $1 AND place_id = $2 RETURNING image_url',
      [imageId, id]
    );

    if (deleted.rowCount === 0) {
      return res.status(404).json({ message: 'Image not found for this place' });
    }

    const publicId = publicIdFromUrl(deleted.rows[0].image_url);
    if (publicId) {
      const wasRemoved = await destroyImage(publicId);
      logger.debug({ publicId, removed: wasRemoved }, 'Gallery asset cleanup');
    }

    res.status(204).send();
  } catch (error) {
    logger.error({ err: error }, 'Error deleting gallery image');
    res.status(500).json({ message: 'Error deleting gallery image' });
  }
};

module.exports = {
  getPlaceImage,
  getPlaceImages,
  addPlaceImage,
  deletePlaceImage
};
