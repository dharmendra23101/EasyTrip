import { render, screen, within } from '@testing-library/react';

import MonthGrid from '../src/components/place/MonthGrid';
import { PlaceSeasonality } from '../src/components/place/PlaceSeasonality';

/**
 * The best-time date grid (`FV-028` stage b, `INS-003`).
 *
 * **Almost every assertion here is about what the grid does NOT say.** The component is twelve
 * coloured cells and it would pass a careless review while asserting something nobody entered: that
 * the nine unmarked months are bad. Nobody said September is bad — they said October to December is
 * good, and a grid read at a glance is believed without the sentence beside it.
 *
 * That is the same rule the schema runs on (`unknown` is never `no`, empty `best_months` asserts
 * nothing), arriving at the layer where it is easiest to break and hardest to notice. So the tests
 * that matter are the ones pinning the *absence* of a verdict, and the ones proving the distinction
 * survives without colour — for a greyscale reader, a colour-blind one, and a screen reader.
 */

const CURATED = {
  best_months: [10, 11, 12],
  crowd_level: 'high',
  typical_visit_minutes: 90,
  seasonality_source: 'editorial',
  seasonality_checked_on: '2026-08-01'
};

describe('the grid shows every month, not only the good ones', () => {
  test('all twelve are rendered, so the marked ones have a scale to be read against', () => {
    // Rendering three cells would be a list, not a grid. The point of the shape `INS-003` borrowed
    // is that you can see the shoulder either side of the season.
    render(<MonthGrid months={[10, 11, 12]} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(12);
  });

  test('nothing renders when nobody has curated months', () => {
    const { container } = render(<MonthGrid months={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('an absent prop is not a crash', () => {
    const { container } = render(<MonthGrid />);
    expect(container).toBeEmptyDOMElement();
  });
});

// ---------------------------------------------------------------------------
// The distinction this component exists to protect
// ---------------------------------------------------------------------------
describe('an unmarked month is not a warning', () => {
  test('a recommended month is named as recommended', () => {
    render(<MonthGrid months={[10, 11, 12]} />);
    expect(screen.getByText('October: recommended')).toBeInTheDocument();
  });

  test('an unmarked month says "not listed", never "avoid"', () => {
    // The single most important assertion in this file. "Not listed as a best month" is a statement
    // about the catalogue; "avoid" would be a statement about the place that nobody made.
    render(<MonthGrid months={[10, 11, 12]} />);
    expect(screen.getByText('September: not listed as a best month')).toBeInTheDocument();
  });

  test('no cell anywhere uses the language of a verdict', () => {
    // Asserted across the whole rendered output rather than one cell, because the wrong word only
    // has to appear once to change what the grid means.
    const { container } = render(<MonthGrid months={[1]} />);
    expect(container.textContent).not.toMatch(/avoid|bad|worst|do not visit|don't visit/i);
  });

  test('the legend says in words what the unmarked cells mean', () => {
    // Without this sentence the grid is nine grey cells and a reader supplies their own meaning,
    // which is exactly the failure the colour choice was made to avoid.
    render(<MonthGrid months={[10]} />);
    expect(screen.getByText(/not a reason to stay away/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// WCAG 1.4.1 — the distinction cannot be colour alone
// ---------------------------------------------------------------------------
describe('the grid works without colour', () => {
  test('every month carries its state as text, not just as a class', () => {
    render(<MonthGrid months={[4, 5]} />);

    // Twelve accessible descriptions, one per cell: the grid is readable with the stylesheet off.
    const described = screen
      .getAllByRole('listitem')
      .map((item) => item.textContent)
      .filter((text) => /recommended|not listed/.test(text));
    expect(described).toHaveLength(12);
  });

  test('a recommended cell is distinguishable from an unlisted one by more than a background', () => {
    // `axe` cannot catch a colour-only distinction, so it is pinned here. The marker element is what
    // survives greyscale; if it ever collapses to a shared class this fails.
    render(<MonthGrid months={[4]} />);

    const cells = screen.getAllByRole('listitem');
    const april = cells.find((cell) => within(cell).queryByText('April: recommended'));
    const may = cells.find((cell) => within(cell).queryByText('May: not listed as a best month'));

    expect(april.innerHTML).not.toBe(may.innerHTML);
    // The filled marker belongs to the recommended cell and not to the unlisted one.
    expect(april.innerHTML).toContain('bg-primary-600');
    expect(may.innerHTML).not.toContain('bg-primary-600');
  });

  test('the month abbreviations are hidden from screen readers, not read twice', () => {
    // "Oct" followed by "October: recommended" is the same fact announced twice in two registers.
    const { container } = render(<MonthGrid months={[10]} />);
    const abbreviations = container.querySelectorAll('[aria-hidden="true"]');
    expect(abbreviations.length).toBeGreaterThan(0);
  });

  test('the grid is announced as a group with a name', () => {
    render(<MonthGrid months={[10]} />);
    expect(screen.getByRole('list', { name: /best months to visit/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// How it sits in the panel
// ---------------------------------------------------------------------------
describe('inside the seasonality panel', () => {
  test('the grid and the phrase both appear, and they agree', () => {
    // The phrase is kept deliberately: it is precise where the grid is scannable, and a reader who
    // cannot use a grid still gets the answer in a sentence.
    render(<PlaceSeasonality place={CURATED} />);

    expect(screen.getByText('October to December')).toBeInTheDocument();
    expect(screen.getByText('October: recommended')).toBeInTheDocument();
    expect(screen.getByText('September: not listed as a best month')).toBeInTheDocument();
  });

  test('a place curated only for crowd level gets the panel but no grid', () => {
    // `hasSeasonalityInfo` is true here and `best_months` is empty, so the panel renders and the
    // grid must not — twelve unmarked cells would assert nothing and look like a verdict on all of
    // them.
    render(
      <PlaceSeasonality place={{ ...CURATED, best_months: [], typical_visit_minutes: null }} />
    );

    expect(screen.getByText('Usually crowded')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: /best months/i })).not.toBeInTheDocument();
  });
});
