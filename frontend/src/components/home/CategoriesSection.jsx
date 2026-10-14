import { motion } from 'framer-motion';
import { CategoryCard } from './CategoryCard';
import { CATEGORY_GRADIENTS } from './homeContent';

export const CategoriesSection = () => {
  return (
    <motion.section
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true }}
      variants={{
        hidden: { opacity: 0 },
        visible: { opacity: 1, transition: { staggerChildren: 0.1 } }
      }}
      className="py-12 sm:py-16 lg:py-20 bg-gray-50"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          variants={{
            hidden: { opacity: 0, y: 20 },
            visible: { opacity: 1, y: 0, transition: { duration: 0.5 } }
          }}
          className="text-center mb-8 sm:mb-12"
        >
          <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-4">Explore by Category</h2>
          <p className="text-sm sm:text-base lg:text-lg text-gray-600 max-w-3xl mx-auto">
            Find destinations that match your travel style and interests.
          </p>
        </motion.div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 sm:gap-3 md:gap-4">
          {[
            // CategoryCard links to /browse?theme=<lowercased label>, so every entry here must
            // lowercase to a real theme id in browse.jsx's themeOptions. 'City' did not, so that
            // tile always landed on an empty result set (IMP-021).
            'Adventure',
            'Historical',
            'Romantic',
            'Nature',
            'Religious',
            'Beach',
            'Mountain',
            'Family'
          ].map((category, index) => (
            <CategoryCard key={category} category={category} gradient={CATEGORY_GRADIENTS[index]} />
          ))}
        </div>
      </div>
    </motion.section>
  );
};
