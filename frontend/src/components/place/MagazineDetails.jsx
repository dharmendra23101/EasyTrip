import { FiInfo, FiTag } from 'react-icons/fi';
import { motion } from 'framer-motion';

// Enhanced Additional Details with magazine layout
export const MagazineDetails = ({ customKeys, themes, isLoading = false }) => {
  // Filter out system fields and empty values
  const filteredCustomKeys = customKeys
    ? Object.entries(customKeys).filter(([key, value]) => {
        const systemFields = [
          'created_by',
          'created_at',
          'updated_by',
          'updated_at',
          'created_by_name',
          'updated_by_name',
          'previous_update'
        ];
        return !systemFields.includes(key) && value && value.toString().trim() !== '';
      })
    : [];

  const hasContent = (themes && themes.length > 0) || filteredCustomKeys.length > 0;

  if (isLoading) {
    return (
      <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-100">
        <div className="flex items-center mb-6">
          <div className="w-12 h-12 bg-gray-200 rounded-lg mr-4 animate-pulse" />
          <div className="h-8 bg-gray-200 rounded w-64 animate-pulse" />
        </div>
        <div className="space-y-4">
          <div className="h-6 bg-gray-200 rounded w-32 animate-pulse" />
          <div className="flex flex-wrap gap-2">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-8 bg-gray-200 rounded-full w-20 animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!hasContent) {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6 }}
      className="bg-white rounded-2xl shadow-xl p-8 border border-gray-100"
    >
      <div className="flex items-center mb-8">
        <div className="p-3 bg-purple-100 rounded-lg mr-4">
          <FiInfo className="text-purple-600 h-6 w-6" />
        </div>
        <h3 className="text-3xl font-serif font-bold text-gray-900">Essential Details</h3>
      </div>

      <div className="space-y-10">
        {/* Themes as magazine-style tags */}
        {themes && themes.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <h4 className="text-lg font-serif font-bold text-gray-800 mb-5 flex items-center border-b border-gray-200 pb-2">
              <FiTag className="mr-2 h-5 w-5 text-purple-600" />
              Perfect For
            </h4>
            <div className="flex flex-wrap gap-3">
              {themes.map((theme, index) => {
                // Create different styles for variety
                const styles = [
                  'from-purple-500 to-pink-500',
                  'from-blue-500 to-indigo-500',
                  'from-emerald-500 to-teal-500',
                  'from-amber-500 to-orange-500',
                  'from-rose-500 to-red-500'
                ];

                return (
                  <motion.span
                    key={index}
                    initial={{ opacity: 0, scale: 0.8, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    transition={{ delay: 0.3 + index * 0.1 }}
                    className={`bg-gradient-to-r ${styles[index % styles.length]} text-white text-sm font-medium px-5 py-2.5 rounded-full shadow-md`}
                  >
                    {theme.charAt(0).toUpperCase() + theme.slice(1)}
                  </motion.span>
                );
              })}
            </div>
          </motion.div>
        )}

        {/* Custom Keys in a magazine layout */}
        {filteredCustomKeys.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            <h4 className="text-lg font-serif font-bold text-gray-800 mb-5 flex items-center border-b border-gray-200 pb-2">
              <FiInfo className="mr-2 h-5 w-5 text-purple-600" />
              Important Information
            </h4>
            {/*
              A `dl`, not a `div` — these are `dt`/`dd` pairs, and outside a `dl` they are invalid
              markup that carries no term/definition relationship for a screen reader. Found by an
              axe-core pass in Sprint 6.17 (`dlitem`, serious, 4 nodes on `/places/1`); the sibling
              list in `admin/index.jsx` already had it right.

              Each pair keeps its own wrapper for the card styling. HTML5 allows a `div` to group a
              name/value pair inside a `dl` precisely so a group can be styled as a unit, and
              Tailwind's preflight zeroes the `dl` margin, so nothing moves on screen.
            */}
            <dl className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {filteredCustomKeys.map(([key, value], index) => {
                // Different card styles for visual interest
                const cardStyles = [
                  'bg-gray-50 border-gray-200',
                  'bg-primary-50 border-primary-200',
                  'bg-amber-50 border-amber-200',
                  'bg-emerald-50 border-emerald-200',
                  'bg-rose-50 border-rose-200',
                  'bg-violet-50 border-violet-200'
                ];

                const style = cardStyles[index % cardStyles.length];

                return (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.4 + index * 0.1 }}
                    className={`rounded-xl p-5 border ${style}`}
                  >
                    <dt className="text-sm font-semibold text-gray-600 uppercase tracking-wider mb-2">
                      {key.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
                    </dt>
                    <dd className="text-gray-900 font-serif text-lg">{value}</dd>
                  </motion.div>
                );
              })}
            </dl>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
};
