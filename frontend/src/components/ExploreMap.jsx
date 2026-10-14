import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import 'leaflet.markercluster';

import { FiAlertCircle, FiRefreshCw } from 'react-icons/fi';

import { useNearbyPlaces } from '../hooks/useNearbyPlaces';
import { useMarkerLayer } from '../hooks/useMarkerLayer';
import { useMapInstance } from '../hooks/useMapInstance';
import { mapStyles, mapGlobal } from './map/mapStyles';
import { DEFAULT_TILE_URL } from './map/tileLayers';
import { RADIUS_KM } from './map/geo';
import { createUserLocationIcon } from './map/mapIcons';
import MapSidebar from './map/MapSidebar';
import MapControls from './map/MapControls';

/**
 * The interactive map (IMP-070).
 *
 * What is left here is the part that owns the Leaflet instance: creating it, keeping its markers
 * in step with the data, and reacting to selection. Everything that does not need the instance
 * moved out — the stylesheet to `map/mapStyles`, the marker and popup HTML to `map/mapIcons`, the
 * basemap list to `map/tileLayers`, the distance maths to `map/geo`, the two overlay clusters to
 * `map/MapSidebar` and `map/MapControls`, and geolocation to `useNearbyPlaces`.
 *
 * Loaded with `next/dynamic` and `ssr: false` by its callers, because Leaflet reads `window` at
 * import time.
 */
