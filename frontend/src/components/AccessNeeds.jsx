import { FiUsers } from 'react-icons/fi';

/**
 * What the traveller needs, on their own profile (`FV-029` stage c).
 *
 * **The mirror image of the admin survey, and the differences are the design.** `AccessibilitySurvey`
 * records a claim about the world that somebody had to go and check, so it has four answers, a
 * source and a date, and the database refuses an unattributed one. This records a statement about
 * the person filling it in. Nobody has to verify it, there is no "unknown" — either they have told
 * us or they have not — and there is no "partly", because a requirement half-met is a requirement
 * not met.
 *
 * So: two checkboxes, and the copy carries the weight instead.
 *
 * **What it promises is exactly what stage (d) delivers, and no more.** It says the planner will
 * flag stops that cannot accommodate them — not that it will hide those stops, and not that it will
 * find accessible alternatives. Over-promising here is the same failure as an unmarked claim on a
 * place: somebody plans a trip believing the tool checked something it did not.
 *
 * **It also says what it cannot know.** Almost the whole catalogue is unsurveyed, so silence from
 * the planner means "nobody has checked these places", never "these places are fine". A traveller
 * who reads an absence of warnings as an all-clear is the person this feature exists to protect.
 */

const NEEDS = [
  {
    name: 'requires_step_free',
    label: 'I need step-free access',
    description: 'Stops with no step-free access are flagged when you check a trip.'
  },
  {
    name: 'requires_accessible_restroom',
    label: 'I need an accessible restroom',
    description: 'Flagged the same way, where a place has been checked for one.'
  }
];

export const AccessNeeds = ({ values = {}, onChange }) => (
  <fieldset className="rounded-lg border border-gray-200 bg-gray-50 p-4">
    <legend className="flex items-center gap-2 px-1 text-sm font-medium text-gray-700">
      <FiUsers className="h-4 w-4 text-primary-600" aria-hidden="true" />
      Access needs
    </legend>

    <p className="mb-3 text-xs text-gray-600">
      Only used to check your own trips. It is never shown to anyone else and never affects what you
      can see or book.
    </p>

    <div className="space-y-3">
      {NEEDS.map((need) => (
        <label
          key={need.name}
          htmlFor={need.name}
          className="flex cursor-pointer items-start gap-3"
        >
          <input
            type="checkbox"
            id={need.name}
            name={need.name}
            checked={Boolean(values[need.name])}
            onChange={(event) => onChange(need.name, event.target.checked)}
            className="mt-0.5 h-4 w-4 flex-shrink-0 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
          />
          <span>
            <span className="block text-sm text-gray-900">{need.label}</span>
            <span className="block text-xs text-gray-600">{need.description}</span>
          </span>
        </label>
      ))}
    </div>

    {/* The limit of the promise, stated where the promise is made. Most places have not been
        surveyed, so no warning is not an all-clear — and a traveller who reads it as one is exactly
        who this feature exists to protect. */}
    <p className="mt-3 text-xs text-gray-500">
      Most places have not been checked yet. No warning means nobody has surveyed those stops — not
      that they will suit you.
    </p>
  </fieldset>
);

export default AccessNeeds;
