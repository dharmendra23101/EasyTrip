import { FiCalendar, FiClock, FiUsers } from 'react-icons/fi';

import {
  CROWD_LEVEL_LABELS,
  SEASONALITY_SOURCE_LABELS,
  describeDuration,
  describeMonths,
  hasSeasonalityInfo,
  isCrowdClaimed
} from '../../constants/placeSeasonality';
import { formatDateShort } from '../../utils/dateFormat';
import { MonthGrid } from './MonthGrid';
import { PlaceFit } from './PlaceFit';

/**
 * When this place is worth visiting, and who says so (`FV-028` stage a).
 *
 * **The visible-provenance half of the stage.** The columns and the admin control are the other two;
 * without this one the data would exist, be filterable, and never be attributed to anyone on the
 * page a traveller actually reads — which is the failure mode `FV-029` was built to avoid and this
 * feature inherits at lower stakes.
 *
 * Three deliberate differences from `PlaceAccessibility`, all following from the stakes:
 *
 * **It renders nothing when nothing is curated, rather than saying "not assessed".** On the
 * accessibility panel an explicit `unknown` is the point: a traveller who needs step-free access
 * must be told plainly that nobody checked, because silence reads as "fine". Here silence is
 * accurate — a missing crowd level strands nobody — and a panel repeating "not assessed" three times
 * across the whole catalogue would train people to skip the section before it ever has content.
 *
 * **The months are a phrase, not a list.** *"October to February"* is what somebody would say;
 * twelve checkboxes rendered as prose is not. The wrap across the year is the interesting case and
 * `describeMonths` handles it — a naive rendering turns one winter season into "January, February,
 * October to December", which reads as two.
 *
 * **The date is shown for the same reason it is required.** Seasonality decays: a quiet place gets
 * popular, and a crowd level from 2019 is displayed exactly as confidently as one from last week.
 */

const Fact = ({ Icon, label, value }) => (
  <div className="flex items-start gap-3">
    <Icon className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary-600" aria-hidden="true" />
    <div>
      <p className="text-sm font-medium text-gray-900">{label}</p>
      <p className="text-sm text-gray-700">{value}</p>
    </div>
  </div>
);

export const PlaceSeasonality = ({ place }) => {
  if (!hasSeasonalityInfo(place)) return null;

  const months = describeMonths(place.best_months);
  const crowd = isCrowdClaimed(place.crowd_level) ? CROWD_LEVEL_LABELS[place.crowd_level] : null;
  const duration = describeDuration(place.typical_visit_minutes);

  const source = SEASONALITY_SOURCE_LABELS[place.seasonality_source];
  const checked = place.seasonality_checked_on
    ? formatDateShort(place.seasonality_checked_on)
    : null;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6">
      <h2 className="mb-4 text-2xl font-bold text-gray-900">When to go</h2>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {months && <Fact Icon={FiCalendar} label="Best months" value={months} />}
        {crowd && <Fact Icon={FiUsers} label="How busy" value={crowd} />}
        {duration && <Fact Icon={FiClock} label="Typical visit" value={duration} />}
      </div>

      {/* `FV-028` stage (b), `INS-003`. The phrase above stays: the grid is scannable and the
          sentence is precise, and a reader who cannot use the grid still gets the answer. */}
      <MonthGrid months={place.best_months} />

      {/* In visible text rather than a `title`, because an unattributed claim and an attributed one
          are different statements and only the second can be judged. */}
      {(source || checked) && (
        <p className="mt-4 border-t border-gray-100 pt-3 text-xs text-gray-600">
          {[source && `From ${source}`, checked && `last checked ${checked}`]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}

      {/* `FV-028` stage (d). Inside this card, and therefore behind `hasSeasonalityInfo` above:
          the fit panel is a form, and offering one on a place where every answer is "nobody has
          recorded that" is worse than offering nothing. It also inherits this section's `when`
          anchor rather than claiming one of its own, which is how `QuieterNearby` avoids the dead
          table-of-contents entry `BL-139` fixed. */}
      <PlaceFit placeId={place.id} />
    </div>
  );
};

export default PlaceSeasonality;
