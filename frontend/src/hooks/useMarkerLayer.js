/**
 * The markers on the map, kept in step with the data (IMP-070).
 *
 * Owns the index of what is currently placed and the two operations over it. It is a hook rather
 * than a module because the index has to survive re-renders without causing them, which is what a
 * ref is for — and a ref needs a component.
 *
 * The decision about *what* to change is in `map/markerDiff`; this applies it.
 */
import { useCallback, useRef } from 'react';
import L from 'leaflet';

import { formatAverageRating } from '../utils/rating';
import { createCustomIcon, createRatingIcon, createPopupContent } from '../components/map/mapIcons';

export const useMarkerLayer = ({
  mapRef,
  markersLayerRef,
  clusterLayerRef,
  selectedMarkerRef,
  clusterMode,
  onSelectPlace
}) => {
  // Markers currently on the map, keyed by place id, so an update can be a diff (IMP-048).
  const markerIndexRef = useRef(new Map());
  const markerModeRef = useRef(null);

  /**
   * Reconcile the markers on the map with the places that should be shown.
   *
   * This used to call `clearLayers()` and rebuild every marker from scratch on each change —
   * and `filteredPlaces` changes on every keystroke in the map's own search box, so typing
   * "goa" destroyed and recreated every `divIcon` in the catalogue three times. Now it adds
   * what is new, removes what is gone, and leaves everything else alone; only markers whose
   * selected state actually flipped are rebuilt, because that is the one thing that changes
   * their icon.
   *
   * A cluster-mode switch still rebuilds wholesale: markers move between two different Leaflet
   * layers, so there is nothing to preserve.
   */
  const updateMarkers = useCallback(
    (places, selected) => {
      if (!mapRef.current || !markersLayerRef.current || !clusterLayerRef.current) return;

      try {
        const modeChanged = markerModeRef.current !== clusterMode;
        markerModeRef.current = clusterMode;

        if (modeChanged) {
          markersLayerRef.current.clearLayers();
          clusterLayerRef.current.clearLayers();
          markerIndexRef.current.clear();

          if (selectedMarkerRef.current) {
            mapRef.current.removeLayer(selectedMarkerRef.current);
            selectedMarkerRef.current = null;
          }
        }

        // Remove and re-add cluster layer if using clustering
        if (clusterMode) {
          if (mapRef.current.hasLayer(markersLayerRef.current)) {
            mapRef.current.removeLayer(markersLayerRef.current);
          }
          if (!mapRef.current.hasLayer(clusterLayerRef.current)) {
            mapRef.current.addLayer(clusterLayerRef.current);
          }
        } else {
          if (mapRef.current.hasLayer(clusterLayerRef.current)) {
            mapRef.current.removeLayer(clusterLayerRef.current);
          }
          if (!mapRef.current.hasLayer(markersLayerRef.current)) {
            mapRef.current.addLayer(markersLayerRef.current);
          }
        }

        const index = markerIndexRef.current;
        const activeLayer = clusterMode ? clusterLayerRef.current : markersLayerRef.current;

        const buildMarker = (place, isSelected) => {
          const rating = formatAverageRating(place);

          const icon = rating
            ? createRatingIcon(rating, isSelected)
            : createCustomIcon('marker', isSelected);

          const marker = L.marker([place.latitude, place.longitude], {
            icon,
            zIndexOffset: isSelected ? 1000 : 0
          });

          marker.bindPopup(createPopupContent(place), {
            className: 'custom-popup-container',
            closeButton: true,
            autoClose: false,
            closeOnEscapeKey: true
          });

          marker.on('click', () => onSelectPlace(place));

          // Show label on hover
          marker.on('mouseover', () => {
            marker
              .bindTooltip(place.name, {
                permanent: false,
                direction: 'top',
                className: 'custom-tooltip'
              })
              .openTooltip();
          });

          return marker;
        };

        const detach = (entry) => {
          if (entry.isSelected) {
            mapRef.current.removeLayer(entry.marker);
            if (selectedMarkerRef.current === entry.marker) selectedMarkerRef.current = null;
          } else {
            entry.layer.removeLayer(entry.marker);
          }
        };

        const wanted = new Set();

        places.forEach((place) => {
          if (!place.latitude || !place.longitude) return;
          wanted.add(place.id);

          const isSelected = Boolean(selected && selected.id === place.id);
          const existing = index.get(place.id);

          // Already on the map in the right state — the common case while typing, and the whole
          // point of the diff.
          if (existing && existing.isSelected === isSelected) return;

          if (existing) detach(existing);

          const marker = buildMarker(place, isSelected);

          if (isSelected) {
            if (selectedMarkerRef.current) mapRef.current.removeLayer(selectedMarkerRef.current);
            marker.addTo(mapRef.current);
            selectedMarkerRef.current = marker;
            index.set(place.id, { marker, isSelected: true, layer: null });
          } else {
            activeLayer.addLayer(marker);
            index.set(place.id, { marker, isSelected: false, layer: activeLayer });
          }
        });

        // Anything no longer in the result set.
        index.forEach((entry, id) => {
          if (wanted.has(id)) return;
          detach(entry);
          index.delete(id);
        });
      } catch (err) {
        console.error('Error updating markers:', err);
      }
    },
    [clusterMode, onSelectPlace, mapRef, markersLayerRef, clusterLayerRef, selectedMarkerRef]
  );

  /**
   * Open the popup for the selected place.
   *
   * This used to build a *second* marker for a place `updateMarkers` had already placed, and
   * assign it over `selectedMarkerRef` — so the first one stayed on the map with nothing holding
   * a reference to it, and every selection leaked one marker. The marker already exists and the
   * index knows where it is; the only thing left to do is open its popup.
   */
  const updateSelectedMarker = useCallback(
    (place) => {
      if (!mapRef.current || !place) return;

      try {
        const entry = markerIndexRef.current.get(place.id);
        if (entry) entry.marker.openPopup();
      } catch (err) {
        console.error('Error updating selected marker:', err);
      }
    },
    [mapRef]
  );

  return { updateMarkers, updateSelectedMarker, markerIndexRef };
};

export default useMarkerLayer;
