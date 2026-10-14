import { useState, useEffect } from 'react';
import {
  FiSun,
  FiCloud,
  FiCloudRain,
  FiCloudSnow,
  FiCloudLightning,
  FiWind,
  FiDroplet,
  FiAlertCircle
} from 'react-icons/fi';

import { fetchPlaceWeather } from '../../services/placesApi';
import { formatWeekdayShort } from '../../utils/dateFormat';

/**
 * Real weather on the place page (`IMP-110`).
 *
 * **What this replaces.** A hardcoded 24 °C "Partly cloudy" with an icon path that did not exist,
 * rendered as though it were a reading. `IMP-027` deleted it; `README` preview 7 still shows it and
 * says so. This is the honest version, and the design rule that follows from that history is
 * absolute: **if there is no real reading, this component says there is none.** It never renders a
 * placeholder number, a dash that looks like a temperature, or a skeleton that never resolves.
 *
 * Client-fetched rather than baked into `getStaticProps`: the page is ISR-cached, so a forecast
 * rendered at build time would be stale on arrival and then served from cache to everyone.
 */

/** WMO code → icon. The words come from the server; only the glyph is chosen here. */
const iconFor = (code) => {
  if (code === 0 || code === 1) return FiSun;
  if (code === 2 || code === 3 || code === 45 || code === 48) return FiCloud;
  if (code >= 71 && code <= 77) return FiCloudSnow;
  if (code >= 85 && code <= 86) return FiCloudSnow;
  if (code >= 95) return FiCloudLightning;
  if (code >= 51) return FiCloudRain;
  return FiCloud;
};

