import { FiChevronRight, FiCompass, FiHeart, FiMapPin, FiStar } from 'react-icons/fi';
import { motion, AnimatePresence } from 'framer-motion';
import { CAROUSEL_VARIANTS } from './homeContent';
import Link from 'next/link';
import { CarouselImage } from './CarouselImage';

export const HeroMobile = ({ home }) => {
  const {
    places,
    currentPlaceIndex,
    autoplay,
    direction,
    likedPlaces,
    isTransitioning,
    carouselRef,
    setAutoplay,
    goToPlace,
    handleDragEnd,
    toggleLike,
    calculateRating,
    error
  } = home;

  return (
    <div className="w-full space-y-6">
      {/* Hero Content - Mobile (Top) */}
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
        className="text-center text-white pt-4"
      >
        <h1 className="text-2xl sm:text-3xl font-extrabold mb-3 leading-tight">
          Discover Your Next
          <span className="block text-primary-300">Adventure</span>
        </h1>

        <p className="text-sm text-gray-200 mb-5 max-w-xs mx-auto leading-relaxed">
          Explore breathtaking destinations with curated recommendations.
        </p>

        <div className="flex flex-col gap-2 max-w-64 mx-auto">
          <Link href="/browse" passHref>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="w-full px-5 py-2.5 bg-primary-600 text-white font-medium rounded-lg shadow-lg hover:bg-primary-700 transition-colors flex items-center justify-center text-sm"
            >
              <FiCompass className="mr-2 h-4 w-4" />
              Explore Now
            </motion.button>
          </Link>
          <Link href="/about" passHref>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="w-full px-5 py-2.5 bg-white/10 backdrop-blur-md border border-white/30 text-white font-medium rounded-lg hover:bg-white/20 transition-colors text-sm"
            >
              Learn More
            </motion.button>
          </Link>
        </div>
      </motion.div>

      {/* Carousel - Mobile (Bottom) */}
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.2 }}
        className="relative pb-12"
      >
        <div
          className="relative h-80 mx-2"
          ref={carouselRef}
          onTouchStart={() => setAutoplay(false)}
          onTouchEnd={() => setTimeout(() => setAutoplay(true), 3000)}
        >
          {error ? (
            <div className="flex h-full items-center justify-center bg-white/10 backdrop-blur-md rounded-xl border border-white/20">
              <div className="text-center text-white p-4">
                <p className="mb-3 text-sm">{error}</p>
                <button
                  onClick={() => window.location.reload()}
                  className="px-3 py-2 bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors text-sm"
                >
                  Try Again
                </button>
              </div>
            </div>
          ) : places.length > 0 ? (
            <>
              {/* Progress Bar */}
              <div className="absolute top-0 left-0 right-0 z-20 h-1 bg-white/20 rounded-t-xl overflow-hidden">
                <motion.div
                  className="h-full bg-gradient-to-r from-blue-500 to-purple-500"
                  initial={{ width: '0%' }}
                  animate={{ width: autoplay && !isTransitioning ? '100%' : '0%' }}
                  transition={{
                    duration: 5,
                    ease: 'linear',
                    repeat: 0
                  }}
                  key={`progress-${currentPlaceIndex}`}
                />
              </div>

              {/* Carousel Container */}
              <div className="relative w-full h-full overflow-hidden rounded-xl">
                <AnimatePresence mode="wait" custom={direction}>
                  <motion.div
                    key={currentPlaceIndex}
                    custom={direction}
                    variants={CAROUSEL_VARIANTS}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={{
                      x: { type: 'spring', stiffness: 300, damping: 30 },
                      opacity: { duration: 0.3 }
                    }}
                    drag="x"
                    dragConstraints={{ left: 0, right: 0 }}
                    dragElastic={0.2}
                    onDragEnd={handleDragEnd}
                    className="absolute w-full h-full"
                  >
                    <div className="bg-white/95 backdrop-blur-md border border-white/30 shadow-2xl h-full rounded-xl overflow-hidden">
                      {/* Image Section - 65% height */}
                      <div className="h-3/5 relative">
                        <CarouselImage place={places[currentPlaceIndex]} isActive={true} />

                        {/* Rating Badge */}
                        <div className="absolute top-2 right-2 bg-white/95 backdrop-blur-sm rounded-full px-2 py-1 flex items-center shadow-lg">
                          <FiStar className="text-yellow-500 mr-1 h-3 w-3" />
                          <span className="text-xs font-medium text-gray-800">
                            {calculateRating(places[currentPlaceIndex])}
                          </span>
                        </div>

                        {/* Like Button */}
                        <motion.button
                          whileHover={{ scale: 1.1 }}
                          whileTap={{ scale: 0.9 }}
                          onClick={(e) => toggleLike(e, places[currentPlaceIndex]?.id)}
                          // Icon-only control: without a name it is announced as just "button" (WCAG
                          // 4.1.2). `aria-pressed` carries the on/off state, which is what a heart
                          // toggle actually is — the same reasoning as IMP-081, applied here.
                          aria-label={
                            likedPlaces.includes(places[currentPlaceIndex]?.id)
                              ? `Remove ${places[currentPlaceIndex]?.name} from your likes`
                              : `Like ${places[currentPlaceIndex]?.name}`
                          }
                          aria-pressed={likedPlaces.includes(places[currentPlaceIndex]?.id)}
                          className={`absolute top-2 left-2 rounded-full backdrop-blur-sm w-11 h-11 flex items-center justify-center shadow-lg transition-colors ${
                            likedPlaces.includes(places[currentPlaceIndex]?.id)
                              ? 'bg-red-500 text-white'
                              : 'bg-white/95 text-gray-700'
                          }`}
                        >
                          <FiHeart
                            className={`h-3 w-3 ${
                              likedPlaces.includes(places[currentPlaceIndex]?.id)
                                ? 'fill-current'
                                : ''
                            }`}
                          />
                        </motion.button>

                        {/* Location Tag */}
                        <div className="absolute bottom-2 left-2 bg-black/60 backdrop-blur-sm rounded-md text-white flex items-center px-2 py-1">
                          <FiMapPin className="mr-1 h-3 w-3" />
                          <span className="text-xs">
                            {places[currentPlaceIndex]?.location || 'Worldwide'}
                          </span>
                        </div>
                      </div>

                      {/* Content Section - 35% height */}
                      <div className="h-2/5 p-3 flex flex-col justify-between bg-white">
                        <div>
                          <h2 className="text-base font-bold text-gray-900 mb-1 line-clamp-1">
                            {places[currentPlaceIndex]?.name}
                          </h2>

                          <p className="text-xs text-gray-600 mb-2 line-clamp-2 leading-relaxed">
                            {places[currentPlaceIndex]?.description ||
                              'Discover this amazing destination.'}
                          </p>

                          {/* Tags */}
                          <div className="flex flex-wrap gap-1 mb-2">
                            {places[currentPlaceIndex]?.tags?.slice(0, 2).map((tag, idx) => (
                              <span
                                key={idx}
                                className="bg-primary-100 text-primary-700 rounded-full px-2 py-0.5 text-xs font-medium"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex justify-between items-center pt-2 border-t border-gray-100">
                          <Link href={`/places/${places[currentPlaceIndex]?.id}`} passHref>
                            <motion.button
                              whileHover={{ scale: 1.05 }}
                              whileTap={{ scale: 0.95 }}
                              className="bg-primary-600 text-white font-medium rounded-md hover:bg-primary-700 px-3 py-1.5 text-xs flex items-center"
                            >
                              View Details
                              <FiChevronRight className="ml-1 h-3 w-3" />
                            </motion.button>
                          </Link>

                          <Link
                            href={`/browse?location=${places[currentPlaceIndex]?.location}`}
                            passHref
                          >
                            {/* `py-1` for a 24px target (`PE-022`, WCAG 2.5.8). `text-xs` with no
                                padding is a 16px box — the twin of "More destinations" in
                                `HeroDesktop`, and the reason the guard measures a phone viewport
                                as well as a desktop one. */}
                            <button className="py-1 text-primary-600 hover:text-primary-800 text-xs underline underline-offset-2">
                              More places
                            </button>
                          </Link>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                </AnimatePresence>
              </div>

              {/* Indicator dots — same `PE-022` fix as `HeroDesktop`, and this is the copy that
                  mattered more: 8x8 targets, on the touch layout. The button is 24x24 per WCAG
                  2.5.8 and the visible dot stays 8x8, so nothing about the design moves. */}
              <div className="absolute -bottom-6 left-0 right-0 flex justify-center">
                {places.map((_, index) => (
                  <motion.button
                    key={index}
                    onClick={() => goToPlace(index)}
                    whileHover={{ scale: 1.2 }}
                    whileTap={{ scale: 0.9 }}
                    className="flex h-6 w-6 items-center justify-center"
                    disabled={isTransitioning}
                    aria-label={`View destination ${index + 1}`}
                  >
                    <span
                      className={`block rounded-full w-2 h-2 transition-all duration-300 ${
                        index === currentPlaceIndex ? 'bg-white scale-125 shadow-lg' : 'bg-white/50'
                      }`}
                    />
                  </motion.button>
                ))}
              </div>
            </>
          ) : (
            <div className="flex h-full items-center justify-center bg-white/10 backdrop-blur-md rounded-xl border border-white/20">
              <p className="text-white/80 text-sm">No destinations available</p>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
};
