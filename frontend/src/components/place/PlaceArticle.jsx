import { FiCamera, FiCompass } from 'react-icons/fi';
import { motion } from 'framer-motion';
import { PlaceAboutSection } from './PlaceAboutSection';
import { PlaceReviewsSection } from './PlaceReviewsSection';
import { PlaceArticleSkeleton } from './PlaceDetailStates';
import { MagazineDetails } from './MagazineDetails';
import MagazineGallery from '../MagazineGallery';
import RelatedPlaces from '../RelatedPlaces';
import { PlaceAccessibility } from './PlaceAccessibility';
import { PlaceSeasonality } from './PlaceSeasonality';
import { QuieterNearby } from './QuieterNearby';
import { hasSeasonalityInfo } from '../../constants/placeSeasonality';
import { hasAccessibilityInfo } from '../../constants/placeAccessibility';

/**
 * The article column — the five sections the table of contents lists, in order.
 *
 * Each `<section id>` here is what `useActiveSection` observes, so the ids must stay in step with
 * `PLACE_SECTIONS`. **Two of them are conditional** — gallery and access — and the *same*
 * predicates decide the markup here and the list `visiblePlaceSections` hands the table of contents.
 * That is the whole of `BL-139`: when those two answers were allowed to differ, the contents listed
 * a "Photo Gallery" link that scrolled nowhere on every place with no images.
 */
export const PlaceArticle = ({
  place,
  images,
  reviews,
  contentLoading,
  authLoading,
  isAuthenticated,
  onViewAllReviews,
  reviewActions
}) => {
  if (contentLoading) {
    return <PlaceArticleSkeleton />;
  }

  return (
    <>
      {/* About Section */}
      <section id="about" className="scroll-mt-24">
        <PlaceAboutSection place={place} />
      </section>

      {/* Additional Details Section */}
      <section id="details" className="scroll-mt-24">
        <MagazineDetails customKeys={place.custom_keys} themes={place.themes} />
      </section>

      {/* Getting in (`FV-029`). Between the details and the gallery, because it is a fact about the
          place rather than a picture of it — and early on a phone, which is where somebody who needs
          it will look first. Renders nothing when nothing has been recorded.
          
          It is a registered section again as of `BL-139`: the table of contents now lists only the
          sections a place actually renders, so an "access" entry appears exactly when this panel
          does. Before that it would have been a dead anchor on every unsurveyed place. */}
      {/* `FV-028`. Above accessibility because *when* is the question a reader asks first, and
          `PLACE_SECTIONS` lists them in this order so the contents and the page agree. The panel
          returns null when nothing is curated, and `visiblePlaceSections` uses the same predicate,
          so the anchor and the section appear together. */}
      {hasSeasonalityInfo(place) && (
        <section id="when" className="scroll-mt-24">
          <PlaceSeasonality place={place} />
        </section>
      )}

      {hasAccessibilityInfo(place) && (
        <section id="access" className="scroll-mt-24">
          <PlaceAccessibility place={place} />
        </section>
      )}

      {/* Image Gallery */}
      {images.length > 0 && (
        <section id="gallery" className="scroll-mt-24">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="bg-white rounded-2xl shadow-xl p-8 border border-gray-100"
          >
            <h2 className="text-4xl font-serif font-bold text-gray-900 mb-8 flex items-center">
              <div className="p-3 bg-primary-100 rounded-lg mr-4">
                <FiCamera className="text-primary-600 h-7 w-7" />
              </div>
              Photo Gallery
            </h2>
            <MagazineGallery images={images} placeName={place.name} />
          </motion.div>
        </section>
      )}

      {/* Reviews Section */}
      <section id="reviews" className="scroll-mt-24">
        <PlaceReviewsSection
          place={place}
          reviews={reviews}
          contentLoading={contentLoading}
          authLoading={authLoading}
          isAuthenticated={isAuthenticated}
          onViewAll={onViewAllReviews}
          reviewActions={reviewActions}
        />
      </section>

      {/* Related Places */}
      <section id="related" className="scroll-mt-24">
        {/* `FV-028` stage (c). Inside the existing section on purpose: it renders nothing for a
            place with no quieter neighbour, which is every place today, so giving it an anchor of
            its own would mean a table-of-contents entry pointing at nothing - the exact defect
            `BL-139` fixed. Nothing to register, nothing to gate, nothing to go stale. */}
        <QuieterNearby placeId={place.id} />

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
        >
          <div className="flex items-center mb-10">
            <div className="p-3 bg-emerald-100 rounded-lg mr-4">
              <FiCompass className="text-emerald-600 h-7 w-7" />
            </div>
            <h2 className="text-4xl font-serif font-bold text-gray-900">Similar Adventures</h2>
          </div>

          <RelatedPlaces
            currentPlaceId={place.id}
            themes={place.themes}
            location={place.location}
            isLoading={contentLoading}
          />
        </motion.div>
      </section>
    </>
  );
};
