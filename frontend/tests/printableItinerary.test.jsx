import { render, screen } from '@testing-library/react';

import PrintableItinerary from '../src/components/trips/PrintableItinerary';

/**
 * The printable itinerary (`FV-009` stage b).
 *
 * **Why this is a component and not a print stylesheet is the thing under test.** A
 * `@media print { display: none }` pass over the workspace would make the default *"it prints unless
 * somebody remembered to hide it"*, so every control added later reaches paper until a person
 * notices. It would also be untestable: jsdom has no pagination and print rules are inert in it, so
 * a suite could only assert that a class name exists.
 *
 * A separate component inverts the default — nothing is on the page unless it was put there — and
 * that is exactly what a test can check. So most of these assert what is **absent**.
 *
 * The other theme is the difference from stage (a). The `.ics` export refuses a trip with no start
 * date, because an event with no date has no position on a calendar. Paper has no such requirement,
 * and a "Day 1 / Day 2" itinerary is a perfectly usable thing to carry.
 */

const TRIP = {
  id: 1,
  title: 'Karnataka in March',
  description: 'Temples, then the coast.',
  start_date: '2026-03-01',
  end_date: '2026-03-03',
  days: [
    {
      id: 10,
      day_number: 1,
      items: [
        {
          id: 100,
          title: 'Virupaksha Temple',
          start_time: '06:30:00',
          place_name: 'Virupaksha Temple',
          place_location: 'Hampi',
          notes: 'Bring water.\nThe climb is steep.'
        },
        { id: 101, title: 'Lunch' }
      ]
    },
    { id: 11, day_number: 2, items: [] }
  ]
};

const CHECKLIST = [
  { id: 1, label: 'Passport', is_done: true },
  { id: 2, label: 'Charger', is_done: false }
];

const NOTES = [
  {
    id: 1,
    body: 'Hotel booking XY123',
    created_at: '2026-02-14T10:00:00Z',
    updated_at: '2026-02-14T10:00:00Z'
  }
];

