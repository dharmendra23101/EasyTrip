import { useCallback, useEffect, useMemo, useState } from 'react';
import { FiCheck, FiMinus, FiSliders } from 'react-icons/fi';

import { fetchPlaceFit } from '../../services/placesApi';
import { MONTHS } from '../../constants/placeSeasonality';
import { THEMES } from '../../constants/themes';

/**
 * How well this place fits the trip somebody is describing, and **why** (`FV-028` stage d).
 *
 * ---------------------------------------------------------------------------
 * The number is the dangerous part, so the number never travels alone
 * ---------------------------------------------------------------------------
 * A percentage looks like a measurement. It is the one rendering in this whole feature that a reader
 * will believe without reading the sentence beside it, which is exactly why the earlier stages were
 * built the way they were: `MonthGrid` refuses to colour a month "avoid", `QuieterNearby` stays
 * silent rather than claim it looked. This panel is where that discipline is hardest to hold, because
 * "78%" is so much more satisfying than "we know three things about this place".
 *
 * So three rules are enforced here rather than left to the caller:
 *
 * **1. The score is never shown without its coverage.** They are rendered in the same sentence, not
 * in the same card - a reader who sees the first has already seen the second. 78% over a fifth of the
 * evidence and 78% over all of it are different claims, and the API returns `coverage` precisely so
 * this component cannot pretend otherwise.
 *
 * **2. A `null` score renders as words, never as a bar at zero.** `null` means nothing was known. A
 * progress bar sitting at the left edge says "this place scored badly", which is a claim nobody made
 * about a place nobody has curated - the same fabrication `MonthGrid`'s missing red would have been.
 *
 * **3. What could not be counted is shown, with its reason.** The absent factors are the honest half
 * of the answer. Hiding them would leave a confident four-line explanation that silently omits that
 * three of the four inputs were unknown.
 *
 * ---------------------------------------------------------------------------
 * It is arithmetic, and it says so in the interface
 * ---------------------------------------------------------------------------
 * `FP-012` bars dressing a rule-based feature up as AI. There is no model here and the panel says so
 * in words a traveller reads, not only in a comment: the weights come from the API and are printed
 * next to the factors they weight, so the reader can add it up themselves. An explanation nobody can
 * check is decoration.
 *
 * ---------------------------------------------------------------------------
 * Where it renders, and where it does not
 * ---------------------------------------------------------------------------
 * Inside the existing `when` section, which `PlaceArticle` already gates on `hasSeasonalityInfo`. Two
 * consequences, both wanted:
 *
 *   - **No anchor of its own**, so there is no table-of-contents entry that can point at nothing -
 *     the dead-link class of bug `BL-139` fixed and `QuieterNearby` sidesteps the same way.
 *   - **It appears only where somebody has curated something.** On an untouched place the panel would
 *     be a form whose every answer is "nobody has recorded that", which is a worse thing to offer
 *     than nothing. The gate widens on its own as the catalogue is curated; it needs no code change.
 */

/** The reader has not answered yet. Distinct from "answered none", which is a real, scoreable answer. */
const NO_MONTH = '';

