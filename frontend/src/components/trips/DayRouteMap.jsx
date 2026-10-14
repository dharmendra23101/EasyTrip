import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { DEFAULT_TILE_URL } from '../map/tileLayers';

/**
 * One day's stops, drawn (`FV-026` stage c).
 *
 * **Why this is not `ExploreMap` with different props.** That component owns clustering, a basemap
 * switcher, geolocation, a radius circle, a sidebar and a selection model, across `useMapInstance`
 * and `useMarkerLayer` — every one of which exists for browsing an unbounded catalogue. A day has
 * under twenty stops in a fixed order and nothing to select. Threading a second mode through 210
 * lines of instance hook to reuse a `L.map()` call would make the browse map harder to read in order
 * to save thirty lines here, which is the wrong trade in both directions.
 *
 * What *is* shared is the thing that should be: the basemap URL comes from `map/tileLayers`, so a
 * day route and the explore map cannot end up on different tiles.
 *
 * ---------------------------------------------------------------------------
 * The line is dashed because it is not a road
 * ---------------------------------------------------------------------------
 * `dayRouteService` says this out loud and it is worth repeating at the drawing end: the provider's
 * **Matrix** endpoint returns distances and durations and **no geometry**. Tracing the real road
 * needs the *Directions* endpoint — a second surface with its own quota and its own terms.
 *
 * So the polyline is straight between stops, and dashing it is the only honest way to render that.
 * A solid line between two pins is a claim about a route; a dashed one is a claim about an order,
 * which is what this actually knows. The shape is the finding either way — a day that doubles back
 * is a zig-zag whether or not the line follows a road.
 *
 * ---------------------------------------------------------------------------
 * `aria-hidden`, and why that is not giving up
 * ---------------------------------------------------------------------------
 * A Leaflet canvas is unreadable to a screen reader, and no amount of labelling makes a shape
 * legible. Rather than describe the picture badly, this element is hidden from assistive technology
 * entirely — and `DayRoute` renders the **same** information as an ordered list with distances
 * beside it, for every reader. The list is not a fallback; it is the primary rendering, and the map
 * is the enhancement.
 */

/** A numbered pin. The number is the stop's place in the day, which is what the panel's list says. */
const stopIcon = (position, isLast) =>
  L.divIcon({
    className: '',
    html: `<span class="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white text-xs font-bold text-white shadow-md ${
      isLast ? 'bg-rose-600' : 'bg-primary-600'
    }">${position}</span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14]
  });

const DayRouteMap = ({ stops = [], dayNumber, className = '' }) => {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);

  // Create the instance once. Not on `stops`: the cleanup destroys the map, so listing the data
  // here would tear the whole thing down and rebuild it on every reorder — the exact defect
  // `useMapInstance`'s header records having had (`IMP-048`).
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return undefined;

    const map = L.map(containerRef.current, {
      zoomControl: true,
      // A route panel sits inside a scrolling page. Scroll-to-zoom would swallow the page scroll
      // the moment the pointer crossed the map, which on a phone means the day below is unreachable.
      scrollWheelZoom: false,
      attributionControl: true
    });

    L.tileLayer(DEFAULT_TILE_URL, {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  // Redraw when the day changes. Clearing the layer group rather than the map keeps the tiles, the
  // zoom control and the attribution alive across a reorder.
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();

    const points = stops.map((stop) => [stop.latitude, stop.longitude]);
    if (points.length === 0) return;

    if (points.length > 1) {
      L.polyline(points, {
        color: '#4f46e5',
        weight: 3,
        opacity: 0.85,
        dashArray: '8 8'
      }).addTo(layer);
    }

    stops.forEach((stop, index) => {
      L.marker([stop.latitude, stop.longitude], {
        icon: stopIcon(index + 1, index === stops.length - 1),
        // The pins are decoration over a list that already carries every name; letting them take
        // focus would add N tab stops that say nothing the list has not already said.
        keyboard: false,
        title: stop.title
      })
        .addTo(layer)
        .bindPopup(
          `<strong>${index + 1}. ${stop.title}</strong>${
            stop.start_time ? `<br/>${stop.start_time}` : ''
          }`
        );
    });

    // `fitBounds` on a single point produces a zero-area box, which Leaflet renders at maximum
    // zoom — a street-level view of one pin, which tells the reader nothing about where it is.
    if (points.length === 1) {
      map.setView(points[0], 12);
    } else {
      map.fitBounds(L.latLngBounds(points), { padding: [32, 32], maxZoom: 14 });
    }
  }, [stops]);

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      data-testid={`day-route-map-${dayNumber}`}
      className={`h-64 w-full overflow-hidden rounded-lg border border-gray-200 ${className}`}
    />
  );
};

export default DayRouteMap;
