import { useState } from 'react';
import { FiChevronDown, FiList } from 'react-icons/fi';
import { motion, AnimatePresence } from 'framer-motion';

// Table of Contents component
export const TableOfContents = ({ sections }) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="bg-white rounded-2xl shadow-xl p-6 mb-8 border border-gray-100 hover:shadow-2xl transition-shadow duration-300">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between w-full"
      >
        <div className="flex items-center">
          <div className="p-2 bg-primary-100 rounded-lg mr-3">
            <FiList className="text-primary-600 h-5 w-5" />
          </div>
          {/* `h2`, not `h3`. The only heading above it is the place name (`h1`), so an `h3`
              skipped a level and axe reported `heading-order`. The size is a Tailwind class,
              so nothing moves on screen (`PE-022`). */}
          <h2 className="font-serif text-xl font-bold text-gray-900">In This Article</h2>
        </div>
        <FiChevronDown
          className={`h-5 w-5 text-gray-500 transform transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="overflow-hidden"
          >
            <ul className="mt-4 space-y-2 border-l-2 border-primary-100 pl-4">
              {sections.map((section, index) => (
                <li key={index} className="py-1">
                  <a
                    href={`#${section.id}`}
                    className="flex items-center text-gray-700 hover:text-primary-600 transition-colors"
                  >
                    <span className="text-primary-600 font-serif font-bold mr-2">{index + 1}</span>
                    <span className="font-medium">{section.title}</span>
                  </a>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
