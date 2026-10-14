/**
 * The results column: header, the four display states, and the three view modes (IMP-070).
 *
 * The map is loaded with `ssr: false` because Leaflet reaches for `window` at import time, so a
 * static import takes down the whole server render of a page that is otherwise fully server-rendered
 * (IMP-040).
 *
 * The four states are ordered deliberately: initial load, then error, then empty, then results. An
 * error must win over "no places found" — telling someone their filters matched nothing when the
 * request actually failed sends them off adjusting filters that were never applied.
 */
import dynamic from 'next/dynamic';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FiSliders,
  FiChevronDown,
  FiRefreshCw,
  FiMinimize2,
  FiMaximize2,
  FiAlertCircle,
  FiCheck,
  FiSearch,
  FiMapPin,
  FiX,
  FiLoader
} from 'react-icons/fi';

import PlaceCard from '../PlaceCard';
import LoadingSpinner from '../LoadingSpinner';
import PlaceListItem from './PlaceListItem';
import { viewModes, sortOptions, fadeInUp, staggerChildren } from './browseOptions';

// Dynamically import the map component
const ExploreMap = dynamic(() => import('../ExploreMap'), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full bg-gray-100 animate-pulse flex items-center justify-center">
      <div className="text-center">
        <FiLoader className="h-8 w-8 text-gray-400 animate-spin mx-auto mb-2" />
        <p className="text-gray-400">Loading Map...</p>
      </div>
    </div>
  )
});

