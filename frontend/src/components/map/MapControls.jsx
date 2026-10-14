/**
 * Everything overlaid on the map: search, sidebar toggle, basemap switcher, cluster toggle,
 * fullscreen, the live counters, zoom and locate (IMP-070).
 *
 * Rendered only once the map is ready — every control here acts on a map instance, and offering
 * them before one exists means buttons that silently do nothing.
 *
 * Zoom and locate arrive as callbacks rather than a map ref. The controls describe what the user
 * asked for; `ExploreMap` owns the instance that can carry it out.
 */
import { motion, AnimatePresence } from 'framer-motion';
import {
  FiSearch,
  FiX,
  FiChevronRight,
  FiChevronLeft,
  FiLayers,
  FiCheck,
  FiMinimize2,
  FiMaximize2,
  FiMapPin,
  FiTarget,
  FiPlus,
  FiMinus,
  FiCrosshair
} from 'react-icons/fi';

import { TILE_LAYERS } from './tileLayers';
import { controlsStyles } from './controlsStyles';

const MapControls = ({
  mapLoaded,
  searchQuery,
  setSearchQuery,
  showSidebar,
  setShowSidebar,
  showLayers,
  setShowLayers,
  tileLayer,
  setTileLayer,
  clusterMode,
  setClusterMode,
  isFullscreen,
  toggleFullscreen,
  places,
  visiblePlaces,
  mapMetrics,
  onZoomIn,
  onZoomOut,
  onLocate
}) => (
  <>
    <style jsx>{controlsStyles}</style>
    {/* Map controls */}
    {mapLoaded && (
      <>
        {/* Top left controls - Search and toggle sidebar */}
        <div className="map-control top-left">
          <div className="search-container">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search places on map..."
              aria-label="Search places on the map"
              className="search-input"
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

          <button
            className="control-button sidebar-toggle"
            onClick={() => setShowSidebar(!showSidebar)}
            aria-label="Toggle sidebar"
          >
            {showSidebar ? <FiChevronRight /> : <FiChevronLeft />}
            <span>{showSidebar ? 'Hide List' : 'Show List'}</span>
          </button>
        </div>

        {/* Top right controls - Layer switcher */}
        <div className="map-control top-right">
          <div className="map-style-switcher">
            <button
              className="control-button layers-button"
              onClick={() => setShowLayers(!showLayers)}
              aria-label="Change map style"
            >
              <FiLayers />
              <span>Styles</span>
            </button>

            <AnimatePresence>
              {showLayers && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="map-style-dropdown"
                >
                  {TILE_LAYERS.map((layer) => (
                    <button
                      key={layer.id}
                      className={`style-option ${tileLayer === layer.url ? 'active' : ''}`}
                      onClick={() => {
                        setTileLayer(layer.url);
                        setShowLayers(false);
                      }}
                    >
                      {layer.icon}
                      <span>{layer.name}</span>
                      {tileLayer === layer.url && (
                        <motion.div
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          className="check-icon"
                        >
                          <FiCheck />
                        </motion.div>
                      )}
                    </button>
                  ))}

                  <div className="style-dropdown-footer">
                    <button
                      className={`cluster-toggle ${clusterMode ? 'active' : ''}`}
                      onClick={() => setClusterMode(!clusterMode)}
                    >
                      <span>Cluster Mode</span>
                      <div className={`toggle-switch ${clusterMode ? 'on' : 'off'}`}>
                        <div className="toggle-handle"></div>
                      </div>
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <button
            className="control-button fullscreen-button"
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          >
            {isFullscreen ? <FiMinimize2 /> : <FiMaximize2 />}
          </button>
        </div>

        {/* Bottom center controls - Map stats */}
        <div className="map-control bottom-center">
          <div className="map-stats">
            <div className="stat">
              <FiMapPin className="stat-icon" />
              <span>
                {visiblePlaces.length}/{places.length}
              </span>
            </div>
            <div className="stat">
              <FiTarget className="stat-icon" />
              <span>Z: {mapMetrics.zoom.toFixed(1)}</span>
            </div>
          </div>
        </div>

        {/* Custom zoom controls */}
        <div className="map-control custom-zoom">
          <button className="zoom-button zoom-in" onClick={onZoomIn} aria-label="Zoom in">
            <FiPlus />
          </button>
          <button className="zoom-button zoom-out" onClick={onZoomOut} aria-label="Zoom out">
            <FiMinus />
          </button>
        </div>

        {/* Locate me button */}
        <button
          className="map-control geolocate-control"
          onClick={onLocate}
          aria-label="Show my location"
        >
          <FiCrosshair />
        </button>
      </>
    )}
  </>
);

export default MapControls;
