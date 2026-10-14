import { FiCheck } from 'react-icons/fi';
import { motion } from 'framer-motion';
import { STEP_TITLES } from './placeFormOptions';

/** The wizard's position: a bar on mobile, a numbered rail on desktop. */
export const FormProgress = ({ step }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    className="mb-6 sm:mb-8"
  >
    <div className="bg-white rounded-lg shadow-sm p-3 sm:p-4">
      {/* Mobile Progress */}
      <div className="block sm:hidden">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-600">Step {step} of 4</span>
          <span className="text-xs text-gray-500">{Math.round((step / 4) * 100)}% Complete</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-primary-600 h-2 rounded-full transition-all duration-300"
            style={{ width: `${(step / 4) * 100}%` }}
          ></div>
        </div>
        <div className="mt-2">
          <h3 className="text-sm font-semibold text-primary-600">{STEP_TITLES[step]}</h3>
        </div>
      </div>

      {/* Desktop Progress */}
      <div className="hidden sm:block">
        <div className="flex items-center justify-between">
          {Object.entries(STEP_TITLES).map(([stepNum, title]) => (
            <div key={stepNum} className="flex items-center">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  parseInt(stepNum) === step
                    ? 'bg-primary-600 text-white'
                    : parseInt(stepNum) < step
                      ? 'bg-green-500 text-white'
                      : 'bg-gray-200 text-gray-600'
                }`}
              >
                {parseInt(stepNum) < step ? <FiCheck className="w-4 h-4" /> : stepNum}
              </div>
              <span
                className={`ml-2 text-xs sm:text-sm font-medium ${
                  parseInt(stepNum) === step ? 'text-primary-600' : 'text-gray-500'
                }`}
              >
                {title}
              </span>
              {stepNum !== '4' && (
                <div
                  className={`w-8 sm:w-12 h-1 mx-2 sm:mx-4 ${
                    parseInt(stepNum) < step ? 'bg-green-500' : 'bg-gray-200'
                  }`}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  </motion.div>
);
