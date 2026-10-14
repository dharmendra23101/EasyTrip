import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FiArrowRight, FiUsers } from 'react-icons/fi';

import { fetchQuieterNearby } from '../../services/placesApi';
import { CROWD_LEVEL_LABELS, SEASONALITY_SOURCE_LABELS } from '../../constants/placeSeasonality';

/**
 * Quieter places near this one (`FV-028` stage c).
 *
 * `FV-002` promises "somewhere not crowded" and until stage (a) the only honest answer was a guess.
 * This is the panel that answers it: given a place somebody judged busy, the ones nearby that
 * somebody judged quieter.
 *
 * ---------------------------------------------------------------------------
 * Silence is the common case, and it is designed for rather than tolerated
 * ---------------------------------------------------------------------------
 * "Less crowded" is a **relation**, so it takes two curated values. The API returns `[]` unless both
 * the origin and the candidate have a crowd level somebody entered, which today is nothing at all.
 *
 * So this renders **nothing** — no heading, no empty state, no "no quieter places found". An empty
 * state would appear on every page in the catalogue and would say something false: that we looked and
 * there was nowhere quieter, when the truth is that nobody has judged either end. A section that says
 * nothing is better than one that says the wrong thing confidently.
 *
 * It also means no anchor is registered for it, which sidesteps the dead-link class of bug `BL-139`
 * fixed: this lives inside the existing `related` section rather than claiming one of its own.
 *
 * ---------------------------------------------------------------------------
 * Client-side, deliberately
 * ---------------------------------------------------------------------------
 * The place page is server-rendered for crawlers, and this is not content a crawler needs — it is a
 * lateral suggestion, and fetching it server-side would put a second query on the critical path of
 * every place page to render nothing for all of them.
 */

export const QuieterNearby = ({ placeId }) => {
  const [places, setPlaces] = useState([]);

  useEffect(() => {
    if (!placeId) return undefined;

    // `cancelled` rather than an AbortController: the request is cheap and idempotent, and what
    // actually matters is not calling setState after the reader has navigated away.
    let cancelled = false;

    fetchQuieterNearby(placeId)
      .then((response) => {
        if (!cancelled) setPlaces(response?.data || []);
      })
      // A failed suggestion is not worth an error message on somebody's holiday reading. The panel
      // stays absent, which is what it would have been anyway for almost every place.
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [placeId]);

  if (places.length === 0) return null;

  return (
    <section className="mb-10 rounded-xl border border-gray-200 bg-white p-6">
      <h3 className="mb-1 flex items-center gap-2 text-xl font-semibold text-gray-900">
        <FiUsers className="h-5 w-5 text-primary-600" aria-hidden="true" />
        Quieter nearby
      </h3>
      <p className="mb-4 text-sm text-gray-600">
        Somebody judged these less crowded than this place.
      </p>

      <ul className="space-y-3">
        {places.map((place) => (
          <li key={place.id}>
            <Link
              href={`/places/${place.id}`}
              className="flex items-center justify-between gap-4 rounded-lg border border-gray-200 p-3 transition-colors hover:bg-gray-50"
            >
              <span>
                <span className="block font-medium text-gray-900">{place.name}</span>
                <span className="block text-sm text-gray-600">
                  {/* The crowd level and the distance together. "Quieter" on its own is not
                      actionable — "quieter, and 8 km away" is. */}
                  {CROWD_LEVEL_LABELS[place.crowd_level]} · {place.distance_km} km away
                </span>
                {/* Attributed here too. This is a claim about a *different* place, shown on a page
                    about this one, where it is even easier to read as established fact. */}
                {place.seasonality_source && (
                  <span className="block text-xs text-gray-500">
                    From {SEASONALITY_SOURCE_LABELS[place.seasonality_source]}
                    {place.seasonality_checked_on && `, checked ${place.seasonality_checked_on}`}
                  </span>
                )}
              </span>
              <FiArrowRight className="h-5 w-5 flex-shrink-0 text-gray-400" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
};

export default QuieterNearby;
