import { FiAlertCircle } from 'react-icons/fi';

import {
  CROWD_LEVEL_OPTIONS,
  DEFAULT_CROWD_LEVEL,
  MONTHS,
  SEASONALITY_SOURCE_OPTIONS,
  describeMonths,
  isCrowdClaimed,
  seasonalityProblem
} from '../../constants/placeSeasonality';

/**
 * The control that records when a place is worth visiting (`FV-028` stage a).
 *
 * **It ships in the same sprint as its columns, deliberately.** `places.setting` shipped a
 * migration, a validator, a `CHECK` constraint and an index with no way to set it (`TD-023`), and
 * the whole catalogue sat at `unknown` while two features read it. `FV-029` did not repeat that and
 * neither does this.
 *
 * ---------------------------------------------------------------------------
 * Why months rather than a season
 * ---------------------------------------------------------------------------
 * The browse filter offers three seasons, so offering three checkboxes here would be simpler and
 * would be wrong: a season is a different thing in Kerala and in Ladakh, and storing one region's
 * calendar is how the free-text field this replaces became unusable. The admin picks months; the
 * filter maps its three seasons onto them.
 *
 * The shortcuts exist because twelve checkboxes is a tedious control and a tedious control gets
 * filled in carelessly. They set months, not a season — what is stored is always the months.
 *
 * ---------------------------------------------------------------------------
 * What this control is fixing
 * ---------------------------------------------------------------------------
 * The season filter has always matched month names against free text, and a regex cannot tell a
 * recommendation from a warning: `lower('Avoid April') ~ 'april|may|june'` is TRUE, so a place whose
 * own note warns you off April was returned to somebody filtering for April (`BUG-056`). Everything
 * here exists so a curator can say which months are *good*, in a form nothing has to interpret.
 */

const MonthPicker = ({ selected, onToggle, onSet }) => (
  <fieldset className="mb-6">
    <legend className="text-sm font-semibold text-gray-800">Best months to visit</legend>
    <p className="mb-3 text-xs text-gray-600">
      Tick the months this place is actually good. Leave it empty if nobody has worked it out —
      empty means <strong>not curated</strong>, and travellers are told nothing rather than
      something invented.
    </p>

    <div className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
      {MONTHS.map((month) => {
        const id = `best_month_${month.value}`;
        const checked = selected.includes(month.value);

        return (
          <label
            key={month.value}
            htmlFor={id}
            className={`flex cursor-pointer items-center gap-2 rounded-lg border p-2 text-sm transition-colors ${
              checked ? 'border-primary-600 bg-primary-50' : 'border-gray-300 hover:bg-gray-50'
            }`}
          >
            <input
              type="checkbox"
              id={id}
              checked={checked}
              onChange={() => onToggle(month.value)}
              className="h-4 w-4 flex-shrink-0 rounded text-primary-600 focus:ring-primary-500"
            />
            <span className="text-gray-900">{month.short}</span>
          </label>
        );
      })}
    </div>

    <div className="flex flex-wrap gap-2">
      {/* Shortcuts, not seasons. They fill the checkboxes and then get out of the way — nothing
          records that "winter" was pressed, because the stored fact is the months. */}
      {[
        { label: 'Winter', months: [10, 11, 12, 1, 2, 3] },
        { label: 'Summer', months: [4, 5, 6] },
        { label: 'Monsoon', months: [7, 8, 9] },
        { label: 'All year', months: MONTHS.map((month) => month.value) },
        { label: 'Clear', months: [] }
      ].map((preset) => (
        <button
          key={preset.label}
          type="button"
          onClick={() => onSet(preset.months)}
          className="rounded-full border border-gray-300 px-3 py-1 text-xs text-gray-700 hover:bg-gray-50"
        >
          {preset.label}
        </button>
      ))}
    </div>

    {selected.length > 0 && (
      <p className="mt-3 text-xs text-gray-600">
        Travellers will see: <strong>{describeMonths(selected)}</strong>
      </p>
    )}
  </fieldset>
);

