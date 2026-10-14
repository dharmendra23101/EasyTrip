import { FiAlertCircle, FiCamera } from 'react-icons/fi';
import { motion } from 'framer-motion';
import { themeOptions } from './placeFormOptions';
import { StepNavigation } from './StepNavigation';
import ImageUpload from '../../ImageUpload';
import { SettingSelector } from '../SettingSelector';
import { AccessibilitySurvey } from '../AccessibilitySurvey';
import SeasonalitySurvey from '../SeasonalitySurvey';

export const StepMediaThemes = ({ form }) => {
  const {
    formData,
    errors,
    handleChange,
    handleThemeToggle,
    handleImageChange,
    handleImageRemove,
    goToStep
  } = form;

  return (
    <motion.div
      key="step3"
      initial={{ opacity: 0, x: 50 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -50 }}
      className="p-4 sm:p-6 lg:p-8"
    >
      <div className="flex items-center mb-6">
        <div className="p-2 sm:p-3 bg-purple-100 rounded-lg mr-3 sm:mr-4">
          <FiCamera className="text-purple-600 h-5 w-5 sm:h-6 sm:w-6" />
        </div>
        <h2 className="text-xl sm:text-2xl font-bold text-gray-900">Media & Themes</h2>
      </div>

      {/* Primary Image Section */}
      <div className="mb-8">
        <h3 className="text-base sm:text-lg font-semibold text-gray-800 mb-4">Primary Image</h3>
        <p className="text-xs sm:text-sm text-gray-600 mb-4">
          Upload a main image for this place (max 5MB). You can add more images after creating the
          place.
        </p>

        <ImageUpload
          onImageSelect={(file) => {
            if (file) {
              handleImageChange(file);
            } else {
              handleImageRemove();
            }
          }}
          maxSize={5 * 1024 * 1024} // 5MB
          multiple={false}
          preview={true}
          className="w-full"
        />

        {errors.image && (
          <motion.p
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-2 text-sm text-red-500 flex items-center"
          >
            <FiAlertCircle className="mr-1 flex-shrink-0" />
            {errors.image}
          </motion.p>
        )}
      </div>

      {/* Themes Section */}
      <div>
        <h3 className="text-base sm:text-lg font-semibold text-gray-800 mb-4">Theme Categories</h3>
        <p className="text-xs sm:text-sm text-gray-600 mb-4">
          Select all themes that apply to this destination
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {themeOptions.map((theme) => (
            <motion.div key={theme.id} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
              <button
                type="button"
                onClick={() => handleThemeToggle(theme.id)}
                className={`flex items-center p-3 sm:p-4 rounded-xl w-full transition-all border-2 text-left ${
                  formData.themes.includes(theme.id)
                    ? `bg-${theme.color}-50 text-${theme.color}-700 border-${theme.color}-300 shadow-md`
                    : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100 hover:border-gray-300'
                }`}
              >
                <div className="flex-shrink-0 text-sm sm:text-base">{theme.icon}</div>
                <div className="text-left">
                  <div className="font-medium text-sm sm:text-base">{theme.label}</div>
                  <div className="text-xs opacity-75 hidden sm:block">{theme.description}</div>
                </div>
              </button>
            </motion.div>
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-3">
          Selected: {formData.themes.length} theme
          {formData.themes.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* TD-023 — classified at creation, so the backfill only ever has to cover what already
          existed rather than growing with every new place. */}
      <SettingSelector value={formData.setting} onChange={handleChange} />

      {/* `BL-138`. Surveyed at creation for the same reason the classification is: the API has
          accepted these fields on create since Sprint 8.33, and without a control here a new place
          was unsurveyed until somebody thought to re-open it. `accessibility_source` is in this
          step's `STEP_FIELDS`, so an unattributed claim stops the wizard here rather than surfacing
          as a rejected submit two steps later. */}
      <AccessibilitySurvey formData={formData} onChange={handleChange} />

      {/* `FV-028`, on the same step and for the same reason: the API has accepted these fields on
          create since this sprint, and a place with no control here stays uncurated until somebody
          thinks to re-open it. `seasonality_source` is in this step's `STEP_FIELDS`. */}
      <SeasonalitySurvey formData={formData} onChange={handleChange} />

      <StepNavigation
        onPrevious={() => goToStep(2)}
        onNext={() => goToStep(4)}
        nextLabel="Next: Tags & Details"
      />
    </motion.div>
  );
};
