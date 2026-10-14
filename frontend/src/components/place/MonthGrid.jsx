import { MONTHS } from '../../constants/placeSeasonality';

/**
 * The twelve months of the year, with the good ones marked (`FV-028` stage b, `INS-003`).
 *
 * **Google Flights' date grid with the axis changed from price to season.** `INS-003` recorded the
 * shape and rejected the substance: the price version needs a data source this project does not have
 * and cannot honestly obtain. What it can obtain is which months a place is worth visiting, and the
 * same reframe applies — *"when is this best"* rather than *"is this available"*.
 *
 * ---------------------------------------------------------------------------
 * Two states, not three, and this is the whole design
 * ---------------------------------------------------------------------------
 * A month is either **listed as best** or **not listed**. There is deliberately no "avoid" state,
 * and the grid must never read as one.
 *
 * The temptation is obvious: twelve cells, three of them green, and the other nine want a colour.
 * Red is the natural choice and it would be a **fabricated claim** — nobody said September is bad,
 * they said October to December is good, and those are different statements. It is the same rule the
 * schema runs on, where an empty `best_months` asserts nothing and `unknown` is never `no`. Here the
 * failure would be worse than a wrong database value, because a coloured grid is read at a glance and
 * believed without the sentence beside it.
 *
 * So unlisted months are neutral grey, the legend says what grey means in words, and the accessible
 * name for each cell spells it out rather than leaving a screen-reader user to infer it from a class.
 *
 * ---------------------------------------------------------------------------
 * Not colour alone
 * ---------------------------------------------------------------------------
 * WCAG 1.4.1: colour cannot be the only thing carrying the distinction. Every recommended month also
 * gets a visible filled marker and bold weight, and every cell carries text naming its state — so the
 * grid survives greyscale, a colour-blind reader, and a screen reader, and `axe` can see it does.
 */

export const MonthGrid = ({ months = [] }) => {
  const best = new Set(months);
  if (best.size === 0) return null;

  return (
    <div className="mt-2">
      <ol className="grid grid-cols-6 gap-1.5 sm:grid-cols-12" aria-label="Best months to visit">
        {MONTHS.map((month) => {
          const recommended = best.has(month.value);

          return (
            <li key={month.value}>
              <div
                className={`flex flex-col items-center gap-1 rounded-md border px-1 py-2 ${
                  recommended
                    ? 'border-primary-600 bg-primary-50 font-semibold text-primary-800'
                    : 'border-gray-200 bg-gray-50 text-gray-500'
                }`}
              >
                <span aria-hidden="true" className="text-xs">
                  {month.short}
                </span>

                {/* The non-colour half of the distinction. A filled dot for a recommended month, an
                    empty ring for one that is merely not listed — legible in greyscale, which the
                    background tint alone is not. */}
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 rounded-full ${
                    recommended ? 'bg-primary-600' : 'border border-gray-300'
                  }`}
                />

                {/* Named in full for a screen reader, because "Oct" and a green background is not a
                    statement anybody can hear. "Not listed" rather than "avoid" — the distinction
                    this component exists to protect. */}
                <span className="sr-only">
                  {month.label}: {recommended ? 'recommended' : 'not listed as a best month'}
                </span>
              </div>
            </li>
          );
        })}
      </ol>

      {/* The sentence that stops the grid being read as a verdict on the other nine months. */}
      <p className="mt-2 text-xs text-gray-600">
        Marked months are the ones somebody recommended. The rest are simply not listed — that is
        not a reason to stay away.
      </p>
    </div>
  );
};

export default MonthGrid;
