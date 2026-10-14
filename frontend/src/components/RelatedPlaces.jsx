import { useState, useEffect } from 'react';
import Link from 'next/link';
import { fetchPlaces } from '../services/placesApi';
import PlaceCard from './PlaceCard';

const RelatedPlaces = ({ currentPlaceId, themes, location }) => {
  const [relatedPlaces, setRelatedPlaces] = useState([]);
  const [loading, setLoading] = useState(true);
  // "Nothing matched" and "the request failed" rendered identically before this — both fell
  // through to "No related places found." (IMP-031).
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const fetchRelatedPlaces = async () => {
      try {
        setLoading(true);
        setFailed(false);

        // Ask for five and keep four. This used to download every place matching the theme —
        // full rows, no limit — and slice to four in the browser, so a popular theme cost a
        // whole-catalogue payload to render one strip of cards. The extra row covers the one
        // case the server cannot: the current place matching its own criteria (IMP-038).
        const { data } = await fetchPlaces({
          ...(themes && themes.length > 0 && { themes }),
          ...(!themes?.length && location && { location }),
          limit: 5
        });

        const results = data.filter((place) => place.id.toString() !== currentPlaceId.toString());

        setRelatedPlaces(results.slice(0, 4));
      } catch (error) {
        console.error('Error fetching related places:', error);
        setRelatedPlaces([]);
        setFailed(true);
      } finally {
        setLoading(false);
      }
    };

    if (currentPlaceId && (themes?.length > 0 || location)) {
      fetchRelatedPlaces();
    } else {
      setLoading(false);
    }
  }, [currentPlaceId, themes, location, reloadKey]);

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <div className="w-10 h-10 border-4 border-primary-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (failed) {
    return (
      <div className="bg-gray-50 rounded-lg p-8 text-center">
        <p className="text-gray-700 mb-1">Couldn&apos;t load related places.</p>
        <p className="text-gray-500 text-sm mb-4">
          This section failed to load — it doesn&apos;t mean there are none.
        </p>
        <button
          type="button"
          onClick={() => setReloadKey((key) => key + 1)}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-primary-600 hover:bg-primary-700"
        >
          Try again
        </button>
      </div>
    );
  }

  if (relatedPlaces.length === 0) {
    return (
      <div className="bg-gray-50 rounded-lg p-8 text-center">
        <p className="text-gray-600 mb-4">No related places found.</p>
        <Link
          href="/browse"
          className="inline-flex items-center px-4 py-2 border border-transparent text-base font-medium rounded-md shadow-sm text-white bg-primary-600 hover:bg-primary-700"
        >
          Browse All Places
        </Link>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
      {relatedPlaces.map((place) => (
        <PlaceCard key={place.id} place={place} />
      ))}
    </div>
  );
};

export default RelatedPlaces;
