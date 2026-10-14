import { FiAlertCircle, FiArrowLeft, FiInfo, FiMapPin, FiNavigation } from 'react-icons/fi';
import { motion } from 'framer-motion';

export const StepBasicInfo = ({ form }) => {
  const {
    formData,
    errors,
    handleChange,
    handleLocationLookup,
    isLookingUp,
    geocodeResults,
    applyGeocodeResult,
    clearGeocodeResults,
    goToStep
  } = form;

  return (
    <motion.div
      key="step1"
      initial={{ opacity: 0, x: 50 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -50 }}
      className="p-4 sm:p-6 lg:p-8"
    >
      <div className="flex items-center mb-6">
        <div className="p-2 sm:p-3 bg-primary-100 rounded-lg mr-3 sm:mr-4">
          <FiInfo className="text-primary-600 h-5 w-5 sm:h-6 sm:w-6" />
        </div>
        <h2 className="text-xl sm:text-2xl font-bold text-gray-900">Basic Information</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
        <div className="md:col-span-2 lg:col-span-1">
          <label htmlFor="name" className="block text-sm font-semibold text-gray-700 mb-2">
            Place Name *
          </label>
          <input
            type="text"
            id="name"
            name="name"
            value={formData.name}
            onChange={handleChange}
            className={`block w-full border-2 rounded-xl shadow-sm focus:ring-primary-500 focus:border-primary-500 transition-colors py-3 px-4 text-sm sm:text-base ${
              errors.name ? 'border-red-500' : 'border-gray-300'
            }`}
            placeholder="Enter the place name"
            required
          />
          {errors.name && (
            <motion.p
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-2 text-sm text-red-500 flex items-center"
            >
              <FiAlertCircle className="mr-1 flex-shrink-0" />
              {errors.name}
            </motion.p>
          )}
        </div>

        <div className="md:col-span-2 lg:col-span-1">
          <label htmlFor="location" className="block text-sm font-semibold text-gray-700 mb-2">
            Location *
          </label>
          <div className="relative">
            <FiMapPin className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              id="location"
              name="location"
              value={formData.location}
              onChange={handleChange}
              className={`block w-full pl-10 pr-10 border-2 rounded-xl shadow-sm focus:ring-primary-500 focus:border-primary-500 transition-colors py-3 px-4 text-sm sm:text-base ${
                errors.location ? 'border-red-500' : 'border-gray-300'
              }`}
              placeholder="Enter the location"
              required
            />
            <button
              type="button"
              onClick={handleLocationLookup}
              disabled={isLookingUp}
              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-primary-500 hover:text-primary-700 p-1 disabled:opacity-50"
              title="Auto-fill coordinates"
              aria-label="Auto-fill coordinates from the address"
            >
              <FiNavigation className={`w-4 h-4 ${isLookingUp ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {/* Attribution for the geocoder, shown whether or not a lookup has run yet (IMP-127).
              ODbL 4.3 requires crediting OpenStreetMap for geocoding output, and an exact match
              applies itself without ever rendering the candidate list below — so a notice attached
              only to that list would be absent in the common case. It doubles as the answer to
              "where do these coordinates come from?", which the button alone does not say. */}
          <p className="mt-2 text-xs text-gray-500">
            The lookup fills coordinates from{' '}
            <a
              href="https://nominatim.org/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-gray-700"
            >
              Nominatim
            </a>
            . Data ©{' '}
            <a
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-gray-700"
            >
              OpenStreetMap
            </a>{' '}
            contributors, ODbL.
          </p>

          {/* Ambiguous lookups only (IMP-116). A single match fills the form directly — this list
              exists so that several matches are never resolved by guessing the first one, which is
              how the wrong pin ends up on a public map. */}
          {geocodeResults.length > 0 && (
            <div className="mt-3 rounded-xl border-2 border-primary-200 bg-primary-50 p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-gray-800">
                  {geocodeResults.length} matches — pick the right one
                </p>
                <button
                  type="button"
                  onClick={clearGeocodeResults}
                  className="text-xs text-gray-500 hover:text-gray-700"
                >
                  Dismiss
                </button>
              </div>
              <ul className="mt-2 space-y-1">
                {geocodeResults.map((result) => (
                  <li key={`${result.latitude},${result.longitude}`}>
                    <button
                      type="button"
                      onClick={() => applyGeocodeResult(result)}
                      className="w-full rounded-lg px-2 py-2 text-left text-sm text-gray-700 hover:bg-white"
                    >
                      <span className="block">{result.label}</span>
                      {/* The coordinates are shown, not hidden behind the label: two candidates can
                          read almost identically, and the number is what actually gets saved. */}
                      <span className="block text-xs text-gray-500">
                        {result.latitude.toFixed(4)}, {result.longitude.toFixed(4)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {errors.location && (
            <motion.p
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-2 text-sm text-red-500 flex items-center"
            >
              <FiAlertCircle className="mr-1 flex-shrink-0" />
              {errors.location}
            </motion.p>
          )}
        </div>
      </div>

      <div className="mt-6">
        <label htmlFor="description" className="block text-sm font-semibold text-gray-700 mb-2">
          Description
        </label>
        <textarea
          id="description"
          name="description"
          value={formData.description}
          onChange={handleChange}
          rows="4"
          className={`block w-full border-2 rounded-xl shadow-sm focus:ring-primary-500 focus:border-primary-500 transition-colors py-3 px-4 text-sm sm:text-base resize-none ${
            errors.description ? 'border-red-500' : 'border-gray-300'
          }`}
          placeholder="Describe this place, its attractions, and what makes it special..."
        />
        <div className="mt-1 flex justify-between text-xs sm:text-sm text-gray-500">
          <span>Optional but recommended</span>
          <span>{formData.description.length}/2000</span>
        </div>
        {errors.description && (
          <motion.p
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-2 text-sm text-red-500 flex items-center"
          >
            <FiAlertCircle className="mr-1 flex-shrink-0" />
            {errors.description}
          </motion.p>
        )}
      </div>

      <div className="mt-6 sm:mt-8 flex justify-end">
        <button
          type="button"
          onClick={() => goToStep(2)}
          className="inline-flex items-center px-4 sm:px-6 py-2 sm:py-3 bg-primary-600 text-white font-medium rounded-xl hover:bg-primary-700 transition-colors text-sm sm:text-base"
        >
          Next: Location Details
          <FiArrowLeft className="ml-2 rotate-180" />
        </button>
      </div>
    </motion.div>
  );
};
