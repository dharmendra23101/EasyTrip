/**
 * The desktop filter sidebar (IMP-070).
 *
 * The same five filter groups as the mobile drawer, plus sort, recent searches and the stats card.
 * The two panels are deliberately not one component: they differ in more than layout — the desktop
 * one shows selected values back as chips under each dropdown, caps tags at 15 rather than 20, and
 * applies on change instead of behind an Apply button.
 */
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import BrowseStatsCard from './BrowseStatsCard';
import {
  FiMapPin,
  FiLayers,
  FiTag,
  FiStar,
  FiCheck,
  FiSliders,
  FiClock,
  FiInfo
} from 'react-icons/fi';

import FilterSection from './FilterSection';
import { themeOptions } from './browseOptions';
import AccessFilterSection from './AccessFilterSection';
import SeasonFilterSection from './SeasonFilterSection';

// The single deliberate exception to the one-date-policy rule, and the only one in the app.
// `utils/dateFormat.js` pins the zone to UTC because a *stored* timestamp must read identically for
// everyone. This is the opposite requirement: it is the reader's own "today", so it must follow the
// reader's clock. See the render site for why it is client-only.
const localToday = () =>
  // eslint-disable-next-line no-restricted-syntax -- deliberately the viewer's zone, not UTC
  new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