// ---------------------------------------------------------------------------
// The itinerary itself
// ---------------------------------------------------------------------------
describe('the plan, on paper', () => {
  test('every day is printed, in order, with its date', () => {
    render(<PrintableItinerary trip={TRIP} />);

    expect(screen.getByText(/Day 1/)).toBeInTheDocument();
    expect(screen.getByText(/Day 2/)).toBeInTheDocument();
    // Day 2 of a trip starting 1 March. Computed by the shared UTC helper, so this also pins that
    // the printed date agrees with the workspace's (`BUG-058`).
    expect(screen.getByText('March 2, 2026')).toBeInTheDocument();
  });

  test('a stop carries its time, its place and its notes', () => {
    render(<PrintableItinerary trip={TRIP} />);

    // Seconds are dropped: Postgres sends `TIME` as HH:MM:SS and nobody writes an itinerary in
    // seconds.
    expect(screen.getByText('06:30')).toBeInTheDocument();
    expect(screen.getByText('Virupaksha Temple, Hampi')).toBeInTheDocument();
    expect(screen.getByText(/Bring water/)).toBeInTheDocument();
  });

  test('line breaks in an item note survive onto the page', () => {
    render(<PrintableItinerary trip={TRIP} />);
    expect(screen.getByText(/Bring water/)).toHaveClass('whitespace-pre-wrap');
  });

  test('an untimed stop keeps its column, so the times stay scannable', () => {
    // A dash rather than nothing: an empty cell lets the titles jump left and the column stops
    // being a column.
    render(<PrintableItinerary trip={TRIP} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  test('an empty day is printed rather than skipped', () => {
    // A gap in the numbering reads as a page that failed to print. The day is real; it is just
    // empty.
    render(<PrintableItinerary trip={TRIP} />);
    expect(screen.getByText(/Nothing planned/i)).toBeInTheDocument();
  });

  test('each day is held together across a page break', () => {
    // The commonest thing that makes a printed itinerary annoying: a day split down the middle.
    const { container } = render(<PrintableItinerary trip={TRIP} />);
    const dayHeading = screen.getByText(/Day 1/).closest('section');

    expect(dayHeading).toHaveClass('break-inside-avoid');
    expect(container.querySelectorAll('.break-inside-avoid').length).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// What the `.ics` export refuses and this does not
// ---------------------------------------------------------------------------
describe('a trip with no dates still prints', () => {
  test('the days appear, numbered, with no invented dates', () => {
    // Stage (a) answers 422 here, because a calendar event needs a date. Paper does not, and
    // refusing would be applying a calendar's constraint to a document that is not one.
    render(<PrintableItinerary trip={{ ...TRIP, start_date: null, end_date: null }} />);

    // Scoped to the headings rather than the whole document: this trip is *titled* "Karnataka in
    // March", and a document-wide `/March/` matches the title instead of a date — a test that would
    // have passed for the wrong reason on any trip whose name did not name a month.
    const headings = screen.getAllByRole('heading', { level: 2 });
    expect(headings.map((heading) => heading.textContent)).toEqual(['Day 1', 'Day 2']);
  });

  test('the header shows no date range when there is none', () => {
    render(<PrintableItinerary trip={{ ...TRIP, start_date: null, end_date: null }} />);
    expect(screen.queryByText(/2026/)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Checklist and notes — the rest of what somebody carries
// ---------------------------------------------------------------------------
describe('the checklist prints as boxes a person can tick', () => {
  test('a done item shows its tick and a pending one shows an empty box', () => {
    render(<PrintableItinerary trip={TRIP} checklist={CHECKLIST} />);

    expect(screen.getByText('Passport')).toBeInTheDocument();
    expect(screen.getByText('Charger')).toBeInTheDocument();
    expect(screen.getByText('✓')).toBeInTheDocument();
  });

  test('the done state is in text, not only in a drawn box', () => {
    // Same rule as the workspace's `aria-pressed`: a tick and a strike-through are a visual
    // convention a screen reader cannot report.
    render(<PrintableItinerary trip={TRIP} checklist={CHECKLIST} />);

    expect(screen.getByText('Done:')).toBeInTheDocument();
    expect(screen.getByText('Not done:')).toBeInTheDocument();
  });

  test('no checklist means no heading at all', () => {
    render(<PrintableItinerary trip={TRIP} />);
    expect(screen.queryByText('Checklist')).not.toBeInTheDocument();
  });
});

describe('notes print, because that is where the booking reference is', () => {
  test('the note and the date it was written both appear', () => {
    // "The hotel confirmed" and "the hotel confirmed three weeks ago, before the dates changed" are
    // different statements.
    render(<PrintableItinerary trip={TRIP} notes={NOTES} />);

    expect(screen.getByText('Hotel booking XY123')).toBeInTheDocument();
    expect(screen.getByText('Feb 14, 2026')).toBeInTheDocument();
  });

  test('no notes means no heading at all', () => {
    render(<PrintableItinerary trip={TRIP} />);
    expect(screen.queryByText('Notes')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// What is deliberately not on it
// ---------------------------------------------------------------------------
describe('nothing reaches paper that was not put there', () => {
  test('no buttons, no links, no form controls', () => {
    // The assertion that makes this a document rather than a screenshot of an application, and the
    // one a print stylesheet could not make.
    const { container } = render(
      <PrintableItinerary trip={TRIP} notes={NOTES} checklist={CHECKLIST} />
    );

    expect(container.querySelectorAll('button')).toHaveLength(0);
    expect(container.querySelectorAll('a')).toHaveLength(0);
    expect(container.querySelectorAll('input, select, textarea')).toHaveLength(0);
  });

  test('no judgement about the plan is printed — only what it says', () => {
    // The feasibility report, the replan proposal and the fit score are claims computed at a moment.
    // Paper cannot say when, and cannot withdraw them when the plan changes.
    render(<PrintableItinerary trip={TRIP} notes={NOTES} checklist={CHECKLIST} />);

    expect(screen.queryByText(/feasib/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/% fit/)).not.toBeInTheDocument();
    expect(screen.queryByText(/suggest/i)).not.toBeInTheDocument();
  });

  test('nothing renders at all without a trip', () => {
    const { container } = render(<PrintableItinerary trip={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('a trip with no days renders its header and stops', () => {
    render(<PrintableItinerary trip={{ ...TRIP, days: [] }} />);

    expect(screen.getByText('Karnataka in March')).toBeInTheDocument();
    expect(screen.queryByText(/Day 1/)).not.toBeInTheDocument();
  });
});