export const PlaceFit = ({ placeId }) => {
  const [month, setMonth] = useState(NO_MONTH);
  const [interests, setInterests] = useState([]);
  const [fit, setFit] = useState(null);

  // Stable across renders so the effect below is not re-run by a new array identity on every
  // keystroke elsewhere in the page.
  const interestKey = useMemo(() => interests.join(','), [interests]);

  useEffect(() => {
    if (!placeId) return undefined;

    let cancelled = false;

    fetchPlaceFit(placeId, {
      month: month === NO_MONTH ? undefined : Number(month),
      interests: interestKey ? interestKey.split(',') : []
    })
      .then((response) => {
        // `?.data` rather than `|| null`: a malformed response must land on the "nothing is known"
        // path, not throw past the catch and leave the previous answer on screen beside the new
        // question. Stale working is worse than none - it is working for a question nobody asked.
        if (!cancelled) setFit(response?.data ?? null);
      })
      .catch(() => {
        if (!cancelled) setFit(null);
      });

    return () => {
      cancelled = true;
    };
  }, [placeId, month, interestKey]);

  const toggleInterest = useCallback((id) => {
    setInterests((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
    );
  }, []);

  const scored = fit && fit.score !== null && fit.score !== undefined;

  return (
    <div className="mt-6 rounded-xl border border-gray-200 bg-gray-50 p-5">
      <h4 className="flex items-center gap-2 text-base font-semibold text-gray-900">
        <FiSliders className="h-4 w-4 text-primary-600" aria-hidden="true" />
        Does this place fit your trip?
      </h4>

      {/* `FP-012`, in the interface rather than only in a comment. A reader is entitled to know that
          the number below is four comparisons added up, not a prediction about them. */}
      <p className="mt-1 text-sm text-gray-600">
        Tell us when you are going and what you like. We add up what somebody has actually recorded
        about this place — it is arithmetic, not a prediction, and it shows its working.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="fit-month" className="block text-sm font-medium text-gray-700">
            When are you going?
          </label>
          <select
            id="fit-month"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
          >
            <option value={NO_MONTH}>No particular month</option>
            {MONTHS.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </div>

        <fieldset>
          <legend className="block text-sm font-medium text-gray-700">What do you like?</legend>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {THEMES.map((theme) => {
              const chosen = interests.includes(theme.id);

              return (
                <label
                  key={theme.id}
                  className={`cursor-pointer rounded-full border px-2.5 py-1 text-xs ${
                    chosen
                      ? 'border-primary-600 bg-primary-50 font-semibold text-primary-800'
                      : 'border-gray-300 bg-white text-gray-600'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={chosen}
                    onChange={() => toggleInterest(theme.id)}
                  />
                  {theme.label}
                </label>
              );
            })}
          </div>
        </fieldset>
      </div>

      {/* Announced, because the answer changes without the page navigating and a screen-reader user
          would otherwise have to go looking for what their last click did. */}
      <div aria-live="polite" className="mt-5">
        {scored ? (
          <>
            <p className="text-sm text-gray-900">
              {/* Rule 1. One sentence, so the score cannot be quoted without the standing behind it.
                  Splitting these into a big number and a footnote is exactly the failure. */}
              <span className="text-2xl font-bold text-primary-700">
                {Math.round(fit.score * 100)}% fit
              </span>{' '}
              <span className="text-gray-600">
                — from {Math.round(fit.coverage * 100)}% of what we would want to know.
              </span>
            </p>

            <ul className="mt-3 space-y-2">
              {fit.factors.map((factor) => (
                <li key={factor.key} className="flex gap-2 text-sm">
                  {/* Not colour alone (WCAG 1.4.1): the icon carries the counted/not-counted
                      distinction and every row names its own state in text. */}
                  <FiCheck
                    className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary-600"
                    aria-hidden="true"
                  />
                  <span>
                    <span className="font-medium text-gray-900">{factor.label}</span>
                    <span className="sr-only"> counted:</span>{' '}
                    <span className="text-gray-700">{factor.detail}</span>{' '}
                    {/* The weight, printed beside the thing it weights, so the reader can add the
                        score up themselves. An explanation nobody can check is decoration. */}
                    <span className="whitespace-nowrap text-xs text-gray-500">
                      (worth {Math.round(factor.weight * 100)}%)
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          fit && (
            /* Rule 2. Words, not a bar at zero. "We cannot score this" and "this scores zero" are
               different statements and only one of them is true here. */
            <p className="text-sm font-medium text-gray-900">
              We cannot score this place yet — nobody has recorded enough about it.
            </p>
          )
        )}

        {/* Rule 3. The honest half of the answer, on both paths: what was not counted, and why. */}
        {fit?.unavailable?.length > 0 && (
          <>
            <p className="mt-3 text-xs font-medium text-gray-600">
              {scored ? 'Not counted, so not held against it:' : 'What is missing:'}
            </p>
            <ul className="mt-1 space-y-1">
              {fit.unavailable.map((entry) => (
                <li key={entry.key} className="flex gap-2 text-xs text-gray-500">
                  <FiMinus className="mt-0.5 h-3 w-3 flex-shrink-0" aria-hidden="true" />
                  <span>
                    <span className="font-medium">{entry.label}</span>
                    <span className="sr-only"> could not be counted:</span> {entry.reason}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
};

export default PlaceFit;
