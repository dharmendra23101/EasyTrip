import { useRouter } from 'next/router';
import { FiArrowLeft, FiPlus } from 'react-icons/fi';
import Link from 'next/link';

export const ManagePlacesHeader = ({ manage }) => {
  const router = useRouter();
  const { places, filteredPlaces, viewMode, setViewMode } = manage;

  return (
    <div className="flex flex-col space-y-4 sm:space-y-0 sm:flex-row sm:items-center sm:justify-between mb-6 sm:mb-8">
      <div className="flex-1">
        <button
          onClick={() => router.push('/admin')}
          className="flex items-center text-gray-600 hover:text-gray-900 mb-3 sm:mb-4 text-sm sm:text-base"
        >
          <FiArrowLeft className="mr-2 w-4 h-4 sm:w-5 sm:h-5" />
          Back to Dashboard
        </button>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Manage Places</h1>
        <p className="text-sm text-gray-600 mt-1">
          {filteredPlaces.length} of {places.length} places
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 sm:gap-2">
        {/* View Toggle for larger screens */}
        <div className="hidden sm:flex bg-white rounded-lg border border-gray-200 p-1">
          <button
            onClick={() => setViewMode('card')}
            className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
              viewMode === 'card'
                ? 'bg-primary-600 text-white'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Cards
          </button>
          <button
            onClick={() => setViewMode('table')}
            className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
              viewMode === 'table'
                ? 'bg-primary-600 text-white'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Table
          </button>
        </div>

        <Link
          href="/admin/addPlace"
          className="inline-flex items-center justify-center px-4 py-2 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 transition-colors"
        >
          <FiPlus className="mr-2 h-4 w-4" />
          Add Place
        </Link>
      </div>
    </div>
  );
};
