import {
  FiArrowLeft,
  FiArrowRight,
  FiChevronRight,
  FiCompass,
  FiHeart,
  FiMapPin,
  FiStar
} from 'react-icons/fi';
import { motion, AnimatePresence } from 'framer-motion';
import { CAROUSEL_VARIANTS } from './homeContent';
import Link from 'next/link';
import { CarouselImage } from './CarouselImage';

export const HeroDesktop = ({ home }) => {
  const {
    places,
    currentPlaceIndex,
    autoplay,
    direction,
    likedPlaces,
    isTransitioning,
    carouselRef,
    setAutoplay,
    goToNextPlace,
    goToPrevPlace,
    goToPlace,
    toggleLike,
    calculateRating,
    error
  } = home;

  return (
    <div className="flex items-center justify-between w-full gap-12">
      {/* Left Column - Hero Content */}
      <div className="w-1/2">
        <motion.div
          initial={{ opacity: 0, x: -30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8 }}
          className="text-white max-w-2xl"
        >
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold mb-6 leading-tight">
            Discover Your Next <span className="text-primary-300">Adventure</span>
          </h1>

          <p className="text-lg lg:text-xl text-gray-200 mb-8 max-w-lg leading-relaxed">
            Explore breathtaking destinations with curated recommendations and seamless planning.
          </p>

          <div className="flex gap-4">
            <Link href="/browse" passHref>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className="px-6 py-3 bg-primary-600 text-white font-medium rounded-lg shadow-lg hover:bg-primary-700 transition-colors flex items-center"
              >
                <FiCompass className="mr-2" />
                Explore Now
              </motion.button>
            </Link>

            <Link href="/about" passHref>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className="px-6 py-3 bg-white/10 backdrop-blur-md border border-white/30 text-white font-medium rounded-lg hover:bg-white/20 transition-colors"
              >
                Learn More
              </motion.button>
            </Link>
          </div>
        </motion.div>
      </div>

      {/* Right Column - Carousel */}
      <div className="w-1/2">
        <motion.div
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="relative h-[500px]"
          ref={carouselRef}
          onMouseEnter={() => setAutoplay(false)}
          onMouseLeave={() => setAutoplay(true)}
        >
          {error ? (
            <div className="flex h-full items-center justify-center bg-white/10 backdrop-blur-md rounded-xl border border-white/20">
              <div className="text-center text-white p-4">
                <p className="mb-4 text-sm">{error}</p>
                <button
                  onClick={() => window.location.reload()}
                  className="px-4 py-2 bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors text-sm"
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
                    className="absolute w-full h-full"
                  >
                    <div className="bg-white/95 backdrop-blur-md border border-white/30 shadow-2xl h-full rounded-xl overflow-hidden">
                      {/* Image Section */}
                      <div className="h-3/5 relative">
                        <CarouselImage place={places[currentPlaceIndex]} isActive={true} />

                        {/* Rating Badge */}
                        <div className="absolute top-4 right-4 bg-white/95 backdrop-blur-sm rounded-full px-3 py-1 flex items-center shadow-lg">
                          <FiStar className="text-yellow-500 mr-1 h-4 w-4" />
                          <span className="text-sm font-medium text-gray-800">
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
                          className={`absolute top-4 left-4 rounded-full backdrop-blur-sm w-10 h-10 flex items-center justify-center shadow-lg transition-colors ${
                            likedPlaces.includes(places[currentPlaceIndex]?.id)
                              ? 'bg-red-500 text-white'
                              : 'bg-white/95 text-gray-700'
                          }`}
                        >
                          <FiHeart
                            className={`h-4 w-4 ${
                              likedPlaces.includes(places[currentPlaceIndex]?.id)
                                ? 'fill-current'
                                : ''
                            }`}
                          />
                        </motion.button>

                        {/* Location Tag */}
                        <div className="absolute bottom-4 left-4 bg-black/60 backdrop-blur-sm rounded-lg text-white flex items-center px-3 py-1.5">
                          <FiMapPin className="mr-1.5 h-4 w-4" />
                          <span className="text-sm">
                            {places[currentPlaceIndex]?.location || 'Worldwide'}
                          </span>
                        </div>
                      </div>

                      {/* Content Section */}
                      <div className="h-2/5 p-6 flex flex-col justify-between bg-white">
                        <div>
                          <h2 className="text-2xl font-bold text-gray-900 mb-2 line-clamp-1">
                            {places[currentPlaceIndex]?.name}
                          </h2>

                          <p className="text-gray-600 mb-4 line-clamp-2 leading-relaxed">
                            {places[currentPlaceIndex]?.description ||
                              'Discover this amazing destination with EasyTrip.'}
                          </p>

                          {/* Tags */}
                          <div className="flex flex-wrap gap-2 mb-4">
                            {places[currentPlaceIndex]?.tags?.slice(0, 3).map((tag, idx) => (
                              <span
                                key={idx}
                                className="bg-primary-100 text-primary-700 rounded-full px-3 py-1 text-sm font-medium"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex justify-between items-center pt-4 border-t border-gray-100">
                          <Link href={`/places/${places[currentPlaceIndex]?.id}`} passHref>
                            <motion.button
                              whileHover={{ scale: 1.05 }}
                              whileTap={{ scale: 0.95 }}
                              className="bg-primary-600 text-white font-medium rounded-lg hover:bg-primary-700 px-5 py-2 text-sm flex items-center"
                            >
                              View Details
                              <FiChevronRight className="ml-1 h-4 w-4" />
                            </motion.button>
                          </Link>

                          <Link
                            href={`/browse?location=${places[currentPlaceIndex]?.location}`}
                            passHref
                          >
                            {/* `py-1` for a 24px-tall target (`PE-022`, WCAG 2.5.8). At `text-sm`
                                with no padding this box was 20px, and the exception for links
                                inline in a sentence does not reach it: it sits on its own beside
                                the primary action, which is what makes it a target rather than
                                prose. The underline and colour are untouched. */}
                            <button className="py-1 text-primary-600 hover:text-primary-800 text-sm underline underline-offset-2">
                              More destinations
                            </button>
                          </Link>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                </AnimatePresence>
              </div>

              {/* Navigation Controls */}
              <div className="absolute top-1/2 -translate-y-1/2 w-full flex justify-between px-4 z-10">
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  className="w-12 h-12 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center text-white border border-white/30 shadow-lg transition-all disabled:opacity-50"
                  onClick={goToPrevPlace}
                  aria-label="Previous destination"
                  disabled={isTransitioning}
                >
                  <FiArrowLeft className="h-5 w-5" />
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  className="w-12 h-12 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center text-white border border-white/30 shadow-lg transition-all disabled:opacity-50"
                  onClick={goToNextPlace}
                  aria-label="Next destination"
                  disabled={isTransitioning}
                >
                  <FiArrowRight className="h-5 w-5" />
                </motion.button>
              </div>

              {/* Indicator dots.

                  The button is 24x24 and the dot inside it is 12x12 (`PE-022`). WCAG 2.5.8 sets
                  24x24 CSS px as the minimum target, and these were 12x12 — a quarter of the area,
                  on the control that moves the hero. Growing the *target* rather than the dot keeps
                  the design identical and is what the success criterion actually asks for.

                  `space-x-3` became `space-x-1` so the visible gap is unchanged now that each
                  button carries its own padding. */}
              <div className="absolute -bottom-10 left-0 right-0 flex justify-center space-x-1">
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
                      className={`block rounded-full w-3 h-3 transition-all duration-300 ${
                        index === currentPlaceIndex
                          ? 'bg-white scale-125 shadow-lg'
                          : 'bg-white/50 hover:bg-white/70'
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
        </motion.div>
      </div>
    </div>
  );
};