const BrowseFilterPanel = ({
  currentUser,
  stats,
  total,
  lastUpdated,
  filters,
  setters,
  facets,
  collapsedSections,
  toggleSection,
  clearAllFilters,
  sortOrder,
  setSortOrder,
  recentSearches,
  clearRecentSearches
}) => {
  // Empty on the server and on the first client render, then filled — the standard way to render
  // a client-only value without lying to the hydrator.
  const [today, setToday] = useState('');
  useEffect(() => setToday(localToday()), []);

  const {
    location: selectedLocation,
    district: selectedDistrict,
    state: selectedState,
    themes: selectedThemes,
    tags: selectedTags,
    date: selectedDate,
    minRating: ratingFilter,
    stepFree
  } = filters;
  const {
    setSearchTerm,
    setSelectedLocation,
    setSelectedDistrict,
    setSelectedState,
    setSelectedDate,
    setRatingFilter,
    setStepFree,
    handleThemeToggle,
    handleTagToggle
  } = setters;
  const { locations, districts, states, tags } = facets;

  return (
    <aside className="hidden lg:block">
      <h2 className="sr-only">Filters</h2>

      <div className="bg-white shadow rounded-lg overflow-hidden divide-y divide-gray-200">
        <div className="p-6 pb-0">
          {/* Recent searches */}
          {recentSearches.length > 0 && (
            <div className="mt-2">
              <div className="flex justify-between items-center text-xs text-gray-500 mb-1">
                <span>Recent searches</span>
                <button
                  onClick={clearRecentSearches}
                  className="text-primary-600 hover:text-primary-800"
                >
                  Clear
                </button>
              </div>
              <div className="flex flex-wrap gap-1">
                {recentSearches.slice(0, 3).map((term, idx) => (
                  <button
                    key={idx}
                    onClick={() => setSearchTerm(term)}
                    className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200"
                  >
                    {term}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Desktop filter sections */}
        <div className="p-6">
          <FilterSection
            title="Location Details"
            icon={<FiMapPin className="text-primary-600" />}
            collapsed={collapsedSections.location}
            onToggle={() => toggleSection('location')}
          >
            <div className="space-y-4">
              {/* Location Dropdown */}
              <div>
                <label
                  htmlFor="desktop-location"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Location
                </label>
                <select
                  id="desktop-location"
                  value={selectedLocation}
                  onChange={(e) => setSelectedLocation(e.target.value)}
                  className="block w-full bg-white border border-gray-200 rounded-lg shadow-md hover:shadow-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 px-4 py-2 text-gray-700 text-sm transition-all duration-300 ease-in-out cursor-pointer"
                >
                  <option value="">All Locations</option>
                  {locations.map((loc, index) => (
                    <option key={index} value={loc}>
                      {loc}
                    </option>
                  ))}
                </select>
                {selectedLocation && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    <span className="px-3 py-1 text-sm bg-primary-100 text-primary-700 rounded-full shadow-sm flex items-center gap-1">
                      <FiMapPin className="h-4 w-4" /> {selectedLocation}
                    </span>
                  </div>
                )}
              </div>

              {/* District Dropdown */}
              <div>
                <label
                  htmlFor="desktop-district"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  District
                </label>
                <select
                  id="desktop-district"
                  value={selectedDistrict}
                  onChange={(e) => setSelectedDistrict(e.target.value)}
                  className="block w-full bg-white border border-gray-200 rounded-lg shadow-md hover:shadow-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 px-4 py-2 text-gray-700 text-sm transition-all duration-300 ease-in-out cursor-pointer"
                >
                  <option value="">All Districts</option>
                  {districts.map((district, index) => (
                    <option key={index} value={district}>
                      {district}
                    </option>
                  ))}
                </select>
                {selectedDistrict && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    <span className="px-3 py-1 text-sm bg-primary-100 text-primary-700 rounded-full shadow-sm flex items-center gap-1">
                      <FiMapPin className="h-4 w-4" /> {selectedDistrict}
                    </span>
                  </div>
                )}
              </div>

              {/* State Dropdown */}
              <div>
                <label
                  htmlFor="desktop-state"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  States
                </label>
                <select
                  id="desktop-state"
                  value={selectedState}
                  onChange={(e) => setSelectedState(e.target.value)}
                  className="block w-full bg-white border border-gray-200 rounded-lg shadow-md hover:shadow-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 px-4 py-2 text-gray-700 text-sm transition-all duration-300 ease-in-out cursor-pointer"
                >
                  <option value="">All States</option>
                  {states.map((state, index) => (
                    <option key={index} value={state}>
                      {state}
                    </option>
                  ))}
                </select>
                {selectedState && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    <span className="px-3 py-1 text-sm bg-primary-100 text-primary-700 rounded-full shadow-sm flex items-center gap-1">
                      <FiMapPin className="h-4 w-4" /> {selectedState}
                    </span>
                  </div>
                )}
              </div>
            </div>
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
                    <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="ml-auto">
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
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                {tags.slice(0, 15).map((tag, index) => (
                  <motion.button
                    key={index}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => handleTagToggle(tag)}
                    className={`text-sm px-3 py-1 rounded-full ${
                      selectedTags.includes(tag)
                        ? 'bg-green-100 text-green-800 border border-green-300'
                        : 'bg-gray-100 text-gray-700 border border-gray-200 hover:bg-gray-200'
                    }`}
                  >
                    {tag}
                    {selectedTags.includes(tag) && (
                      <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="ml-1">
                        <FiCheck className="inline h-3 w-3 text-green-600" />
                      </motion.span>
                    )}
                  </motion.button>
                ))}
              </div>

              {tags.length > 15 && (
                <button
                  className="text-sm text-primary-600 hover:text-primary-800"
                  onClick={() => toggleSection('tags')}
                >
                  {collapsedSections.tags ? 'Show all tags' : 'Show fewer tags'}
                </button>
              )}
            </div>
          </FilterSection>

          <SeasonFilterSection
            value={selectedDate}
            onChange={setSelectedDate}
            collapsed={collapsedSections.date}
            onToggle={() => toggleSection('date')}
          />

          <AccessFilterSection
            value={stepFree}
            onChange={setStepFree}
            collapsed={collapsedSections.access}
            onToggle={() => toggleSection('access')}
          />

          <FilterSection
            title="Rating"
            icon={<FiStar className="text-primary-600" />}
            collapsed={collapsedSections.rating}
            onToggle={() => toggleSection('rating')}
          >
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Minimum Rating</label>
              <div className="flex items-center justify-between space-x-2">
                {[0, 1, 2, 3, 4, 5].map((rating) => (
                  <motion.button
                    key={rating}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => setRatingFilter(rating)}
                    className={`flex-1 py-2 flex items-center justify-center rounded-md ${
                      ratingFilter === rating
                        ? 'bg-yellow-100 text-yellow-800 border border-yellow-300'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-200'
                    }`}
                  >
                    {rating === 0 ? (
                      <span>Any</span>
                    ) : (
                      <div className="flex items-center">
                        {rating}
                        <FiStar
                          className={`ml-1 h-3 w-3 ${ratingFilter === rating ? 'text-yellow-500' : ''}`}
                        />
                      </div>
                    )}
                  </motion.button>
                ))}
              </div>

              <div className="mt-4 flex items-center justify-between">
                <div className="flex items-center">
                  {ratingFilter > 0 ? (
                    <div className="flex text-yellow-600">
                      {[...Array(ratingFilter)].map((_, i) => (
                        <FiStar key={i} className="h-4 w-4 fill-current" />
                      ))}
                      {[...Array(5 - ratingFilter)].map((_, i) => (
                        <FiStar key={i} className="h-4 w-4 text-gray-300" />
                      ))}
                    </div>
                  ) : (
                    <span className="text-sm text-gray-500">Any rating</span>
                  )}
                </div>

                {ratingFilter > 0 && (
                  <button
                    onClick={() => setRatingFilter(0)}
                    className="text-sm text-primary-600 hover:text-primary-800"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          </FilterSection>
        </div>

        {/* Sort options */}
        <div className="p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-3 flex items-center">
            <FiSliders className="mr-2 text-primary-600" />
            Sort By
          </h3>
          <div className="space-y-2">
            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={() => setSortOrder('newest')}
              className={`flex items-center justify-between w-full py-2 px-3 rounded-md ${
                sortOrder === 'newest'
                  ? 'bg-primary-100 text-primary-800'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              <span className="flex items-center">
                <FiClock className="mr-2 h-4 w-4" />
                Newest First
              </span>
              {sortOrder === 'newest' && (
                <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }}>
                  <FiCheck className="h-4 w-4" />
                </motion.span>
              )}
            </motion.button>

            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={() => setSortOrder('rating')}
              className={`flex items-center justify-between w-full py-2 px-3 rounded-md ${
                sortOrder === 'rating'
                  ? 'bg-primary-100 text-primary-800'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              <span className="flex items-center">
                <FiStar className="mr-2 h-4 w-4" />
                Highest Rated
              </span>
              {sortOrder === 'rating' && (
                <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }}>
                  <FiCheck className="h-4 w-4" />
                </motion.span>
              )}
            </motion.button>

            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={() => setSortOrder('name')}
              className={`flex items-center justify-between w-full py-2 px-3 rounded-md ${
                sortOrder === 'name'
                  ? 'bg-primary-100 text-primary-800'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              <span className="flex items-center">
                <FiInfo className="mr-2 h-4 w-4" />
                Alphabetical
              </span>
              {sortOrder === 'name' && (
                <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }}>
                  <FiCheck className="h-4 w-4" />
                </motion.span>
              )}
            </motion.button>
          </div>
        </div>

        {/* Clear filters */}
        <div className="p-6">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={clearAllFilters}
            className="w-full py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none transition-colors"
          >
            Clear All Filters
          </motion.button>

          <div className="mt-4 text-xs text-center text-gray-500">
            <div className="flex items-center justify-center">
              <FiClock className="mr-1 h-3 w-3" />
              {/*
                Today's date, from the *viewer's* clock — which is the one thing on this page that
                genuinely has no server-side answer. Rendering it during SSR produced markup the
                browser then disagreed with whenever the two straddled midnight (guaranteed, not
                rare, for anyone far enough behind UTC late in the day): a hydration mismatch for
                a decoration. It is filled in after mount instead, so the server renders nothing
                and there is nothing to disagree about.

                Deliberately NOT routed through `utils/dateFormat.js`, and the one place in the
                app allowed to format a date itself: those helpers pin the zone to UTC on purpose,
                because a *stored* timestamp must read the same for everyone. This is the opposite
                requirement — it must read as the reader's own today.
              */}
              <span>{today}</span>
            </div>
          </div>
        </div>
      </div>

      <BrowseStatsCard
        stats={stats}
        total={total}
        currentUser={currentUser}
        lastUpdated={lastUpdated}
      />
    </aside>
  );
};

export default BrowseFilterPanel;
