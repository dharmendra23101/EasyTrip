import { dayDate } from '../../utils/tripDates';
import { formatDate, formatDateShort } from '../../utils/dateFormat';

/**
 * The trip as a sheet of paper (`FV-009` stage b).
 *
 * ---------------------------------------------------------------------------
 * A separate page, not a print stylesheet on the workspace
 * ---------------------------------------------------------------------------
 * The obvious implementation is `@media print { … display: none }` over `/trips/[id]`. It is the
 * wrong shape, and the reason is a default rather than an aesthetic one:
 *
 * The workspace is dense with controls - reorder arrows on every item, a delete button on every day,
 * the feasibility and replan panels, the fit panel, the notes and checklist forms. Hiding them one by
 * one makes the default **"it prints unless somebody remembered to hide it"**, so every control added
 * later silently appears on paper until a person notices. That is a rule which decays on its own.
 *
 * A separate page inverts it: **nothing reaches paper unless it was put here deliberately.** It is
 * also testable, which a print stylesheet is not - jsdom has no pagination and `@media print` rules
 * are inert in it, so a suite could only assert that a class name exists.
 *
 * ---------------------------------------------------------------------------
 * This prints where the `.ics` export refuses
 * ---------------------------------------------------------------------------
 * Stage (a) returns 422 for a trip with no start date, because an event with no date has no position
 * on a calendar. **Paper has no such requirement.** "Day 1 / Day 2 / Day 3" is a perfectly usable
 * itinerary to carry, and refusing to print it would be applying a calendar's constraint to a
 * document that is not one. Dates appear when they are known and are simply absent when they are not.
 *
 * ---------------------------------------------------------------------------
 * What is on it, and why
 * ---------------------------------------------------------------------------
 * The itinerary, the checklist and the notes - which is to say the three things somebody actually
 * carries. Notes are on it because that is where a booking reference lives, and a printout that
 * omits the confirmation number is a printout that gets left behind. The checklist prints **as
 * boxes**: a ticked one shows its tick, and an unticked one is a box a person can tick with a pen,
 * which is the entire point of carrying it.
 *
 * Deliberately absent: everything that is a judgement rather than a fact. The feasibility report, the
 * replan proposal and the fit score are all *claims about* the plan, computed at a moment, and paper
 * has no way to say when they were computed or to withdraw them when the plan changes.
 */

/** `10:00:00` -> `10:00`. Postgres sends `TIME` with seconds; nobody writes an itinerary in seconds. */
const clockTime = (time) => (time ? String(time).slice(0, 5) : null);

const ItemLine = ({ item }) => (
  // `break-inside-avoid` here as well as on the day: a single stop split across a page boundary puts
  // a time on one sheet and the place it belongs to on the next.
  <li className="flex gap-3 break-inside-avoid border-b border-gray-200 py-2 last:border-b-0">
    {/* A fixed-width column, so the times line up down the page and can be scanned rather than read.
        The dash keeps the column occupied for an untimed stop, which stops the titles jumping left. */}
    <span className="w-14 flex-shrink-0 font-mono text-sm text-gray-700">
      {clockTime(item.start_time) || '—'}
    </span>

    <span className="min-w-0">
      <span className="block font-medium text-gray-900">{item.title}</span>

      {/* The place as a person would say it to a driver. */}
      {(item.place_name || item.place_location) && (
        <span className="block text-sm text-gray-600">
          {[item.place_name, item.place_location].filter(Boolean).join(', ')}
        </span>
      )}

      {/* `whitespace-pre-wrap`, as in the workspace: a note is often a list and collapsing it into a
          paragraph loses what it said. */}
      {item.notes && (
        <span className="block whitespace-pre-wrap text-sm text-gray-600">{item.notes}</span>
      )}
    </span>
  </li>
);

