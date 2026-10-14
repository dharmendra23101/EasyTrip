import { FiCheck, FiMinus, FiSlash } from 'react-icons/fi';

import { isClaimed } from '../constants/placeAccessibility';
import { formatDateShort } from '../utils/dateFormat';

/**
 * A place's step-free answer, rendered with the caveat attached (`FV-029` stage a, `BL-137`).
 *
 * **The date is not decoration and it is not optional.** `FV-029`'s kill criterion is about unmarked
 * assertions, and a badge reading *"Step-free ✓"* is exactly one: it presents a fact somebody
 * checked on a particular day with the same confidence as the place's name. Ramps get removed, lifts
 * break, works close an entrance for a season. So the badge says **when**, always, in the same
 * breath — and the accessible name says **who**, because a claim by the operator and a claim by
 * somebody who went and looked are not the same claim.
 *
 * That is why this is a component rather than three lines inlined into `PlaceCard`: the rule is that
 * the answer never travels without its provenance, and a rule stated in one place can be checked.
 *
 * **Renders nothing for `unknown`,** which is most of the catalogue. An absent badge means nobody has
 * checked; it must never be read as "not accessible", and the surest way to keep those apart is to
 * make the unsurveyed case produce no element at all rather than a greyed-out one that looks like a
 * verdict.
 */

/**
 * The levels that get a badge — and **`unknown` is deliberately absent**, which is load-bearing
 * rather than an omission.
 *
 * `PlaceAccessibility`'s equivalent table *does* carry an `unknown` entry, because on the page about
 * one place "Not checked" is worth saying. Copying that here would start badging the entire
 * unsurveyed catalogue, and the `isClaimed` guard below is the only thing that would stop it. The
 * absence is asserted in `accessibilityBrowse.test.jsx` for exactly that reason: no mutation of the
 * guard alone can change behaviour while this table has no `unknown` key, so the table is what the
 * test has to pin.
 */
export const BADGE_LEVELS = {
  yes: {
    label: 'Step-free',
    sentence: 'Step-free access',
    Icon: FiCheck,
    className: 'bg-emerald-600/90 text-white'
  },
  partial: {
    label: 'Partly step-free',
    sentence: 'Partly step-free access',
    Icon: FiMinus,
    className: 'bg-amber-500/90 text-white'
  },
  // Not red. It is honest information that saves a wasted journey, not a warning about the place —
  // and colouring it as a failure would discourage admins from recording it.
  no: {
    label: 'Not step-free',
    sentence: 'No step-free access',
    Icon: FiSlash,
    className: 'bg-gray-700/90 text-white'
  }
};

const SOURCES = {
  operator: 'according to the place',
  site_visit: 'checked in person',
  third_party: 'according to a third party'
};

export const AccessibilityBadge = ({ place, className = '' }) => {
  // Two guards for one rule, and the redundancy is deliberate. `isClaimed` is the named rule;
  // `BADGE_LEVELS` having no `unknown` key is what makes it true today. Either alone would do, and
  // that is precisely why both are here — the one that is easy to delete is the one written down.
  if (!isClaimed(place?.step_free_access)) return null;
  const level = BADGE_LEVELS[place.step_free_access];
  if (!level) return null;

  const checked = place.accessibility_checked_on
    ? formatDateShort(place.accessibility_checked_on)
    : null;
  const source = SOURCES[place.accessibility_source];

  // The whole claim in one sentence, for a reader who gets the badge announced rather than seen.
  // Built from the same three fields the visible text uses, so they cannot disagree.
  const description = [level.sentence, source, checked && `last checked ${checked}`]
    .filter(Boolean)
    .join(', ');

  return (
    <span
      title={description}
      aria-label={description}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium shadow-md backdrop-blur-sm ${level.className} ${className}`}
    >
      <level.Icon className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
      <span>{level.label}</span>
      {/* Visible, not only in the label. A sighted reader deciding whether to trust this needs the
          date as much as a screen-reader user does. */}
      {checked && <span className="opacity-80">· {checked}</span>}
    </span>
  );
};

export default AccessibilityBadge;
