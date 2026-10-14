import { FiArrowLeft, FiLoader, FiMinus, FiPlus, FiSave, FiTag, FiX } from 'react-icons/fi';
import { motion } from 'framer-motion';
import { tagSuggestions } from './placeFormOptions';

export const StepTagsDetails = ({ form, router }) => {
  const {
    formData,
    newTag,
    newKeyName,
    newKeyValue,
    isSubmitting,
    showTagSuggestions,
    setNewTag,
    setNewKeyName,
    setNewKeyValue,
    setShowTagSuggestions,
    handleAddTag,
    handleRemoveTag,
    handleAddCustomKey,
    handleRemoveCustomKey,
    goToStep
  } = form;

  return (
    <motion.div
      key="step4"
      initial={{ opacity: 0, x: 50 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -50 }}
      className="p-4 sm:p-6 lg:p-8"
    >
      <div className="flex items-center mb-6">
        <div className="p-2 sm:p-3 bg-yellow-100 rounded-lg mr-3 sm:mr-4">
          <FiTag className="text-yellow-600 h-5 w-5 sm:h-6 sm:w-6" />
        </div>
        <h2 className="text-xl sm:text-2xl font-bold text-gray-900">Tags & Additional Details</h2>
      </div>

      {/* Tags Section */}
      <div className="mb-8">
        <h3 className="text-base sm:text-lg font-semibold text-gray-800 mb-4">Tags</h3>

        <div className="flex flex-wrap gap-2 mb-4">
          {formData.tags.map((tag, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex items-center bg-primary-50 text-primary-700 px-3 py-2 rounded-full border border-primary-200"
            >
              <span className="text-xs sm:text-sm font-medium">{tag}</span>
              <button
                type="button"
                onClick={() => handleRemoveTag(tag)}
                className="ml-2 text-primary-500 hover:text-primary-700 transition-colors"
              >
                <FiX className="w-3 h-3 sm:w-4 sm:h-4" />
              </button>
            </motion.div>
          ))}
        </div>

        <div className="relative">
          <div className="flex flex-col sm:flex-row gap-2 sm:gap-0">
            <input
              type="text"
              value={newTag}
              onChange={(e) => {
                setNewTag(e.target.value);
                setShowTagSuggestions(e.target.value.length > 0);
              }}
              className="block w-full border-2 border-gray-300 rounded-xl sm:rounded-l-xl sm:rounded-r-none shadow-sm focus:ring-primary-500 focus:border-primary-500 py-3 px-4 text-sm sm:text-base"
              placeholder="Add a tag (e.g., family-friendly, weekend, nature)"
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddTag();
                }
              }}
            />
            <button
              type="button"
              onClick={() => handleAddTag()}
              className="inline-flex items-center justify-center px-4 sm:px-6 py-3 border-2 border-primary-600 sm:border-l-0 text-primary-600 font-medium rounded-xl sm:rounded-l-none sm:rounded-r-xl hover:bg-primary-50 transition-colors text-sm sm:text-base"
            >
              <FiPlus className="mr-1" />
              Add
            </button>
          </div>

          {/* Tag Suggestions */}
          {showTagSuggestions && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto"
            >
              {tagSuggestions
                .filter(
                  (suggestion) =>
                    suggestion.toLowerCase().includes(newTag.toLowerCase()) &&
                    !formData.tags.includes(suggestion)
                )
                .slice(0, 8)
                .map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => handleAddTag(suggestion)}
                    className="w-full text-left px-4 py-2 hover:bg-gray-50 text-gray-700 border-b border-gray-100 last:border-b-0 text-sm"
                  >
                    {suggestion}
                  </button>
                ))}
            </motion.div>
          )}
        </div>
        <p className="text-xs text-gray-500 mt-2">
          {formData.tags.length}/10 tags • Click suggestions above or type your own
        </p>
      </div>

      {/* Custom Details Section */}
      <div>
        <h3 className="text-base sm:text-lg font-semibold text-gray-800 mb-4">
          Additional Details
        </h3>

        <div className="space-y-3 mb-6">
          {Object.entries(formData.custom_keys).map(([key, value], index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center bg-gray-50 p-3 sm:p-4 rounded-xl border border-gray-200"
            >
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-gray-800 text-sm sm:text-base truncate">
                  {key}
                </div>
                <div className="text-gray-600 text-xs sm:text-sm break-words">{value}</div>
              </div>
              <button
                type="button"
                onClick={() => handleRemoveCustomKey(key)}
                className="text-red-500 hover:text-red-700 transition-colors p-2 ml-2 flex-shrink-0"
              >
                <FiMinus className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
            </motion.div>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-3">
          <input
            type="text"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            className="block w-full border-2 border-gray-300 rounded-xl shadow-sm focus:ring-primary-500 focus:border-primary-500 py-3 px-4 text-sm sm:text-base"
            placeholder="Detail name (e.g., Best Time to Visit)"
          />
          <input
            type="text"
            value={newKeyValue}
            onChange={(e) => setNewKeyValue(e.target.value)}
            className="block w-full border-2 border-gray-300 rounded-xl shadow-sm focus:ring-primary-500 focus:border-primary-500 py-3 px-4 text-sm sm:text-base"
            placeholder="Detail value (e.g., October to March)"
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAddCustomKey();
              }
            }}
          />
        </div>
        <button
          type="button"
          onClick={handleAddCustomKey}
          className="mt-3 inline-flex items-center px-4 py-2 border-2 border-gray-300 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition-colors text-sm"
        >
          <FiPlus className="mr-2" />
          Add Detail
        </button>
        <p className="text-xs text-gray-500 mt-2">
          {Object.keys(formData.custom_keys).length}/10 custom details
        </p>
      </div>

      <div className="mt-6 sm:mt-8 flex flex-col sm:flex-row justify-between gap-3 sm:gap-4">
        <button
          type="button"
          onClick={() => goToStep(3)}
          className="inline-flex items-center justify-center px-4 sm:px-6 py-2 sm:py-3 bg-gray-100 text-gray-700 font-medium rounded-xl hover:bg-gray-200 transition-colors text-sm sm:text-base order-3 sm:order-1"
        >
          <FiArrowLeft className="mr-2" />
          Previous
        </button>
        <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 order-1 sm:order-2">
          <button
            type="button"
            onClick={() => router.push('/admin')}
            className="inline-flex items-center justify-center px-4 sm:px-6 py-2 sm:py-3 border-2 border-gray-300 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition-colors text-sm sm:text-base"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex items-center justify-center px-6 sm:px-8 py-2 sm:py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold rounded-xl hover:from-blue-700 hover:to-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg text-sm sm:text-base"
          >
            {isSubmitting ? (
              <span className="flex items-center">
                <FiLoader className="animate-spin mr-2 h-4 w-4 sm:h-5 sm:w-5" />
                Creating Place...
              </span>
            ) : (
              <span className="flex items-center">
                <FiSave className="mr-2 h-4 w-4 sm:h-5 sm:w-5" />
                Create Place
              </span>
            )}
          </button>
        </div>
      </div>
    </motion.div>
  );
};
