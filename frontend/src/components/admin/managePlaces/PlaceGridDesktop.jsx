import { FiClock, FiEdit, FiEye, FiMapPin, FiTrash2 } from 'react-icons/fi';
import Link from 'next/link';
import ImageWithFallback from '../../ImageWithFallback';
import { formatDateShort } from '../../../utils/dateFormat';
import { getPlaceImageUrl } from '../../../utils/placeImage';

export const PlaceGridDesktop = ({ manage }) => {
  const { filteredPlaces, confirmDelete, truncateText } = manage;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {filteredPlaces.map((place) => (
        <div
          key={place.id}
          className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow"
        >
          {/* Card Image */}
          <div className="aspect-video bg-gray-100">
            <ImageWithFallback
              src={getPlaceImageUrl(place)}
              alt={place.name}
              width={400}
              height={225}
              className="w-full h-full object-cover"
              fallbackSrc="/images/placeholder.jpg"
            />
          </div>

          {/* Card Content */}
          <div className="p-6">
            <div className="flex items-start justify-between mb-2">
              <h3 className="text-lg font-semibold text-gray-900 truncate flex-1">{place.name}</h3>
              <div className="ml-2 flex items-center space-x-2">
                <Link
                  href={`/places/${place.id}`}
                  className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] p-1 text-gray-500 hover:text-primary-600 rounded transition-colors"
                  title="View Place"
                  aria-label={`View ${place.name}`}
                >
                  <FiEye className="w-4 h-4" />
                </Link>
                <Link
                  href={`/admin/editPlace/${place.id}`}
                  className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] p-1 text-gray-500 hover:text-primary-600 rounded transition-colors"
                  title="Edit Place"
                  aria-label={`Edit ${place.name}`}
                >
                  <FiEdit className="w-4 h-4" />
                </Link>
                <button
                  onClick={() => confirmDelete(place)}
                  className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] p-1 text-gray-500 hover:text-red-600 rounded transition-colors"
                  title="Delete Place"
                  aria-label={`Delete ${place.name}`}
                >
                  <FiTrash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex items-center text-sm text-gray-500 mb-3">
              <FiMapPin className="w-4 h-4 mr-1 flex-shrink-0" />
              <span className="truncate">{place.location}</span>
            </div>

            {place.description && (
              <p className="text-gray-600 text-sm mb-3 line-clamp-2">
                {truncateText(place.description, 120)}
              </p>
            )}

            {/* Tags */}
            {place.tags && place.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-4">
                {place.tags.slice(0, 3).map((tag, index) => (
                  <span
                    key={index}
                    className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-primary-50 text-primary-700"
                  >
                    {tag}
                  </span>
                ))}
                {place.tags.length > 3 && (
                  <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                    +{place.tags.length - 3}
                  </span>
                )}
              </div>
            )}

            {/* Meta Info */}
            <div className="flex items-center justify-end text-xs text-gray-500 pt-3 border-t border-gray-100">
              <div className="flex items-center">
                <FiClock className="w-3 h-3 mr-1" />
                <span>{formatDateShort(place.updated_at)}</span>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};
