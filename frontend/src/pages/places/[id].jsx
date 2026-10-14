import { useState, useMemo } from 'react';
import { useRouter } from 'next/router';
import { motion, useScroll, useTransform } from 'framer-motion';
// Server-side reads come from placesApi, which carries no Firebase import — see its header.
import {
  fetchPlaces,
  fetchPlaceById,
  fetchPlaceImages,
  fetchPlaceReviews
} from '../../services/placesApi';
import { useAuth } from '../../context/AuthContext';
import { useWishlist } from '../../hooks/useWishlist';
import { usePlaceDetail } from '../../hooks/usePlaceDetail';
import { usePlaceReviewActions } from '../../hooks/usePlaceReviewActions';
import { useActiveSection } from '../../hooks/useActiveSection';
import { useSharePlace } from '../../hooks/useSharePlace';
import { PlaceMagazineHero } from '../../components/place/PlaceMagazineHero';
import { TableOfContents } from '../../components/place/TableOfContents';
import { MobileTableOfContents } from '../../components/place/MobileTableOfContents';
import { MagazineIssueBar } from '../../components/place/MagazineIssueBar';
import { MagazineSidebar } from '../../components/place/MagazineSidebar';
import { PlaceArticle } from '../../components/place/PlaceArticle';
import { PlaceSeoHead } from '../../components/place/PlaceSeoHead';
import { PlaceLoadingState, PlaceErrorState } from '../../components/place/PlaceDetailStates';
import { composeGallery, visiblePlaceSections } from '../../utils/placeDetail';
import { hasAccessibilityInfo } from '../../constants/placeAccessibility';
import { hasSeasonalityInfo } from '../../constants/placeSeasonality';
import { getAverageRating } from '../../utils/rating';

/**
 * The place detail page.
 *
 * Place, gallery and reviews arrive as props from `getStaticProps` (IMP-040). This page used to
 * be a three-stage client waterfall behind a spinner — place, then images + reviews, then
 * related places — which meant a crawler saw an empty shell on the pages a travel site most
 * needs indexed, and a visitor saw a spinner until three round trips had resolved.
 *
 * The page itself is composition (IMP-070): the data lives in `usePlaceDetail`, the review
 * operations in `usePlaceReviewActions`, and each section of the article in its own component
 * under `components/place/`.
 */
