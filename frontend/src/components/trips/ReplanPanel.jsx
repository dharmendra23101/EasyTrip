import { FiArrowRight, FiCloudRain, FiInfo, FiLoader, FiSun } from 'react-icons/fi';

/**
 * The replan, as a diff somebody reads before anything happens (`FV-027` stage b).
 *
 * **Its own component rather than a section inside `FeasibilityPanel`**, though it renders directly
 * beneath it. The two answer different questions — *can this be done?* and *what would you change?*
 * — and `RouteSuggestion` set the precedent for a proposal owning its own file. Folding this in
 * would have taken that panel past 250 lines to say something it does not say.
 *
 * ---------------------------------------------------------------------------
 * Three rules, and each is a way this could quietly become harmful
 * ---------------------------------------------------------------------------
 * **1. Applying is a second, deliberate press.** The item's kill criteria stop the feature dead if
 * *"the replan cannot be presented as a reviewable diff — silently rewriting somebody's trip is
 * worse than having no feature at all"*. So nothing here moves anything on render, on load, or on
 * expanding a row. One button, one item, one move.
 *
 * **2. Applying one proposal invalidates the rest, and the list goes away.** Every proposal was
 * computed against the plan as it stood; accepting one changes that plan. The hook clears the whole
 * replan on any write, so what returns is a *stale list* replaced by nothing rather than by
 * something subtly wrong. Users must press again to get proposals that are true.
 *
 * **3. What it will not do is shown, not hidden.** A wet day left alone with no explanation reads as
 * a broken feature — so `declined` is rendered with its reason. That is the difference between "this
 * tool has nothing to say about your problem" and "this tool did not notice your problem".
 */

const Proposal = ({ proposal, onApply, busy }) => (
  <li className="rounded-xl border border-gray-200 bg-white p-4">
    <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-gray-900">
      <span>{proposal.title}</span>
      {/* Labelled, because the visible content is two numbers with an arrow between them — which a
          screen reader announces as "Day 1 Day 3" with nothing to say what happens in between. */}
      <span
        aria-label={`Move from day ${proposal.from_day_number} to day ${proposal.to_day_number}`}
        className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-700"
      >
        Day {proposal.from_day_number}
        <FiArrowRight className="h-3 w-3" aria-hidden="true" />
        Day {proposal.to_day_number}
      </span>
    </div>

    {/* The citation, laid out as a comparison rather than a sentence: the reader is deciding
        between two days, and the two conditions side by side is the decision. */}
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
      <span className="inline-flex items-center gap-1.5 text-amber-700">
        <FiCloudRain className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
        Day {proposal.from_day_number}: {proposal.because.from_condition}
        {typeof proposal.because.from_precipitation_mm === 'number' &&
          ` (${proposal.because.from_precipitation_mm} mm)`}
      </span>
      <span className="inline-flex items-center gap-1.5 text-green-700">
        <FiSun className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
        Day {proposal.to_day_number}: {proposal.because.to_condition}
      </span>
    </div>

    <div className="mt-3 flex items-center justify-between gap-3">
      {proposal.because.source && (
        // Open-Meteo is CC-BY, and attribution follows the data rather than the page it first
        // appeared on — the same rule the feasibility findings follow.
        <p className="text-xs text-gray-500">Forecast from {proposal.because.source}</p>
      )}
      <button
        type="button"
        onClick={() => onApply(proposal)}
        disabled={busy}
        className="ml-auto inline-flex min-h-[44px] items-center rounded-lg border border-primary-600 px-4 py-2 text-sm font-semibold text-primary-700 transition-colors hover:bg-primary-50 disabled:opacity-60"
      >
        Move to day {proposal.to_day_number}
      </button>
    </div>
  </li>
);

export const ReplanPanel = ({ replan, replanning, error, busy, onSuggest, onApply }) => (
  <section
    aria-labelledby="replan-heading"
    className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"
  >
    <div className="flex items-center justify-between gap-3">
      <h2 id="replan-heading" className="text-lg font-semibold text-gray-900">
        Is the weather going to be a problem?
      </h2>
      <button
        type="button"
        onClick={onSuggest}
        disabled={replanning}
        className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-700 disabled:opacity-60"
      >
        {replanning && <FiLoader className="h-4 w-4 animate-spin" aria-hidden="true" />}
        {replanning ? 'Checking…' : 'Check the forecast'}
      </button>
    </div>

    {/* Same reasoning as the feasibility panel's: the result replaces itself in place, so a screen
        reader that hears nothing after pressing has no way to know anything happened. */}
    <div aria-live="polite" className="mt-4">
      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error.message || 'Could not work out what to change.'}
        </p>
      )}

      {!error && !replan && !replanning && (
        <p className="text-sm text-gray-600">
          Looks at the forecast for each outdoor stop and suggests moving the ones that will be
          rained on. Nothing changes until you say so.
        </p>
      )}

      {!error && replan && replan.considered === 0 && (
        <p className="rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          Nothing outdoors is forecast to be rained on.
        </p>
      )}

      {!error && replan && replan.considered > 0 && replan.proposals.length > 0 && (
        <ul className="space-y-3">
          {replan.proposals.map((proposal) => (
            <Proposal key={proposal.item_id} proposal={proposal} onApply={onApply} busy={busy} />
          ))}
        </ul>
      )}

      {!error && replan && replan.declined?.length > 0 && (
        // Rule 3. Not an error state and not styled as one — these are things the tool has
        // deliberately declined to touch, and the reader needs to know it looked.
        <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Left alone</p>
          <ul className="mt-2 space-y-1.5">
            {replan.declined.map((decline) => (
              <li key={decline.item_id} className="flex gap-2 text-sm text-gray-700">
                <FiInfo
                  className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-gray-400"
                  aria-hidden="true"
                />
                <span>{decline.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  </section>
);

export default ReplanPanel;
