/**
 * The mobile filter drawer (IMP-070).
 *
 * Renders the same five filter groups as the desktop sidebar but as a slide-over, with its own
 * search box and an explicit Apply button — on a phone the panel covers the results, so the count
 * at the bottom is the only feedback that a filter did anything.
 *
 * The ids are prefixed `mobile-` because both panels are in the DOM at once at some viewport
 * widths, and two `<label htmlFor>` pairs cannot share an id.
 */
import { motion, AnimatePresence } from 'framer-motion';
import {
  FiFilter,
  FiX,
  FiSearch,
  FiMapPin,
  FiLayers,
  FiCheck,
  FiTag,
  FiCalendar,
  FiStar
} from 'react-icons/fi';

import FilterSection from './FilterSection';
import { themeOptions, dateOptions, fadeInUp, staggerChildren } from './browseOptions';

const BrowseMobileFilters = ({
  open: mobileFiltersOpen,
  onClose,
  isClient,
  total,
  filters,
  setters,
  facets,
  collapsedSections,
  toggleSection,
  clearAllFilters
}) => {
  const setMobileFiltersOpen = onClose;
  const {
    searchTerm,
    location: selectedLocation,
    district: selectedDistrict,
    state: selectedState,
    themes: selectedThemes,
    tags: selectedTags,
    date: selectedDate,
    minRating: ratingFilter
  } = filters;
  const {
    setSearchTerm,
    setSelectedLocation,
    setSelectedDistrict,
    setSelectedState,
    setSelectedDate,
    setRatingFilter,
    handleThemeToggle,
    handleTagToggle
  } = setters;
  const { locations, districts, states, tags } = facets;

  return (
    <AnimatePresence>
      {mobileFiltersOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-40 lg:hidden"
        >
          <div
            className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm"
            onClick={() => setMobileFiltersOpen(false)}
          ></div>

          <motion.div
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed inset-y-0 left-0 z-40 w-full max-w-xs overflow-y-auto bg-white shadow-xl"
          >
            <div className="sticky top-0 z-10 bg-white p-4 flex items-center justify-between border-b border-gray-200">
              <h2 className="text-lg font-medium text-gray-900 flex items-center">
                <FiFilter className="mr-2 text-primary-600" />
                Filters
              </h2>
              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => setMobileFiltersOpen(false)}
                className="bg-white rounded-full p-1 hover:bg-gray-100"
              >
                <FiX className="h-6 w-6 text-gray-500" />
              </motion.button>
            </div>

            <div className="p-4 pb-24" id="filter-panel">
              {/* Search */}
              <div className="mb-6">
                <label
                  htmlFor="mobile-search"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Search
                </label>
                <div className="relative">
                  <input
                    id="mobile-search"
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search places..."
                    aria-label="Search places"
                    className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500"
                  />
                  <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                    <FiSearch className="h-5 w-5 text-gray-400" />
                  </div>
                  {searchTerm && (
                    <button
                      onClick={() => setSearchTerm('')}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
                    >
                      <FiX className="h-5 w-5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Mobile filter sections */}
              <FilterSection
                title="Location"
                icon={<FiMapPin className="text-primary-600" />}
                collapsed={collapsedSections.location}
                onToggle={() => toggleSection('location')}
              >
                <motion.div
                  variants={staggerChildren}
                  initial="hidden"
                  animate="visible"
                  className="space-y-4"
                >
                  <motion.div variants={fadeInUp}>
                    <label
                      htmlFor="mobile-location"
                      className="block text-sm font-medium text-gray-700 mb-1"
                    >
                      Location
                    </label>
                    <select
                      id="mobile-location"
                      value={selectedLocation}
                      onChange={(e) => setSelectedLocation(e.target.value)}
                      className="block w-full border-gray-300 rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500"
                    >
                      <option value="">All Locations</option>
                      {locations.map((loc, index) => (
                        <option key={index} value={loc}>
                          {loc}
                        </option>
                      ))}
                    </select>
                  </motion.div>

                  <motion.div variants={fadeInUp}>
                    <label
                      htmlFor="mobile-district"
                      className="block text-sm font-medium text-gray-700 mb-1"
                    >
                      District
                    </label>
                    <select
                      id="mobile-district"
                      value={selectedDistrict}
                      onChange={(e) => setSelectedDistrict(e.target.value)}
                      className="block w-full border-gray-300 rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500"
                    >
                      <option value="">All Districts</option>
                      {districts.map((district, index) => (
                        <option key={index} value={district}>
                          {district}
                        </option>
                      ))}
                    </select>
                  </motion.div>

                  <motion.div variants={fadeInUp}>
                    <label
                      htmlFor="mobile-state"
                      className="block text-sm font-medium text-gray-700 mb-1"
                    >
                      State
                    </label>
                    <select
                      id="mobile-state"
                      value={selectedState}
                      onChange={(e) => setSelectedState(e.target.value)}
                      className="block w-full border-gray-300 rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500"
                    >
                      <option value="">All States</option>
                      {states.map((state, index) => (
                        <option key={index} value={state}>
                          {state}
                        </option>
                      ))}
                    </select>
                  </motion.div>
                </motion.div>
              </FilterSection>

              <FilterSection
                title="Themes"
                icon={<FiLayers className="text-primary-600" />}
                collapsed={collapsedSections.themes}
                onToggle={() => toggleSection('themes')}
              >
                <div className="grid grid-cols-2 gap-2">
                  {themeOptions.map((theme) => (
                    <motion.button
                      key={theme.id}
                      whileHover={{ scale: 1.03 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => handleThemeToggle(theme.id)}
                      className={`flex items-center px-3 py-2 rounded-md text-sm ${
                        selectedThemes.includes(theme.id)
                          ? 'bg-primary-100 text-primary-800 border border-primary-300'
                          : 'bg-gray-100 text-gray-700 border border-gray-200 hover:bg-gray-200'
                      }`}
                    >
                      <span className="mr-2">{theme.icon}</span>
                      <span className="truncate">{theme.label}</span>
                      {selectedThemes.includes(theme.id) && (
                        <motion.span
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          className="ml-auto"
                        >
                          <FiCheck className="h-4 w-4 text-primary-600" />
                        </motion.span>
                      )}
                    </motion.button>
                  ))}
                </div>
              </FilterSection>

              <FilterSection
                title="Tags"
                icon={<FiTag className="text-primary-600" />}
                collapsed={collapsedSections.tags}
                onToggle={() => toggleSection('tags')}
              >
                <div className="flex flex-wrap gap-2">
                  {tags.slice(0, 20).map((tag, index) => (
                    <motion.button
                      key={index}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => handleTagToggle(tag)}
                      className={`text-sm px-3 py-1 rounded-full ${
                        selectedTags.includes(tag)
                          ? 'bg-primary-100 text-primary-800 border border-primary-300'
                          : 'bg-gray-100 text-gray-700 border border-gray-200 hover:bg-gray-200'
                      }`}
                    >
                      {tag}
                      {selectedTags.includes(tag) && (
                        <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="ml-1">
                          <FiCheck className="inline-block h-3 w-3 text-primary-600" />
                        </motion.span>
                      )}
                    </motion.button>
                  ))}
                </div>
              </FilterSection>

              <FilterSection
                title="Best Time to Visit"
                icon={<FiCalendar className="text-primary-600" />}
                collapsed={collapsedSections.date}
                onToggle={() => toggleSection('date')}
              >
                <div className="grid grid-cols-2 gap-2">
                  {isClient &&
                    dateOptions.map((option) => (
                      <motion.button
                        key={option.id}
                        whileHover={{ scale: 1.03 }}
                        whileTap={{ scale: 0.97 }}
                        onClick={() => setSelectedDate(option.id)}
                        className={`py-2 px-3 rounded-md text-sm flex items-center ${
                          selectedDate === option.id
                            ? 'bg-primary-100 text-primary-800 border border-primary-300'
                            : 'bg-gray-100 text-gray-700 border border-gray-200 hover:bg-gray-200'
                        }`}
                      >
                        <span className="mr-2">{option.icon}</span>
                        <span>{option.label}</span>
                        {selectedDate === option.id && (
                          <motion.span
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            className="ml-auto"
                          >
                            <FiCheck className="h-4 w-4 text-primary-600" />
                          </motion.span>
                        )}
                      </motion.button>
                    ))}
                </div>
              </FilterSection>

              <FilterSection
                title="Rating"
                icon={<FiStar className="text-primary-600" />}
                collapsed={collapsedSections.rating}
                onToggle={() => toggleSection('rating')}
              >
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Minimum Rating
                  </label>
                  <div className="flex items-center justify-between space-x-2">
                    {[0, 1, 2, 3, 4, 5].map((rating) => (
                      <motion.button
                        key={rating}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => setRatingFilter(rating)}
                        className={`flex-1 py-2 flex items-center justify-center rounded-md ${
                          ratingFilter === rating
                            ? 'bg-primary-600 text-white'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      >
                        {rating === 0 ? (
                          <span>Any</span>
                        ) : (
                          <div className="flex items-center">
                            {rating}
                            <FiStar
                              className={`ml-1 h-3 w-3 ${ratingFilter === rating ? 'text-yellow-300' : ''}`}
                            />
                          </div>
                        )}
                      </motion.button>
                    ))}
                  </div>
                </div>
              </FilterSection>

              <div className="sticky bottom-0 bg-white p-4 border-t border-gray-200 mt-6">
                <div className="flex space-x-3">
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={clearAllFilters}
                    className="flex-1 py-2 px-4 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none"
                  >
                    Clear All
                  </motion.button>
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => setMobileFiltersOpen(false)}
                    className="flex-1 bg-primary-600 py-2 px-4 border border-transparent rounded-md text-sm font-medium text-white hover:bg-primary-700 focus:outline-none"
                  >
                    Apply Filters
                  </motion.button>
                </div>

                <div className="mt-3 text-xs text-center text-gray-500">
                  {total} {total === 1 ? 'place' : 'places'} found
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default BrowseMobileFilters;
