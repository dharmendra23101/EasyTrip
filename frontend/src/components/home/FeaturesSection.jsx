import { FiArrowRight, FiCompass, FiHeart, FiStar } from 'react-icons/fi';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { FeatureCard } from './FeatureCard';

export const FeaturesSection = () => {
  return (
    <motion.section
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true }}
      variants={{
        hidden: { opacity: 0 },
        visible: { opacity: 1, transition: { staggerChildren: 0.2 } }
      }}
      className="py-12 sm:py-16 lg:py-20 bg-white"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          variants={{
            hidden: { opacity: 0, y: 20 },
            visible: { opacity: 1, y: 0, transition: { duration: 0.5 } }
          }}
          className="text-center mb-8 sm:mb-12"
        >
          <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-4">Why Choose EasyTrip</h2>
          <p className="text-sm sm:text-base lg:text-lg text-gray-600 max-w-3xl mx-auto">
            Curated destinations and personalized recommendations for seamless travel planning.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6 lg:gap-8">
          {[
            {
              icon: <FiCompass className="h-5 w-5 sm:h-6 sm:w-6" />,
              title: 'Curated Destinations',
              description: 'Handpicked places with detailed information and authentic reviews.'
            },
            {
              icon: <FiStar className="h-5 w-5 sm:h-6 sm:w-6" />,
              title: 'Real Reviews',
              description: 'Genuine feedback from travelers to help you make informed decisions.'
            },
            {
              icon: <FiHeart className="h-5 w-5 sm:h-6 sm:w-6" />,
              title: 'Personalized Experience',
              description: 'Smart recommendations based on your preferences and interests.'
            }
          ].map((feature, index) => (
            <FeatureCard key={index} {...feature} />
          ))}
        </div>

        <motion.div
          variants={{
            hidden: { opacity: 0, y: 20 },
            visible: { opacity: 1, y: 0, transition: { duration: 0.5 } }
          }}
          className="mt-8 sm:mt-12 text-center"
        >
          <Link href="/browse" passHref>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="px-6 sm:px-8 py-3 bg-primary-600 text-white font-medium rounded-lg flex items-center mx-auto text-sm sm:text-base shadow-lg hover:bg-primary-700 transition-colors"
            >
              Start Exploring
              <FiArrowRight className="ml-2 h-4 w-4" />
            </motion.button>
          </Link>
        </motion.div>
      </div>
    </motion.section>
  );
};
