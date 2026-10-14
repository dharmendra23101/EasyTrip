import { useState, useEffect } from 'react';
import { toast } from 'react-toastify';
import { deletePlace } from '../services/placeService';
import { fetchPlaces } from '../services/placesApi';

/** Truncate for a card summary, on a word boundary would be nicer but this matches the design. */
export const truncateText = (text, maxLength) => {
  if (!text) return '';
  return text.length > maxLength ? `${text.substring(0, maxLength)}...` : text;
};

/**
 * The admin place list: load, filter, delete (IMP-070 / the Phase 5 line criterion).
 *
 * Searching and filtering happen in the browser, so this genuinely wants the whole catalogue —
 * unlike the public browse grid, which pages server-side.
 */
export function useManagePlaces({ currentUser, isAdmin, loading, getIdToken }) {
  const [places, setPlaces] = useState([]);
  const [filteredPlaces, setFilteredPlaces] = useState([]);
  const [loadingPlaces, setLoadingPlaces] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedLocation, setSelectedLocation] = useState('');
  const [locations, setLocations] = useState([]);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [placeToDelete, setPlaceToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [viewMode, setViewMode] = useState('card'); // 'card' or 'table'
  const [showFilters, setShowFilters] = useState(false);

  // Fetch places
  useEffect(() => {
    const loadAllPlaces = async () => {
      try {
        setLoadingPlaces(true);
        setLoadError(null);

        // This table searches, sorts and filters entirely in the browser, so unlike the public
        // browse grid it genuinely wants the whole catalogue — but the endpoint caps a single
        // response at 100 rows (IMP-038). Walk the pages rather than asking for more: the server
        // **rejects** an oversized limit with a 400 (`isInt({min:1,max:100})`), it does not clamp.
        // An earlier version of this comment said "silently clamp", which was wrong — asking for
        // 5,000 rows would have failed the request outright, not returned a truncated list.
        // Pinned by a backend test. PAGE_CAP is a runaway guard, not a product limit; hitting it
        // is reported.
        const PAGE_SIZE = 100;
        const PAGE_CAP = 50;
        const data = [];
        let offset = 0;
        let truncated = false;

        for (let page = 0; ; page += 1) {
          if (page >= PAGE_CAP) {
            truncated = true;
            break;
          }
          const { data: rows, pagination } = await fetchPlaces({ limit: PAGE_SIZE, offset });
          data.push(...rows);
          if (!pagination.hasMore || rows.length === 0) break;
          offset += rows.length;
        }

        if (truncated) {
          console.warn(`Place list truncated at ${data.length} rows (${PAGE_CAP} pages).`);
          toast.warn(`Showing the first ${data.length} places.`);
        }

        setPlaces(data);
        setFilteredPlaces(data);

        // Extract unique locations
        const uniqueLocations = [...new Set(data.map((place) => place.location).filter(Boolean))];
        setLocations(uniqueLocations);

        setLoadingPlaces(false);
      } catch (error) {
        console.error('Error fetching places:', {
          message: error.message,
          status: error.status
        });
        setLoadError(error.message || 'Could not reach the server.');
        toast.error(error.message || 'Failed to load places');
        setLoadingPlaces(false);
      }
    };

    if (!loading && currentUser && isAdmin) {
      loadAllPlaces();
    }
  }, [loading, currentUser, isAdmin]);

  // Filter places based on search and location
  useEffect(() => {
    if (places.length > 0) {
      let filtered = [...places];

      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        filtered = filtered.filter(
          (place) =>
            place.name.toLowerCase().includes(term) ||
            (place.description && place.description.toLowerCase().includes(term)) ||
            (place.location && place.location.toLowerCase().includes(term)) ||
            (place.updated_by_name && place.updated_by_name.toLowerCase().includes(term))
        );
      }

      if (selectedLocation) {
        filtered = filtered.filter((place) => place.location === selectedLocation);
      }

      setFilteredPlaces(filtered);
    }
  }, [searchTerm, selectedLocation, places]);

  const confirmDelete = (place) => {
    setPlaceToDelete(place);
    setShowDeleteModal(true);
  };

  const handleDelete = async () => {
    if (!placeToDelete) return;

    try {
      setDeleting(true);
      const token = await getIdToken();
      if (!token) {
        throw new Error('Your session has expired. Please sign in again.');
      }
      await deletePlace(placeToDelete.id, token);

      // Update state
      setPlaces(places.filter((p) => p.id !== placeToDelete.id));
      setFilteredPlaces(filteredPlaces.filter((p) => p.id !== placeToDelete.id));

      toast.success('Place deleted successfully');
      setShowDeleteModal(false);
      setPlaceToDelete(null);
    } catch (error) {
      console.error('Error deleting place:', {
        message: error.message,
        status: error.status,
        placeId: placeToDelete.id
      });
      toast.error(error.message || 'Failed to delete place');
    } finally {
      setDeleting(false);
    }
  };

  return {
    places,
    filteredPlaces,
    loadingPlaces,
    loadError,
    searchTerm,
    selectedLocation,
    locations,
    showDeleteModal,
    placeToDelete,
    deleting,
    viewMode,
    showFilters,
    setSearchTerm,
    setSelectedLocation,
    setViewMode,
    setShowFilters,
    setShowDeleteModal,
    confirmDelete,
    handleDelete,
    truncateText
  };
}
