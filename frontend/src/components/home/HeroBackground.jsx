import { motion, AnimatePresence } from 'framer-motion';
import { getPlaceImageUrl } from '../../utils/placeImage';

export const HeroBackground = ({ home }) => {
  const { places, currentPlaceIndex } = home;

  return (
    <>
      {/* Dynamic Background Image */}
      <AnimatePresence mode="wait">
        <motion.div
          key={currentPlaceIndex}
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{
            backgroundImage: `url(${getPlaceImageUrl(places[currentPlaceIndex], '/images/hero-bg.jpg')})`
          }}
          initial={{ opacity: 0, scale: 1.1 }}
          animate={{ opacity: 0.3, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 1, ease: 'easeInOut' }}
        />
      </AnimatePresence>

      {/* Overlay */}
    </>
  );
};
