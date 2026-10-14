import { FiCheck, FiUsers } from 'react-icons/fi';

import FilterSection from './FilterSection';
import { STEP_FREE_CHOICES } from '../../utils/browseFilters';

/**
 * The step-free access filter (`FV-029` stage a, `BL-137`).
 *
 * Extracted when `check-module-size` put `BrowseFilterPanel.jsx` at 530 lines. The seam is a real
 * one rather than an arbitrary cut: this is the only filter in the panel whose **caption is part of
 * the control**, and that sentence is the thing most likely to be edited without meaning to change
 * behaviour.
 *
 * ---------------------------------------------------------------------------
 * Why the caption is not decoration
 * ---------------------------------------------------------------------------
 * A filtered list reads as a verdict on everything it leaves out. Here that reading is wrong and
 * dangerous in the same breath: almost the entire catalogue is `unknown`, so this hides far more
 * places than it rules out, and a traveller who took the result as "these are the accessible ones"
 * would be reading an absence of surveying as an absence of ramps.
 *
 * The choices themselves carry the other half of the honesty — neither offers `unknown`, and `Any`
 * sends no parameter at all rather than every level. `STEP_FREE_CHOICES` holds both and
 * `accessibilityBrowse.test.jsx` asserts them, because they are one line each to get wrong.
 */
export const AccessFilterSection = ({ value, onChange, collapsed, onToggle }) => (
  <FilterSection
    title="Access"
    icon={<FiUsers className="text-primary-600" />}
    collapsed={collapsed}
    onToggle={onToggle}
  >
    <div className="space-y-2">
      {Object.entries(STEP_FREE_CHOICES).map(([id, choice]) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          aria-pressed={value === id}
          className={`w-full py-2 px-3 rounded-md text-sm flex items-center justify-between ${
            value === id
              ? 'bg-primary-100 text-primary-800 border border-primary-300'
              : 'bg-gray-100 text-gray-700 border border-gray-200 hover:bg-gray-200'
          }`}
        >
          <span>{choice.label}</span>
          {value === id && <FiCheck className="h-4 w-4 text-primary-600" />}
        </button>
      ))}
    </div>

    <p className="mt-3 text-xs text-gray-500">
      Only places somebody has actually checked. Most of the catalogue has not been surveyed yet, so
      this hides far more than it rules out.
    </p>
  </FilterSection>
);

export default AccessFilterSection;
