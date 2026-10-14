/**
 * The visitor's position, and the places within `RADIUS_KM` of it (IMP-070).
 *
 * Extracted from `ExploreMap`, where it was an effect with three exit paths and two of them
 * duplicated. `radiusMode` is the honest name for what it reports: whether the returned list is
 * actually a radius around someone, or just every place because permission was refused or the
 * browser has no geolocation at all. The map reads it to decide whether to draw the circle.
 *
 * Nothing here touches Leaflet, so what "nearby" means is decided in one place and can be read
 * without one.
 */
import { useEffect, useState } from 'react';

import { calculateDistance, RADIUS_KM } from '../components/map/geo';

const hasCoordinates = (place) =>
  typeof place.latitude === 'number' && typeof place.longitude === 'number';

export const useNearbyPlaces = (places) => {
  const [userLocation, setUserLocation] = useState(null);
  const [nearbyPlaces, setNearbyPlaces] = useState([]);
  const [radiusMode, setRadiusMode] = useState(true);

  useEffect(() => {
    // No position, for any reason: show everything, and say so, so the caller does not draw a
    // radius circle around a location it does not have.
    const showEverything = () => {
      setNearbyPlaces(places.filter(hasCoordinates));
      setRadiusMode(false);
    };

    if (!navigator.geolocation) {
      showEverything();
      return;
    }

    navigator.geolocation.getCurrentPosition(({ coords }) => {
      const { latitude: userLat, longitude: userLng } = coords;
      setUserLocation({ lat: userLat, lng: userLng });

      const withDistance = places
        .filter(hasCoordinates)
        .map((place) => ({
          ...place,
          distance: calculateDistance(userLat, userLng, place.latitude, place.longitude)
        }))
        .sort((a, b) => a.distance - b.distance);

      const within = withDistance.filter((place) => place.distance <= RADIUS_KM);

      // Nothing within the radius is not an error — someone browsing from outside the covered
      // region should still see the catalogue, nearest first, rather than an empty map.
      setNearbyPlaces(within.length > 0 ? within : withDistance);
    }, showEverything);
  }, [places]);

  return { userLocation, nearbyPlaces, radiusMode };
};

export default useNearbyPlaces;
