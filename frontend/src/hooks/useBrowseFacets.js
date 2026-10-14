import { useEffect, useState } from 'react';

import { fetchFacets, fetchPlaces } from '../services/placesApi';

/**
 * The four filter vocabularies (IMP-070).
 *
 * `getServerSideProps` normally supplies these. The effect covers the case where it could not
 * reach the API and rendered the page anyway, so a transient outage costs the filter lists until
 * the next load rather than permanently.
 */
export const useBrowseFacets = (initialFacets) => {
  const [facets, setFacets] = useState(() => ({
    locations: initialFacets?.locations || [],
    districts: initialFacets?.districts || [],
    states: initialFacets?.states || [],
    tags: initialFacets?.tags || []
  }));

  useEffect(() => {
    if (initialFacets) return;

    let cancelled = false;
    fetchFacets().then((loaded) => {
      if (!cancelled) setFacets(loaded);
    });

    return () => {
      cancelled = true;
    };
  }, [initialFacets]);

  return facets;
};

/**
 * Map markers, fetched only while the map is open and thrown away when it closes.
 *
 * Unpaginated by design — a map showing twelve of a hundred pins is worse than no map — which is
 * affordable only because `projection: 'map'` returns coordinates and a label rather than full
 * rows. The grid is paginated and the map is not, so neither view pays for the other.
 */
export const useBrowseMapPlaces = ({ viewMode, criteria, criteriaKey }) => {
  const [mapPlaces, setMapPlaces] = useState([]);
  const [mapLoading, setMapLoading] = useState(false);

  useEffect(() => {
    if (viewMode !== 'map') return;

    let cancelled = false;
    const controller = new AbortController();
    setMapLoading(true);

    fetchPlaces({ ...criteria, projection: 'map' }, { signal: controller.signal })
      .then((response) => {
        if (!cancelled) setMapPlaces(response.data);
      })
      .catch((err) => {
        if (cancelled || err.name === 'AbortError') return;
        console.error('Failed to load map places:', err);
        setMapPlaces([]);
      })
      .finally(() => {
        if (!cancelled) setMapLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- criteriaKey stands in for criteria.
  }, [viewMode, criteriaKey]);

  return { mapPlaces, mapLoading };
};

export default useBrowseFacets;
