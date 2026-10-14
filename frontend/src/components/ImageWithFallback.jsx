import { useState, useEffect } from 'react';
import Image from 'next/image';

/**
 * An image with a placeholder fallback, used by the three admin `managePlaces` views.
 *
 * **Two things were removed here in Sprint 6.16, both of which `PlaceCard` had already fixed.**
 * This is the second copy of a defect whose first copy was repaired — the same shape as `IMP-122`,
 * where tracing "the last two `formatDate` copies" turned up seven.
 *
 * 1. **A `?t=${Date.now()}` cache-buster.** `PlaceCard`'s comment describes exactly why it went:
 *    *"It was meant to be development-only, but it was evaluated on every render, so any re-render
 *    produced a new URL and re-downloaded the image — and it made the browser cache useless for the
 *    whole session."* Every word applied here too. It was gated on `NODE_ENV === 'development'`, so
 *    production users never saw it, but `next dev` is what the E2E suite and every developer runs.
 *
 * 2. **A `showTimestamp` debug overlay** rendering `new Date().toISOString()`. No caller ever
 *    passed the prop, so it never ran — but `/admin/managePlaces` is server-rendered, and a
 *    timestamp evaluated during render is a server/client mismatch by construction. That is
 *    `BUG-046`, which shipped twice. The date lint rule does not cover it: `toISOString()` is
 *    zone-safe, and the hazard here is hydration rather than time zone.
 */
const ImageWithFallback = ({ src, alt, width, height, className, objectFit, priority }) => {
  const [imgSrc, setImgSrc] = useState('');
  const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // Reset state when the source changes, so a new src does not inherit the previous one's
    // error/loaded flags and render as permanently broken or permanently loading.
    setImgSrc(src);
    setError(false);
    setLoaded(false);
  }, [src, alt]);

  const finalSrc = imgSrc || '/images/placeholder.jpg';

  return (
    <div className={`relative ${className || ''}`}>
      {!loaded && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-200 animate-pulse">
          <span className="text-gray-500 text-sm">Loading...</span>
        </div>
      )}

      <Image
        src={error ? '/images/placeholder.jpg' : finalSrc}
        alt={alt || 'Image'}
        width={width || 500}
        height={height || 300}
        className={`${objectFit || 'object-cover'} w-full h-full rounded-lg ${loaded ? 'opacity-100' : 'opacity-0'} transition-opacity duration-300`}
        priority={priority}
        onError={() => {
          console.error(`Image load error for: ${imgSrc}`, alt);
          setError(true);
          setLoaded(true);
        }}
        onLoad={() => {
          setLoaded(true);
        }}
      />
    </div>
  );
};

export default ImageWithFallback;
