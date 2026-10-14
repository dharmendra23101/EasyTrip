import { memo, useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FiMapPin,
  FiTag,
  FiEye,
  FiCalendar,
  FiStar,
  FiInfo,
  FiClock,
  FiCamera,
  FiLoader,
  FiCheck
} from 'react-icons/fi';

import { getPlaceImageUrl } from '../utils/placeImage';
import { formatAverageRating, getRatingCount, getAverageRating } from '../utils/rating';
import AccessibilityBadge from './AccessibilityBadge';
import { formatRelativeOrShort } from '../utils/dateFormat';

const PlaceCard = ({ place, priority = false }) => {
  const [isHovered, setIsHovered] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const cardRef = useRef(null);
  const defaultImage = '/images/placeholder.jpg';

  /**
   * The clock, read after mount rather than during render (`BUG-059`).
   *
   * `formatDate` below called `Date.now()` while rendering, which made this component's output a
   * function of *when* it rendered. The card is server-rendered on both surfaces that use it and
   * the home page is ISR with `revalidate: 300`, so cached markup could say "Yesterday" where the
   * hydrating browser computed "Today" — the `BUG-044` / `BUG-046` hydration family a third time,
   * on the one axis `IMP-122`'s lint rule cannot cover. Not the locale, not the zone: the clock.
   *
   * `null` until the effect runs, so **the server and the first client render produce identical
   * markup by construction** rather than because a day boundary is unlikely to fall between them.
   *
   * This trades a `react-hooks/purity` violation for a `set-state-in-effect` one, deliberately and
   * favourably: the first is a real hydration hazard, the second is the idiom this codebase already
   * uses in 29 other places (`BL-146`). The visible cost is that a row less than seven days old
   * shows its absolute date for one frame before the relative label replaces it.
   */
  const [now, setNow] = useState(null);
  useEffect(() => setNow(Date.now()), []);

  // Image loading statuses
  const [loadStatus, setLoadStatus] = useState('pending'); // 'pending', 'loading', 'loaded', 'error'

  // Validate place data to prevent errors
  const isValidPlace = place && place.id && place.name;

  // Get proper image URL for main image with optional cache busting in development
  // The API now returns an absolute CDN url or null, so there is no proxy hop left to take
  // (IMP-037). When there is no image, render the local placeholder directly — previously this
  // fell through to `/api/places/:id/image`, which cost three server hops and two database
  // queries only to end up serving that same placeholder.
  //
  // The `?t=${Date.now()}` cache-buster is gone with it. It was meant to be development-only, but
  // it was evaluated on every render, so any re-render produced a new URL and re-downloaded the
  // image — and it made the browser cache useless for the whole session.
  const getImageUrl = () => {
    if (imageError) return defaultImage;
    return getPlaceImageUrl(place, defaultImage);
  };

  // Handle image error with advanced retry logic
  const handleImageError = (e) => {
    console.warn(`Image failed to load for place: ${place.name || 'Unknown'}`);
    setImageError(true);
    setLoadStatus('error');

    if (e && e.target) {
      e.target.src = defaultImage;
    }
  };

  // Handle successful image load
  const handleImageLoad = () => {
    setImageLoaded(true);
    setLoadStatus('loaded');
  };

  // Dates, all of them, from the module that owns dates (`IMP-122`). The relative branch used to
  // live here and read the clock during render; it is now `formatRelativeOrShort`, which takes
  // `now` as an argument and is therefore a pure function that can be tested at a boundary rather
  // than merely near one (`BUG-059`).
  const formatDate = (dateString) => formatRelativeOrShort(dateString, now);

  // Colour coding compares numbers, not strings. The previous version compared the *formatted*
  // value ("4.5" >= 4.5), which JavaScript coerces — so it happened to work, and would have
  // stopped working the moment the format gained a suffix.
  const getRatingDisplay = () => {
    const average = getAverageRating(place);
    if (average === null) return null;

    let colorClass = 'bg-yellow-500';
    if (average >= 4.5) colorClass = 'bg-green-500';
    else if (average < 3) colorClass = 'bg-orange-500';

    return {
      value: formatAverageRating(place),
      count: getRatingCount(place),
      colorClass
    };
  };

  const rating = getRatingDisplay();

  // Intersection Observer to detect when card is visible
  useEffect(() => {
    if (!cardRef.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          setLoadStatus('loading');
          observer.disconnect();
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(cardRef.current);

    return () => observer.disconnect();
  }, []);

  // Shorten long text with ellipsis
  const truncateText = (text, length = 100) => {
    if (!text) return '';
    return text.length > length ? text.substring(0, length) + '...' : text;
  };

  // Render error card if place data is invalid
  if (!isValidPlace) {
    return (
      <motion.div
        className="bg-red-50 rounded-xl shadow-md overflow-hidden h-full p-4 text-red-500"
        whileHover={{ y: -4 }}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <div className="flex items-center justify-center h-60">
          <div className="text-center">
            <FiTag className="h-12 w-12 mx-auto mb-2" />
            <h3 className="text-lg font-medium">Invalid Place Data</h3>
            <p className="text-sm mt-2">Unable to display this destination</p>
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      ref={cardRef}
      className="bg-white rounded-xl shadow-md overflow-hidden h-full transition-all duration-300 group"
      whileHover={{
        y: -8,
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)'
      }}
      onHoverStart={() => setIsHovered(true)}
      onHoverEnd={() => setIsHovered(false)}
      initial={{ opacity: 0, y: 20 }}
      animate={{
        opacity: isVisible ? 1 : 0,
        y: isVisible ? 0 : 20
      }}
      transition={{
        duration: 0.4,
        ease: [0.4, 0, 0.2, 1]
      }}
    >
      <Link href={`/places/${place.id}`} className="block h-full">
        <div className="relative cursor-pointer h-full flex flex-col">
          {/* Image Container */}
          <div className="relative h-60 w-full overflow-hidden">
            {/* Loading State */}
            <AnimatePresence mode="wait">
              {(loadStatus === 'pending' || loadStatus === 'loading') && !imageLoaded && (
                <motion.div
                  className="absolute inset-0 bg-gray-100 flex items-center justify-center z-10"
                  initial={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  <div className="text-center">
                    {loadStatus === 'loading' ? (
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
                      >
                        <FiLoader className="h-8 w-8 text-primary-500 mx-auto" />
                      </motion.div>
                    ) : (
                      <div className="w-full h-48 bg-gradient-to-r from-gray-200 to-gray-300 animate-pulse rounded" />
                    )}
                    <span className="text-xs text-gray-500 mt-2 block">Loading image...</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Main Image */}
            <div className="absolute inset-0 bg-gray-50">
              {isVisible && (
                <img
                  src={getImageUrl()}
                  alt={place.name}
                  className={`w-full h-full object-cover transform transition-all duration-700 ease-out
                    ${isHovered ? 'scale-110' : 'scale-100'}
                    ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
                  onError={handleImageError}
                  onLoad={handleImageLoad}
                  loading={priority ? 'eager' : 'lazy'}
                />
              )}
            </div>

            {/* Gradient Overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/30 to-transparent opacity-80 group-hover:opacity-90 transition-opacity duration-300"></div>

            {/* Main Details */}
            <div className="absolute bottom-0 left-0 right-0 p-4 text-white">
              <h3 className="text-xl font-bold mb-1 line-clamp-1 group-hover:underline decoration-2 underline-offset-2 transition-all">
                {place.name}
              </h3>
              <div className="flex items-center text-sm">
                <FiMapPin className="h-4 w-4 mr-1 flex-shrink-0 text-primary-300" />
                <span className="truncate text-gray-100">
                  {place.location}
                  {place.district && `, ${place.district}`}
                </span>

                {/* Rating Badge */}
                {rating && (
                  <div
                    className={`ml-auto flex items-center ${rating.colorClass} text-white rounded-full px-2 py-0.5 text-xs`}
                  >
                    <FiStar className="mr-1" />
                    <span>{rating.value}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Theme/Tag Badges */}
          {(place.themes || place.tags) && (
            <div className="absolute top-3 left-3 flex flex-wrap gap-1 max-w-[75%] z-10">
              {place.themes && Array.isArray(place.themes) && place.themes.length > 0 ? (
                <>
                  {place.themes.slice(0, 2).map((theme, index) => (
                    <motion.span
                      key={index}
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: index * 0.1 + 0.2 }}
                      className="inline-block px-2 py-1 text-xs font-medium rounded-full bg-primary-500/90 text-white backdrop-blur-sm shadow-md"
                    >
                      {theme}
                    </motion.span>
                  ))}
                  {place.themes.length > 2 && (
                    <motion.span
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: 0.4 }}
                      className="inline-block px-2 py-1 text-xs font-medium rounded-full bg-gray-700/80 text-white backdrop-blur-sm shadow-md"
                    >
                      +{place.themes.length - 2}
                    </motion.span>
                  )}
                </>
              ) : place.tags && Array.isArray(place.tags) && place.tags.length > 0 ? (
                <>
                  {place.tags.slice(0, 2).map((tag, index) => (
                    <motion.span
                      key={index}
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: index * 0.1 + 0.2 }}
                      className="inline-block px-2 py-1 text-xs font-medium rounded-full bg-green-500/90 text-white backdrop-blur-sm shadow-md"
                    >
                      {tag}
                    </motion.span>
                  ))}
                  {place.tags.length > 2 && (
                    <motion.span
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: 0.4 }}
                      className="inline-block px-2 py-1 text-xs font-medium rounded-full bg-gray-700/80 text-white backdrop-blur-sm shadow-md"
                    >
                      +{place.tags.length - 2}
                    </motion.span>
                  )}
                </>
              ) : null}
            </div>
          )}

          {/* Step-free access (`FV-029`). Bottom-left, clear of the theme chips top-left and the
              location badge top-right, and above the gradient so the date stays readable. Renders
              nothing at all for an unsurveyed place — an absent badge means nobody checked, and a
              greyed-out one would read as a verdict. */}
          <div className="absolute bottom-3 left-3 z-20">
            <AccessibilityBadge place={place} />
          </div>

          {/* Location Badge */}
          {(place.state || place.district) && (
            <motion.div
              className="absolute top-3 right-3 z-10"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 }}
            >
              <span className="inline-block px-2 py-1 text-xs font-medium rounded-full bg-blue-500/90 text-white backdrop-blur-sm shadow-md">
                {place.state || place.district}
              </span>
            </motion.div>
          )}

          {/* View Details Button */}
          <motion.div
            className="absolute bottom-3 right-3 z-20"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: isHovered ? 1 : 0, scale: isHovered ? 1 : 0.8 }}
            transition={{ duration: 0.2 }}
          >
            <span className="bg-white shadow-lg text-primary-700 px-3 py-1.5 rounded-full flex items-center justify-center hover:bg-primary-50 transition-colors text-sm font-medium">
              <FiEye className="h-4 w-4 mr-1" />
              View Details
            </span>
          </motion.div>

          {/* Image Load Status Indicator */}
          {loadStatus === 'loaded' && (
            <motion.div
              className="absolute top-3 left-1/2 -translate-x-1/2 z-20"
              initial={{ opacity: 1, y: 0 }}
              animate={{ opacity: 0, y: -10 }}
              transition={{ delay: 1, duration: 0.5 }}
            >
              <span className="inline-flex items-center px-2 py-1 text-xs font-medium rounded-full bg-green-500/90 text-white backdrop-blur-sm">
                <FiCheck className="mr-1" />
                HD Image Loaded
              </span>
            </motion.div>
          )}

          {/* Card Content */}
          <div className="p-5 flex-grow flex flex-col">
            {/* Description */}
            {place.description && (
              <div className="mb-3 flex-grow">
                <p className="text-gray-600 line-clamp-2 text-sm leading-relaxed">
                  {truncateText(place.description, 120)}
                </p>
              </div>
            )}

            {/* Responsive Details Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2 mb-2">
              {/* Custom Keys */}
              {place.custom_keys &&
                typeof place.custom_keys === 'object' &&
                Object.keys(place.custom_keys).length > 0 && (
                  <div className="col-span-1">
                    <h4 className="text-xs font-semibold text-gray-700 mb-1 flex items-center">
                      <FiInfo className="mr-1 text-primary-500" />
                      Details:
                    </h4>
                    <div className="space-y-1">
                      {Object.entries(place.custom_keys)
                        .filter(
                          ([key]) =>
                            !['created_by', 'created_at', 'updated_by', 'updated_at'].includes(key)
                        )
                        .slice(0, 2)
                        .map(([key, value]) => (
                          <div key={key} className="flex text-xs">
                            <span className="font-medium text-gray-700 mr-1">{key}:</span>
                            <span className="text-gray-600 truncate">{value}</span>
                          </div>
                        ))}
                      {Object.keys(place.custom_keys).filter(
                        (key) =>
                          !['created_by', 'created_at', 'updated_by', 'updated_at'].includes(key)
                      ).length > 2 && (
                        <div className="text-xs text-primary-600 font-medium hover:underline cursor-pointer">
                          +
                          {Object.keys(place.custom_keys).filter(
                            (key) =>
                              !['created_by', 'created_at', 'updated_by', 'updated_at'].includes(
                                key
                              )
                          ).length - 2}{' '}
                          more details
                        </div>
                      )}
                    </div>
                  </div>
                )}

              {/* Tags list */}
              {place.tags && Array.isArray(place.tags) && place.tags.length > 0 && (
                <div className="col-span-1">
                  <h4 className="text-xs font-semibold text-gray-700 mb-1 flex items-center">
                    <FiTag className="mr-1 text-primary-500" />
                    Tags:
                  </h4>
                  <div className="flex flex-wrap gap-1">
                    {place.tags.slice(0, 3).map((tag, index) => (
                      <span
                        key={index}
                        className="text-xs text-gray-600 bg-gray-100 px-2 py-0.5 rounded-full hover:bg-gray-200 transition-colors"
                      >
                        {tag}
                      </span>
                    ))}
                    {place.tags.length > 3 && (
                      <span className="text-xs text-primary-600 font-medium hover:underline cursor-pointer">
                        +{place.tags.length - 3} more
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="mt-auto pt-3 border-t border-gray-100 flex flex-wrap justify-between items-center text-xs text-gray-500">
              <div className="flex items-center">
                <FiCalendar className="mr-1 text-gray-500" />
                <span className="whitespace-nowrap">{formatDate(place.created_at)}</span>
              </div>

              {place.updated_at && place.updated_at !== place.created_at && (
                <div className="flex items-center text-xs text-gray-500 mr-2">
                  <FiClock className="mr-1" />
                  <span>Updated {formatDate(place.updated_at)}</span>
                </div>
              )}

              {place.rating_count > 0 ? (
                <div className="flex items-center">
                  <FiStar
                    className={`mr-1 ${rating && parseFloat(rating.value) >= 4 ? 'text-yellow-500' : 'text-gray-500'}`}
                  />
                  <span>
                    {place.rating_count} {place.rating_count === 1 ? 'review' : 'reviews'}
                  </span>
                </div>
              ) : (
                <div className="flex items-center">
                  <FiInfo className="mr-1 text-gray-500" />
                  <span>No reviews yet</span>
                </div>
              )}
            </div>

            {/* Image Status */}
            {place.primary_image_url && (
              <div className="absolute top-1 left-1 z-10">
                <span className="flex items-center text-[10px] bg-white/80 backdrop-blur-sm px-1.5 py-0.5 rounded text-gray-600">
                  <FiCamera className="mr-0.5 h-2.5 w-2.5" />
                  HD
                </span>
              </div>
            )}
          </div>
        </div>
      </Link>
    </motion.div>
  );
};

/**
 * Memoised (IMP-045).
 *
 * The browse grid renders this component once per result, and each instance carries ~11
 * motion elements, an IntersectionObserver and date formatting. Browse holds a lot of state that
 * has nothing to do with any card — hover flags, the sort menu, the loading flag, the filter
 * panel — and every one of those changes re-rendered every visible card, because there was no
 * React.memo anywhere in the codebase.
 *
 * The default shallow comparison is the right one here: `place` is a row object replaced
 * wholesale when the query changes, and the remaining props are primitives.
 */
export default memo(PlaceCard);
