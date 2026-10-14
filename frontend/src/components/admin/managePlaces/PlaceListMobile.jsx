import { FiClock, FiEdit, FiEye, FiMapPin, FiTrash2 } from 'react-icons/fi';
import Link from 'next/link';
import ImageWithFallback from '../../ImageWithFallback';
import { formatDateShort } from '../../../utils/dateFormat';
import { getPlaceImageUrl } from '../../../utils/placeImage';

export const PlaceListMobile = ({ manage }) => {
  const { filteredPlaces, confirmDelete } = manage;

  return (
    <div className="block sm:hidden space-y-4">
      {filteredPlaces.map((place) => (
        <div
          key={place.id}
          className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden"
        >
          <div className="flex p-4">
            {/* Place Image */}
            <div className="flex-shrink-0 mr-4">
              <div className="w-16 h-16 rounded-lg overflow-hidden bg-gray-100">
                <ImageWithFallback
                  src={getPlaceImageUrl(place)}
                  alt={place.name}
                  width={64}
                  height={64}
                  className="w-full h-full object-cover"
                  fallbackSrc="/images/placeholder.jpg"
                />
              </div>
            </div>

            {/* Place Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <h3 className="text-lg font-semibold text-gray-900 truncate">{place.name}</h3>
                  <div className="flex items-center text-sm text-gray-500 mt-1">
                    <FiMapPin className="w-4 h-4 mr-1 flex-shrink-0" />
                    <span className="truncate">{place.location}</span>
                  </div>
                </div>

                {/* Action Menu */}
                <div className="ml-2 flex-shrink-0">
                  <div className="flex items-center space-x-2">
                    <Link
                      href={`/places/${place.id}`}
                      className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] p-2 text-gray-500 hover:text-primary-600 rounded-lg hover:bg-primary-50 transition-colors"
                      title="View Place"
                      aria-label={`View ${place.name}`}
                    >
                      <FiEye className="w-4 h-4" />
                    </Link>
                    <Link
                      href={`/admin/editPlace/${place.id}`}
                      className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] p-2 text-gray-500 hover:text-primary-600 rounded-lg hover:bg-primary-50 transition-colors"
                      title="Edit Place"
                      aria-label={`Edit ${place.name}`}
                    >
                      <FiEdit className="w-4 h-4" />
                    </Link>
                    <button
                      onClick={() => confirmDelete(place)}
                      className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] p-2 text-gray-500 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors"
                      title="Delete Place"
                      aria-label={`Delete ${place.name}`}
                    >
                      <FiTrash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Tags */}
              {place.tags && place.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {place.tags.slice(0, 2).map((tag, index) => (
                    <span
                      key={index}
                      className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-primary-50 text-primary-700"
                    >
                      {tag}
                    </span>
                  ))}
                  {place.tags.length > 2 && (
                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                      +{place.tags.length - 2}
                    </span>
                  )}
                </div>
              )}

              {/* Meta Info */}
              <div className="flex items-center justify-end mt-3 text-xs text-gray-500">
                <div className="flex items-center">
                  <FiClock className="w-3 h-3 mr-1" />
                  <span>{formatDateShort(place.updated_at)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};
