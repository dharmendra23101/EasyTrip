import { THEMES } from '../constants/themes';
import { BUDGET_BANDS, TRAVEL_PACES, PARTY_TYPES, DIETARY_NEEDS } from '../constants/preferences';

/**
 * What kind of travelling somebody does (`FV-020` stage a).
 *
 * ---------------------------------------------------------------------------
 * Every field can be unset, and that is the design rather than a nicety
 * ---------------------------------------------------------------------------
 * `021_travel_preferences.sql` gives every scalar a NULL default because **not said is not a
 * default**: somebody who has never opened this form has not told us they want a mid-range,
 * balanced, solo trip. So each `<select>` carries an explicit *"Not set"* option rather than
 * defaulting to the middle value, and choosing it sends `''`, which the API turns back into NULL.
 *
 * A form where the first option is silently a preference is a form that invents opinions.
 *
 * ---------------------------------------------------------------------------
 * Interests are the same fourteen tags places carry
 * ---------------------------------------------------------------------------
 * Not a free-text field and not a parallel vocabulary — `THEMES` is what `places.themes` uses and
 * what `check:themes` keeps in step across tiers. A stated interest can therefore actually meet a
 * tagged place.
 *
 * ---------------------------------------------------------------------------
 * The dietary list says why it is asking
 * ---------------------------------------------------------------------------
 * This is health- and religion-adjacent, and it is stored under the same terms as `dob` and the
 * access needs — private to the authenticated profile route, absent from every public payload, and
 * never copied onto a trip. The panel says so, because somebody deciding whether to tell a travel
 * site they keep kosher deserves to know where it goes before they type it.
 */

const Choice = ({ id, label, value, options, onChange }) => (
  <div>
    <label htmlFor={id} className="block text-sm font-medium text-gray-700">
      {label}
    </label>
    <select
      id={id}
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value)}
      className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
    >
      {/* Explicitly "not set", not a default. See the header. */}
      <option value="">Not set</option>
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
    </select>
  </div>
);

// `values = {}` for the same reason `AccessNeeds` has it, and it is the same form: both mount
// inside the profile page's fieldset before the stored profile has necessarily arrived. Two
// components rendered side by side, one of which throws on an absent prop, is the kind of
// asymmetry that is invisible until the day the page loads its data differently.
export const TravelPreferences = ({ values = {}, onChange }) => {
  const toggle = (field, id) => {
    const current = values[field] || [];
    onChange(
      field,
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]
    );
  };

  return (
    <fieldset className="mt-6 border-t border-gray-200 pt-6">
      <legend className="text-base font-semibold text-gray-900">How you like to travel</legend>
      <p className="mb-4 mt-1 text-sm text-gray-600">
        All optional, and all editable later. Leaving something unset means exactly that — EasyTrip
        does not assume a default on your behalf.
      </p>

      <div className="grid gap-4 sm:grid-cols-3">
        <Choice
          id="budget_band"
          label="Budget"
          value={values.budget_band}
          options={BUDGET_BANDS}
          onChange={(value) => onChange('budget_band', value)}
        />
        <Choice
          id="travel_pace"
          label="Pace"
          value={values.travel_pace}
          options={TRAVEL_PACES}
          onChange={(value) => onChange('travel_pace', value)}
        />
        <Choice
          id="party_type"
          label="Usually travelling"
          value={values.party_type}
          options={PARTY_TYPES}
          onChange={(value) => onChange('party_type', value)}
        />
      </div>

      <div className="mt-6">
        <span className="block text-sm font-medium text-gray-700">Interests</span>
        <p className="mb-2 text-xs text-gray-500">
          The same tags places are labelled with, so these can actually match somewhere.
        </p>
        <div className="flex flex-wrap gap-2">
          {THEMES.map((theme) => {
            const selected = (values.interests || []).includes(theme.id);
            return (
              <button
                key={theme.id}
                type="button"
                onClick={() => toggle('interests', theme.id)}
                aria-pressed={selected}
                className={`min-h-[36px] rounded-full border px-3 py-1.5 text-sm transition-colors ${
                  selected
                    ? 'border-primary-600 bg-primary-50 text-primary-700'
                    : 'border-gray-300 text-gray-700 hover:border-primary-400'
                }`}
              >
                {theme.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-6">
        <span className="block text-sm font-medium text-gray-700">Dietary needs</span>
        {/* Where it goes, before they type it. */}
        <p className="mb-2 text-xs text-gray-500">
          Private to your profile. It is never shown on a place, never copied onto a trip, and
          anyone you share an itinerary with cannot see it.
        </p>
        <div className="flex flex-wrap gap-2">
          {DIETARY_NEEDS.map((need) => {
            const selected = (values.dietary_needs || []).includes(need.id);
            return (
              <button
                key={need.id}
                type="button"
                onClick={() => toggle('dietary_needs', need.id)}
                aria-pressed={selected}
                className={`min-h-[36px] rounded-full border px-3 py-1.5 text-sm transition-colors ${
                  selected
                    ? 'border-primary-600 bg-primary-50 text-primary-700'
                    : 'border-gray-300 text-gray-700 hover:border-primary-400'
                }`}
              >
                {need.label}
              </button>
            );
          })}
        </div>
      </div>
    </fieldset>
  );
};

export default TravelPreferences;
