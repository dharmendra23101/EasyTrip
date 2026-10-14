/**
 * The HTML Leaflet renders for markers, popups and the user's own position (IMP-070).
 *
 * These build DOM as strings because that is the interface `L.divIcon` and `bindPopup` take —
 * Leaflet inserts the markup itself, outside React. That is also why the CSS these class names
 * refer to lives in the **global** half of `mapStyles`: a scoped rule would never match a node
 * React did not render.
 */
import L from 'leaflet';

import { formatAverageRating } from '../../utils/rating';

// Leaflet icon setup
const createCustomIcon = (className, selected = false) => {
  return L.divIcon({
    className: `custom-marker-icon ${selected ? 'selected' : ''}`,
    html: `<div class="marker-pin ${selected ? 'selected' : ''}">
             <div class="marker-icon">
               <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
                 <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                 <circle cx="12" cy="10" r="3"></circle>
               </svg>
             </div>
             ${selected ? '<div class="marker-pulse"></div>' : ''}
           </div>`,
    iconSize: [30, 42],
    iconAnchor: [15, 42],
    popupAnchor: [0, -42]
  });
};

// Rating icon
const createRatingIcon = (rating, selected = false) => {
  return L.divIcon({
    className: `rating-marker-icon ${selected ? 'selected' : ''}`,
    html: `<div class="marker-pin ${selected ? 'selected' : ''}">
             <div class="rating">
               <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2" fill="#FFD700" stroke-linecap="round" stroke-linejoin="round">
                 <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
               </svg>
               <span>${rating}</span>
             </div>
             ${selected ? '<div class="marker-pulse"></div>' : ''}
           </div>`,
    iconSize: [30, 42],
    iconAnchor: [15, 42],
    popupAnchor: [0, -42]
  });
};

// Custom popup content
const createPopupContent = (place) => {
  const rating = formatAverageRating(place);

  return `
    <div class="custom-popup">
      <div class="popup-header">
        <h3>${place.name}</h3>
        ${
          rating
            ? `
          <div class="rating">
            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="#FFD700" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
            </svg>
            <span>${rating}</span>
          </div>
        `
            : ''
        }
      </div>
      <div class="popup-body">
        <p>${place.location}${place.district ? `, ${place.district}` : ''}${place.state ? `, ${place.state}` : ''}</p>
        ${place.description ? `<p class="description">${place.description.substring(0, 100)}${place.description.length > 100 ? '...' : ''}</p>` : ''}
      </div>
      <div class="popup-footer">
        <a href="/places/${place.id}" class="view-button">View Details</a>
      </div>
    </div>
  `;
};

/** The pulsing dot marking the visitor's own position. */
export const createUserLocationIcon = () =>
  L.divIcon({
    className: 'user-location-icon',
    html: `<div class="user-marker">
               <div class="user-marker-inner">
                 <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
                   <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                   <circle cx="12" cy="7" r="4"></circle>
                 </svg>
               </div>
               <div class="user-marker-pulse"></div>
             </div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10]
  });

export { createCustomIcon, createRatingIcon, createPopupContent };