export const PrintableItinerary = ({ trip, notes = [], checklist = [] }) => {
  if (!trip) return null;

  return (
    <article className="mx-auto max-w-3xl bg-white p-8 text-gray-900 print:p-0">
      <header className="mb-6 border-b-2 border-gray-900 pb-4">
        <h1 className="font-serif text-3xl font-bold">{trip.title}</h1>

        {/* Both dates, or neither. A range with one end missing reads as a typo rather than as a
            trip somebody has not finished planning. */}
        {trip.start_date && (
          <p className="mt-1 text-gray-700">
            {formatDate(trip.start_date)}
            {trip.end_date && ` — ${formatDate(trip.end_date)}`}
          </p>
        )}

        {trip.description && <p className="mt-2 text-gray-700">{trip.description}</p>}
      </header>

      {trip.days?.length > 0 && (
        <section className="mb-8">
          {trip.days.map((day) => {
            const date = dayDate(trip, day.day_number);

            return (
              // The whole day held together where it fits on one sheet. A day split mid-way is the
              // commonest thing that makes a printed itinerary annoying to use.
              <section key={day.id} className="mb-5 break-inside-avoid">
                <h2 className="mb-1 border-b border-gray-400 pb-1 font-serif text-lg font-bold">
                  Day {day.day_number}
                  {/* Absent rather than invented when the trip has no dates — the same rule the rest
                      of this codebase runs on, and the reason `dayDate` returns null.

                      **Recorded as an equivalent mutant (`P9`).** Removing this guard changes
                      nothing today, because `formatDate(null)` returns `null` and React renders that
                      as nothing. It is kept because that is a contract of a *different* module: the
                      day this one starts returning the string "Invalid Date" — which it did before
                      `BUG-046` — the guard is what stops it reaching paper. */}
                  {date && (
                    <span className="ml-2 font-sans text-sm font-normal text-gray-600">
                      {formatDate(date)}
                    </span>
                  )}
                </h2>

                {day.items?.length > 0 ? (
                  <ol className="list-none">
                    {day.items.map((item) => (
                      <ItemLine key={item.id} item={item} />
                    ))}
                  </ol>
                ) : (
                  // Printed, not hidden. A day with nothing on it is a real part of the plan, and a
                  // gap in the numbering would read as a page that failed to print.
                  <p className="py-2 text-sm italic text-gray-500">Nothing planned.</p>
                )}
              </section>
            );
          })}
        </section>
      )}

      {checklist.length > 0 && (
        <section className="mb-8 break-inside-avoid">
          <h2 className="mb-2 border-b border-gray-400 pb-1 font-serif text-lg font-bold">
            Checklist
          </h2>
          <ul className="list-none">
            {checklist.map((item) => (
              <li key={item.id} className="flex items-start gap-2 py-1">
                {/* A drawn box rather than a checkbox input: an input prints as a control, and some
                    browsers will not print its checked state at all. This is the one thing on the
                    page a reader is expected to change with a pen. */}
                <span
                  aria-hidden="true"
                  className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center border border-gray-700 text-xs leading-none"
                >
                  {item.is_done ? '✓' : ''}
                </span>
                {/* The state in text too, so the page is not only legible to somebody looking at it.
                    Same rule as the workspace's `aria-pressed`. */}
                <span className="sr-only">{item.is_done ? 'Done:' : 'Not done:'}</span>
                <span className={item.is_done ? 'text-gray-500 line-through' : ''}>
                  {item.label}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {notes.length > 0 && (
        <section className="break-inside-avoid">
          <h2 className="mb-2 border-b border-gray-400 pb-1 font-serif text-lg font-bold">Notes</h2>
          {notes.map((note) => (
            <div key={note.id} className="mb-3 break-inside-avoid">
              <p className="whitespace-pre-wrap text-sm">{note.body}</p>
              {/* The date a note was written is part of what it means — "the hotel confirmed" and
                  "the hotel confirmed three weeks ago, before the dates changed" are different
                  statements. Short form here because paper is narrow. */}
              <p className="text-xs text-gray-500">{formatDateShort(note.created_at)}</p>
            </div>
          ))}
        </section>
      )}
    </article>
  );
};

export default PrintableItinerary;