const ExploreMap = ({
  places: rawPlaces = [],
  selectedPlace,
  // Browse renders the map without a selection handler, and every marker binds a click that
  // calls this — so without a default, clicking any pin threw a TypeError.
  onSelectPlace = () => {},
  center = { lat: 20.5937, lng: 78.9629 }, // Default to India's center
  zoom = 5,
  onZoomChange,
  onCenterChange,
  className = ''
}) => {
  // Refs for DOM elements
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const markersLayerRef = useRef(null);
  const clusterLayerRef = useRef(null);
  const selectedMarkerRef = useRef(null);

  // State for UI and functionality
  const [mapLoaded, setMapLoaded] = useState(false);
  const [error, setError] = useState(null);
  // The URL, not an id, because the tile-layer effect and the switcher's active check both compare
  // on it. Taken from the list rather than repeated, so the two cannot disagree.
  const [tileLayer, setTileLayer] = useState(DEFAULT_TILE_URL);
  const [searchQuery, setSearchQuery] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showLayers, setShowLayers] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [clusterMode, setClusterMode] = useState(true);
  const [visiblePlaces, setVisiblePlaces] = useState([]);

  const [mapMetrics, setMapMetrics] = useState({
    zoom: zoom,
    bearing: 0,
    pitch: 0
  });

  // PostgreSQL returns DECIMAL columns as strings, so every `typeof place.latitude === 'number'`
  // guard below rejected every row and the map rendered zero markers (IMP-007). Coordinates are
  // normalised once here rather than at each guard: unparseable values become null, so those same
  // guards still exclude them, and the distance maths downstream operates on real numbers.
  const places = useMemo(
    () =>
      rawPlaces.map((place) => {
        const latitude = Number.parseFloat(place.latitude);
        const longitude = Number.parseFloat(place.longitude);
        return {
          ...place,
          latitude: Number.isFinite(latitude) ? latitude : null,
          longitude: Number.isFinite(longitude) ? longitude : null
        };
      }),
    [rawPlaces]
  );

  // Where the visitor is, and what is near them. The map only needs `radiusMode` — whether the
  // list is genuinely a radius around someone, and so whether to draw the circle. How "near" is
  // decided lives in the hook, and the distance maths under it in `map/geo`.
  const { userLocation, nearbyPlaces, radiusMode } = useNearbyPlaces(places);

  // Filter places based on search query and nearby places
  const filteredPlaces = useMemo(() => {
    const placesToFilter = radiusMode
      ? nearbyPlaces
      : places.filter(
          (place) => typeof place.latitude === 'number' && typeof place.longitude === 'number'
        );

    if (!searchQuery) return placesToFilter;

    const query = searchQuery.toLowerCase();
    return placesToFilter.filter(
      (place) =>
        place.name.toLowerCase().includes(query) ||
        place.location?.toLowerCase().includes(query) ||
        place.district?.toLowerCase().includes(query) ||
        place.state?.toLowerCase().includes(query)
    );
  }, [nearbyPlaces, places, searchQuery, radiusMode]);

  // `filteredPlaces` and `selectedPlace` as the Leaflet event handlers see them.
  //
  // Those handlers are registered once when the map is built and close over whatever the values
  // were at that moment. Reading through a ref keeps them current without making the map's
  // The Leaflet instance itself, built once. The refs stay here because the marker layer below
  // needs the same three.
  useMapInstance({
    containerRef: mapContainerRef,
    mapRef,
    markersLayerRef,
    clusterLayerRef,
    center,
    zoom,
    tileLayer,
    filteredPlaces,
    selectedPlace,
    onZoomChange,
    onCenterChange,
    setMapLoaded,
    setVisiblePlaces,
    setMapMetrics,
    setError
  });

  // The markers, and the two operations over them. The index lives in the hook so this component
  // does not have to hold state it never reads.
  //
  // **Declared here, above the effects that call it, and that position is load-bearing.** It used
  // to sit below them, so both effects named it inside their bodies while leaving it out of their
  // dependency arrays - a dependency array is evaluated during render, and naming a `const` from
  // below would read it in its temporal dead zone and throw. Each effect therefore carried an
  // `eslint-disable-next-line react-hooks/exhaustive-deps` and a paragraph explaining why the lint
  // rule was wrong. It was not wrong; the ordering was. Moving one call up deletes two waivers and
  // lets both effects state their real dependencies (`BL-146`).
  const { updateMarkers, updateSelectedMarker } = useMarkerLayer({
    mapRef,
    markersLayerRef,
    clusterLayerRef,
    selectedMarkerRef,
    clusterMode,
    onSelectPlace
  });

  // The user's position and radius circle, as layers on the existing map rather than a reason to
  // rebuild it. Both are removed before being re-added so a second geolocation fix does not
  // leave the first one behind.
  const userLayersRef = useRef([]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    userLayersRef.current.forEach((layer) => map.removeLayer(layer));
    userLayersRef.current = [];

    if (!userLocation) return;

    const marker = L.marker([userLocation.lat, userLocation.lng], {
      icon: createUserLocationIcon()
    })
      .bindPopup('Your Location')
      .addTo(map);
    userLayersRef.current.push(marker);

    if (radiusMode && nearbyPlaces.length > 0) {
      const circle = L.circle([userLocation.lat, userLocation.lng], {
        color: '#4F46E5',
        fillColor: '#4F46E5',
        fillOpacity: 0.1,
        radius: RADIUS_KM * 1000 // Convert to meters
      }).addTo(map);
      userLayersRef.current.push(circle);
    }

    // Recentre once, when the position first arrives — the old code got this for free by
    // rebuilding the map around the new centre, at the cost of rebuilding the map.
    map.setView([userLocation.lat, userLocation.lng], Math.max(map.getZoom(), 10));
  }, [userLocation, radiusMode, nearbyPlaces.length, mapLoaded]);

  // Update markers when places or selected place changes.
  useEffect(() => {
    if (mapRef.current && mapLoaded) {
      updateMarkers(filteredPlaces, selectedPlace);
    }
  }, [filteredPlaces, selectedPlace, mapLoaded, updateMarkers]);

  // Update tile layer when it changes
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;

    // Remove existing tile layers
    mapRef.current.eachLayer((layer) => {
      if (layer instanceof L.TileLayer) {
        mapRef.current.removeLayer(layer);
      }
    });

    // Add new tile layer
    L.tileLayer(tileLayer, {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(mapRef.current);
  }, [tileLayer, mapLoaded]);

  // Fly to selected place when it changes
  useEffect(() => {
    if (
      !mapRef.current ||
      !mapLoaded ||
      !selectedPlace ||
      !selectedPlace.latitude ||
      !selectedPlace.longitude
    )
      return;

    try {
      // Fly to the selected place
      mapRef.current.flyTo(
        [selectedPlace.latitude, selectedPlace.longitude],
        Math.max(mapRef.current.getZoom(), 14),
        {
          animate: true,
          duration: 1.5
        }
      );

      // Update the selected marker
      updateSelectedMarker(selectedPlace);
    } catch (err) {
      console.error('Error flying to selected place:', err);
    }
  }, [selectedPlace, mapLoaded, updateSelectedMarker]);

  // Function to toggle fullscreen mode
  // The verbs the control cluster asks for. They live here because this is what holds the Leaflet
  // instance; handing `MapControls` the ref instead would make it unrenderable without a live map,
  // which is the opposite of what extracting it was for.
  const zoomIn = useCallback(() => mapRef.current?.zoomIn(), []);
  const zoomOut = useCallback(() => mapRef.current?.zoomOut(), []);
  const locateMe = useCallback(
    () => mapRef.current?.locate({ setView: true, maxZoom: 16, enableHighAccuracy: true }),
    []
  );

  // Function to toggle fullscreen mode
  const toggleFullscreen = useCallback(() => {
    if (!mapContainerRef.current) return;

    try {
      if (!isFullscreen) {
        if (mapContainerRef.current.requestFullscreen) {
          mapContainerRef.current.requestFullscreen();
        } else if (mapContainerRef.current.mozRequestFullScreen) {
          mapContainerRef.current.mozRequestFullScreen();
        } else if (mapContainerRef.current.webkitRequestFullscreen) {
          mapContainerRef.current.webkitRequestFullscreen();
        } else if (mapContainerRef.current.msRequestFullscreen) {
          mapContainerRef.current.msRequestFullscreen();
        }
      } else {
        if (document.exitFullscreen) {
          document.exitFullscreen();
        } else if (document.mozCancelFullScreen) {
          document.mozCancelFullScreen();
        } else if (document.webkitExitFullscreen) {
          document.webkitExitFullscreen();
        } else if (document.msExitFullscreen) {
          document.msExitFullscreen();
        }
      }

      // Update state
      setIsFullscreen(!isFullscreen);

      // Resize map after toggling fullscreen
      setTimeout(() => {
        if (mapRef.current) {
          mapRef.current.invalidateSize();
        }
      }, 200);
    } catch (err) {
      console.error('Error toggling fullscreen:', err);
    }
  }, [isFullscreen]);

  // Handle fullscreen change events
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isInFullscreen = !!(
        document.fullscreenElement ||
        document.mozFullScreenElement ||
        document.webkitFullscreenElement ||
        document.msFullscreenElement
      );

      setIsFullscreen(isInFullscreen);

      // Resize map when fullscreen state changes
      if (mapRef.current) {
        mapRef.current.invalidateSize();
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('msfullscreenchange', handleFullscreenChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('msfullscreenchange', handleFullscreenChange);
    };
  }, []);

  // Handle map errors and loading
  if (error) {
    return (
      <div className={`map-error-container ${className}`}>
        <div className="map-error">
          <FiAlertCircle className="error-icon" />
          <h3>Map Error</h3>
          <p>{error}</p>
          <button onClick={() => window.location.reload()}>
            <FiRefreshCw className="refresh-icon" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Render the map and its controls
  return (
    <div className={`map-wrapper ${className} ${isFullscreen ? 'fullscreen' : ''}`}>
      {/* Map container */}
      <div ref={mapContainerRef} className="map-container">
        {!mapLoaded && (
          <div className="map-loading">
            <div className="loading-spinner"></div>
            <p>Loading interactive map...</p>
          </div>
        )}
      </div>

      <MapSidebar
        showSidebar={showSidebar}
        setShowSidebar={setShowSidebar}
        mapLoaded={mapLoaded}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        places={places}
        filteredPlaces={filteredPlaces}
        visiblePlaces={visiblePlaces}
        mapMetrics={mapMetrics}
        selectedPlace={selectedPlace}
        onSelectPlace={onSelectPlace}
      />

      <MapControls
        mapLoaded={mapLoaded}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        showSidebar={showSidebar}
        setShowSidebar={setShowSidebar}
        showLayers={showLayers}
        setShowLayers={setShowLayers}
        tileLayer={tileLayer}
        setTileLayer={setTileLayer}
        clusterMode={clusterMode}
        setClusterMode={setClusterMode}
        isFullscreen={isFullscreen}
        toggleFullscreen={toggleFullscreen}
        places={places}
        visiblePlaces={visiblePlaces}
        mapMetrics={mapMetrics}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onLocate={locateMe}
      />

      {/* Stylesheet in components/map/mapStyles.js — 981 lines, see the note there on why
          one block is scoped and the other is not. */}
      <style jsx>{mapStyles}</style>
      <style jsx global>
        {mapGlobal}
      </style>
    </div>
  );
};

export default ExploreMap;
