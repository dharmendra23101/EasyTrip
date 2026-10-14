import { useState, useMemo } from 'react';
import { FiChevronRight, FiFlag, FiMessageSquare, FiTrash2, FiUser } from 'react-icons/fi';
import { motion } from 'framer-motion';
import RatingStars from '../RatingStars';
import { formatDate } from '../../utils/dateFormat';

// Magazine-style Review Section
export const MagazineReviews = ({
  reviews,
  onReportReview,
  onDeleteReview,
  isDeletingReview = false,
  isLoading = false
}) => {
  const [viewMode, setViewMode] = useState('curated');

  // Filter out some of the most positive reviews for "curated" view
  const curatedReviews = useMemo(() => {
    if (!reviews.length) return [];

    // In a real app, you'd use more sophisticated curation logic
    return reviews
      .filter((review) => review.rating >= 4)
      .sort((a, b) => b.rating - a.rating)
      .slice(0, 3);
  }, [reviews]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        {[...Array(3)].map((_, i) => (
          <div
            key={i}
            className="bg-white rounded-xl p-6 shadow-md border border-gray-100 animate-pulse"
          >
            <div className="flex items-center mb-4">
              <div className="w-12 h-12 bg-gray-200 rounded-full mr-4"></div>
              <div className="space-y-2">
                <div className="h-4 bg-gray-200 rounded w-32"></div>
                <div className="h-3 bg-gray-200 rounded w-24"></div>
              </div>
            </div>
            <div className="space-y-2">
              <div className="h-4 bg-gray-200 rounded w-full"></div>
              <div className="h-4 bg-gray-200 rounded w-5/6"></div>
              <div className="h-4 bg-gray-200 rounded w-4/6"></div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!reviews.length) {
    return (
      <div className="text-center py-8 bg-gray-50 rounded-xl border border-gray-100">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mb-4">
          <FiMessageSquare className="h-8 w-8 text-gray-400" />
        </div>
        <h3 className="text-lg font-medium text-gray-900 mb-2">No Reviews Yet</h3>
        <p className="text-gray-600 max-w-md mx-auto">
          Be the first to share your experience at this destination.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* View toggle */}
      <div className="flex justify-center mb-6">
        <div className="inline-flex bg-gray-100 rounded-full p-1">
          <button
            onClick={() => setViewMode('curated')}
            className={`px-4 py-2 rounded-full text-sm font-medium ${
              viewMode === 'curated'
                ? 'bg-white shadow text-primary-600'
                : 'text-gray-700 hover:text-gray-900'
            }`}
          >
            Editor&apos;s Picks
          </button>
          <button
            onClick={() => setViewMode('all')}
            className={`px-4 py-2 rounded-full text-sm font-medium ${
              viewMode === 'all'
                ? 'bg-white shadow text-primary-600'
                : 'text-gray-700 hover:text-gray-900'
            }`}
          >
            All Reviews ({reviews.length})
          </button>
        </div>
      </div>

      {/* Reviews grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {(viewMode === 'curated' ? curatedReviews : reviews).map((review, index) => (
          <motion.div
            key={review.id || index}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
            className={`bg-white rounded-xl p-6 shadow-md border border-gray-100 ${
              review.rating >= 4
                ? 'border-l-4 border-l-green-500'
                : review.rating <= 2
                  ? 'border-l-4 border-l-red-500'
                  : ''
            }`}
          >
            <div className="flex items-center mb-4">
              {/*
                No avatar image, deliberately (`SECURITY_AUDIT` L8). This used to branch on
                `review.user_avatar` and render it through `getCloudinaryThumbnail` into an
                `<img src>`. **No API response has ever carried that field** — a grep for
                `user_avatar` across `backend/src` returns zero — so the branch never ran and the
                icon below is what every review has always shown. Removing it changes nothing
                rendered.

                It is worth removing rather than leaving because `getCloudinaryThumbnail` is not a
                sanitizer: its first line returns the input **unchanged** when the string does not
                contain `cloudinary.com`. So the branch was an unvalidated sink waiting for someone
                to add one field to a review payload, which is exactly what the original finding
                said — *"dead today, unvalidated sink tomorrow"*.

                If avatars are ever implemented, validate the URL at the point it enters the system
                rather than relying on this helper, and re-add the image here deliberately.
              */}
              <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mr-4 text-gray-500">
                <FiUser className="w-6 h-6" />
              </div>
              <div>
                <h4 className="font-medium text-gray-900">
                  {review.user_name || 'Anonymous Traveler'}
                </h4>
                <div className="flex items-center text-sm text-gray-500">
                  <div className="mr-2">
                    <RatingStars rating={review.rating} size="small" />
                  </div>
                  <span className="text-xs">{formatDate(review.created_at) || 'Recent visit'}</span>
                </div>
              </div>
            </div>

            <p className="text-gray-700 font-serif leading-relaxed">
              {review.comment || 'Great experience! Highly recommended for all travelers.'}
            </p>

            <div className="mt-4 pt-4 border-t border-gray-100 flex justify-between items-center text-sm">
              <div className="text-gray-500 font-medium">
                {/* Could add helpful count here */}
                <span>Was this helpful?</span>
              </div>

              {/* `is_own` is set server-side: the payload carries an opaque author digest rather
                  than a uid, so this flag is the only way the client can identify its own review.
                  Owners get delete; everyone else gets report. Offering someone the option to
                  report their own review would be noise, and the API rejects it anyway. */}
              {review.is_own ? (
                <button
                  onClick={() => onDeleteReview(review.id)}
                  disabled={isDeletingReview}
                  className="text-red-500 hover:text-red-700 disabled:opacity-50 flex items-center gap-1"
                >
                  <FiTrash2 className="w-4 h-4" />
                  <span>{isDeletingReview ? 'Deleting…' : 'Delete'}</span>
                </button>
              ) : (
                /* 24x24, because the icon alone was 16x16 and an icon-only control has no text
                   box to enlarge it (`PE-022`, WCAG 2.5.8). `-m-1` keeps the flag optically where
                   it was, so the padding buys hit area rather than layout. */
                <button
                  onClick={() => onReportReview(review.id)}
                  className="-m-1 flex h-6 w-6 items-center justify-center text-gray-400 hover:text-gray-600"
                >
                  <span className="sr-only">Report this review</span>
                  <FiFlag className="w-4 h-4" />
                </button>
              )}
            </div>
          </motion.div>
        ))}
      </div>

      {/* Show more button */}
      {viewMode === 'curated' && reviews.length > curatedReviews.length && (
        <div className="text-center mt-8">
          <button
            onClick={() => setViewMode('all')}
            className="inline-flex items-center justify-center px-6 py-3 border border-gray-300 shadow-sm text-base font-medium rounded-full text-gray-700 bg-white hover:bg-gray-50"
          >
            <span>View All {reviews.length} Reviews</span>
            <FiChevronRight className="ml-2 h-5 w-5" />
          </button>
        </div>
      )}
    </div>
  );
};
