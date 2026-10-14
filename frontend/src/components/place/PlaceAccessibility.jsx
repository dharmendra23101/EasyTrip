import { FiCheck, FiInfo, FiMinus, FiSlash, FiUsers } from 'react-icons/fi';

import { hasAccessibilityInfo, isClaimed } from '../../constants/placeAccessibility';
import { formatDateShort } from '../../utils/dateFormat';

/**
 * What is known about getting into this place, and who says so (`FV-029` stage a, `BL-137`).
 *
 * The badge on a card is a summary; this is the version with room to be honest. Three things it does
 * that the badge cannot:
 *
 * **It renders `unknown` explicitly, as a sentence.** The card omits an unsurveyed place entirely,
 * because an absent badge in a grid cannot be mistaken for anything. On the page *about this place*
 * the opposite is true: silence reads as "there was nothing to say", and a traveller who needs step-
 * free access deserves to be told plainly that nobody has checked rather than left to infer it.
 *
 * **It attributes every claim in visible text**, not in a `title`. `FV-029`'s kill criterion is about
 * unmarked assertions, and *"step-free, according to the place, last checked 1 Aug 2026"* is a
 * different statement from *"step-free"* — the second is the one that strands somebody when the ramp
 * came out last winter.
 *
 * **It leads with the notes when there are any.** *"Step-free to the courtyard; the inner sanctum is
 * up eleven steps with no handrail"* is worth more than either enumerated answer, and the
 * enumerations exist to make the catalogue filterable rather than to replace the sentence.
 */

const ANSWERS = {
  yes: { label: 'Yes', Icon: FiCheck, className: 'text-emerald-700' },
  partial: { label: 'Partly', Icon: FiMinus, className: 'text-amber-700' },
  no: { label: 'No', Icon: FiSlash, className: 'text-gray-700' },
  unknown: { label: 'Not checked', Icon: FiInfo, className: 'text-gray-500' }
};

const SOURCES = {
  operator: 'according to the place itself',
  site_visit: 'checked in person',
  third_party: 'according to a third party'
};

const Answer = ({ question, level }) => {
  const answer = ANSWERS[level] || ANSWERS.unknown;

  return (
    <div className="flex items-start gap-3">
      <answer.Icon
        className={`mt-0.5 h-5 w-5 flex-shrink-0 ${answer.className}`}
        aria-hidden="true"
      />
      <div>
        <p className="text-sm font-medium text-gray-900">{question}</p>
        <p className={`text-sm ${answer.className}`}>{answer.label}</p>
      </div>
    </div>
  );
};

export const PlaceAccessibility = ({ place }) => {
  const surveyed = isClaimed(place?.step_free_access) || isClaimed(place?.accessible_restroom);
  const notes = place?.accessibility_notes;

  // Nothing recorded and nothing to say. Rendering an empty panel would be a heading promising
  // information that is not there — and `hasAccessibilityInfo` is shared with the table of contents
  // so the two cannot disagree about whether this section exists (`BL-139`).
  if (!hasAccessibilityInfo(place)) return null;

  const checked = place.accessibility_checked_on
    ? formatDateShort(place.accessibility_checked_on)
    : null;
  const source = SOURCES[place.accessibility_source];

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-8 shadow-xl">
      <h2 className="mb-1 flex items-center gap-2 font-serif text-2xl font-bold text-gray-900">
        <FiUsers className="h-6 w-6 text-primary-600" aria-hidden="true" />
        Getting in
      </h2>
      <p className="mb-6 text-sm text-gray-600">
        Recorded by an EasyTrip editor. It describes what somebody found on one day — check with the
        place before travelling if it decides your trip.
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Answer question="Step-free access" level={place.step_free_access} />
        <Answer question="Accessible restroom" level={place.accessible_restroom} />
      </div>

      {notes && <p className="mt-6 border-l-4 border-primary-100 pl-4 text-gray-700">{notes}</p>}

      {/* The attribution, in visible text rather than a tooltip. A claim and its provenance are one
          statement, and separating them is what turns the first into an unmarked assertion. */}
      {surveyed && (source || checked) && (
        <p className="mt-6 text-xs text-gray-500">
          {[source, checked && `last checked ${checked}`].filter(Boolean).join(' · ')}
        </p>
      )}
    </div>
  );
};

export default PlaceAccessibility;
