import { FiAlertCircle, FiMapPin, FiPlus, FiRefreshCw } from 'react-icons/fi';
import Link from 'next/link';

/** An outage must never render as "No places yet" — that tells an admin their data is gone and
 *  invites them to re-create it (IMP-031). */
export const PlaceListError = ({ loadError, onRetry }) => (
  <div className="bg-white shadow-sm rounded-xl border border-red-200 p-8 text-center">
    <div className="max-w-md mx-auto">
      <FiAlertCircle className="mx-auto h-12 w-12 text-red-400 mb-4" />
      <h3 className="text-lg font-medium text-gray-900 mb-2">Couldn&apos;t load places</h3>
      <p className="text-gray-500 mb-2">{loadError}</p>
      <p className="text-gray-500 mb-6 text-sm">
        Your places are still there — this is a problem reaching the server, not an empty database.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center px-4 py-2 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700"
      >
        <FiRefreshCw className="mr-2 h-4 w-4" />
        Try again
      </button>
    </div>
  </div>
);

/** No rows at all: either nothing has been added yet, or the filters exclude everything. */
export const PlaceListEmpty = ({ places }) => (
  <div className="bg-white shadow-sm rounded-xl border border-gray-200 p-8 text-center">
    <div className="max-w-md mx-auto">
      <FiMapPin className="mx-auto h-12 w-12 text-gray-500 mb-4" />
      <h3 className="text-lg font-medium text-gray-900 mb-2">
        {places.length === 0 ? 'No places yet' : 'No matching places'}
      </h3>
      <p className="text-gray-500 mb-6">
        {places.length === 0
          ? 'Get started by adding your first place to the platform.'
          : 'Try adjusting your search or filter criteria.'}
      </p>
      {places.length === 0 && (
        <Link
          href="/admin/addPlace"
          className="inline-flex items-center px-4 py-2 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none"
        >
          <FiPlus className="mr-2 h-4 w-4" />
          Add First Place
        </Link>
      )}
    </div>
  </div>
);
