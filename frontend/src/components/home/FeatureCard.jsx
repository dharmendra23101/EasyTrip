import { motion } from 'framer-motion';

// FeatureCard component
export const FeatureCard = ({ icon, title, description }) => (
  <motion.div
    variants={{
      hidden: { opacity: 0, y: 20 },
      visible: { opacity: 1, y: 0, transition: { duration: 0.5 } }
    }}
    className="bg-white p-4 sm:p-6 rounded-xl shadow-lg backdrop-blur-sm border border-gray-100/50 hover:shadow-xl transition-shadow duration-300"
    whileHover={{ y: -5 }}
  >
    <div className="w-10 h-10 sm:w-12 sm:h-12 bg-primary-100 text-primary-600 rounded-full flex items-center justify-center mb-4 sm:mb-6 mx-auto">
      {icon}
    </div>
    <h3 className="text-lg sm:text-xl font-semibold text-gray-900 mb-2 text-center">{title}</h3>
    <p className="text-sm sm:text-base text-gray-600 text-center">{description}</p>
  </motion.div>
);
