import { FiFilter, FiSearch } from 'react-icons/fi';

export const ManagePlacesFilters = ({ manage }) => {
  const {
    searchTerm,
    selectedLocation,
    locations,
    showFilters,
    setSearchTerm,
    setSelectedLocation,
    setShowFilters
  } = manage;

  return (
    <div className="bg-white shadow-sm rounded-xl border border-gray-200 mb-6 overflow-hidden">
      <div className="p-4 sm:p-6">
        {/* Search Bar */}
        <div className="relative mb-4">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <FiSearch className="h-5 w-5 text-gray-500" />
          </div>
          <input
            type="text"
            className="block w-full pl-10 pr-3 py-3 border border-gray-300 rounded-xl leading-5 bg-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-sm sm:text-base"
            placeholder="Search places..."
            aria-label="Search places"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        {/* Filter Toggle for Mobile */}
        <div className="flex items-center justify-between sm:hidden mb-4">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center text-gray-600 hover:text-gray-900 text-sm"
          >
            <FiFilter className="mr-2 h-4 w-4" />
            Filters
          </button>
          {selectedLocation && (
            <span className="text-xs text-primary-600 bg-primary-50 px-2 py-1 rounded-full">
              {selectedLocation}
            </span>
          )}
        </div>

        {/* Filters */}
        <div className={`${showFilters ? 'block' : 'hidden'} sm:block`}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label htmlFor="location" className="block text-sm font-medium text-gray-700 mb-2">
                Filter by Location
              </label>
              <select
                id="location"
                className="block w-full border border-gray-300 rounded-lg py-2 px-3 bg-white focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-sm"
                value={selectedLocation}
                onChange={(e) => setSelectedLocation(e.target.value)}
              >
                <option value="">All Locations</option>
                {locations.map((location, index) => (
                  <option key={index} value={location}>
                    {location}
                  </option>
                ))}
              </select>
            </div>

            {/* Clear Filters */}
            {(searchTerm || selectedLocation) && (
              <div className="flex items-end">
                <button
                  onClick={() => {
                    setSearchTerm('');
                    setSelectedLocation('');
                    setShowFilters(false);
                  }}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Clear Filters
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
