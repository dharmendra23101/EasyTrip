import { useState, useEffect, useCallback } from 'react';
import { getPlaceById, getPlaceImages, getPlaceReviews } from '../services/placeService';
import { composeGallery } from '../utils/placeDetail';

/**
 * The detail page's data: the place, its gallery and its reviews (IMP-070).
 *
 * Seeded from the `getStaticProps` payload (IMP-040), so the first render already has content.
 * The fetch path survives for the retry button and for the pages that were not pre-rendered.
 *
 * @param {String|undefined} id - the route param; absent on the first render of a dynamic route
 * @param {Object} initial - `{ place, images, reviews }` from the pre-rendered payload
 * @param {Object} auth - `{ currentUser, authLoading }`, for the ownership re-read below
 */
export function usePlaceDetail(
  id,
  { place: initialPlace, images: initialImages, reviews: initialReviews },
  { currentUser, authLoading }
) {
  const [place, setPlace] = useState(initialPlace);
  const [images, setImages] = useState(initialImages);
  const [reviews, setReviews] = useState(initialReviews);
  const [loading, setLoading] = useState(!initialPlace);
  const [contentLoading, setContentLoading] = useState(!initialPlace);
  const [error, setError] = useState(null);

  const fetchAllData = useCallback(async () => {
    if (!id) return;

    setLoading(true);
    setContentLoading(true);
    setError(null);

    try {
      // Fetch place data first (critical)
      const placeData = await getPlaceById(id);

      setPlace(placeData);
      setLoading(false); // Allow UI to render with basic data

      // Fetch additional data (non-critical)
      const [imagesData, reviewsData] = await Promise.allSettled([
        getPlaceImages(id),
        getPlaceReviews(id)
      ]);

      const imageResults = imagesData.status === 'fulfilled' ? imagesData.value : [];
      setImages(composeGallery(placeData, imageResults));

      const reviewResults = reviewsData.status === 'fulfilled' ? reviewsData.value : [];
      setReviews(reviewResults || []);
    } catch (err) {
      console.error('Error loading page data:', {
        message: err.message,
        placeId: id
      });
      setError(err.message || 'Failed to load place details. Please try again.');
    } finally {
      setContentLoading(false);
    }
  }, [id]);

  // Re-seed when the props change.
  //
  // `useState(initialPlace)` only runs its initialiser on mount, and Next re-renders this same
  // component with new props when you navigate from one place to another. The keyed
  // ErrorBoundary in `_app` happens to remount the whole page subtree on every route change, so
  // this would be correct without the effect — but that makes this page's correctness depend on
  // an unrelated component's `key`, and the failure mode if someone removes it is silently
  // rendering the previous place's content under the new URL.
  useEffect(() => {
    if (!initialPlace) return;
    setPlace(initialPlace);
    setImages(initialImages);
    setReviews(initialReviews);
    setError(null);
    setLoading(false);
    setContentLoading(false);
  }, [initialPlace, initialImages, initialReviews]);

  // Client fetch, only when the page was not pre-rendered with data. With `getStaticProps` in
  // place that is the retry path rather than the normal one.
  useEffect(() => {
    if (initialPlace) return;
    fetchAllData();
  }, [fetchAllData, initialPlace]);

  // The first reviews read happens at mount, usually a beat before Firebase restores the
  // session, so it goes out unauthenticated and the server cannot mark `is_own`. Re-read
  // once a signed-in identity is known, otherwise a reload always renders the user's own
  // review as somebody else's and the edit UI never appears. Anonymous visitors skip this.
  useEffect(() => {
    if (!id || authLoading || !currentUser?.uid) return;

    let cancelled = false;

    getPlaceReviews(id)
      .then((data) => {
        if (!cancelled) setReviews(data || []);
      })
      .catch((err) => console.error('Error refreshing reviews:', err.message));

    return () => {
      cancelled = true;
    };
  }, [id, authLoading, currentUser?.uid]);

  return {
    place,
    setPlace,
    images,
    reviews,
    setReviews,
    loading,
    contentLoading,
    error,
    refetch: fetchAllData
  };
}
