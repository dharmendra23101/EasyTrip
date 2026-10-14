/**
 * The slide-over list of places currently on the map (IMP-070).
 *
 * It shows *filtered* places, not *visible* ones, and marks which of them are in the viewport —
 * so panning the map re-labels the rows rather than emptying the list. That distinction is why
 * both `filteredPlaces` and `visiblePlaces` are props: one is the list, the other is a lookup.
 */
import { motion, AnimatePresence } from 'framer-motion';
import {
  FiMapPin,
  FiX,
  FiSearch,
  FiInfo,
  FiEye,
  FiStar,
  FiCheck,
  FiArrowRight
} from 'react-icons/fi';

import {
  formatAverageRating,
  getRatingCount,
  hasRating as placeHasRating
} from '../../utils/rating';
import { sidebarStyles } from './sidebarStyles';

const MapSidebar = ({
  showSidebar,
  setShowSidebar,
  mapLoaded,
  searchQuery,
  setSearchQuery,
  places,
  filteredPlaces,
  visiblePlaces,
  mapMetrics,
  selectedPlace,
  onSelectPlace
}) => (
  <>
    <style jsx>{sidebarStyles}</style>
    {/* Sidebar with place list */}
    <AnimatePresence>
      {showSidebar && mapLoaded && (
        <motion.div
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="map-sidebar"
        >
          <div className="sidebar-header">
            <h3>
              <FiMapPin className="sidebar-icon" />
              Places in View
            </h3>
            <button
              className="close-button"
              onClick={() => setShowSidebar(false)}
              aria-label="Close sidebar"
            >
              <FiX />
            </button>
          </div>

          <div className="sidebar-search">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search places..."
              aria-label="Search places"
              className="sidebar-search-input"
            />
            <FiSearch className="search-icon" />
            {searchQuery && (
              <button
                className="clear-search"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
              >
                <FiX />
              </button>
            )}
          </div>

          <div className="sidebar-stats">
            <div className="stat">
              <span className="stat-label">Visible:</span>
              <span className="stat-value">{visiblePlaces.length}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Total:</span>
              <span className="stat-value">{places.length}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Zoom:</span>
              <span className="stat-value">{mapMetrics.zoom}x</span>
            </div>
          </div>

          <div className="sidebar-places">
            {filteredPlaces.length === 0 ? (
              <div className="no-places">
                <FiInfo className="info-icon" />
                <p>No places match your search</p>
              </div>
            ) : (
              filteredPlaces.map((place) => {
                const isCurrentlySelected = selectedPlace?.id === place.id;
                const isVisible = visiblePlaces.some((p) => p.id === place.id);

                return (
                  <motion.button
                    key={place.id}
                    type="button"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.2 }}
                    className={`place-item ${isCurrentlySelected ? 'selected' : ''} ${isVisible ? 'visible' : 'not-visible'}`}
                    aria-pressed={isCurrentlySelected}
                    onClick={() => onSelectPlace(place)}
                  >
                    <div className="place-icon">
                      {isVisible ? (
                        <FiEye className="visible-icon" />
                      ) : (
                        <FiMapPin className="pin-icon" />
                      )}
                    </div>
                    <div className="place-info">
                      <h4>{place.name}</h4>
                      <p>
                        {place.location}
                        {place.district ? `, ${place.district}` : ''}
                      </p>
                      {placeHasRating(place) && (
                        <div className="place-rating">
                          <FiStar className="star-icon" />
                          <span>{formatAverageRating(place)}</span>
                          <span className="review-count">({getRatingCount(place)})</span>
                        </div>
                      )}
                    </div>
                    <div className="place-actions">
                      {isCurrentlySelected ? (
                        <FiCheck className="check-icon" />
                      ) : (
                        <FiArrowRight className="arrow-icon" />
                      )}
                    </div>
                  </motion.button>
                );
              })
            )}
          </div>

          <div className="sidebar-footer">
            <p>
              <FiInfo className="info-icon-small" />
              Click on a place to view details
            </p>
            <p className="attribution">
              <span>Map data © OpenStreetMap</span>
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  </>
);

export default MapSidebar;
