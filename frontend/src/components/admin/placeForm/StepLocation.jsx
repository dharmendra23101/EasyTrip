// `FiLocation` is not a react-icons export — the page aliased FiMapPin to it. Keeping the alias
// keeps the JSX below identical to what it was inline.
import { FiAlertCircle, FiMapPin as FiLocation } from 'react-icons/fi';
import { motion } from 'framer-motion';
import { StepNavigation } from './StepNavigation';

export const StepLocation = ({ form }) => {
  const { formData, errors, handleChange, goToStep } = form;

  return (
    <motion.div
      key="step2"
      initial={{ opacity: 0, x: 50 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -50 }}
      className="p-4 sm:p-6 lg:p-8"
    >
      <div className="flex items-center mb-6">
        <div className="p-2 sm:p-3 bg-green-100 rounded-lg mr-3 sm:mr-4">
          <FiLocation className="text-green-600 h-5 w-5 sm:h-6 sm:w-6" />
        </div>
        <h2 className="text-xl sm:text-2xl font-bold text-gray-900">Location Details</h2>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
        <div>
          <label htmlFor="district" className="block text-sm font-semibold text-gray-700 mb-2">
            District
          </label>
          <input
            type="text"
            id="district"
            name="district"
            value={formData.district}
            onChange={handleChange}
            className="block w-full border-2 border-gray-300 rounded-xl shadow-sm focus:ring-primary-500 focus:border-primary-500 transition-colors py-3 px-4 text-sm sm:text-base"
            placeholder="Enter district name"
          />
        </div>

        <div>
          <label htmlFor="state" className="block text-sm font-semibold text-gray-700 mb-2">
            State
          </label>
          <input
            type="text"
            id="state"
            name="state"
            value={formData.state}
            onChange={handleChange}
            className="block w-full border-2 border-gray-300 rounded-xl shadow-sm focus:ring-primary-500 focus:border-primary-500 transition-colors py-3 px-4 text-sm sm:text-base"
            placeholder="Enter state name"
          />
        </div>

        <div>
          <label htmlFor="locality" className="block text-sm font-semibold text-gray-700 mb-2">
            Locality
          </label>
          <input
            type="text"
            id="locality"
            name="locality"
            value={formData.locality}
            onChange={handleChange}
            className="block w-full border-2 border-gray-300 rounded-xl shadow-sm focus:ring-primary-500 focus:border-primary-500 transition-colors py-3 px-4 text-sm sm:text-base"
            placeholder="Enter locality/area name"
          />
        </div>

        <div>
          <label htmlFor="pin_code" className="block text-sm font-semibold text-gray-700 mb-2">
            PIN Code
          </label>
          <input
            type="text"
            id="pin_code"
            name="pin_code"
            value={formData.pin_code}
            onChange={handleChange}
            className={`block w-full border-2 rounded-xl shadow-sm focus:ring-primary-500 focus:border-primary-500 transition-colors py-3 px-4 text-sm sm:text-base ${
              errors.pin_code ? 'border-red-500' : 'border-gray-300'
            }`}
            placeholder="123456"
            maxLength="6"
          />
          {errors.pin_code && (
            <motion.p
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-2 text-sm text-red-500 flex items-center"
            >
              <FiAlertCircle className="mr-1 flex-shrink-0" />
              {errors.pin_code}
            </motion.p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 mt-6">
        <div>
          <label htmlFor="latitude" className="block text-sm font-semibold text-gray-700 mb-2">
            Latitude
          </label>
          <input
            type="text"
            id="latitude"
            name="latitude"
            value={formData.latitude}
            onChange={handleChange}
            placeholder="e.g. 28.6139"
            className={`block w-full border-2 rounded-xl shadow-sm focus:ring-primary-500 focus:border-primary-500 transition-colors py-3 px-4 text-sm sm:text-base ${
              errors.latitude ? 'border-red-500' : 'border-gray-300'
            }`}
          />
          {errors.latitude && (
            <motion.p
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-2 text-sm text-red-500 flex items-center"
            >
              <FiAlertCircle className="mr-1 flex-shrink-0" />
              {errors.latitude}
            </motion.p>
          )}
        </div>

        <div>
          <label htmlFor="longitude" className="block text-sm font-semibold text-gray-700 mb-2">
            Longitude
          </label>
          <input
            type="text"
            id="longitude"
            name="longitude"
            value={formData.longitude}
            onChange={handleChange}
            placeholder="e.g. 77.2090"
            className={`block w-full border-2 rounded-xl shadow-sm focus:ring-primary-500 focus:border-primary-500 transition-colors py-3 px-4 text-sm sm:text-base ${
              errors.longitude ? 'border-red-500' : 'border-gray-300'
            }`}
          />
          {errors.longitude && (
            <motion.p
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-2 text-sm text-red-500 flex items-center"
            >
              <FiAlertCircle className="mr-1 flex-shrink-0" />
              {errors.longitude}
            </motion.p>
          )}
        </div>
      </div>

      <StepNavigation
        onPrevious={() => goToStep(1)}
        onNext={() => goToStep(3)}
        nextLabel="Next: Media & Themes"
      />
    </motion.div>
  );
};
