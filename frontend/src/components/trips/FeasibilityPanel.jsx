import { FiAlertTriangle, FiCheckCircle, FiInfo, FiLoader, FiXCircle } from 'react-icons/fi';
import { formatDateShort } from '../../utils/dateFormat';

/**
 * The feasibility report, shown to the person who has to execute the plan (`FV-025`, `IMP-130`).
 *
 * **Three rules the presentation has to get right, and each of them is a way this panel could
 * quietly become useless:**
 *
 * 1. **Nothing is shown until it is asked for.** A verdict that appears on load, before the trip is
 *    finished, is a verdict about a half-built plan — and a panel that is red while you are still
 *    typing is a panel people learn to ignore.
 * 2. **Errors and warnings do not look the same.** An error means the day cannot be done; a warning
 *    means it is awkward, and a traveller is allowed to want an awkward day. Painting both red
 *    teaches the reader that red sometimes means "carry on", which is exactly the lesson that makes
 *    the next real error invisible (the same reasoning as the moderation queue's 409).
 * 3. **Every estimate says it is one.** There is no routing provider: travel times come from
 *    straight-line distance, a road factor and an average speed. The engine returns its assumptions
 *    for this purpose, and this component renders them rather than hiding them behind a number that
 *    looks measured (`PROJECT_CONSTITUTION.md` Article III).
 */

const SEVERITY = {
  error: {
    Icon: FiXCircle,
    tone: 'border-red-200 bg-red-50 text-red-800',
    iconTone: 'text-red-500',
    label: 'Cannot be done as planned'
  },
  warning: {
    Icon: FiAlertTriangle,
    tone: 'border-amber-200 bg-amber-50 text-amber-800',
    iconTone: 'text-amber-500',
    label: 'Worth a look'
  }
};

/**
 * How an accessibility survey's provenance reads in a warning (`FV-029` stage d).
 *
 * The same three values `AccessibilityBadge` renders, worded for a sentence that follows a problem
 * rather than a label that sits beside an answer. `operator` stays hedged on purpose: it is a claim
 * by an interested party, and the traveller deciding whether to trust a warning should be able to
 * see that.
 */
const CHECKED_BY = {
  operator: 'The place says so',
  site_visit: 'Checked in person',
  third_party: 'Reported by a third party'
};

const Finding = ({ finding }) => {
  const style = SEVERITY[finding.severity] ?? SEVERITY.warning;
  const { Icon } = style;

  return (
    <li className={`flex gap-3 rounded-xl border p-3 text-sm ${style.tone}`}>
      <Icon className={`mt-0.5 h-4 w-4 flex-shrink-0 ${style.iconTone}`} aria-hidden="true" />
      <div>
        <span className="sr-only">{style.label}: </span>
        <p>{finding.message}</p>
        {finding.estimated && (
          // Attached to the finding rather than only to the panel footer: a screenshot of one
          // warning has to carry its own caveat, because that is how a warning travels.
          <p className="mt-1 text-xs opacity-75">
            Estimated from straight-line distance — not a routed journey.
          </p>
        )}
        {finding.checked_by && (
          // The badge's rule, in a warning. An accessibility finding without who checked and when
          // is the bare assertion `FV-029` exists to prevent — a ramp removed last winter reads
          // exactly like one confirmed this morning otherwise.
          //
          // Deliberately not folded into `finding.source` below: that key means "the provider whose
          // data produced this", is rendered as the literal words "Forecast from", and is there
          // because Open-Meteo is CC-BY. A survey's witness is a different thing.
          <p className="mt-1 text-xs opacity-75">
            {CHECKED_BY[finding.checked_by] ?? 'Recorded'}
            {finding.checked_on ? `, ${formatDateShort(finding.checked_on)}` : ''}
          </p>
        )}
        {finding.source && (
          // The same reasoning, applied to somebody else's licence rather than to our own
          // estimate. Open-Meteo is CC-BY, and attribution follows the data rather than the page it
          // first appeared on — which is the gap `IMP-127` found for the geocoder. The provider is
          // named by the finding, not hardcoded here, so a second source could never be mislabelled.
          //
          // The wording is "forecast", not "sunrise and sunset", because two rules now rest on the
          // same reading: daylight (`FV-031`) and rain (`FV-027`). Naming only one of them would
          // have made a rain warning cite the sunrise it never consulted.
          <p className="mt-1 text-xs opacity-75">
            Forecast from{' '}
            <a
              href="https://open-meteo.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              {finding.source}
            </a>
          </p>
        )}
      </div>
    </li>
  );
};

export const FeasibilityPanel = ({ report, checking, error, onCheck }) => (
  <section
    aria-labelledby="feasibility-heading"
    className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"
  >
    <div className="flex items-center justify-between gap-3">
      <h2 id="feasibility-heading" className="text-lg font-semibold text-gray-900">
        Can this plan be done?
      </h2>
      <button
        type="button"
        onClick={onCheck}
        disabled={checking}
        className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-700 disabled:opacity-60"
      >
        {checking && <FiLoader className="h-4 w-4 animate-spin" aria-hidden="true" />}
        {checking ? 'Checking…' : 'Check this plan'}
      </button>
    </div>

    {/* `aria-live` because the result replaces itself in place: a screen-reader user who presses
        the button and hears nothing has no way to know the check ran at all. */}
    <div aria-live="polite" className="mt-4">
      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error.message || 'Could not check this trip.'}
        </p>
      )}

      {!error && !report && !checking && (
        <p className="text-sm text-gray-600">
          Checks the days against the trip&apos;s dates, looks for overlapping times, and estimates
          whether there is enough time to travel between stops.
        </p>
      )}

      {!error && report && report.findings.length === 0 && (
        <p className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          <FiCheckCircle className="h-4 w-4 flex-shrink-0 text-green-600" aria-hidden="true" />
          Nothing here looks impossible. Times, distances and days all add up.
        </p>
      )}

      {!error && report && report.findings.length > 0 && (
        <>
          <p className="text-sm font-medium text-gray-800">
            {report.counts.errors > 0
              ? `${report.counts.errors} thing${report.counts.errors === 1 ? '' : 's'} that cannot be done as planned`
              : 'Nothing impossible — but some things are worth a look'}
            {report.counts.warnings > 0 && `, and ${report.counts.warnings} worth a look`}.
          </p>
          <ul className="mt-3 space-y-2">
            {report.findings.map((finding, index) => (
              <li key={`${finding.code}-${index}`} className="list-none">
                <ul className="list-none">
                  <Finding finding={finding} />
                </ul>
              </li>
            ))}
          </ul>
        </>
      )}

      {!error && report && report.assumptions && (
        // The numbers behind every travel estimate, in the open. When a routing provider lands
        // (`FV-026`) this block is how the change becomes visible rather than silent.
        <p className="mt-4 flex items-start gap-2 text-xs text-gray-500">
          <FiInfo className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
          <span>
            Travel times assume {report.assumptions.average_speed_kmh} km/h and roads about{' '}
            {Math.round((report.assumptions.road_factor - 1) * 100)}% longer than a straight line.
            EasyTrip does not use a routing service, so these are estimates rather than directions.
          </span>
        </p>
      )}
    </div>
  </section>
);

export default FeasibilityPanel;