export default function PlaceDetails({
  initialPlace = null,
  initialImages = [],
  initialReviews = []
}) {
  const router = useRouter();
  const { id } = router.query;
  const auth = useAuth();
  const { currentUser, isAuthenticated, loading: authLoading } = auth;
  const { scrollY } = useScroll();

  const [showTableOfContents, setShowTableOfContents] = useState(false);

  /**
   * The heart (`IMP-108`).
   *
   * This was `useState(false)` — so the icon reset to empty on every visit, and a place liked on
   * the home carousel showed as unliked on its own detail page, because that heart wrote to
   * `localStorage` and this one wrote to nothing. One hook now answers for both.
   */
  const wishlist = useWishlist();

  const { place, setPlace, images, reviews, setReviews, loading, contentLoading, error, refetch } =
    usePlaceDetail(
      id,
      { place: initialPlace, images: initialImages, reviews: initialReviews },
      { currentUser, authLoading }
    );

  const reviewActions = usePlaceReviewActions(id, reviews, auth, { setPlace, setReviews });

  // Only the sections this place actually renders (`BL-139`). Memoised because `useActiveSection`
  // needs a stable reference — a fresh array each render tears down and re-registers the observer.
  const sections = useMemo(
    () =>
      visiblePlaceSections({
        hasImages: images.length > 0,
        hasAccessibility: hasAccessibilityInfo(place),
        hasSeasonality: hasSeasonalityInfo(place)
      }),
    [images.length, place]
  );

  const [activeSection, setActiveSection] = useActiveSection(sections, [contentLoading]);
  const { share, shareTo } = useSharePlace(place);

  // Scroll progress
  const scrollProgress = useTransform(scrollY, [0, 2000], [0, 100]);

  // The API returns a computed `average_rating`; this used to recompute it from the sum and count
  // and return 0 for an unrated place, which renders as a zero-star rating rather than as 'no
  // ratings yet'. `getAverageRating` returns null for that case (IMP-073).
  const avgRating = useMemo(() => getAverageRating(place), [place]);

  if (loading && !place) {
    return <PlaceLoadingState />;
  }

  if (error && !place) {
    return <PlaceErrorState error={error} onRetry={refetch} />;
  }

  return (
    <>
      <PlaceSeoHead place={place} />

      {/* Reading progress bar */}
      <motion.div
        className="fixed top-0 left-0 right-0 h-1 bg-primary-600 z-50"
        style={{ scaleX: scrollProgress, transformOrigin: '0%' }}
      />

      <div className="bg-gray-50 min-h-screen">
        {/* Magazine-style Hero */}
        <PlaceMagazineHero
          place={place}
          onBack={() => router.back()}
          onShare={share}
          onToggleFavorite={() => wishlist.toggle(place?.id)}
          isFavorite={wishlist.isSaved(place?.id)}
          avgRating={avgRating}
          onShareSocial={shareTo}
        />

        <MobileTableOfContents
          sections={sections}
          activeSection={activeSection}
          isOpen={showTableOfContents}
          onToggle={() => setShowTableOfContents((prev) => !prev)}
          onClose={() => setShowTableOfContents(false)}
        />

        <MagazineIssueBar currentUser={currentUser} />

        {/* Main Content */}
        {/* A `div`, not a `main`. `_app.jsx` already opens `<main id="main-content">` around
            every page, so a second one here produced three axe violations from one cause —
            duplicate main, non-top-level main, and a non-unique landmark — and left a screen
            reader with two "main" regions to choose between (`PE-022`). */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 relative z-20">
          {/* Table of Contents for larger screens */}
          <div className="hidden md:block mb-12">
            <TableOfContents sections={sections} />
          </div>

          <div className="lg:grid lg:grid-cols-3 lg:gap-12">
            {/* Main Content Area */}
            <div className="lg:col-span-2 space-y-16">
              <PlaceArticle
                place={place}
                images={images}
                reviews={reviews}
                contentLoading={contentLoading}
                authLoading={authLoading}
                isAuthenticated={isAuthenticated}
                onViewAllReviews={() => setActiveSection('reviews')}
                reviewActions={reviewActions}
              />
            </div>

            {/* Sidebar */}
            <div className="mt-12 lg:mt-0">
              <MagazineSidebar place={place} reviews={reviews} isLoading={contentLoading} />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * Which detail pages exist at build time (IMP-040).
 *
 * Only the most recent 20 are pre-built. `fallback: 'blocking'` means everything else is
 * generated on its first request and then cached like any other static page, so the build stays
 * fast and bounded no matter how large the catalogue grows — pre-building all of them would make
 * deploy time a function of row count for pages nobody may visit.
 *
 * A failure here returns an empty path list rather than throwing. The API being unreachable
 * during a build is an infrastructure state, not a reason to ship nothing; every page is still
 * reachable through the fallback.
 */
export async function getStaticPaths() {
  try {
    const { data } = await fetchPlaces({ limit: 20, sort: 'newest' });
    return {
      paths: data.map((place) => ({ params: { id: String(place.id) } })),
      fallback: 'blocking'
    };
  } catch (error) {
    console.error('[getStaticPaths] places:', error.message);
    return { paths: [], fallback: 'blocking' };
  }
}

/**
 * Render the place, its gallery and its reviews into the HTML.
 *
 * Reviews are included even though `is_own` cannot be resolved without a caller — this request
 * has no user, so every review comes back marked as somebody else's. That is the correct answer
 * for the cached copy, which is shared by every visitor and by crawlers; the page re-reads
 * reviews with the user's token once Firebase restores the session, and that pass is what makes
 * the edit affordance appear. The alternative — leaving reviews out of the static payload — would
 * hide real review content from search engines to avoid a flag anonymous visitors never see.
 */
export async function getStaticProps({ params }) {
  try {
    const place = await fetchPlaceById(params.id);

    // Neither of these should sink the page: a place with an unreachable gallery or review list
    // is still worth rendering.
    const [imagesResult, reviewsResult] = await Promise.allSettled([
      fetchPlaceImages(params.id),
      fetchPlaceReviews(params.id)
    ]);

    return {
      props: {
        initialPlace: place,
        initialImages: composeGallery(
          place,
          imagesResult.status === 'fulfilled' ? imagesResult.value : []
        ),
        initialReviews: reviewsResult.status === 'fulfilled' ? reviewsResult.value : []
      },
      revalidate: 300
    };
  } catch (error) {
    // A real 404 is a real 404 — but recheck periodically, since `fallback: 'blocking'` means
    // this also covers a place created after the last build.
    if (error.status === 404) {
      return { notFound: true, revalidate: 300 };
    }

    // Anything else is an outage, not a missing page. Throwing keeps the last successfully
    // generated copy being served during ISR instead of replacing it with a 404 that would then
    // be cached and indexed.
    throw error;
  }
}
