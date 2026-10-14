import { render, screen } from '@testing-library/react';

import AccessibilityBadge, { BADGE_LEVELS } from '../src/components/AccessibilityBadge';
import { PlaceAccessibility } from '../src/components/place/PlaceAccessibility';
import {
  STEP_FREE_CHOICES,
  buildCriteria,
  buildQueryString,
  countActiveFilters,
  createEmptyFilters,
  filtersFromInitial
} from '../src/utils/browseFilters';

/**
 * Browsing and reading accessibility (`FV-029` stage a, `BL-137`).
 *
 * Everything here is one rule, checked from four sides: **an answer never travels without its
 * provenance.** `FV-029`'s kill criterion is about unmarked assertions, and a badge reading
 * "Step-free ✓" is one — it presents something somebody checked on a particular day with the same
 * confidence as the place's name, and ramps come out.
 *
 * The second rule is the one that makes the filter honest: **`unknown` is never a match.** A
 * traveller filtering on step-free access is asking which places anyone has checked, and returning
 * an unsurveyed row answers a different question with the same words.
 */

const surveyed = {
  id: 1,
  name: 'Hampi',
  step_free_access: 'yes',
  accessible_restroom: 'partial',
  accessibility_notes: 'Step-free to the courtyard; the sanctum is up eleven steps.',
  accessibility_source: 'site_visit',
  accessibility_checked_on: '2026-08-01'
};

const unsurveyed = {
  id: 2,
  name: 'Coorg',
  step_free_access: 'unknown',
  accessible_restroom: 'unknown',
  accessibility_notes: null,
  accessibility_source: null,
  accessibility_checked_on: null
};

