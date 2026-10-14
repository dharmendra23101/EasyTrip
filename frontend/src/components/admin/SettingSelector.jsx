import { PLACE_SETTING_OPTIONS, DEFAULT_PLACE_SETTING } from '../../constants/placeSetting';

/**
 * The control that classifies where a place happens (`TD-023`).
 *
 * `places.setting` shipped in Sprint 8.17 with a migration, a validator, a `CHECK` constraint and
 * an index — and **no way to set it**. Two features then shipped that read it (`FV-031` daylight,
 * `FV-027` rain), which left both live, correct, and firing on nothing, because the whole catalogue
 * sits at `unknown`. This is the missing half.
 *
 * **Radios, not a `<select>`.** The other admin selects here are one-line choices; this one changes
 * what the planner is allowed to say about a place, and each option's consequence has to be visible
 * *before* it is chosen rather than discoverable afterwards. Four options with a sentence each is
 * exactly the case radios exist for — and it is why `LocaleSwitcher`, two options with no
 * consequences to explain, is a `<select>` instead.
 *
 * **`unknown` is presented as an answer.** An admin nudged out of it by a UI that treats it as a
 * blank produces guesses, and a guess here becomes a confident warning about the wrong place. The
 * engines treat `unknown` as *no evidence* and stay silent, which is the outcome this control has
 * to make feel acceptable.
 */
export const SettingSelector = ({ value, onChange, name = 'setting' }) => (
  <fieldset className="mb-8">
    <legend className="text-xl font-semibold text-gray-800 mb-1">Where does this happen?</legend>
    <p className="text-sm text-gray-600 mb-4">
      Used to warn travellers about rain and darkness. Leave it unclassified if you are not sure —
      the planner stays quiet rather than guessing.
    </p>

    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {PLACE_SETTING_OPTIONS.map((option) => {
        const id = `${name}-${option.value}`;
        const checked = (value || DEFAULT_PLACE_SETTING) === option.value;

        return (
          <label
            key={option.value}
            htmlFor={id}
            className={`flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors ${
              checked ? 'border-primary-600 bg-primary-50' : 'border-gray-300 hover:bg-gray-50'
            }`}
          >
            <input
              type="radio"
              id={id}
              name={name}
              value={option.value}
              checked={checked}
              onChange={onChange}
              className="mt-1 h-4 w-4 flex-shrink-0 text-primary-600 focus:ring-primary-500"
            />
            <span>
              <span className="block text-sm font-medium text-gray-900">{option.label}</span>
              {/* The consequence, at the moment of choosing. A tooltip would be a consequence you
                  have to go looking for. */}
              <span className="block text-xs text-gray-600">{option.description}</span>
            </span>
          </label>
        );
      })}
    </div>
  </fieldset>
);

export default SettingSelector;
