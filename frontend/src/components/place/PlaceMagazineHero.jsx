import { useState, useEffect, useRef } from 'react';
import {
  FiArrowDown,
  FiArrowLeft,
  FiCalendar,
  FiClock,
  FiExternalLink,
  FiHeart,
  FiLink,
  FiMapPin,
  FiShare2,
  FiStar
} from 'react-icons/fi';
import { motion, AnimatePresence, useScroll, useTransform } from 'framer-motion';
import LoadingSpinner from '../LoadingSpinner';
import { useDismissable } from '../../hooks/useDismissable';
import { formatAverageRating } from '../../utils/rating';
import { PLACEHOLDER_IMAGE, getPlaceLargeImageUrl } from '../../utils/placeImage';
import { formatDate } from '../../utils/dateFormat';

// Hero section with cinematic magazine styling
export const PlaceMagazineHero = ({
  place,
  onBack,
  onShare,
  onToggleFavorite,
  isFavorite,
  avgRating,
  onShareSocial
}) => {
  const [shareOpen, setShareOpen] = useState(false);
  const shareRef = useDismissable(shareOpen, () => setShareOpen(false));
  const heroRef = useRef(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [heroHeight, setHeroHeight] = useState('100vh');
  const { scrollY } = useScroll();
  const opacity = useTransform(scrollY, [0, 300], [1, 0]);
  const scale = useTransform(scrollY, [0, 300], [1, 1.1]);
  const titleY = useTransform(scrollY, [0, 300], [0, 100]);

  // Load hero image with JavaScript
  useEffect(() => {
    if (!place || !heroRef.current) return;

    const img = new window.Image();
    const imageUrl = getPlaceLargeImageUrl(place, 1600, PLACEHOLDER_IMAGE);

    img.onload = () => {
      setImageLoaded(true);
      heroRef.current.style.backgroundImage = `url(${imageUrl})`;
    };

    img.onerror = () => {
      heroRef.current.style.backgroundImage = 'linear-gradient(to right, #4b6cb7, #182848)';
      setImageLoaded(true);
    };

    img.src = imageUrl;

    // Adjust hero height based on screen size
    const handleResize = () => {
      if (window.innerWidth < 640) {
        setHeroHeight('85vh');
      } else {
        setHeroHeight('100vh');
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [place]);

  return (
    <motion.div
      ref={heroRef}
      className="relative overflow-hidden"
      style={{
        height: heroHeight,
        backgroundPosition: 'center',
        backgroundSize: 'cover',
        backgroundRepeat: 'no-repeat',
        scale: scale
      }}
    >
      {/* Loading indicator */}
      <AnimatePresence>
        {!imageLoaded && (
          <motion.div
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 flex items-center justify-center bg-gray-900 z-10"
          >
            <div className="text-center">
              <LoadingSpinner size="large" color="white" />
              <p className="mt-4 text-white text-lg font-serif italic">Loading visuals...</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hero overlay with gradient */}
      <motion.div
        style={{ opacity }}
        className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/60 to-black/30 z-10"
      />

      {/* Top navigation bar */}
      <div className="absolute top-0 left-0 right-0 px-6 md:px-12 pt-8 md:pt-10 z-30 flex justify-between items-start">
        <motion.button
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
          onClick={onBack}
          className="bg-white/90 backdrop-blur-md text-gray-900 p-3 rounded-full hover:bg-white shadow-2xl transition-all duration-300 hover:scale-110 border border-white/20"
          aria-label="Go back"
        >
          <FiArrowLeft className="h-6 w-6" />
        </motion.button>

        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="flex space-x-3"
        >
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="relative"
            ref={shareRef}
          >
            {/* Was a CSS `group-hover` disclosure, which does not exist on touch — every mobile
                user and every keyboard user was locked out of sharing entirely (IMP-079). The
                trigger also called onShare() directly, so clicking it copied the link while the
                menu it revealed offered a different set of actions. */}
            <button
              onClick={() => setShareOpen((open) => !open)}
              className="bg-white/90 backdrop-blur-md text-gray-900 p-3 rounded-full hover:bg-white shadow-2xl transition-all duration-300 hover:scale-110 border border-white/20"
              aria-label="Share this place"
              aria-haspopup="menu"
              aria-expanded={shareOpen}
            >
              <FiShare2 className="h-6 w-6 transition-colors" />
            </button>

            {shareOpen && (
              <div
                className="absolute right-0 mt-2 w-56 z-40 origin-top-right"
                role="menu"
                aria-label="Share options"
              >
                <div className="bg-white rounded-xl shadow-2xl border border-gray-100 overflow-hidden">
                  <div className="p-4 border-b border-gray-100">
                    <h3 className="font-serif font-semibold text-gray-900">Share this place</h3>
                  </div>
                  <div className="p-2">
                    {/* Static classes: these were `hover:bg-${color}-50` template literals, which
                        the Tailwind JIT scanner cannot see, so none of those styles were ever
                        generated. */}
                    {[
                      {
                        platform: 'copy',
                        label: 'Copy Link',
                        icon: FiLink,
                        hover: 'hover:bg-gray-50 hover:text-gray-900'
                      },
                      {
                        platform: 'twitter',
                        label: 'Twitter',
                        icon: FiExternalLink,
                        hover: 'hover:bg-sky-50 hover:text-sky-700'
                      },
                      {
                        platform: 'facebook',
                        label: 'Facebook',
                        icon: FiExternalLink,
                        hover: 'hover:bg-primary-50 hover:text-primary-700'
                      },
                      {
                        platform: 'whatsapp',
                        label: 'WhatsApp',
                        icon: FiExternalLink,
                        hover: 'hover:bg-green-50 hover:text-green-700'
                      }
                    ].map(({ platform, label, icon: Icon, hover }) => (
                      <button
                        key={platform}
                        role="menuitem"
                        onClick={() => {
                          setShareOpen(false);
                          return platform === 'copy' ? onShare() : onShareSocial(platform);
                        }}
                        className={`flex items-center w-full text-left px-4 py-3 text-sm text-gray-700 rounded-lg transition-all duration-200 ${hover}`}
                      >
                        <Icon className="mr-3 h-4 w-4" />
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </motion.div>

          <motion.button
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            onClick={onToggleFavorite}
            className={`bg-white/90 backdrop-blur-md p-3 rounded-full hover:bg-white shadow-2xl transition-all duration-300 hover:scale-110 border border-white/20 ${
              isFavorite ? 'text-red-500' : 'text-gray-900 hover:text-red-500'
            }`}
            aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          >
            <motion.div
              animate={{ scale: isFavorite ? [1, 1.2, 1] : 1 }}
              transition={{ duration: 0.3 }}
            >
              <FiHeart className={`h-6 w-6 ${isFavorite ? 'fill-current' : ''}`} />
            </motion.div>
          </motion.button>
        </motion.div>
      </div>

      {/* Magazine-style title overlay - positioned at center */}
      <motion.div
        style={{ y: titleY }}
        className="absolute inset-x-0 bottom-0 top-0 flex flex-col items-center justify-center z-20 text-white px-6 md:px-12"
      >
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, ease: 'easeOut' }}
          className="max-w-4xl mx-auto text-center"
        >
          {/* Magazine-style category label */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="mb-4"
          >
            <span className="inline-block px-3 py-1 border-b-2 border-white/70 text-white/90 text-sm font-semibold tracking-widest uppercase">
              {place.themes?.[0] || 'Featured Destination'}
            </span>
          </motion.div>

          {/* Large title with serif font */}
          <h1 className="font-serif text-5xl md:text-7xl lg:text-8xl font-black mb-6 leading-none tracking-tight text-shadow-2xl">
            {place.name}
          </h1>

          {/* Magazine-style subtitle/deck */}
          <p className="text-xl md:text-2xl font-serif italic text-white/90 max-w-3xl mx-auto mb-8 leading-relaxed">
            {place.description
              ? place.description.length > 120
                ? place.description.substring(0, 120) + '...'
                : place.description
              : `Discover the hidden treasures and unique charm of this captivating destination`}
          </p>

          {/* Location and ratings line */}
          <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-4 text-lg">
            <motion.div
              className="flex items-center bg-black/40 backdrop-blur-sm px-4 py-2 rounded-full border border-white/20"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.4 }}
            >
              <FiMapPin className="mr-2 h-5 w-5" />
              <span className="font-medium">
                {place.location}
                {place.district && `, ${place.district}`}
                {place.state && `, ${place.state}`}
              </span>
            </motion.div>

            {avgRating > 0 && (
              <motion.div
                className="flex items-center bg-black/40 backdrop-blur-sm px-4 py-2 rounded-full border border-white/20"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.5 }}
              >
                <FiStar className="mr-2 h-5 w-5 text-yellow-400 fill-current" />
                <span className="font-medium">
                  {formatAverageRating(place)} ({place.rating_count}{' '}
                  {place.rating_count === 1 ? 'review' : 'reviews'})
                </span>
              </motion.div>
            )}
          </div>

          {/* Scroll down indicator */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.7, duration: 0.5 }}
            className="absolute bottom-16 left-1/2 transform -translate-x-1/2"
          >
            <motion.div
              animate={{ y: [0, 10, 0] }}
              transition={{ repeat: Infinity, duration: 1.5 }}
              className="flex flex-col items-center"
            >
              <span className="text-sm font-medium mb-2 text-white/80">Discover More</span>
              <FiArrowDown className="h-6 w-6 text-white/80" />
            </motion.div>
          </motion.div>
        </motion.div>
      </motion.div>

      {/* Editorial information line */}
      <div className="absolute bottom-0 left-0 right-0 py-4 px-6 z-20 text-white/60 flex justify-between text-xs bg-gradient-to-t from-black to-transparent">
        <div className="flex items-center">
          <FiCalendar className="mr-1 h-3 w-3" />
          <span>Published: {formatDate(place.created_at) || 'September 2025'}</span>
        </div>
        {place.updated_at && (
          <div className="hidden md:flex items-center">
            <FiClock className="mr-1 h-3 w-3" />
            <span>Updated: {formatDate(place.updated_at)}</span>
          </div>
        )}
      </div>
    </motion.div>
  );
};
