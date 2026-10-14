import { motion } from 'framer-motion';
import Link from 'next/link';

// CategoryCard component
export const CategoryCard = ({ category, gradient }) => (
  <motion.div
    variants={{
      hidden: { opacity: 0, y: 20 },
      visible: { opacity: 1, y: 0, transition: { duration: 0.5 } }
    }}
  >
    <Link href={`/browse?theme=${category.toLowerCase()}`} passHref>
      <motion.div
        whileHover={{ y: -3, scale: 1.02 }}
        className={`relative h-24 sm:h-32 md:h-40 rounded-xl overflow-hidden group cursor-pointer ${gradient}`}
      >
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent group-hover:from-black/40 transition-all duration-300"></div>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-white font-bold text-sm sm:text-lg md:text-xl drop-shadow-lg">
            {category}
          </span>
        </div>
      </motion.div>
    </Link>
  </motion.div>
);

// Main Home component
//
// Data arrives as props from `getStaticProps` below, so the carousel is in the HTML the server
// sends rather than three stages behind it (IMP-040). There is no loading state left to model:
