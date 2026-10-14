/**
 * The browse page's hero: search box, search history, theme chips and headline stats (IMP-070).
 *
 * `isClient` gates the theme chips because the selected set is restored from the URL on the
 * client; rendering them on the server too produced a hydration mismatch on any shared filtered
 * link. The stats come from the same server payload as the first page of results, so they render
 * on both sides and are safe.
 */
import { motion, AnimatePresence } from 'framer-motion';
import { FiSearch, FiX, FiClock, FiCheck, FiStar, FiMapPin } from 'react-icons/fi';

import { themeOptions } from './browseOptions';

const BrowseHero = ({ isClient, stats, filters, setters, search }) => {
  const { searchTerm, themes: selectedThemes } = filters;
  const { setSearchTerm, handleThemeToggle } = setters;
  const {
    debouncedSearch,
    searchActive,
    setSearchActive,
    searchInputRef,
    handleSearchFocus,
    recentSearches,
    suggestions = [],
    applySearchSuggestion,
    clearSearchTerm,
    clearAllSearchHistory
  } = search;

  // Matches from the catalogue (IMP-112) and terms this browser has used before are two different
  // kinds of answer, so the panel opens when either has something rather than when history does.
  // Suggestions sit above history: they are about the letters on screen right now, where a recent
  // search is about a different session.
  const showSuggestionPanel = searchActive && (suggestions.length > 0 || recentSearches.length > 0);

  return (
    <div className="relative overflow-hidden">
      {/* Background Image with Overlay */}
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{
          backgroundImage: "url('/images/hero-bg.jpg')"
        }}
      />
      {/* Dark Overlay for better text readability */}
      <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/50 to-black/70" />
      {/* Pattern Overlay */}
      <div className="absolute inset-0 opacity-10">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.4'%3E%3Ccircle cx='30' cy='30' r='2'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`
          }}
        />
      </div>

      <div
        className="relative z-10 py-6 sm:py-8 md:py-10 bg-cover bg-center"
        style={{ backgroundImage: "url('/images/hero-bg.jpg')" }}
      >
        {/* Dark overlay for readability */}
        <div className="absolute inset-0 bg-black/60"></div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-center max-w-4xl mx-auto text-white"
          >
            {/* Heading */}
            <h1 className="text-xl sm:text-2xl md:text-3xl font-bold">
              <span className="block">Discover</span>
              <span className="block bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">
                Amazing Places
              </span>
            </h1>

            {/* Subheading */}
            <p className="mt-2 text-xs sm:text-sm md:text-base text-gray-200 max-w-lg mx-auto leading-snug">
              Explore breathtaking destinations, hidden gems, and unforgettable experiences.
            </p>

            {/* Search bar */}
            <div className="mt-4 max-w-md mx-auto">
              <div className="relative">
                <div className="relative bg-white rounded-md shadow-md border border-gray-200">
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => debouncedSearch(e.target.value)}
                    onFocus={handleSearchFocus}
                    onBlur={() => setTimeout(() => setSearchActive(false), 200)}
                    ref={searchInputRef}
                    placeholder="Search destinations..."
                    aria-label="Search destinations"
                    className="block w-full bg-transparent pl-10 pr-4 py-2 text-sm text-gray-900 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 rounded-md"
                  />
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <FiSearch className="h-4 w-4 text-primary-600" />
                  </div>
                  {searchTerm && (
                    <button
                      onClick={() => setSearchTerm('')}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      <FiX className="h-4 w-4" />
                    </button>
                  )}
                </div>

                {/* Search Suggestions */}
                <AnimatePresence>
                  {showSuggestionPanel && (
                    <motion.div
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      className="absolute z-20 mt-1 w-full bg-white rounded-lg shadow-md border border-gray-200 py-2"
                    >
                      {suggestions.length > 0 && (
                        <div className="border-b border-gray-100 pb-1 mb-1">
                          <div className="px-2 py-1">
                            <h3 className="text-xs font-medium text-gray-700">Places</h3>
                          </div>
                          <ul className="max-h-40 overflow-y-auto">
                            {suggestions.map((place) => (
                              <li key={place.id} className="hover:bg-gray-50">
                                <button
                                  type="button"
                                  className="flex w-full items-center px-3 py-1.5 text-left text-sm text-gray-700"
                                  onClick={() => applySearchSuggestion(place.name)}
                                >
                                  <FiMapPin className="mr-2 h-3 w-3 shrink-0 text-primary-600" />
                                  <span className="truncate">{place.name}</span>
                                  {/* The place name alone is ambiguous across states — two
                                      "Badami"s would be indistinguishable rows. */}
                                  {(place.district || place.state) && (
                                    <span className="ml-2 truncate text-xs text-gray-400">
                                      {[place.district, place.state].filter(Boolean).join(', ')}
                                    </span>
                                  )}
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {recentSearches.length > 0 && (
                        <>
                          <div className="px-2 py-1 border-b border-gray-100">
                            <div className="flex justify-between items-center">
                              <h3 className="text-xs font-medium text-gray-700">Recent Searches</h3>
                              <button
                                onClick={clearAllSearchHistory}
                                className="text-xs text-primary-600 hover:text-primary-800"
                              >
                                Clear All
                              </button>
                            </div>
                          </div>
                          <ul className="max-h-32 overflow-y-auto">
                            {recentSearches.map((term, index) => (
                              <li key={index} className="flex items-center hover:bg-gray-50">
                                <button
                                  type="button"
                                  className="flex flex-1 items-center px-3 py-1 text-gray-600 text-sm text-left"
                                  onClick={() => applySearchSuggestion(term)}
                                >
                                  <FiClock className="h-3 w-3 mr-2 text-gray-400" />
                                  <span>{term}</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => clearSearchTerm(term, e)}
                                  aria-label={`Remove "${term}" from recent searches`}
                                  className="px-3 py-1 text-gray-400 hover:text-gray-600"
                                >
                                  <FiX className="h-3 w-3" />
                                </button>
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* Theme Chips */}
            <div className="mt-4">
              <p className="text-xs text-gray-300 mb-2">Popular Themes</p>
              <div className="flex flex-wrap justify-center gap-2">
                {isClient &&
                  themeOptions.map((theme) => (
                    <motion.button
                      key={theme.id}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => handleThemeToggle(theme.id)}
                      className={`group flex items-center px-3 py-1 rounded-md text-xs font-medium transition-all ${
                        selectedThemes.includes(theme.id)
                          ? `${theme.bgColor} text-white shadow-sm`
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      <span className="mr-1">{theme.icon}</span>
                      <span>{theme.label}</span>
                      {selectedThemes.includes(theme.id) && (
                        <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="ml-1">
                          <FiCheck className="h-3 w-3" />
                        </motion.span>
                      )}
                    </motion.button>
                  ))}
              </div>
            </div>

            {/* Stats Section */}
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.5 }}
              className="mt-6 flex flex-wrap justify-center gap-4"
            >
              <div className="text-center">
                <div className="text-lg font-bold text-primary-400">{stats.totalPlaces}+</div>
                <div className="text-xs text-gray-300">Places</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold text-yellow-400">{stats.avgRating}</div>
                <div className="text-xs text-gray-300 flex items-center justify-center">
                  <FiStar className="h-3 w-3 mr-1" />
                  Avg Rating
                </div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold text-green-400">{stats.locationCount}</div>
                <div className="text-xs text-gray-300">Top Destinations</div>
              </div>
            </motion.div>
          </motion.div>
        </div>
      </div>
    </div>
  );
};

export default BrowseHero;
