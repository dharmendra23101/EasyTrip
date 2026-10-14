import { FiAlertCircle } from 'react-icons/fi';

import {
  ACCESS_LEVEL_OPTIONS,
  ACCESSIBILITY_SOURCE_OPTIONS,
  DEFAULT_ACCESS_LEVEL,
  isClaimed,
  surveyProblem
} from '../../constants/placeAccessibility';

/**
 * The control that records whether a place can actually be visited (`FV-029` stage a, `BL-136`).
 *
 * `places.setting` shipped a migration, a validator, a `CHECK` constraint and an index with **no way
 * to set it** (`TD-023`), and the whole catalogue sat at `unknown` while two features read it. This
 * ships in the same sprint as its columns so that does not happen twice.
 *
 * ---------------------------------------------------------------------------
 * The one control in this product where a careless answer hurts somebody
 * ---------------------------------------------------------------------------
 * `FV-029`'s kill criterion is not about data quality: *"a wrong step-free claim strands somebody at
 * the bottom of a staircase."* So this form is built to make the cautious answer easy and the
 * confident one deliberate.
 *
 * **`Not surveyed` is first among equals, described as an answer rather than a blank.** An admin
 * nudged out of it by a UI that treats it as missing produces guesses, and a guess here is the harm.
 *
 * **The provenance fields appear the moment a claim is made, and say why.** The database refuses an
 * unattributed claim (`places_accessibility_is_attributed`), so without this the admin meets the
 * rule as a 400 after pressing save, having already typed everything. Learning it while filling the
 * form is the difference between a rule and an obstacle.
 *
 * **`No` is presented as useful.** It is: it saves a wasted journey, and an admin who feels that
 * only `Yes` is worth recording produces a catalogue that is silent about every inaccessible place.
 */

const LevelChoice = ({ name, legend, hint, value, onChange }) => (
  <fieldset className="mb-6">
    <legend className="text-sm font-semibold text-gray-800">{legend}</legend>
    <p className="mb-3 text-xs text-gray-600">{hint}</p>

    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {ACCESS_LEVEL_OPTIONS.map((option) => {
        const id = `${name}-${option.value}`;
        const checked = (value || DEFAULT_ACCESS_LEVEL) === option.value;

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
              {/* The consequence, at the moment of choosing — not in a tooltip somebody has to
                  go looking for. */}
              <span className="block text-xs text-gray-600">{option.description}</span>
            </span>
          </label>
        );
      })}
    </div>
  </fieldset>
);

export const AccessibilitySurvey = ({ formData = {}, onChange }) => {
  const claiming = isClaimed(formData.step_free_access) || isClaimed(formData.accessible_restroom);
  const problem = surveyProblem(formData);

  return (
    <section className="mb-8" aria-labelledby="accessibility-heading">
      <h2 id="accessibility-heading" className="mb-1 text-xl font-semibold text-gray-800">
        Getting in and getting around
      </h2>
      <p className="mb-5 text-sm text-gray-600">
        Only record what somebody has actually checked. A wrong answer here sends a traveller on a
        journey they cannot complete, so <strong>not surveyed is a safe answer</strong> — nothing is
        shown to travellers until there is something verified to show.
      </p>

      <LevelChoice
        name="step_free_access"
        legend="Step-free access"
        hint="Can a visitor reach the main experience without steps?"
        value={formData.step_free_access}
        onChange={onChange}
      />

      <LevelChoice
        name="accessible_restroom"
        legend="Accessible restroom"
        hint="Is there one on site?"
        value={formData.accessible_restroom}
        onChange={onChange}
      />

      <div className="mb-6">
        <label
          htmlFor="accessibility_notes"
          className="mb-1 block text-sm font-semibold text-gray-800"
        >
          Notes
        </label>
        <p className="mb-2 text-xs text-gray-600">
          Where the ramp stops, what the surface is, whether staff assist. This is usually worth
          more to a traveller than the answers above, and it needs no source — a note asserts
          nothing on its own.
        </p>
        <textarea
          id="accessibility_notes"
          name="accessibility_notes"
          rows={3}
          maxLength={2000}
          value={formData.accessibility_notes || ''}
          onChange={onChange}
          placeholder="Step-free to the courtyard; the inner sanctum is up eleven steps with no handrail."
          className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-primary-500"
        />
      </div>

      {/* Revealed by a claim, because that is when it becomes required. Rendering it always would
          make it look optional; hiding it after a claim would make the 400 a mystery. */}
      {claiming && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="mb-3 text-sm text-amber-900">
            You have recorded an answer, so this has to say <strong>who checked and when</strong>.
            An answer without those cannot be shown to anyone, and will not save.
          </p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="accessibility_source"
                className="mb-1 block text-sm font-medium text-gray-800"
              >
                Where did this come from?
              </label>
              <select
                id="accessibility_source"
                name="accessibility_source"
                value={formData.accessibility_source || ''}
                onChange={onChange}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">Choose one…</option>
                {ACCESSIBILITY_SOURCE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-600">
                {ACCESSIBILITY_SOURCE_OPTIONS.find(
                  (option) => option.value === formData.accessibility_source
                )?.description || 'Weakest to strongest.'}
              </p>
            </div>

            <div>
              <label
                htmlFor="accessibility_checked_on"
                className="mb-1 block text-sm font-medium text-gray-800"
              >
                When was it last checked?
              </label>
              <input
                type="date"
                id="accessibility_checked_on"
                name="accessibility_checked_on"
                value={formData.accessibility_checked_on || ''}
                onChange={onChange}
                max={new Date().toISOString().slice(0, 10)}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
              <p className="mt-1 text-xs text-gray-600">
                Ramps get removed and lifts break. The date is shown beside the answer so a
                traveller can judge how much to trust it.
              </p>
            </div>
          </div>

          {problem && (
            <p role="alert" className="mt-3 flex items-start gap-2 text-sm text-red-700">
              <FiAlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
              {problem}
            </p>
          )}
        </div>
      )}
    </section>
  );
};

export default AccessibilitySurvey;
