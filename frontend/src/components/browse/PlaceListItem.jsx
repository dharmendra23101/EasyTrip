/**
 * One place as a list row (IMP-070).
 *
 * The list view is not the grid view with different CSS: it shows the description, the tag list,
 * the created date and the review count, none of which `PlaceCard` renders. Extracted from
 * `browse.jsx` where it was 130 lines inline inside a `.map()`.
 */
import { useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { FiStar, FiMapPin, FiClock, FiMessageCircle, FiArrowRight, FiLoader } from 'react-icons/fi';

import { getPlaceThumbnailUrl } from '../../utils/placeImage';
import { formatAverageRating, hasRating } from '../../utils/rating';
import { themeOptions } from './browseOptions';
import { formatDateShort } from '../../utils/dateFormat';

const EnhancedImage = ({ place, priority = false }) => {
  const [status, setStatus] = useState('loading');
  const fallbackImage = '/images/placeholder.jpg';

  // The API returns an absolute CDN url or null, so the proxy fallback is gone (IMP-037), and
  // with it the `?t=${Date.now()}` cache-buster — it ran on every render, not just in
  // development builds as intended, so each re-render produced a new URL and re-fetched.
  // Card-sized delivery transform: never pull the full-resolution original into a ~400px slot.
  // The second rung used to read `place.image_url`, which is a place_images column and is never
  // present on a place row — so a place whose only image was in the gallery fell through to the
  // placeholder even though the API had resolved it into `fallback_image_url` (IMP-037/IMP-073).
  const getImageUrl = () => getPlaceThumbnailUrl(place, fallbackImage);

  return (
    <div className="w-full h-full relative">
      {/* Loading state */}
      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-100 animate-pulse">
          <FiLoader className="h-8 w-8 text-gray-400 animate-spin" />
        </div>
      )}

      {/* Actual image */}
      <img
        src={getImageUrl()}
        alt={place.name}
        className={`w-full h-full object-cover transition-opacity duration-500 ${status === 'loaded' ? 'opacity-100' : 'opacity-0'}`}
        onLoad={() => setStatus('loaded')}
        onError={() => {
          setStatus('error');
        }}
        loading={priority ? 'eager' : 'lazy'}
      />

      {/* Error fallback */}
      {status === 'error' && (
        <img
          src={fallbackImage}
          alt="Placeholder"
          className="w-full h-full object-cover"
          loading="lazy"
        />
      )}
    </div>
  );
};

const PlaceListItem = ({ place, index, handleTagToggle }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{
      duration: 0.4,
      delay: (index % 5) * 0.05
    }}
    whileHover={{ y: -4 }}
    className="bg-white rounded-xl shadow-lg overflow-hidden flex flex-col sm:flex-row hover:shadow-xl transition-all duration-300"
  >
    {/* List view image */}
    <div className="sm:w-1/3 h-48 sm:h-auto relative">
      <EnhancedImage place={place} priority={index < 3} />

      {/* Rating badge */}
      {hasRating(place) && (
        <div className="absolute top-3 right-3 bg-yellow-500/90 text-white px-3 py-1 rounded-full text-sm flex items-center backdrop-blur-sm shadow-md">
          <FiStar className="mr-1 h-4 w-4" />
          {formatAverageRating(place)}
        </div>
      )}

      {/* Themes badges */}
      {place.themes && place.themes.length > 0 && (
        <div className="absolute top-3 left-3 flex flex-wrap gap-1">
          {place.themes.slice(0, 2).map((theme) => {
            const themeOption = themeOptions.find((t) => t.id === theme);
            return (
              <span
                key={theme}
                className={`inline-flex items-center text-white text-xs px-2 py-1 rounded-full backdrop-blur-sm shadow-sm ${
                  themeOption?.bgColor || 'bg-gray-500'
                }`}
              >
                {themeOption?.icon && <span className="mr-1">{themeOption.icon}</span>}
                {themeOption?.label || theme}
              </span>
            );
          })}
          {place.themes.length > 2 && (
            <span className="inline-block px-2 py-1 text-xs font-medium rounded-full bg-gray-700/80 text-white backdrop-blur-sm shadow-sm">
              +{place.themes.length - 2}
            </span>
          )}
        </div>
      )}
    </div>

    <div className="p-6 flex-1 flex flex-col">
      <div className="flex-1">
        <h3 className="text-xl font-bold text-gray-900 mb-2 flex items-start">
          <Link
            href={`/places/${place.id}`}
            className="hover:text-primary-600 transition-colors group flex-1"
          >
            <span className="group-hover:underline">{place.name}</span>
          </Link>
          {(place.district || place.state) && (
            <span className="ml-2 text-sm font-normal text-gray-500 bg-gray-100 px-2 py-1 rounded-md">
              {place.district && place.state
                ? `${place.district}, ${place.state}`
                : place.district || place.state}
            </span>
          )}
        </h3>

        <div className="flex items-center text-sm text-gray-500 mb-3">
          <FiMapPin className="mr-1 text-primary-500" />
          <span>{place.location}</span>
        </div>

        <p className="text-gray-600 text-sm mb-4 line-clamp-2">
          {place.description || 'No description available.'}
        </p>

        {/* Tags */}
        {place.tags && place.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-4">
            {place.tags.slice(0, 5).map((tag, tagIndex) => (
              <span
                key={tagIndex}
                className="text-xs text-gray-600 bg-gray-100 px-2 py-1 rounded-full hover:bg-gray-200 transition-colors cursor-pointer"
                onClick={() => handleTagToggle(tag)}
              >
                {tag}
              </span>
            ))}
            {place.tags.length > 5 && (
              <span className="text-xs text-primary-600 hover:text-primary-700 cursor-pointer">
                +{place.tags.length - 5} more
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">
        <div className="flex items-center text-xs text-gray-500">
          <FiClock className="mr-1 text-gray-400" />
          <span>{formatDateShort(place.created_at)}</span>
        </div>

        <div className="flex items-center space-x-4">
          {place.rating_count > 0 && (
            <div className="flex items-center text-xs text-gray-500">
              <FiMessageCircle className="mr-1 text-gray-400" />
              <span>
                {place.rating_count} {place.rating_count === 1 ? 'review' : 'reviews'}
              </span>
            </div>
          )}

          <Link
            href={`/places/${place.id}`}
            className="inline-flex items-center text-primary-600 hover:text-primary-800 font-medium transition-colors"
          >
            <span className="hidden sm:inline">View Details</span>
            <FiArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </div>
      </div>
    </div>
  </motion.div>
);

export default PlaceListItem;
