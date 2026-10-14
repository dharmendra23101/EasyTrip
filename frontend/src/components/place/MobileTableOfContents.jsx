import { FiMenu, FiX } from 'react-icons/fi';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * The floating jump-to-section control, mobile only.
 *
 * The desktop equivalent is `TableOfContents`, which is a collapsible card in the content column
 * rather than an overlay — they are separate components because they are separate layouts, not
 * because the list differs.
 */
export const MobileTableOfContents = ({ sections, activeSection, isOpen, onToggle, onClose }) => (
  <>
    {/* Floating table of contents toggle button */}
    <div className="fixed bottom-6 right-6 z-40 md:hidden">
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={onToggle}
        className="bg-primary-600 text-white p-4 rounded-full shadow-lg flex items-center justify-center"
      >
        {isOpen ? <FiX className="h-6 w-6" /> : <FiMenu className="h-6 w-6" />}
      </motion.button>
    </div>

    {/* Mobile table of contents */}
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, y: 50 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 50 }}
          className="fixed bottom-20 right-6 z-40 bg-white rounded-xl shadow-xl p-4 w-64 md:hidden"
        >
          <h3 className="font-bold text-gray-900 mb-2 border-b pb-2">On This Page</h3>
          <ul className="space-y-2">
            {sections.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className={`block py-2 px-3 rounded-lg text-sm ${
                    activeSection === section.id
                      ? 'bg-primary-50 text-primary-700 font-medium'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                  onClick={onClose}
                >
                  {section.title}
                </a>
              </li>
            ))}
          </ul>
        </motion.div>
      )}
    </AnimatePresence>
  </>
);
