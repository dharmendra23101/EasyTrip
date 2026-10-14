import { FiEdit, FiEye, FiTrash2 } from 'react-icons/fi';
import Link from 'next/link';
import ImageWithFallback from '../../ImageWithFallback';
import { formatDateShort } from '../../../utils/dateFormat';
import { getPlaceImageUrl } from '../../../utils/placeImage';

export const PlaceTableDesktop = ({ manage }) => {
  const { filteredPlaces, confirmDelete } = manage;

  return (
    /* Table View */
    <div className="bg-white shadow-sm rounded-xl border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Place
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Location
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Last Updated
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {filteredPlaces.map((place) => (
              <tr key={place.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <div className="flex-shrink-0 h-10 w-10 rounded-lg overflow-hidden">
                      <ImageWithFallback
                        src={getPlaceImageUrl(place)}
                        alt={place.name}
                        width={40}
                        height={40}
                        className="h-10 w-10 object-cover"
                        fallbackSrc="/images/placeholder.jpg"
                      />
                    </div>
                    <div className="ml-4">
                      <div className="text-sm font-medium text-gray-900">{place.name}</div>
                      {place.tags && place.tags.length > 0 && (
                        <div className="text-xs text-gray-500 mt-1">
                          {place.tags.slice(0, 3).join(', ')}
                          {place.tags.length > 3 && '...'}
                        </div>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-gray-900">{place.location}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {formatDateShort(place.updated_at)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  <div className="flex items-center justify-end space-x-2">
                    <Link
                      href={`/places/${place.id}`}
                      className="text-gray-600 hover:text-primary-600 p-1 rounded transition-colors"
                      title="View Place"
                      aria-label={`View ${place.name}`}
                    >
                      <FiEye className="h-4 w-4" />
                    </Link>
                    <Link
                      href={`/admin/editPlace/${place.id}`}
                      className="text-primary-600 hover:text-primary-800 p-1 rounded transition-colors"
                      title="Edit Place"
                      aria-label={`Edit ${place.name}`}
                    >
                      <FiEdit className="h-4 w-4" />
                    </Link>
                    <button
                      onClick={() => confirmDelete(place)}
                      className="text-red-600 hover:text-red-800 p-1 rounded transition-colors"
                      title="Delete Place"
                      aria-label={`Delete ${place.name}`}
                    >
                      <FiTrash2 className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
