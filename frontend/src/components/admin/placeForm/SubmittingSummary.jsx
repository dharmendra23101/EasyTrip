import { FiLoader } from 'react-icons/fi';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * Shown under the form while the create request is in flight.
 *
 * **The steps listed here have to be steps the request actually takes** (`IMP-125`). Two of them
 * were not:
 *
 * - *"Uploading image to Firebase Storage"* — images go to **Cloudinary**. `placeController.js`
 *   imports `../config/cloudinary` and has never touched Firebase Storage. Firebase is used for
 *   auth, which is probably how the wrong service name got here.
 * - *"Setting up admin permissions"* — the request does nothing of the kind. Creating a place
 *   writes a row; it grants nobody anything.
 *
 * Progress copy is read by exactly the person who would be misled by it: an admin waiting on a
 * request, forming a mental model of where their data went. Naming the wrong storage provider is
 * the kind of thing that sends someone to the wrong dashboard when an image goes missing.
 */
export const SubmittingSummary = ({ isSubmitting, primaryImage }) => (
  <AnimatePresence>
    {isSubmitting && (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        className="mt-6 bg-primary-50 border border-primary-200 rounded-xl p-4 sm:p-6"
      >
        <div className="flex items-center mb-4">
          <FiLoader className="animate-spin h-5 w-5 text-primary-600 mr-3" />
          <h3 className="text-base sm:text-lg font-semibold text-primary-900">
            Creating Your Place...
          </h3>
        </div>
        <div className="text-xs sm:text-sm text-primary-700 space-y-1">
          <p>• Validating form data</p>
          <p>• {primaryImage ? 'Uploading image to Cloudinary' : 'Preparing place data'}</p>
          <p>• Saving to database</p>
        </div>
      </motion.div>
    )}
  </AnimatePresence>
);
