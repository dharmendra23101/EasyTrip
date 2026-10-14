/**
 * Whether a place can actually be visited (`FV-029` stage a).
 *
 * Two enumerated axes, one shared vocabulary, plus the provenance that makes a claim usable. The
 * reasoning, and the `CHECK` constraints that enforce it, are in
 * `migrations/012_place_accessibility.sql`.
 *
 * **This item has a kill criterion no other item in `FUTURE_VISION.md` has**, and every decision
 * here follows from it:
 *
 * > *"A wrong step-free claim strands somebody at the bottom of a staircase — this is the one place
 * > in the whole vision where an unmarked guess causes real harm, so unverified data must be
 * > labelled unverified or omitted."*
 *
 * So `unknown` is the default and it means **do not assert anything** — never `no`. Under-serving
 * somebody by staying silent is recoverable; telling them a ramp exists is not. Consumers read
 * `isClaimed` rather than testing for `'no'`.
 */

/**
 * The answers both axes take.
 *
 * `partial` is not a hedge, it is the commonest true answer: a ramp to the courtyard and eleven
 * steps to the sanctum. Without it every such place rounds to a lie in one direction or the other,
 * which is why `FUTURE_VISION`'s *"a few boolean columns"* was not what shipped.
 */
const ACCESS_LEVELS = ['yes', 'no', 'partial', 'unknown'];

/** What an unsurveyed row is, in the database and in the API. */
const DEFAULT_ACCESS_LEVEL = 'unknown';

/**
 * Where a claim came from. An allowlist, because it is rendered beside the claim as its caveat.
 *
 * Ordered weakest to strongest deliberately — `operator` is a claim by an interested party and is
 * recorded rather than trusted, which is the honest framing and the one an admin should see.
 */
const ACCESSIBILITY_SOURCES = ['operator', 'site_visit', 'third_party'];

/** The two columns that constitute a claim. Notes alone are not one — they assert nothing. */
const ACCESS_FIELDS = ['step_free_access', 'accessible_restroom'];

/** True when a row actually says something about this axis. The guard every consumer should use. */
const isClaimed = (level) =>
  typeof level === 'string' && ACCESS_LEVELS.includes(level) && level !== DEFAULT_ACCESS_LEVEL;

/**
 * Does this row make an accessibility claim at all?
 *
 * Mirrors `places_accessibility_is_attributed`'s left-hand side, so the API can reject a request
 * with a readable message instead of surfacing a constraint violation — while the constraint
 * remains the thing that is actually true, because the API is not the only possible writer.
 */
const makesAClaim = (row) => ACCESS_FIELDS.some((field) => isClaimed(row?.[field]));

module.exports = {
  ACCESS_LEVELS,
  DEFAULT_ACCESS_LEVEL,
  ACCESSIBILITY_SOURCES,
  ACCESS_FIELDS,
  isClaimed,
  makesAClaim
};
