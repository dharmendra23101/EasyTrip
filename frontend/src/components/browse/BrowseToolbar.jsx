/**
 * The narrow-viewport toolbar: open filters, sort, and the grid/list switch (IMP-070).
 *
 * Below `md` the desktop results header is hidden, so this is the only place those three controls
 * exist. It carries the active-filter count because the drawer it opens is closed by default —
 * without the badge there is nothing on screen to say the results are filtered.
 */
import { motion, AnimatePresence } from 'framer-motion';
import { FiFilter, FiSliders, FiGrid, FiList } from 'react-icons/fi';

const BrowseToolbar = ({
  activeFilterCount,
  onOpenFilters,
  sortOrder,
  setSortOrder,
  showSortMenu,
  setShowSortMenu,
  viewMode,
  setViewMode
}) => {
  const setMobileFiltersOpen = onOpenFilters;

  return (
    <div className="md:hidden bg-white shadow rounded-lg mb-6">
      <div className="flex items-center justify-between p-4">
        <div className="flex items-center space-x-2">
          <motion.button
            whileTap={{ scale: 0.95 }}
            type="button"
            className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none"
            onClick={() => setMobileFiltersOpen(true)}
          >
            <FiFilter className="mr-2 h-5 w-5 text-primary-600" />
            Filters
            {activeFilterCount > 0 && (
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="ml-1 bg-primary-100 text-primary-800 rounded-full w-5 h-5 flex items-center justify-center text-xs"
              >
                {activeFilterCount}
              </motion.span>
            )}
          </motion.button>

          <div className="relative">
            <motion.button
              whileTap={{ scale: 0.95 }}
              type="button"
              className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none"
              onClick={() => setShowSortMenu(!showSortMenu)}
            >
              <FiSliders className="mr-2 h-5 w-5 text-primary-600" />
              Sort
            </motion.button>

            <AnimatePresence>
              {showSortMenu && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  className="absolute right-0 mt-2 w-48 bg-white shadow-lg rounded-md py-1 z-10"
                >
                  <button
                    onClick={() => {
                      setSortOrder('newest');
                      setShowSortMenu(false);
                    }}
                    className={`block px-4 py-2 text-sm w-full text-left ${sortOrder === 'newest' ? 'bg-primary-50 text-primary-700' : 'text-gray-700'}`}
                  >
                    Newest First
                  </button>
                  <button
                    onClick={() => {
                      setSortOrder('rating');
                      setShowSortMenu(false);
                    }}
                    className={`block px-4 py-2 text-sm w-full text-left ${sortOrder === 'rating' ? 'bg-primary-50 text-primary-700' : 'text-gray-700'}`}
                  >
                    Highest Rated
                  </button>
                  <button
                    onClick={() => {
                      setSortOrder('name');
                      setShowSortMenu(false);
                    }}
                    className={`block px-4 py-2 text-sm w-full text-left ${sortOrder === 'name' ? 'bg-primary-50 text-primary-700' : 'text-gray-700'}`}
                  >
                    Alphabetical
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={() => setViewMode('grid')}
            className={`p-2 rounded ${
              viewMode === 'grid' ? 'bg-primary-100 text-primary-700' : 'bg-gray-100 text-gray-500'
            }`}
            aria-label="Grid view"
          >
            <FiGrid className="h-5 w-5" />
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={() => setViewMode('list')}
            className={`p-2 rounded ${
              viewMode === 'list' ? 'bg-primary-100 text-primary-700' : 'bg-gray-100 text-gray-500'
            }`}
            aria-label="List view"
          >
            <FiList className="h-5 w-5" />
          </motion.button>
        </div>
      </div>
    </div>
  );
};

export default BrowseToolbar;