describe('the badge never states a fact without its date', () => {
  test('it shows the answer and when it was checked, both visibly', () => {
    render(<AccessibilityBadge place={surveyed} />);

    expect(screen.getByText('Step-free')).toBeInTheDocument();
    // Visible, not only in the accessible name. A sighted reader deciding whether to trust this
    // needs the date as much as a screen-reader user does.
    expect(screen.getByText(/Aug 1, 2026/)).toBeInTheDocument();
  });

  test('the accessible name carries who said so as well as when', () => {
    render(<AccessibilityBadge place={surveyed} />);
    const badge = screen.getByLabelText(/Step-free access/);
    expect(badge).toHaveAccessibleName(/checked in person/);
    expect(badge).toHaveAccessibleName(/last checked Aug 1, 2026/);
  });

  test('an operator claim is attributed differently from a site visit', () => {
    // The two are not the same claim, and a badge that renders them identically is the unmarked
    // assertion with an extra step.
    render(<AccessibilityBadge place={{ ...surveyed, accessibility_source: 'operator' }} />);
    expect(screen.getByLabelText(/according to the place/)).toBeInTheDocument();
  });

  test('an unsurveyed place gets no badge at all', () => {
    // Not a greyed-out badge: an absent one cannot be read as "not accessible", and a muted one
    // looks like a verdict.
    const { container } = render(<AccessibilityBadge place={unsurveyed} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('the badge table has no "unknown" entry, which is what makes the guard true', () => {
    // Removing the `isClaimed` guard changes nothing while this table lacks an `unknown` key — the
    // mutation is equivalent, and no assertion about the component can catch it. So the property
    // that actually protects the unsurveyed catalogue is pinned directly.
    //
    // It is a live hazard rather than a hypothetical: `PlaceAccessibility`'s equivalent table does
    // carry an `unknown` entry, because on a page about one place "Not checked" is worth saying.
    // Copying that pattern here would badge every place nobody has checked.
    expect(Object.keys(BADGE_LEVELS).sort()).toEqual(['no', 'partial', 'yes']);
  });

  test('a missing place, or one with no accessibility fields, renders nothing', () => {
    expect(render(<AccessibilityBadge place={undefined} />).container).toBeEmptyDOMElement();
    expect(render(<AccessibilityBadge place={{ id: 9 }} />).container).toBeEmptyDOMElement();
  });

  test('"no" is rendered, because it is information rather than an absence', () => {
    render(<AccessibilityBadge place={{ ...surveyed, step_free_access: 'no' }} />);
    expect(screen.getByText('Not step-free')).toBeInTheDocument();
  });
});

describe('the detail panel says more, including that nobody has checked', () => {
  test('it renders both answers, the notes and the attribution', () => {
    render(<PlaceAccessibility place={surveyed} />);

    expect(screen.getByText('Step-free access')).toBeInTheDocument();
    expect(screen.getByText('Accessible restroom')).toBeInTheDocument();
    expect(screen.getByText(/the sanctum is up eleven steps/)).toBeInTheDocument();
    // Visible text, not a tooltip: a claim and its provenance are one statement.
    expect(screen.getByText(/checked in person/)).toBeInTheDocument();
    expect(screen.getByText(/last checked Aug 1, 2026/)).toBeInTheDocument();
  });

  test('a surveyed place says "Not checked" for the axis nobody answered', () => {
    // Here, unlike on a card, silence would read as "there was nothing to say". On the page about
    // this place a traveller deserves to be told plainly.
    render(<PlaceAccessibility place={{ ...surveyed, accessible_restroom: 'unknown' }} />);
    expect(screen.getByText('Not checked')).toBeInTheDocument();
  });

  test('a place with nothing recorded renders no panel', () => {
    const { container } = render(<PlaceAccessibility place={unsurveyed} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('notes alone are worth a panel, and claim nothing', () => {
    const { container } = render(
      <PlaceAccessibility
        place={{ ...unsurveyed, accessibility_notes: 'The lift was out of order in August.' }}
      />
    );
    expect(container).not.toBeEmptyDOMElement();
    expect(screen.getByText(/lift was out of order/)).toBeInTheDocument();
    // No claim, so nothing to attribute — and demanding a source for a note would push useful
    // sentences out of the catalogue.
    expect(screen.queryByText(/last checked/)).not.toBeInTheDocument();
  });

  test('it tells the reader to check before travelling', () => {
    // The panel describes one day. Saying so is the difference between information and a promise.
    render(<PlaceAccessibility place={surveyed} />);
    expect(screen.getByText(/check with the place before travelling/i)).toBeInTheDocument();
  });
});

describe('the filter offers only questions a traveller asks', () => {
  test('neither choice can return an unsurveyed place', () => {
    // The property the whole filter rests on. `unknown` in either levels array would make the
    // filter return places nobody has checked while still looking filtered.
    Object.values(STEP_FREE_CHOICES).forEach((choice) => {
      expect(choice.levels || []).not.toContain('unknown');
    });
  });

  test('"any" sends no filter at all rather than every level', () => {
    // Sending all four would be a filter that excludes only `unknown` — a much stronger claim than
    // "no preference", and it would quietly hide the unsurveyed catalogue from someone who never
    // asked about access.
    expect(STEP_FREE_CHOICES.any.levels).toBeUndefined();
    expect(buildCriteria(createEmptyFilters()).stepFree).toBeUndefined();
  });

  test('each choice expands to the levels the API takes', () => {
    expect(buildCriteria({ ...createEmptyFilters(), stepFree: 'verified' }).stepFree).toEqual([
      'yes'
    ]);
    expect(buildCriteria({ ...createEmptyFilters(), stepFree: 'partly' }).stepFree).toEqual([
      'yes',
      'partial'
    ]);
  });

  test('it counts as an active filter, so the badge and "clear all" see it', () => {
    expect(countActiveFilters(createEmptyFilters())).toBe(0);
    expect(countActiveFilters({ ...createEmptyFilters(), stepFree: 'verified' })).toBe(1);
  });

  test('it survives the URL round trip, which is what a shared link depends on', () => {
    // `buildQueryString` writes it and `getServerSideProps` reads it back. Those are two halves of
    // one contract and each has passed its own test while disagreeing with the other before.
    const query = buildQueryString({ ...createEmptyFilters(), stepFree: 'partly' });
    expect(query).toContain('access=partly');

    const params = Object.fromEntries(new URLSearchParams(query));
    expect(filtersFromInitial({ stepFree: params.access }).stepFree).toBe('partly');
  });

  test('a stale or invented value in a bookmark falls back to "any"', () => {
    // A link from before this filter existed, or one somebody edited. It must not throw and must
    // not silently filter by something nobody chose.
    expect(filtersFromInitial({ stepFree: 'unknown' }).stepFree).toBe('any');
    expect(filtersFromInitial({ stepFree: 'nonsense' }).stepFree).toBe('any');
    expect(filtersFromInitial({}).stepFree).toBe('any');
  });
});
