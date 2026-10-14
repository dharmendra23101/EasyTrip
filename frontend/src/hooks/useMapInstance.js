/**
 * Creates the Leaflet map and wires its events, once (IMP-070).
 *
 * A hook rather than a module because the instance and its layers are refs — they must outlive
 * renders without causing them — and the creation has to happen in an effect so the container
 * element exists first.
 *
 * The caller keeps the refs. That is deliberate: `useMarkerLayer` needs the same three, and a hook
 * that created them privately would have to hand them back out anyway, with the ownership less
 * obvious rather than more.
 */
import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet.markercluster';

export const useMapInstance = ({
  containerRef,
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
}) => {
  const mapContainerRef = containerRef;

  // lifetime depend on the data — the previous code solved the same problem by rebuilding the
  // entire map whenever the data changed, which is the bug below.
  const liveDataRef = useRef({ filteredPlaces, selectedPlace });
  useEffect(() => {
    liveDataRef.current = { filteredPlaces, selectedPlace };
  }, [filteredPlaces, selectedPlace]);

  // Initialize the map. Once, on mount (IMP-048).
  //
  // This effect used to list `[userLocation, radiusMode, nearbyPlaces]` as dependencies, and its
  // cleanup destroys the map. Geolocation resolves asynchronously *after* first paint and sets
  // all three, so the normal sequence was: build the map, draw the tiles, draw every marker,
  // then tear the whole thing down and do it again. The user-location marker and radius circle
  // are the only things that actually needed the geolocation result, and they are layers — they
  // are added by their own effect below, on the map that already exists.
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    try {
      const initialCenter = [center.lat, center.lng];
      const initialZoom = zoom;

      const map = L.map(mapContainerRef.current, {
        center: initialCenter,
        zoom: initialZoom,
        minZoom: 6, // Prevent zooming out too much
        maxZoom: 18,
        zoomControl: false, // We'll add custom zoom controls
        attributionControl: false // We'll add custom attribution
      });

      // Add tile layer
      L.tileLayer(tileLayer, {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      }).addTo(map);

      // Add custom zoom control
      L.control
        .zoom({
          position: 'bottomright'
        })
        .addTo(map);

      // Add scale control
      L.control
        .scale({
          position: 'bottomleft',
          metric: true,
          imperial: false
        })
        .addTo(map);

      // Add custom attribution
      L.control
        .attribution({
          position: 'bottomright',
          prefix: 'EasyTrip'
        })
        .addTo(map);

      // Initialize marker layers
      const markersLayer = L.layerGroup().addTo(map);
      const clusterLayer = L.markerClusterGroup({
        showCoverageOnHover: false,
        spiderfyOnMaxZoom: true,
        disableClusteringAtZoom: 16,
        maxClusterRadius: 50,
        iconCreateFunction: function (cluster) {
          const count = cluster.getChildCount();
          let size = 'small';

          if (count > 50) size = 'large';
          else if (count > 20) size = 'medium';

          return L.divIcon({
            html: `<div class="cluster-marker ${size}"><span>${count}</span></div>`,
            className: 'leaflet-marker-cluster',
            iconSize: L.point(40, 40)
          });
        }
      });

      // Save references
      mapRef.current = map;
      markersLayerRef.current = markersLayer;
      clusterLayerRef.current = clusterLayer;

      // `whenReady`, not `on('load')`.
      //
      // Leaflet fires `load` synchronously inside the constructor when the map is created with a
      // center and zoom — as it is above — so a listener attached afterwards is registered for an
      // event that has already happened, and `mapLoaded` stayed false forever. Every effect
      // guarded on it was therefore dead: markers never updated after the initial draw, the tile
      // selector did nothing, and selecting a place never flew to it. `whenReady` runs the
      // callback immediately if the map is already ready, which is the case here.
      map.whenReady(() => {
        setMapLoaded(true);

        // Report the zoom the map actually has, not the one it was asked for (`BUG-045`).
        //
        // The requested zoom and the real one can differ from the first frame: this map is
        // constructed with `zoom: 5` against `minZoom: 6`, so Leaflet clamps to 6 — while
        // `ExploreMap` seeds its `mapMetrics` state from the *prop*. Nothing else corrected it,
        // because the only other writer is the `zoomend` handler below, and no zoom event fires
        // during construction. The overlay counter therefore read "Z: 5.0" over tiles at 6 until
        // the user zoomed, which is the `M-6` class: a number displayed but never measured.
        //
        // Syncing from the instance rather than fixing the prop is deliberate. It is correct for
        // any caller and for any future `minZoom`, and it leaves `zoom = 5` meaning what it says —
        // the view intended when the constraints allow it.
        //
        // Both writers, exactly as `zoomend` does below. `setMapMetrics` is the one that reaches
        // the overlay counter; `onZoomChange` is an optional callback for an external consumer and
        // is currently passed by nobody — updating only that one would have looked like a fix and
        // changed nothing on screen.
        const initialZoom = map.getZoom();

        if (onZoomChange) {
          onZoomChange(initialZoom);
        }

        setMapMetrics((prev) => ({ ...prev, zoom: initialZoom }));
      });

      map.on('moveend', () => {
        if (onCenterChange) {
          const center = map.getCenter();
          onCenterChange({ lat: center.lat, lng: center.lng });
        }

        // Get visible bounds - only use valid coordinates
        const bounds = map.getBounds();
        const visiblePlacesList = liveDataRef.current.filteredPlaces.filter((place) => {
          if (typeof place.latitude !== 'number' || typeof place.longitude !== 'number')
            return false;
          return bounds.contains([place.latitude, place.longitude]);
        });

        setVisiblePlaces(visiblePlacesList);
      });

      map.on('zoomend', () => {
        const currentZoom = map.getZoom();
        // Prevent zooming out too much
        if (currentZoom < 6) {
          map.setZoom(6);
          return;
        }

        if (onZoomChange) {
          onZoomChange(currentZoom);
        }

        setMapMetrics((prev) => ({
          ...prev,
          zoom: currentZoom
        }));
      });

      return () => {
        if (mapRef.current) {
          mapRef.current.remove();
          mapRef.current = null;
        }
      };
    } catch (err) {
      console.error('Error initializing map:', err);
      setError('Could not initialize map. Please check your internet connection.');
    }
    // Mount only. Nothing in here should recreate the map — see the note above the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
};

export default useMapInstance;
