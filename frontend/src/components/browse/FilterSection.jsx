/**
 * A collapsible filter group (IMP-070).
 *
 * Both filter panels use it — the mobile dialog and the desktop sidebar render the same five
 * sections — which is why it is a shared component rather than living inside either one.
 */
import { motion, AnimatePresence } from 'framer-motion';
import { FiChevronDown } from 'react-icons/fi';

// Enhanced filter section component with animations
const FilterSection = ({ title, icon, collapsed, onToggle, children }) => (
  <div className="border-b border-gray-200 py-4">
    <button
      onClick={onToggle}
      className="flex w-full items-center justify-between text-base font-medium text-gray-900 group"
      aria-expanded={!collapsed}
    >
      <div className="flex items-center">
        {icon && (
          <span className="mr-2 group-hover:text-primary-600 transition-colors">{icon}</span>
        )}
        <span className="group-hover:text-primary-600 transition-colors">{title}</span>
      </div>
      <motion.div
        className="bg-gray-100 group-hover:bg-primary-100 rounded-full p-1 transition-colors"
        whileTap={{ scale: 0.95 }}
      >
        <motion.div
          initial={false}
          animate={{ rotate: collapsed ? 0 : 180 }}
          transition={{ duration: 0.3, type: 'spring' }}
        >
          <FiChevronDown className="h-4 w-4 group-hover:text-primary-600 transition-colors" />
        </motion.div>
      </motion.div>
    </button>

    <AnimatePresence initial={false}>
      {!collapsed && (
        <motion.div
          initial={{ height: 0, opacity: 0, overflow: 'hidden' }}
          animate={{
            height: 'auto',
            opacity: 1,
            transition: { duration: 0.3, ease: [0.33, 1, 0.68, 1] }
          }}
          exit={{
            height: 0,
            opacity: 0,
            transition: { duration: 0.2, ease: [0.33, 1, 0.68, 1] }
          }}
          className="overflow-hidden"
        >
          <div className="mt-4">{children}</div>
        </motion.div>
      )}
    </AnimatePresence>
  </div>
);

export default FilterSection;
