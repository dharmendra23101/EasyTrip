import { useState } from 'react';
import { FiStar, FiAlertCircle } from 'react-icons/fi';

const ReviewForm = ({
  rating = 0,
  comment = '',
  onRatingChange,
  onCommentChange,
  onSubmit,
  isSubmitting = false,
  userHasReviewed = false,
  error = null
}) => {
  const [hoverRating, setHoverRating] = useState(0);

  const handleStarClick = (value) => {
    onRatingChange(value);
  };

  const handleStarHover = (value) => {
    setHoverRating(value);
  };

  const handleStarLeave = () => {
    setHoverRating(0);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (isSubmitting || !rating) return;
    onSubmit({ rating, comment });
  };

  return (
    <form onSubmit={handleSubmit}>
      {userHasReviewed && (
        <p className="mb-4 text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-md px-4 py-3">
          You have already reviewed this place. Submitting again updates your existing review.
        </p>
      )}

      {/* A rating is a single choice from five mutually exclusive options — a radio group, not five
          independent toggle buttons. `aria-pressed` described each star as its own on/off control,
          so a screen reader announced five unrelated buttons rather than one question with five
          answers, and nothing conveyed that picking 4 unpicks 3 (IMP-081).

          Native radio inputs rather than `role="radiogroup"` on divs: they bring arrow-key
          navigation, roving focus, and form semantics for free, and getting those right by hand is
          exactly where hand-rolled widgets go wrong. The inputs are visually hidden but remain
          focusable — `sr-only` keeps them in the accessibility tree, unlike `display: none`. */}
      <fieldset className="mb-4 border-0 p-0 m-0">
        <legend className="block text-sm font-medium text-gray-700 mb-2">Your Rating</legend>
        <div className="flex" onMouseLeave={handleStarLeave}>
          {[1, 2, 3, 4, 5].map((value) => (
            <label
              key={value}
              onMouseEnter={() => handleStarHover(value)}
              className="mr-1 cursor-pointer rounded focus-within:ring-2 focus-within:ring-primary-500 focus-within:ring-offset-2"
            >
              <input
                type="radio"
                name="rating"
                value={value}
                checked={rating === value}
                onChange={() => handleStarClick(value)}
                className="sr-only"
              />
              <span className="sr-only">{`${value} star${value === 1 ? '' : 's'}`}</span>
              <FiStar
                aria-hidden="true"
                className={`h-8 w-8 ${
                  (hoverRating || rating) >= value
                    ? 'text-yellow-400 fill-current'
                    : 'text-gray-300'
                }`}
              />
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mb-4">
        <label htmlFor="review" className="block text-sm font-medium text-gray-700 mb-2">
          Your Review (Optional)
        </label>
        <textarea
          id="review"
          rows="4"
          value={comment}
          onChange={(e) => onCommentChange(e.target.value)}
          placeholder="Share your experience..."
          className="block w-full border-gray-300 rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500"
        ></textarea>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 flex items-start text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-4 py-3"
        >
          <FiAlertCircle className="h-4 w-4 mr-2 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <button
        type="submit"
        disabled={isSubmitting || !rating}
        className="w-full md:w-auto px-6 py-3 bg-primary-600 text-white rounded-md font-medium hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isSubmitting ? (
          <span className="flex items-center justify-center">
            <svg
              className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              ></circle>
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              ></path>
            </svg>
            Submitting...
          </span>
        ) : userHasReviewed ? (
          'Update Review'
        ) : (
          'Submit Review'
        )}
      </button>
    </form>
  );
};

export default ReviewForm;
