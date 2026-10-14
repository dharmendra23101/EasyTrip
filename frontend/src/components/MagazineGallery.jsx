import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FiCamera, FiEye, FiX, FiChevronLeft, FiChevronRight } from 'react-icons/fi';

const MagazineGallery = ({ images, placeName }) => {
  const [activeIndex, setActiveIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const dialogRef = useRef(null);
  // Where focus was before the lightbox opened, so it can be handed back on close. Without this a
  // keyboard user is returned to the top of the document and has to tab all the way back.
  const openerRef = useRef(null);

  const showPrevious = useCallback(
    () => setActiveIndex((i) => (i === 0 ? images.length - 1 : i - 1)),
    [images.length]
  );
  const showNext = useCallback(
    () => setActiveIndex((i) => (i === images.length - 1 ? 0 : i + 1)),
    [images.length]
  );

  const openLightbox = (index, event) => {
    openerRef.current = event?.currentTarget || null;
    setActiveIndex(index);
    setLightboxOpen(true);
  };

  // Escape to close, arrows to navigate, and a focus trap. Previously the lightbox had none of
  // these: the background stayed tabbable behind the overlay, so a keyboard user could tab into
  // page content they could not see, and there was no way to close it without a mouse (IMP-078).
  useEffect(() => {
    if (!lightboxOpen) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setLightboxOpen(false);
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        showPrevious();
        return;
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        showNext();
        return;
      }
      if (event.key !== 'Tab') return;

      // Focus trap: cycle within the dialog rather than escaping to the page behind it.
      const focusable = dialogRef.current?.querySelectorAll(
        'button, [href], [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    // The page behind must not scroll while a full-screen overlay is up.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Move focus into the dialog so the very next Tab stays inside it.
    dialogRef.current?.focus();

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      openerRef.current?.focus();
    };
  }, [lightboxOpen, showPrevious, showNext]);

  if (!images || images.length === 0) {
    return (
      <div className="bg-gray-50 rounded-xl p-8 text-center">
        <FiCamera className="h-12 w-12 text-gray-400 mx-auto mb-3" />
        <p className="text-gray-500">No images available for this destination yet.</p>
      </div>
    );
  }

  return (
    <div>
      {/* Main gallery grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {images.map((image, index) => (
          <motion.button
            key={index}
            type="button"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="relative aspect-square overflow-hidden rounded-xl shadow-md cursor-pointer block w-full"
            onClick={(event) => openLightbox(index, event)}
            aria-label={`View image ${index + 1} of ${images.length} full size`}
          >
            <img
              src={image.image_url}
              alt={`${placeName} - Image ${index + 1}`}
              className="w-full h-full object-cover transition-transform duration-300 hover:scale-110"
              onError={(e) => {
                e.target.src = '/images/placeholder.jpg';
              }}
            />
            <div className="absolute inset-0 bg-black bg-opacity-0 hover:bg-opacity-30 transition-opacity duration-300 flex items-center justify-center">
              <div className="opacity-0 hover:opacity-100 text-white">
                <FiEye className="h-8 w-8" />
              </div>
            </div>
          </motion.button>
        ))}
      </div>

      {/* Lightbox */}
      <AnimatePresence>
        {lightboxOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={`${placeName} image viewer`}
            tabIndex={-1}
            className="fixed inset-0 z-50 bg-black bg-opacity-90 flex items-center justify-center p-4 focus:outline-none"
            onClick={() => setLightboxOpen(false)}
          >
            <button
              className="absolute top-4 right-4 text-white p-2 rounded-full bg-black bg-opacity-50 hover:bg-opacity-70 z-10"
              aria-label="Close image viewer"
              onClick={(e) => {
                e.stopPropagation();
                setLightboxOpen(false);
              }}
            >
              <FiX className="h-6 w-6" />
            </button>

            {/* Navigation buttons */}
            <button
              className="absolute left-4 text-white p-3 rounded-full bg-black bg-opacity-50 hover:bg-opacity-70 z-10"
              aria-label="Previous image"
              onClick={(e) => {
                e.stopPropagation();
                showPrevious();
              }}
            >
              <FiChevronLeft className="h-6 w-6" />
            </button>

            <button
              className="absolute right-4 text-white p-3 rounded-full bg-black bg-opacity-50 hover:bg-opacity-70 z-10"
              aria-label="Next image"
              onClick={(e) => {
                e.stopPropagation();
                showNext();
              }}
            >
              <FiChevronRight className="h-6 w-6" />
            </button>

            {/* Current image */}
            <motion.div
              key={activeIndex}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="relative max-w-4xl max-h-[80vh] mx-auto"
            >
              <img
                src={images[activeIndex].image_url}
                alt={`${placeName} - Image ${activeIndex + 1}`}
                className="max-w-full max-h-[80vh] object-contain"
                onError={(e) => {
                  e.target.src = '/images/placeholder.jpg';
                }}
              />

              {/* Image counter */}
              <div
                role="status"
                aria-live="polite"
                className="absolute bottom-4 left-1/2 transform -translate-x-1/2 text-white bg-black bg-opacity-50 px-4 py-2 rounded-full text-sm"
              >
                {activeIndex + 1} / {images.length}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default MagazineGallery;
