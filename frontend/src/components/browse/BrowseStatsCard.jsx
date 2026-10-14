import { FiClock, FiStar, FiTarget, FiUser } from 'react-icons/fi';
import { formatDateTime } from '../../utils/dateFormat';

/**
 * The sidebar summary under the filters: result counts, who is signed in, and how fresh the
 * data is. Reads no filter state — only the already-computed `stats` — so it takes those three
 * values directly rather than the filter bundle.
 */
const BrowseStatsCard = ({ stats, total, currentUser, lastUpdated }) => (
  <div className="mt-6 bg-white shadow rounded-lg p-6">
    <h3 className="text-lg font-medium text-gray-900 mb-3 flex items-center">
      <FiTarget className="mr-2 text-primary-600" />
      Explore Stats
    </h3>
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <span className="text-sm text-gray-600">Total Places</span>
        <span className="text-sm font-medium bg-primary-100 text-primary-800 px-2 py-1 rounded">
          {stats.totalPlaces}
        </span>
      </div>
      <div className="flex justify-between items-center">
        <span className="text-sm text-gray-600">Filtered Results</span>
        <span className="text-sm font-medium bg-primary-100 text-primary-800 px-2 py-1 rounded">
          {total}
        </span>
      </div>
      <div className="flex justify-between items-center">
        <span className="text-sm text-gray-600">Top Location</span>
        <span className="text-sm font-medium bg-primary-100 text-primary-800 px-2 py-1 rounded truncate max-w-[120px]">
          {stats.topLocation || 'N/A'}
        </span>
      </div>
      <div className="flex justify-between items-center">
        <span className="text-sm text-gray-600">Average Rating</span>
        <div className="flex items-center text-sm">
          {/* The number is text and has to meet 4.5:1; `text-yellow-500` gave it 1.91:1. Darkening
              the yellow far enough (`yellow-700`, 4.92:1) would have turned a gold star olive to
              fix a problem the star does not have — so the colour moved off the text instead. The
              star keeps the brand yellow and is marked decorative, which it is: the label beside it
              says "Average Rating" and the numeral states the value. */}
          <span className="font-medium text-gray-900 flex items-center">
            {stats.avgRating}
            <FiStar className="ml-1 h-3 w-3 fill-current text-yellow-500" aria-hidden="true" />
          </span>
        </div>
      </div>
    </div>

    {/* User status */}
    {currentUser && (currentUser.displayName || currentUser.email) && (
      <div className="mt-6 pt-4 border-t border-gray-100">
        <div className="flex items-center text-xs text-gray-500">
          <FiUser className="h-3 w-3 mr-1" />
          <span>Logged in as</span>
          <span className="ml-1 font-medium text-primary-600">
            {currentUser.displayName || currentUser.email}
          </span>
        </div>
      </div>
    )}

    {/* Data timestamp */}
    {lastUpdated && (
      <div className="mt-4 text-xs text-center text-gray-500">
        <div className="flex items-center justify-center">
          <FiClock className="mr-1 h-3 w-3" />
          <span>Data updated: {formatDateTime(lastUpdated)}</span>
        </div>
      </div>
    )}
  </div>
);

export default BrowseStatsCard;
