import Link from 'next/link';
import { FiEdit3, FiEye, FiMessageSquare, FiTrash2, FiUser } from 'react-icons/fi';
import { motion } from 'framer-motion';
import { MagazineReviews } from './MagazineReviews';
import ReviewForm from '../ReviewForm';
import RatingStars from '../RatingStars';
import { formatAverageRating, getStarCount } from '../../utils/rating';

/**
 * The reviews section: the aggregate header, the review list, and the write/edit form.
 *
 * @param {Object} reviewActions - the bundle returned by `usePlaceReviewActions`
 */
export const PlaceReviewsSection = ({
  place,
  reviews,
  contentLoading,
  authLoading,
  isAuthenticated,
  onViewAll,
  reviewActions
}) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.6, delay: 0.2 }}
    className="bg-white rounded-2xl shadow-xl p-8 border border-gray-100"
  >
    <h2 className="text-4xl font-serif font-bold text-gray-900 mb-8 flex items-center">
      <div className="p-3 bg-yellow-100 rounded-lg mr-4">
        <FiMessageSquare className="text-yellow-600 h-7 w-7" />
      </div>
      Traveler Reviews
    </h2>

    {/* Magazine-style review stats */}
    {place.rating_count > 0 && (
      <div className="mb-8 flex flex-col md:flex-row md:items-center md:justify-between bg-gray-50 rounded-xl p-6 border border-gray-100">
        <div className="flex items-center mb-4 md:mb-0">
          <div className="flex items-center justify-center w-16 h-16 bg-yellow-100 rounded-full mr-4">
            <span className="text-2xl font-bold text-yellow-700">{formatAverageRating(place)}</span>
          </div>
          <div>
            {/* `h3`: the nearest heading above is "Traveler Reviews" (`h2`), so `h4` skipped a
                level (`PE-022`). */}
            <h3 className="font-medium text-gray-900">Overall Rating</h3>
            <div className="mt-1">
              <RatingStars rating={getStarCount(place)} size="medium" />
            </div>
            <p className="text-sm text-gray-500 mt-1">Based on {place.rating_count} reviews</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() =>
              document.getElementById('review-form')?.scrollIntoView({ behavior: 'smooth' })
            }
            className="flex items-center justify-center bg-primary-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary-700 transition-colors"
          >
            <FiEdit3 className="mr-2 h-4 w-4" />
            Write a Review
          </button>
          <button
            onClick={onViewAll}
            className="flex items-center justify-center bg-gray-100 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors"
          >
            <FiEye className="mr-2 h-4 w-4" />
            View All
          </button>
        </div>
      </div>
    )}

    {/* Reviews display */}
    <MagazineReviews
      reviews={reviews}
      onReportReview={reviewActions.report}
      onDeleteReview={reviewActions.remove}
      isDeletingReview={reviewActions.isDeleting}
      isLoading={contentLoading}
    />

    {/* Review form */}
    <div id="review-form" className="mt-12 pt-8 border-t border-gray-200">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h3 className="text-2xl font-serif font-bold text-gray-900">
          {reviewActions.existingReview ? 'Edit Your Review' : 'Share Your Experience'}
        </h3>
        {/* Also offered here, not just on the review card: the list defaults to
            the "curated" view, which only shows 4-star-and-up reviews, so an
            owner who rated a place lower could not otherwise reach their own
            delete control without switching views. */}
        {reviewActions.existingReview && (
          <button
            type="button"
            onClick={() => reviewActions.remove(reviewActions.existingReview.id)}
            disabled={reviewActions.isDeleting}
            className="text-sm text-red-600 hover:text-red-700 disabled:opacity-50 flex items-center gap-1.5"
          >
            <FiTrash2 className="w-4 h-4" />
            {reviewActions.isDeleting ? 'Deleting…' : 'Delete my review'}
          </button>
        )}
      </div>
      {authLoading ? (
        // Firebase resolves the session a beat after mount; without this
        // a signed-in user sees the "Sign in to review" panel flash first.
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-40 mb-4"></div>
          <div className="h-24 bg-gray-200 rounded w-full"></div>
        </div>
      ) : isAuthenticated ? (
        <ReviewForm
          rating={reviewActions.rating}
          comment={reviewActions.comment}
          onRatingChange={reviewActions.setRating}
          onCommentChange={reviewActions.setComment}
          onSubmit={reviewActions.submit}
          isSubmitting={reviewActions.isSubmitting}
          userHasReviewed={Boolean(reviewActions.existingReview)}
          error={reviewActions.error}
        />
      ) : (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 text-center">
          <p className="text-gray-700 mb-4">
            Sign in to rate this place and share your experience with other travelers.
          </p>
          <Link
            href="/login"
            className="inline-flex items-center justify-center bg-primary-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-primary-700 transition-colors"
          >
            <FiUser className="mr-2 h-4 w-4" />
            Sign in to review
          </Link>
        </div>
      )}
    </div>
  </motion.div>
);
