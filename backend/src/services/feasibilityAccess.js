/**
 * The one feasibility check that is about the traveller rather than the plan (`FV-029` stage d).
 *
 * **Its own module because its input is a different kind of thing.** Every other check in
 * `feasibilityService` is a pure function of the itinerary: the same trip always produces the same
 * findings. This one also reads what the person looking at it has said they need, so the same trip
 * is feasible for one traveller and not for another — and that is worth a file boundary rather than
 * a paragraph, because it is the assumption a reader of the other checks is entitled to keep.
 *
 * `check-module-size` is what forced the split, at 599 lines. It picked the moment; the property
 * above picked which lines moved.
 *
 * Findings are built as literals rather than through `feasibilityService`'s `finding()` helper. That
 * helper exists to normalise a variadic `...extra`; every finding here has the same shape, and
 * importing it would make two modules circular to save nothing.
 */

/**
 * Stops that conflict with what the traveller said they need (`FV-029` stage d).
 *
 * ---------------------------------------------------------------------------
 * `unknown` is silent, and that is the entire design
 * ---------------------------------------------------------------------------
 * Almost the whole catalogue is unsurveyed. The tempting reading — *"we do not know, so warn them
 * to be safe"* — produces a warning on nearly every stop, which trains the traveller who most needs
 * these findings to dismiss them, and does it by asserting something nobody checked.
 *
 * `FV-029`'s kill criterion is about exactly that: *"unverified data must be labelled unverified or
 * omitted"*. Omitted is what this does. The cost is stated where the requirement is entered rather
 * than swallowed — the profile control says in as many words that no warning means nobody has
 * surveyed those stops.
 *
 * ---------------------------------------------------------------------------
 * Why step-free `no` is an error and a missing restroom is not
 * ---------------------------------------------------------------------------
 * Step-free access decides whether the traveller can get in **at all**, so a verified `no` against a
 * stated requirement is a plan that cannot be executed — which is what `error` means here, and what
 * makes `feasible` false. A restroom decides how long they can comfortably stay: a real problem to
 * plan around, not a locked door. Calling both errors would be easier and would flatten a
 * distinction the person reading this actually needs.
 *
 * `partial` is always a warning. It is the answer that most needs a human to read the notes — "a
 * ramp to the courtyard, eleven steps to the sanctum" is fine for one traveller and impossible for
 * another, and the engine has no business deciding which.
 *
 * ---------------------------------------------------------------------------
 * Nothing is inferred, and nothing is stored
 * ---------------------------------------------------------------------------
 * `requirements` arrives as plain data, like every other input this engine takes (`ADR-041`), so the
 * check is replayable and `AI-006` can score it. The findings are computed per request and never
 * persisted — a shared trip carries no trace of its owner's stated needs.
 */
const ACCESS_RULES = [
  {
    requirement: 'requires_step_free',
    field: 'place_step_free_access',
    // A locked door, not an inconvenience.
    no: { code: 'stop_not_step_free', severity: 'error', phrase: 'has no step-free access' },
    partial: {
      code: 'stop_partly_step_free',
      severity: 'warning',
      phrase: 'is only partly step-free'
    }
  },
  {
    requirement: 'requires_accessible_restroom',
    field: 'place_accessible_restroom',
    no: {
      code: 'stop_without_accessible_restroom',
      severity: 'warning',
      phrase: 'has no accessible restroom'
    },
    partial: {
      code: 'stop_without_accessible_restroom',
      severity: 'warning',
      phrase: 'may not have an accessible restroom'
    }
  }
];

const checkAccessNeeds = (day, orderedItems, requirements) => {
  const findings = [];

  for (const rule of ACCESS_RULES) {
    if (!requirements?.[rule.requirement]) continue;

    for (const item of orderedItems) {
      const answer = item[rule.field];
      // `unknown`, and a stop with no place at all, both mean nobody has checked.
      const outcome = answer === 'no' ? rule.no : answer === 'partial' ? rule.partial : null;
      if (!outcome) continue;

      findings.push({
        code: outcome.code,
        severity: outcome.severity,
        message: `"${item.title}" ${outcome.phrase}.`,
        day_number: day.day_number,
        item_ids: [item.id],
        // The claim's provenance travels with the finding, for the reason `checkDaylight`
        // carries its forecast source: a warning that reaches the traveller as a screenshot has
        // to say who checked and when, or it is the bare assertion the badge is forbidden from
        // making.
        //
        // **`checked_by`, not `source`.** `source` already means one specific thing in this
        // engine — the provider whose data produced a finding, carried because Open-Meteo is
        // CC-BY — and `FeasibilityPanel` renders it as the literal words *"Forecast from …"*.
        // Reusing the key would have shipped "Forecast from site_visit". An accessibility
        // survey's provenance is a kind of witness, not a provider owed attribution, so it gets
        // its own key rather than a shared one that reads correctly in only one of two cases.
        checked_by: item.place_accessibility_source ?? null,
        checked_on: item.place_accessibility_checked_on ?? null
      });
    }
  }

  return findings;
};

module.exports = { checkAccessNeeds, ACCESS_RULES };
