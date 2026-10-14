import { useState } from 'react';
import { FiImage } from 'react-icons/fi';
import { getPlaceImageUrl } from '../../utils/placeImage';

// CarouselImage component with better loading states
export const CarouselImage = ({ place }) => {
  const [imageState, setImageState] = useState('loading');

  // The API resolves the gallery fallback into `fallback_image_url` (IMP-037); this used to check
  // `image_url`, which is a column on place_images and never present on a place row — so a place
  // whose only image was in the gallery showed the placeholder. One helper now (IMP-073).
  const getImageUrl = () => getPlaceImageUrl(place);

  return (
    <div className="relative h-full overflow-hidden bg-gradient-to-br from-blue-100 to-purple-100">
      {/* Loading skeleton */}
      {imageState === 'loading' && (
        <div className="absolute inset-0 bg-gradient-to-r from-gray-200 via-gray-300 to-gray-200 animate-pulse">
          <div className="absolute inset-0 bg-gradient-to-t from-gray-400/20 to-transparent"></div>
        </div>
      )}

      {/* Error state */}
      {imageState === 'error' && (
        <div className="absolute inset-0 bg-gradient-to-br from-blue-100 to-purple-100 flex items-center justify-center">
          <div className="text-center">
            <FiImage className="h-8 w-8 sm:h-12 sm:w-12 text-primary-400 mx-auto mb-2 sm:mb-3" />
            <p className="text-primary-600 text-xs sm:text-sm font-medium">{place?.name}</p>
            <p className="text-primary-500 text-xs">Explore this destination</p>
          </div>
        </div>
      )}

      {/* Main image */}
      <img
        src={getImageUrl()}
        alt={place?.name || 'Featured Destination'}
        className={`w-full h-full object-cover transition-all duration-700 ease-out ${
          imageState === 'loaded' ? 'opacity-100 scale-100' : 'opacity-0 scale-105'
        }`}
        loading="eager"
        onLoad={() => setImageState('loaded')}
        onError={() => setImageState('error')}
      />

      {/* Gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent"></div>
    </div>
  );
};
