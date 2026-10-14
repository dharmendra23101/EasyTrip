import Link from 'next/link';
import { FiAlertCircle, FiArrowLeft, FiRefreshCw } from 'react-icons/fi';
import { motion } from 'framer-motion';
import LoadingSpinner from '../LoadingSpinner';

/** Full-page state while the place itself is still loading — reached only when the page was not
 *  pre-rendered with a payload (IMP-040). */
export const PlaceLoadingState = () => (
  <div className="min-h-screen bg-gray-50 flex items-center justify-center">
    <div className="text-center">
      <LoadingSpinner size="large" />
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="mt-6 text-xl text-gray-600 font-serif italic"
      >
        Loading destination...
      </motion.p>
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1 }}
        className="mt-2 text-sm text-gray-500"
      >
        Preparing a beautiful experience for you
      </motion.p>
    </div>
  </div>
);

/** Full-page state when the place could not be loaded at all. `onRetry` re-runs the client fetch. */
export const PlaceErrorState = ({ error, onRetry }) => (
  <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="text-center bg-white rounded-2xl shadow-xl p-8 max-w-md border border-gray-100"
    >
      <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
        <FiAlertCircle className="w-10 h-10 text-red-500" />
      </div>
      <h2 className="text-2xl font-serif font-bold text-gray-900 mb-3">Something went wrong</h2>
      <p className="text-gray-600 mb-8 leading-relaxed">{error}</p>
      <div className="flex flex-col sm:flex-row gap-3">
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => onRetry()}
          className="flex-1 bg-primary-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-primary-700 transition-colors flex items-center justify-center"
        >
          <FiRefreshCw className="mr-2 h-4 w-4" />
          Try Again
        </motion.button>
        <Link
          href="/browse"
          className="flex-1 bg-gray-100 text-gray-700 px-6 py-3 rounded-lg font-medium hover:bg-gray-200 transition-colors text-center flex items-center justify-center"
        >
          <FiArrowLeft className="mr-2 h-4 w-4" />
          Explore Places
        </Link>
      </div>
    </motion.div>
  </div>
);

/** Skeleton for the article column while the non-critical payload resolves. */
export const PlaceArticleSkeleton = () => (
  <div className="space-y-12">
    {/* Loading skeletons */}
    <div className="bg-white rounded-2xl shadow-xl p-8 animate-pulse">
      <div className="h-8 bg-gray-200 rounded w-1/3 mb-6"></div>
      <div className="space-y-4">
        <div className="h-4 bg-gray-200 rounded w-full"></div>
        <div className="h-4 bg-gray-200 rounded w-5/6"></div>
        <div className="h-4 bg-gray-200 rounded w-4/6"></div>
      </div>
    </div>

    <div className="bg-white rounded-2xl shadow-xl p-8 animate-pulse">
      <div className="h-8 bg-gray-200 rounded w-1/4 mb-6"></div>
      <div className="grid grid-cols-2 gap-4">
        <div className="h-24 bg-gray-200 rounded"></div>
        <div className="h-24 bg-gray-200 rounded"></div>
        <div className="h-24 bg-gray-200 rounded"></div>
        <div className="h-24 bg-gray-200 rounded"></div>
      </div>
    </div>
  </div>
);
