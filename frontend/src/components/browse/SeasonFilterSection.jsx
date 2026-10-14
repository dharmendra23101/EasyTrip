import { motion } from 'framer-motion';
import { FiCalendar, FiCheck } from 'react-icons/fi';

import FilterSection from './FilterSection';
import { dateOptions } from './browseOptions';

/**
 * The "best time to visit" filter.
 *
 * Moved out of `BrowseFilterPanel` unchanged when `check-module-size` stopped the run at 530 lines
 * — the second of two sections extracted, and the pair share the property that decided which ones:
 * **their choices come from a module constant rather than from server facets.** Location, district,
 * state and tags are built from whatever the catalogue happens to contain; these two are a fixed
 * vocabulary the product decided on, so they change for different reasons and on different days
 * from the panel around them.
 *
 * Behaviour is identical, including the deliberate asymmetry with `AccessFilterSection` beside it:
 * a place with **no recorded best time is kept** by this filter, because a missing annotation is not
 * evidence of a bad season. The access filter does the opposite for a reason its own file explains.
 */
export const SeasonFilterSection = ({ value, onChange, collapsed, onToggle }) => (
  <FilterSection
    title="Best Time to Visit"
    icon={<FiCalendar className="text-primary-600" />}
    collapsed={collapsed}
    onToggle={onToggle}
  >
    <div className="grid grid-cols-2 gap-2">
      {dateOptions.map((option) => (
        <motion.button
          key={option.id}
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          onClick={() => onChange(option.id)}
          className={`py-2 px-3 rounded-md text-sm flex items-center justify-between ${
            value === option.id
              ? 'bg-primary-100 text-primary-800 border border-primary-300'
              : 'bg-gray-100 text-gray-700 border border-gray-200 hover:bg-gray-200'
          }`}
        >
          <div className="flex items-center">
            <span className="mr-2">{option.icon}</span>
            <span>{option.label}</span>
          </div>
          {value === option.id && (
            <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }}>
              <FiCheck className="h-4 w-4 text-primary-600" />
            </motion.span>
          )}
        </motion.button>
      ))}
    </div>
  </FilterSection>
);

export default SeasonFilterSection;