export const SeasonalitySurvey = ({ formData = {}, onChange }) => {
  const selected = Array.isArray(formData.best_months) ? formData.best_months : [];

  // `onChange` takes a synthetic event because that is what the wizard's `handleChange` reads; the
  // months are not a native form control, so the event is constructed rather than captured.
  const emit = (months) => onChange({ target: { name: 'best_months', value: months } });

  const toggle = (month) =>
    emit(
      selected.includes(month)
        ? selected.filter((value) => value !== month)
        : [...selected, month].sort((a, b) => a - b)
    );

  const claiming =
    selected.length > 0 ||
    isCrowdClaimed(formData.crowd_level) ||
    Boolean(formData.typical_visit_minutes);
  const problem = seasonalityProblem(formData);

  return (
    <section className="mb-8" aria-labelledby="seasonality-heading">
      <h2 id="seasonality-heading" className="mb-1 text-xl font-semibold text-gray-800">
        When to go
      </h2>
      <p className="mb-5 text-sm text-gray-600">
        Half of a travel decision is <em>when</em>, and the catalogue currently says nothing about
        it. Only record what somebody has actually worked out —{' '}
        <strong>blank is a safe answer</strong>.
      </p>

      <MonthPicker selected={selected} onToggle={toggle} onSet={emit} />

      <fieldset className="mb-6">
        <legend className="text-sm font-semibold text-gray-800">How busy is it?</legend>
        <p className="mb-3 text-xs text-gray-600">
          Typically — not on the one day somebody visited.
        </p>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {CROWD_LEVEL_OPTIONS.map((option) => {
            const id = `crowd_level-${option.value}`;
            const checked = (formData.crowd_level || DEFAULT_CROWD_LEVEL) === option.value;

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
                  name="crowd_level"
                  value={option.value}
                  checked={checked}
                  onChange={onChange}
                  className="mt-1 h-4 w-4 flex-shrink-0 text-primary-600 focus:ring-primary-500"
                />
                <span>
                  <span className="block text-sm font-medium text-gray-900">{option.label}</span>
                  <span className="block text-xs text-gray-600">{option.description}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="mb-6">
        <label
          htmlFor="typical_visit_minutes"
          className="mb-1 block text-sm font-semibold text-gray-800"
        >
          How long does a visit take?
        </label>
        <p className="mb-2 text-xs text-gray-600">
          In minutes. This is what a day planner needs to know, and it is the number nobody ever
          writes down. Leave it blank rather than guessing.
        </p>
        <input
          type="number"
          id="typical_visit_minutes"
          name="typical_visit_minutes"
          min={1}
          max={1440}
          value={formData.typical_visit_minutes ?? ''}
          onChange={onChange}
          placeholder="90"
          className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-primary-500 sm:w-48"
        />
      </div>

      {/* Revealed by a claim, because that is when it becomes required. Rendering it always would
          make it look optional; hiding it after a claim would make the 400 a mystery. Same
          reasoning, and the same shape, as `AccessibilitySurvey`. */}
      {claiming && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="mb-3 text-sm text-amber-900">
            You have recorded an answer, so this has to say{' '}
            <strong>who worked it out and when</strong>. An answer without those cannot be shown to
            anyone, and will not save.
          </p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="seasonality_source"
                className="mb-1 block text-sm font-medium text-gray-800"
              >
                Where did this come from?
              </label>
              <select
                id="seasonality_source"
                name="seasonality_source"
                value={formData.seasonality_source || ''}
                onChange={onChange}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">Choose one…</option>
                {SEASONALITY_SOURCE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-600">
                {SEASONALITY_SOURCE_OPTIONS.find(
                  (option) => option.value === formData.seasonality_source
                )?.description ||
                  'Research is a real answer — say so rather than implying a visit.'}
              </p>
            </div>

            <div>
              <label
                htmlFor="seasonality_checked_on"
                className="mb-1 block text-sm font-medium text-gray-800"
              >
                When was it last checked?
              </label>
              <input
                type="date"
                id="seasonality_checked_on"
                name="seasonality_checked_on"
                value={formData.seasonality_checked_on || ''}
                onChange={onChange}
                max={new Date().toISOString().slice(0, 10)}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
              <p className="mt-1 text-xs text-gray-600">
                Seasonality decays — a quiet place gets popular. The date is shown beside the answer
                so a traveller can judge how much to trust it.
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

export default SeasonalitySurvey;
