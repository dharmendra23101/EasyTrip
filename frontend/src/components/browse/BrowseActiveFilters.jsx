/**
 * The active-filter chips (IMP-070).
 *
 * One removable chip per applied filter, plus the result count and a refresh. The guard is here
 * rather than at the call site so the page reads as a list of sections without a conditional
 * wrapped around one of them.
 */
import { motion, AnimatePresence } from 'framer-motion';
import {
  FiFilter,
  FiSearch,
  FiX,
  FiMapPin,
  FiMap,
  FiFlag,
  FiTag,
  FiCalendar,
  FiStar,
  FiInfo,
  FiRefreshCw
} from 'react-icons/fi';

import { themeOptions, dateOptions } from './browseOptions';

const BrowseActiveFilters = ({
  hasActiveFilters,
  total,
  loading,
  onRefresh: handleRefresh,
  filters,
  setters,
  clearAllFilters
}) => {
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

  if (!hasActiveFilters) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white shadow rounded-lg p-4 mb-6"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-gray-700 mr-2 flex items-center">
          <FiFilter className="mr-1 h-4 w-4 text-primary-600" />
          Active filters:
        </span>

        <AnimatePresence>
          {searchTerm && (
            <motion.span
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.15 } }}
              className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-gray-100 text-gray-800"
            >
              <FiSearch className="mr-1 h-4 w-4" />
              {searchTerm}
              <motion.button
                whileHover={{ scale: 1.2 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => setSearchTerm('')}
                className="ml-1 text-gray-500 hover:text-gray-700"
              >
                <FiX className="h-4 w-4" />
              </motion.button>
            </motion.span>
          )}

          {selectedLocation && (
            <motion.span
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.15 } }}
              className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-gray-100 text-gray-800"
            >
              <FiMapPin className="mr-1 h-4 w-4" />
              {selectedLocation}
              <motion.button
                whileHover={{ scale: 1.2 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => setSelectedLocation('')}
                className="ml-1 text-gray-500 hover:text-gray-700"
              >
                <FiX className="h-4 w-4" />
              </motion.button>
            </motion.span>
          )}

          {selectedDistrict && (
            <motion.span
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.15 } }}
              className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-gray-100 text-gray-800"
            >
              <FiMap className="mr-1 h-4 w-4" />
              District: {selectedDistrict}
              <motion.button
                whileHover={{ scale: 1.2 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => setSelectedDistrict('')}
                className="ml-1 text-gray-500 hover:text-gray-700"
              >
                <FiX className="h-4 w-4" />
              </motion.button>
            </motion.span>
          )}

          {selectedState && (
            <motion.span
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.15 } }}
              className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-gray-100 text-gray-800"
            >
              <FiFlag className="mr-1 h-4 w-4" />
              State: {selectedState}
              <motion.button
                whileHover={{ scale: 1.2 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => setSelectedState('')}
                className="ml-1 text-gray-500 hover:text-gray-700"
              >
                <FiX className="h-4 w-4" />
              </motion.button>
            </motion.span>
          )}

          {selectedThemes.map((theme) => {
            const themeOption = themeOptions.find((t) => t.id === theme);
            return (
              <motion.span
                key={theme}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.15 } }}
                className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-primary-100 text-primary-800"
              >
                {themeOption?.icon && <span className="mr-1">{themeOption.icon}</span>}
                {themeOption?.label || theme}
                <motion.button
                  whileHover={{ scale: 1.2 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => handleThemeToggle(theme)}
                  className="ml-1 text-primary-600 hover:text-primary-800"
                >
                  <FiX className="h-4 w-4" />
                </motion.button>
              </motion.span>
            );
          })}

          {selectedTags.map((tag) => (
            <motion.span
              key={tag}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.15 } }}
              className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800"
            >
              <FiTag className="mr-1 h-4 w-4" />
              {tag}
              <motion.button
                whileHover={{ scale: 1.2 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => handleTagToggle(tag)}
                className="ml-1 text-green-600 hover:text-green-800"
              >
                <FiX className="h-4 w-4" />
              </motion.button>
            </motion.span>
          ))}

          {selectedDate !== 'any' && (
            <motion.span
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.15 } }}
              className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-primary-100 text-primary-800"
            >
              <FiCalendar className="mr-1 h-4 w-4" />
              {dateOptions.find((d) => d.id === selectedDate)?.label || selectedDate}
              <motion.button
                whileHover={{ scale: 1.2 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => setSelectedDate('any')}
                className="ml-1 text-primary-600 hover:text-primary-800"
              >
                <FiX className="h-4 w-4" />
              </motion.button>
            </motion.span>
          )}

          {ratingFilter > 0 && (
            <motion.span
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.15 } }}
              className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-yellow-100 text-yellow-800"
            >
              <FiStar className="mr-1 h-4 w-4" />
              {ratingFilter}+ Stars
              <motion.button
                whileHover={{ scale: 1.2 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => setRatingFilter(0)}
                className="ml-1 text-yellow-600 hover:text-yellow-800"
              >
                <FiX className="h-4 w-4" />
              </motion.button>
            </motion.span>
          )}
        </AnimatePresence>

        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={clearAllFilters}
          className="ml-auto text-sm text-primary-600 hover:text-primary-800 px-3 py-1 bg-primary-50 rounded-full flex items-center"
        >
          <FiX className="mr-1 h-4 w-4" />
          Clear all
        </motion.button>
      </div>

      <div className="mt-2 flex justify-between items-center text-sm text-gray-500">
        <div className="flex items-center">
          <FiInfo className="mr-1 h-4 w-4 text-primary-500" />
          Found {total} {total === 1 ? 'place' : 'places'}
        </div>
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={handleRefresh}
          className="flex items-center text-primary-600 hover:text-primary-800"
          disabled={loading}
        >
          <FiRefreshCw className={`mr-1 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </motion.button>
      </div>
    </motion.div>
  );
};

export default BrowseActiveFilters;
