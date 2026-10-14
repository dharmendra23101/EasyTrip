import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { FiCompass } from 'react-icons/fi';

import { fetchRecommendations } from '../services/placesApi';
import { themeLabel } from '../constants/themes';

/**
 * Places picked from what you have saved (`FV-019`).
 *
 * ---------------------------------------------------------------------------
 * Every recommendation says why, in the interface
 * ---------------------------------------------------------------------------
 * `FV-019`'s own text is the requirement: *"an unexplained recommendation is indistinguishable from
 * an arbitrary one"*, and *"shipped as visible UI, not a debug field"*. So each card names the themes
 * it matched on, and the panel names the profile the whole answer came from. A reader can check the
 * suggestion against their own saved list and disagree with it — which is the difference between a
 * recommendation and an assertion.
 *
 * ---------------------------------------------------------------------------
 * It is arithmetic and it says so
 * ---------------------------------------------------------------------------
 * `FP-012`, twice over for this item: *"Not 'AI-powered sorting'. Build `FV-019` properly or call it
 * what it is."* There is no model. The panel says, in words a traveller reads, that this is a
 * comparison of tags — because a feature that stays quiet about being a heuristic is one that lets
 * the reader assume it is something cleverer.
 *
 * ---------------------------------------------------------------------------
 * Two absences it is careful about
 * ---------------------------------------------------------------------------
 * **Nothing saved** is not an error and not an empty grid: it is a specific, fixable state, so the
 * panel says what to do about it. Returning popular places instead would be a different feature
 * wearing this one's label.
 *
 * **Places nobody has tagged** could not be considered at all, and the count is shown. Saying "we
 * looked at everything" when 40 places carry no tags would be the same untruth as scoring them zero.
 */

export const RecommendedForYou = ({ getToken }) => {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (!getToken) return;
    try {
      setData(await fetchRecommendations(await getToken()));
      setFailed(false);
    } catch {
      // A failed suggestion panel is not worth an error banner on a browsing page — but it must not
      // render as "you have nothing saved" either, which is a claim about the reader rather than
      // about the request.
      setFailed(true);
    }
  }, [getToken]);

  useEffect(() => {
    load();
  }, [load]);

  if (failed || !data) return null;

  const { recommendations, basis, excluded } = data;

  // Nothing saved: a state with an action, not an empty grid.
  if (basis.saved_count === 0 || basis.profile.length === 0) {
    return (
      <section className="rounded-xl border border-gray-200 bg-white p-6">
        <h2 className="mb-1 flex items-center gap-2 text-xl font-semibold text-gray-900">
          <FiCompass className="h-5 w-5 text-primary-600" aria-hidden="true" />
          Picked from what you save
        </h2>
        <p className="text-sm text-gray-600">
          {basis.saved_count === 0
            ? 'Save a place you like and this fills in — the suggestions are built from the tags on what you save, so one is enough to start.'
            : 'The places you have saved have not been tagged yet, so there is nothing to match against. This fills in once they are.'}
        </p>
      </section>
    );
  }

  if (recommendations.length === 0) return null;

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-6">
      <h2 className="mb-1 flex items-center gap-2 text-xl font-semibold text-gray-900">
        <FiCompass className="h-5 w-5 text-primary-600" aria-hidden="true" />
        Picked from what you save
      </h2>

      {/* `FP-012`, in the interface rather than only in a comment. */}
      <p className="mb-1 text-sm text-gray-600">
        We compare the tags on the {basis.saved_count}{' '}
        {basis.saved_count === 1 ? 'place' : 'places'} you saved with the tags on everywhere else.
        It is a comparison of tags, not a prediction.
      </p>

      {/* The profile the whole answer was computed from. A recommendation whose input is invisible
          cannot be argued with. */}
      <p className="mb-4 text-xs text-gray-500">
        Matching on:{' '}
        {basis.profile.map((entry) => `${themeLabel(entry.theme)} (${entry.weight})`).join(', ')}
      </p>

      <ul className="grid gap-3 sm:grid-cols-2">
        {recommendations.map((place) => (
          <li key={place.id}>
            <Link
              href={`/places/${place.id}`}
              className="block rounded-lg border border-gray-200 p-3 transition-colors hover:bg-gray-50"
            >
              <span className="block font-medium text-gray-900">{place.name}</span>
              {place.location && (
                <span className="block text-sm text-gray-600">{place.location}</span>
              )}
              {/* The working, per card. Named themes rather than a percentage: "because you save
                  beach places" is checkable against the reader's own list, and a score is not. */}
              <span className="mt-1 block text-xs text-gray-500">
                Because you save{' '}
                {place.shared_themes.map((theme) => themeLabel(theme)).join(' and ')} places
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {excluded.no_themes_recorded > 0 && (
        // The honest half. "We looked at everything" would be untrue while this number is non-zero.
        <p className="mt-4 border-t border-gray-100 pt-3 text-xs text-gray-500">
          {excluded.no_themes_recorded} places could not be considered because nobody has tagged
          them yet.
        </p>
      )}
    </section>
  );
};

export default RecommendedForYou;