export const PlaceWeather = ({ placeId }) => {
  const [state, setState] = useState({ status: 'loading', data: null });

  useEffect(() => {
    if (!placeId) return undefined;

    const controller = new AbortController();
    let cancelled = false;

    const load = async () => {
      try {
        const data = await fetchPlaceWeather(placeId, { signal: controller.signal });
        if (cancelled) return;
        // The server distinguishes "no coordinates" from "provider down" and this keeps them
        // apart, because they need different sentences — one is about this place, the other is
        // about right now.
        setState({ status: data?.available ? 'ready' : 'unavailable', data });
      } catch (error) {
        if (cancelled || error.name === 'AbortError') return;
        setState({ status: 'unavailable', data: { reason: 'provider_unavailable' } });
      }
    };

    load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [placeId]);

  if (state.status === 'loading') {
    return (
      <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <div className="h-4 w-24 animate-pulse rounded bg-gray-200" />
        <div className="mt-4 h-10 w-32 animate-pulse rounded bg-gray-200" />
      </div>
    );
  }

  if (state.status === 'unavailable') {
    // Stated plainly rather than hidden. A missing panel reads as a broken page; a sentence reads
    // as a fact — and the fact is that we do not know, which is the whole point of this feature.
    const noCoordinates = state.data?.reason === 'no_coordinates';
    return (
      <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <h3 className="flex items-center font-serif text-lg font-bold text-gray-900">
          <FiCloud className="mr-2 h-5 w-5 text-gray-400" aria-hidden="true" />
          Weather
        </h3>
        <p className="mt-3 flex items-start text-sm text-gray-600">
          <FiAlertCircle
            className="mr-2 mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400"
            aria-hidden="true"
          />
          {noCoordinates
            ? 'This place has no coordinates on file yet, so there is no forecast for it.'
            : 'Weather is unavailable right now. We show a real forecast or nothing at all.'}
        </p>
      </div>
    );
  }

  const { current, forecast = [], source } = state.data;

  /**
   * `react-hooks/static-components` flags the line below, and it is **wrong here** - recorded
   * rather than silenced, because the difference matters (`BL-146`).
   *
   * The rule exists to catch a component *defined* during render, which gets a new identity every
   * time and so remounts its subtree and discards its state. `iconFor` defines nothing: it is a
   * lookup that returns one of five `react-icons` components imported at module scope, so the
   * identity is stable for a given weather code and changes only when the code moves between
   * categories - which is exactly when a different icon *should* mount.
   *
   * The rule cannot see that, because a capitalised local assigned during render is
   * indistinguishable from a created one without following the callee. `const Icon = pick(x)` is
   * the idiomatic way to render a dynamically chosen component, so the disable is on this line
   * only and the rule stays on everywhere else, where it would catch the real thing.
   */
  const CurrentIcon = iconFor(current.code);

  return (
    <section
      aria-labelledby="place-weather"
      className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm"
    >
      <h3
        id="place-weather"
        className="flex items-center font-serif text-lg font-bold text-gray-900"
      >
        {/* eslint-disable-next-line react-hooks/static-components -- see the note on `CurrentIcon` */}
        <CurrentIcon className="mr-2 h-5 w-5 text-primary-600" aria-hidden="true" />
        Weather
      </h3>

      <div className="mt-4 flex items-end gap-3">
        <p className="text-4xl font-bold text-gray-900">
          {current.temperature_c}
          <span className="text-2xl">°C</span>
        </p>
        <div className="pb-1">
          <p className="font-medium text-gray-800">{current.condition}</p>
          {current.feels_like_c !== null && (
            <p className="text-sm text-gray-500">Feels like {current.feels_like_c}°C</p>
          )}
        </div>
      </div>

      <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-600">
        {current.humidity_pct !== null && (
          <div className="flex items-center">
            <dt className="sr-only">Humidity</dt>
            <FiDroplet className="mr-1.5 h-4 w-4 text-gray-400" aria-hidden="true" />
            <dd>{current.humidity_pct}%</dd>
          </div>
        )}
        {current.wind_kph !== null && (
          <div className="flex items-center">
            <dt className="sr-only">Wind speed</dt>
            <FiWind className="mr-1.5 h-4 w-4 text-gray-400" aria-hidden="true" />
            <dd>{current.wind_kph} km/h</dd>
          </div>
        )}
      </dl>

      {forecast.length > 0 && (
        <ul className="mt-5 grid grid-cols-4 gap-2 border-t border-gray-100 pt-4 sm:grid-cols-7">
          {forecast.map((day) => {
            const DayIcon = iconFor(day.code);
            return (
              <li key={day.date} className="text-center">
                <p className="text-xs font-medium text-gray-500">{formatWeekdayShort(day.date)}</p>
                <DayIcon
                  className={`mx-auto my-1 h-4 w-4 ${day.is_wet ? 'text-blue-500' : 'text-gray-400'}`}
                  aria-hidden="true"
                />
                {/* The glyph above is `aria-hidden`, and it was the only thing carrying the
                    condition — so a screen reader announced a weekday and two numbers, and whether
                    it was going to rain reached nobody. The server has computed these words since
                    the panel was built (`describe(weather_code)`); the client picked a glyph from
                    the same code and dropped the string. Rendering it is the whole fix. */}
                <span className="sr-only">{day.condition}</span>
                <p className="text-xs text-gray-900">
                  <span className="sr-only">High </span>
                  {day.max_c}°
                </p>
                {/* `gray-500`, not `gray-400`: the low is deliberately quieter than the high, and
                    at 2.53:1 `gray-400` was quieter than WCAG AA allows. `gray-500` is 4.83:1 and
                    is what the weekday label above already uses. */}
                <p className="text-xs text-gray-500">
                  <span className="sr-only">Low </span>
                  {day.min_c}°
                </p>
              </li>
            );
          })}
        </ul>
      )}

      {/* Attribution, not decoration: Open-Meteo's terms ask for it, and naming the source is what
          separates this panel from the fabricated one it replaced. */}
      <p className="mt-4 text-xs text-gray-500">
        Forecast by{' '}
        <a
          href="https://open-meteo.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-gray-600"
        >
          {source}
        </a>
      </p>
    </section>
  );
};

export default PlaceWeather;
