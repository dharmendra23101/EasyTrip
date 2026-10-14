import { FiStar } from 'react-icons/fi';

/**
 * A read-only 5-star display (adopted in IMP-073).
 *
 * This component predates Phase 1 and was imported by nothing, while `places/[id].jsx` hand-rolled
 * the same `[...Array(5)].map` twice. It is now used by both of those sites.
 *
 * The sizes and colour below were changed to match the markup being replaced (`w-4`/`w-5`,
 * `text-yellow-500`) rather than the other way round: adopting a shared component should not
 * quietly restyle the pages that adopt it. `text-yellow-400` and `h-3 w-3` were this component's
 * own values and had never appeared on screen.
 *
 * Not for input. The interactive star picker in `ReviewForm` needs buttons, hover state and
 * keyboard handling (`IMP-081`); display and input only look alike.
 *
 * @param {Number} rating - whole stars to fill, 0–5
 * @param {Number} [count] - review count; rendered in parentheses when > 0
 * @param {'small'|'medium'|'large'} [size]
 */
const RatingStars = ({ rating, count, size = 'medium' }) => {
  const sizeClasses = {
    small: 'h-4 w-4',
    medium: 'h-5 w-5',
    large: 'h-6 w-6'
  };

  const normalizedRating = rating || 0;
  const displayCount = count || 0;

  return (
    <div className="flex items-center">
      {/* Five decorative icons carrying one piece of information: announced once here rather than
          five times, per IMP-077's handling of icon-only content. */}
      <div className="flex" role="img" aria-label={`Rated ${normalizedRating} out of 5`}>
        {[1, 2, 3, 4, 5].map((star) => (
          <FiStar
            key={star}
            aria-hidden="true"
            className={`${sizeClasses[size] || sizeClasses.medium} ${
              star <= normalizedRating ? 'text-yellow-500 fill-current' : 'text-gray-300'
            }`}
          />
        ))}
      </div>
      {displayCount > 0 && <span className="ml-1 text-sm text-gray-600">({displayCount})</span>}
    </div>
  );
};

export default RatingStars;