const BrowseResults = ({
  places,
  total,
  loading,
  initialLoading,
  loadingMore,
  hasMore,
  error,
  onRefresh: handleRefresh,
  onLoadMore: loadMore,
  loadMoreRef,
  viewMode,
  setViewMode,
  sortOrder,
  setSortOrder,
  canSortByRelevance,
  showSortMenu,
  setShowSortMenu,
  mapFullscreen,
  setMapFullscreen,
  mapPlaces,
  mapLoading,
  hasActiveFilters,
  clearAllFilters,
  handleTagToggle
}) => (
  <div className="mt-6 lg:mt-0 lg:col-span-3">
    {/* Desktop results header: result count + view toggle. The search input that used to
                                sit here duplicated the hero search above it (IMP-029). */}
    <div className="hidden md:flex justify-between items-center mb-6 bg-white shadow-lg rounded-xl p-6 border border-gray-100">
      <div className="flex-1 max-w-md relative">
        <div className="text-sm text-gray-500">
          {total} {total === 1 ? 'place' : 'places'} found
        </div>
      </div>

      <div className="flex items-center ml-6 space-x-4">
        {/* View Mode Toggle */}
        <div className="flex items-center bg-gray-100 rounded-xl p-1">
          {viewModes.map((mode) => (
            <motion.button
              key={mode.id}
              whileTap={{ scale: 0.95 }}
              onClick={() => setViewMode(mode.id)}
              className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                viewMode === mode.id
                  ? 'bg-white text-primary-600 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
              title={mode.description}
            >
              <span className="text-lg">{mode.icon}</span>
              <span className="hidden lg:inline">{mode.label}</span>
            </motion.button>
          ))}
        </div>

        {/* Sort Dropdown */}
        <div className="relative">
          <motion.button
            whileTap={{ scale: 0.95 }}
            className="flex items-center space-x-2 bg-white px-4 py-3 border-2 border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition-all shadow-sm"
            onClick={() => setShowSortMenu(!showSortMenu)}
          >
            <FiSliders className="h-4 w-4" />
            <span>Sort: {sortOptions.find((s) => s.id === sortOrder)?.label}</span>
            <FiChevronDown
              className={`h-4 w-4 transition-transform ${showSortMenu ? 'rotate-180' : ''}`}
            />
          </motion.button>

          <AnimatePresence>
            {showSortMenu && (
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.95 }}
                transition={{ type: 'spring', damping: 20, stiffness: 300 }}
                className="absolute right-0 mt-2 w-56 bg-white shadow-xl rounded-xl py-2 z-20 border border-gray-100"
              >
                {/* "Best Match" is offered only while a search term exists: without one the
                    server ranks every row identically and resolves the sort back to `newest`,
                    so listing it here would let the user pick an order that does not run. */}
                {sortOptions
                  .filter((option) => option.id !== 'relevance' || canSortByRelevance)
                  .map((option) => (
                    <button
                      key={option.id}
                      onClick={() => {
                        setSortOrder(option.id);
                        setShowSortMenu(false);
                      }}
                      className={`flex items-center justify-between px-4 py-3 text-sm w-full text-left transition-colors ${
                        sortOrder === option.id
                          ? 'bg-primary-50 text-primary-700'
                          : 'text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center">
                        <span className="mr-3">{option.icon}</span>
                        <span>{option.label}</span>
                      </div>
                      {sortOrder === option.id && <FiCheck className="h-4 w-4 text-primary-600" />}
                    </button>
                  ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Refresh Button */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={handleRefresh}
          aria-label="Refresh results"
          className={`p-3 border-2 border-gray-200 rounded-xl text-gray-700 hover:bg-gray-50 transition-all shadow-sm ${
            loading ? 'animate-pulse' : ''
          }`}
          disabled={loading}
          title="Refresh places"
        >
          <FiRefreshCw className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} />
        </motion.button>

        {/* Map Fullscreen Toggle (only show when in map mode) */}
        {viewMode === 'map' && (
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setMapFullscreen(!mapFullscreen)}
            className="p-3 border-2 border-gray-200 rounded-xl text-gray-700 hover:bg-gray-50 transition-all shadow-sm"
            title={mapFullscreen ? 'Exit fullscreen' : 'Fullscreen map'}
          >
            {mapFullscreen ? (
              <FiMinimize2 className="h-5 w-5" />
            ) : (
              <FiMaximize2 className="h-5 w-5" />
            )}
          </motion.button>
        )}
      </div>
    </div>

    {/* Places display with enhanced views */}
    {initialLoading ? (
      <div className="flex flex-col items-center justify-center py-32 bg-white rounded-xl shadow-lg">
        <LoadingSpinner size="large" color="primary" />
        <p className="text-xl text-primary-800 mt-6 font-medium">Loading amazing destinations...</p>
        <p className="text-sm text-gray-500 mt-2">
          Discovering perfect places for your next adventure
        </p>
      </div>
    ) : error ? (
      <div className="bg-white rounded-xl shadow-lg p-8 text-center">
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', damping: 20 }}
        >
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-100 text-red-600 mb-4">
            <FiAlertCircle className="h-8 w-8" />
          </div>
          <h3 className="text-lg font-medium text-red-600 mb-2">{error}</h3>
          <p className="text-gray-500 mb-4">Something went wrong while loading places.</p>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleRefresh}
            className="inline-flex items-center px-6 py-3 border border-transparent rounded-xl shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 transition-colors"
          >
            <FiRefreshCw className="mr-2 h-5 w-5" />
            Try Again
          </motion.button>
        </motion.div>
      </div>
    ) : places.length === 0 ? (
      <div className="bg-white rounded-xl shadow-lg p-8 text-center">
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', damping: 20 }}
        >
          <div className="mx-auto w-16 h-16 text-gray-400 mb-4">
            <FiSearch className="w-full h-full" />
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">No places found</h3>
          <p className="text-gray-500 mb-6">Try adjusting your filters or search criteria.</p>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={clearAllFilters}
            className="inline-flex items-center px-6 py-3 border border-transparent rounded-xl shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 transition-colors"
          >
            Clear All Filters
          </motion.button>
        </motion.div>
      </div>
    ) : (
      <div className="space-y-6">
        {/* Map View */}
        {viewMode === 'map' && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className={`bg-white rounded-xl shadow-lg overflow-hidden ${
              mapFullscreen ? 'fixed inset-4 z-50' : 'h-96 sm:h-[500px] lg:h-[600px]'
            }`}
          >
            <div className="h-full relative">
              <ExploreMap places={mapPlaces} className="h-full w-full rounded-xl" />

              {/* Map overlay with place count. Markers are their
                                                    own request, so this reports its own state
                                                    rather than borrowing the grid's. */}
              <div className="absolute top-4 left-4 bg-white/90 backdrop-blur-sm rounded-lg px-4 py-2 shadow-lg">
                <div className="flex items-center text-sm font-medium text-gray-700">
                  <FiMapPin className="h-4 w-4 mr-2 text-primary-600" />
                  {mapLoading
                    ? 'Loading places…'
                    : `${mapPlaces.length} ${mapPlaces.length === 1 ? 'place' : 'places'}`}
                </div>
              </div>

              {/* Close fullscreen button */}
              {mapFullscreen && (
                <button
                  onClick={() => setMapFullscreen(false)}
                  className="absolute top-4 right-4 bg-white/90 backdrop-blur-sm rounded-lg p-2 shadow-lg hover:bg-white transition-colors"
                >
                  <FiX className="h-6 w-6 text-gray-700" />
                </button>
              )}
            </div>
          </motion.div>
        )}

        {/* Grid View */}
        {/*
                                        No `LayoutGroup` and no `layout` prop (IMP-045). Layout
                                        animation makes Framer measure the bounding box of every
                                        participating element on each list change, so a filter
                                        toggle forced a synchronous layout read across the whole
                                        grid — the most expensive thing on the page, spent
                                        animating cards between positions nobody was tracking.
                                        The entrance fade stays; it costs nothing to measure.
                                    */}
        {viewMode === 'grid' && (
          <motion.div
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6"
            variants={staggerChildren}
            initial="hidden"
            animate="visible"
          >
            {places.map((place, index) => (
              <motion.div
                key={place.id}
                variants={fadeInUp}
                initial="hidden"
                animate="visible"
                transition={{
                  duration: 0.4,
                  delay: (index % 3) * 0.1
                }}
              >
                <PlaceCard place={place} priority={index < 6} />
              </motion.div>
            ))}
          </motion.div>
        )}

        {/* List View */}
        {viewMode === 'list' && (
          <motion.div className="space-y-6">
            {places.map((place, index) => (
              <PlaceListItem
                key={place.id}
                place={place}
                index={index}
                handleTagToggle={handleTagToggle}
              />
            ))}
          </motion.div>
        )}

        {/* Load more. The next page is a request now rather than a
                                        slice of memory, so the button has to report that it is
                                        working and refuse a second click while it does. */}
        {hasMore && viewMode !== 'map' && (
          <div ref={loadMoreRef} className="flex justify-center py-8">
            <motion.button
              whileHover={loadingMore ? undefined : { scale: 1.05 }}
              whileTap={loadingMore ? undefined : { scale: 0.95 }}
              onClick={loadMore}
              disabled={loadingMore}
              aria-busy={loadingMore}
              className="inline-flex items-center px-8 py-4 border border-gray-300 rounded-xl shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 transition-colors disabled:opacity-60 disabled:cursor-wait"
            >
              <span>{loadingMore ? 'Loading…' : 'Load More Places'}</span>
              {loadingMore ? (
                <FiLoader className="ml-2 h-4 w-4 animate-spin" />
              ) : (
                <FiChevronDown className="ml-2 h-4 w-4" />
              )}
            </motion.button>
          </div>
        )}

        {/* Results count */}
        {viewMode !== 'map' && (
          <div className="text-center text-sm text-gray-500 bg-white rounded-xl py-4 shadow-sm">
            Showing {places.length} of {total} results
            {hasActiveFilters && (
              <span className="ml-2">
                •{' '}
                <button
                  onClick={clearAllFilters}
                  className="text-primary-600 hover:text-primary-800 underline"
                >
                  Clear filters
                </button>
              </span>
            )}
          </div>
        )}
      </div>
    )}
  </div>
);

export default BrowseResults;
