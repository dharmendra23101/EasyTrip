import Link from 'next/link';
import { FiStar, FiTrash2, FiAlertCircle, FiEdit3, FiMessageSquare } from 'react-icons/fi';

import { useMyReviews } from '../../hooks/useMyReviews';
import LoadingSpinner from '../LoadingSpinner';
import { formatDate } from '../../utils/dateFormat';

/**
 * "Your reviews" on the profile page (`IMP-117`).
 *
 * The README advertised profiles that let you *manage reviews*; the page was a three-field form.
 * This is the half that made the claim true.
 *
 * Three states, kept apart for the reason `IMP-031` names: **an empty history and a failed request
 * both render zero rows**, and telling somebody their reviews are gone when the network hiccuped is
 * the worse of the two mistakes.
 */

/** Stars as text for assistive tech, filled shapes for everyone else. */
const Rating = ({ value }) => (
  <span className="flex items-center" aria-label={`${value} out of 5`}>
    {[1, 2, 3, 4, 5].map((star) => (
      <FiStar
        key={star}
        aria-hidden="true"
        className={`h-4 w-4 ${star <= value ? 'fill-current text-amber-500' : 'text-gray-300'}`}
      />
    ))}
  </span>
);

export const MyReviews = () => {
  const { reviews, error, actionError, refresh, remove, removingId, ready } = useMyReviews();

  if (!ready) {
    return (
      <div className="py-12 flex justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-center">
        <FiAlertCircle className="mx-auto h-7 w-7 text-amber-500" aria-hidden="true" />
        <p className="mt-3 font-medium text-gray-900">We could not load your reviews</p>
        <p className="mt-1 text-sm text-gray-600">
          Nothing has been deleted — this is a problem reaching the server.
        </p>
        <button
          type="button"
          onClick={refresh}
          className="mt-4 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
        >
          Try again
        </button>
      </div>
    );
  }

  if (reviews.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-10 text-center">
        <FiMessageSquare className="mx-auto h-8 w-8 text-gray-300" aria-hidden="true" />
        <p className="mt-3 font-medium text-gray-900">You have not written any reviews yet</p>
        <p className="mt-1 text-sm text-gray-600">
          Visit a destination page and share what it was actually like.
        </p>
        <Link
          href="/browse"
          className="mt-4 inline-block rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
        >
          Browse destinations
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/*
        An action that failed, reported *above the list that is still there*. The full-page error
        block belongs to a failed load only — using it here would hide the reviews the delete did
        not remove, which reads as though it had.
      */}
      {actionError && (
        <div
          role="alert"
          className="flex items-start rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
          <FiAlertCircle className="mr-2 mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
          <span>{actionError.message || 'That did not work. Your review is still here.'}</span>
        </div>
      )}

      <p className="sr-only" role="status">
        {reviews.length} {reviews.length === 1 ? 'review' : 'reviews'}
      </p>

      {reviews.map((review) => (
        <article
          key={review.id}
          className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <Link
                href={`/places/${review.place_id}`}
                className="font-serif text-lg font-bold text-gray-900 hover:text-primary-600"
              >
                {review.place_name}
              </Link>
              {review.place_location && (
                <p className="truncate text-sm text-gray-500">{review.place_location}</p>
              )}
            </div>
            <Rating value={review.rating} />
          </div>

          {review.comment && <p className="mt-3 text-gray-700">{review.comment}</p>}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-3">
            <p className="text-xs text-gray-500">
              {/* `updated_at` rather than `created_at`: an edited review's useful date is when it
                  last said what it says now. */}
              Last updated {formatDate(review.updated_at)}
            </p>

            <div className="flex items-center gap-2">
              {/* Editing is re-submitting the form on the place page — the upsert means there is
                  exactly one write path, and it lives next to the form that uses it. */}
              <Link
                href={`/places/${review.place_id}#reviews`}
                className="inline-flex items-center rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              >
                <FiEdit3 className="mr-1.5 h-4 w-4" aria-hidden="true" />
                Edit
              </Link>
              <button
                type="button"
                onClick={() => remove(review)}
                disabled={removingId === review.id}
                className="inline-flex items-center rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
                aria-label={`Delete your review of ${review.place_name}`}
              >
                <FiTrash2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
                {removingId === review.id ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
};

export default MyReviews;
