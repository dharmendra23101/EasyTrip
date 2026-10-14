/**
 * Great-circle distance (IMP-070).
 *
 * Extracted because it is the only thing in `ExploreMap` that is a plain function of its arguments,
 * and therefore the only thing that could be checked without a browser and a Leaflet instance. It
 * decides which places count as "nearby", so getting it wrong silently changes what the map shows.
 */

/** Kilometres between two WGS-84 points, by the haversine formula. */
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Radius of the Earth in kilometers
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c; // Distance in kilometers
  return distance;
};

/** The radius the map treats as "near me", in kilometres. */
export const RADIUS_KM = 300;

export { calculateDistance };
