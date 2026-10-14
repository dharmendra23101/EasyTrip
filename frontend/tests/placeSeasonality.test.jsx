import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SeasonalitySurvey from '../src/components/admin/SeasonalitySurvey';
import { PlaceSeasonality } from '../src/components/place/PlaceSeasonality';
import {
  describeDuration,
  describeMonths,
  hasSeasonalityInfo,
  seasonalityProblem
} from '../src/constants/placeSeasonality';
import { visiblePlaceSections } from '../src/utils/placeDetail';

/**
 * When to go, as an admin records it and as a traveller reads it (`FV-028` stage a).
 *
 * **Most of the weight is on `describeMonths`, and that is not where it would naturally go.** The
 * component tests are thin because the components are thin; the month phrasing is where the real
 * logic lives, and the case it exists for — a season that wraps across December — is the one a naive
 * implementation gets wrong while looking right on every other input. `[12,1,2]` rendered as
 * "January, February, December" reads as two separate seasons.
 *
 * The rest holds the honesty rule: a claim needs attribution before it can be saved, and an
 * uncurated place says nothing rather than saying "not assessed" — which is the deliberate
 * difference from `PlaceAccessibility`, where an explicit `unknown` is the whole point.
 */

const CURATED = {
  best_months: [10, 11, 12],
  crowd_level: 'high',
  typical_visit_minutes: 90,
  seasonality_source: 'editorial',
  seasonality_checked_on: '2026-08-01'
};

// ---------------------------------------------------------------------------
// The month phrasing, which is the only real logic here
// ---------------------------------------------------------------------------
describe('months read as a phrase somebody would say', () => {
  test('a run becomes a span', () => {
    expect(describeMonths([10, 11, 12])).toBe('October to December');
  });

  test('a season that wraps past December is one span, not two', () => {
    // The case this function exists for. Sorted ascending and rendered naively, this is
    // "January, February, October to December" — which reads as two seasons and is wrong.
    expect(describeMonths([10, 11, 12, 1, 2])).toBe('October to February');
  });

  test('the input order does not matter', () => {
    expect(describeMonths([2, 12, 1, 11, 10])).toBe('October to February');
  });

  test('two genuinely separate runs stay separate', () => {
    // A real shoulder-season answer, and the reason a start/end pair was rejected for the column.
    expect(describeMonths([10, 11, 12, 1, 2, 7])).toBe('October to February, July');
  });

  test('a single month is named rather than spanned', () => {
    expect(describeMonths([5])).toBe('May');
  });

  test('every month is "All year", not "January to December"', () => {
    expect(describeMonths([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])).toBe('All year');
  });

  test('nothing curated is an empty string, which renders as nothing', () => {
    expect(describeMonths([])).toBe('');
    expect(describeMonths(undefined)).toBe('');
  });
});

describe('a duration reads as time, not as minutes', () => {
  test('under an hour stays in minutes', () => {
    expect(describeDuration(45)).toBe('About 45 minutes');
  });

  test('a round hour has no trailing zero minutes', () => {
    expect(describeDuration(120)).toBe('About 2 hours');
  });

  test('one hour is singular', () => {
    expect(describeDuration(60)).toBe('About 1 hour');
  });

  test('a mixed duration says both parts', () => {
    expect(describeDuration(90)).toBe('About 1 hour 30 minutes');
  });

  test('nothing curated is an empty string', () => {
    expect(describeDuration(null)).toBe('');
    expect(describeDuration(undefined)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// What counts as a claim, which decides what is shown and what must be attributed
// ---------------------------------------------------------------------------
describe('whether a place has anything to say about when to go', () => {
  test('an uncurated place has nothing', () => {
    expect(hasSeasonalityInfo({ best_months: [], crowd_level: 'unknown' })).toBe(false);
  });

  test('unknown is not a crowd level', () => {
    // The same rule the whole schema runs on: `unknown` asserts nothing and must never read as
    // `low`. A panel that appeared for `unknown` would be a panel on every place in the catalogue.
    expect(hasSeasonalityInfo({ crowd_level: 'unknown' })).toBe(false);
    expect(hasSeasonalityInfo({ crowd_level: 'low' })).toBe(true);
  });

  test('any one of the three is enough', () => {
    expect(hasSeasonalityInfo({ best_months: [4] })).toBe(true);
    expect(hasSeasonalityInfo({ typical_visit_minutes: 30 })).toBe(true);
  });

  test('it survives a place that has not loaded', () => {
    expect(hasSeasonalityInfo(undefined)).toBe(false);
  });
});

describe('the table of contents lists only sections that exist', () => {
  test('"When To Go" is absent for an uncurated place', () => {
    // `BL-139`'s rule. The section is absent for the entire catalogue on the day this ships, so
    // registering it unconditionally would put a dead anchor on every page.
    const sections = visiblePlaceSections({ hasImages: true, hasSeasonality: false });
    expect(sections.map((section) => section.id)).not.toContain('when');
  });

  test('it appears exactly when the panel does', () => {
    const sections = visiblePlaceSections({ hasImages: true, hasSeasonality: true });
    expect(sections.map((section) => section.id)).toContain('when');
  });
});

// ---------------------------------------------------------------------------
// The attribution rule, restated in the browser
// ---------------------------------------------------------------------------
describe('a claim cannot be saved without provenance', () => {
  test('an uncurated form has no problem', () => {
    expect(seasonalityProblem({ best_months: [], crowd_level: 'unknown' })).toBeNull();
  });

  test('months without a source are refused', () => {
    expect(seasonalityProblem({ best_months: [4] })).toMatch(/source/i);
  });

  test('a source without a date is refused', () => {
    expect(seasonalityProblem({ best_months: [4], seasonality_source: 'editorial' })).toMatch(
      /date/i
    );
  });

  test('a future date is refused', () => {
    expect(
      seasonalityProblem({
        best_months: [4],
        seasonality_source: 'editorial',
        seasonality_checked_on: '2099-01-01'
      })
    ).toMatch(/future/i);
  });

  test('a duration alone is a claim too', () => {
    // Easy to miss: the months are empty and the crowd level is `unknown`, so a check that only
    // looked at those two would let an unattributed duration through to a 400.
    expect(seasonalityProblem({ typical_visit_minutes: 90 })).toMatch(/source/i);
  });

  test('an empty duration string is not a claim', () => {
    // What an untouched number input actually submits. Reading it as a value would demand
    // attribution for a form nobody filled in.
    expect(seasonalityProblem({ typical_visit_minutes: '' })).toBeNull();
  });

  test('a fully attributed claim passes', () => {
    expect(seasonalityProblem(CURATED)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The panel a traveller reads
// ---------------------------------------------------------------------------
describe('the place panel', () => {
  test('renders nothing at all when nothing is curated', () => {
    // Deliberately unlike `PlaceAccessibility`, which says "not checked" out loud. Silence here is
    // accurate — a missing crowd level strands nobody — and a panel repeating "not assessed" across
    // the whole catalogue teaches people to skip the section before it ever has content.
    const { container } = render(<PlaceSeasonality place={{ best_months: [] }} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('shows the months, the crowd level and the duration', () => {
    render(<PlaceSeasonality place={CURATED} />);
    expect(screen.getByText('October to December')).toBeInTheDocument();
    expect(screen.getByText('Usually crowded')).toBeInTheDocument();
    expect(screen.getByText('About 1 hour 30 minutes')).toBeInTheDocument();
  });

  test('attributes the claim in visible text, not in a title attribute', () => {
    // `FV-029`'s kill criterion applied here: "October to December, from our own research, last
    // checked 1 Aug 2026" is a different statement from "October to December", and only the first
    // can be judged by the person reading it.
    render(<PlaceSeasonality place={CURATED} />);
    expect(screen.getByText(/From our own research/)).toBeInTheDocument();
    expect(screen.getByText(/last checked/)).toBeInTheDocument();
  });

  test('omits a fact nobody curated rather than showing a blank row', () => {
    render(<PlaceSeasonality place={{ ...CURATED, typical_visit_minutes: null }} />);
    expect(screen.queryByText('Typical visit')).not.toBeInTheDocument();
    expect(screen.getByText('Best months')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// The admin control
// ---------------------------------------------------------------------------
describe('the admin survey', () => {
  test('the provenance fields stay hidden until a claim is made', () => {
    // Rendering them always would make them look optional; revealing them on a claim is what
    // teaches the rule at the moment it starts applying.
    render(<SeasonalitySurvey formData={{ best_months: [] }} onChange={jest.fn()} />);
    expect(screen.queryByLabelText(/Where did this come from/)).not.toBeInTheDocument();
  });

  test('they appear the moment a month is ticked', () => {
    render(<SeasonalitySurvey formData={{ best_months: [4] }} onChange={jest.fn()} />);
    expect(screen.getByLabelText(/Where did this come from/)).toBeInTheDocument();
  });

  test('ticking a month reports the column name the API takes', async () => {
    // The wizard spreads this into the multipart body, so a rename here silently stops the field
    // saving and changes nothing visible.
    const onChange = jest.fn();
    render(<SeasonalitySurvey formData={{ best_months: [] }} onChange={onChange} />);

    await userEvent.click(screen.getByLabelText('Apr'));

    expect(onChange).toHaveBeenCalledWith({ target: { name: 'best_months', value: [4] } });
  });

  test('unticking removes just that month', async () => {
    const onChange = jest.fn();
    render(<SeasonalitySurvey formData={{ best_months: [4, 5] }} onChange={onChange} />);

    await userEvent.click(screen.getByLabelText('Apr'));

    expect(onChange).toHaveBeenCalledWith({ target: { name: 'best_months', value: [5] } });
  });

  test('a shortcut sets months rather than recording a season', () => {
    // The stored fact is always the months. Nothing records that "Monsoon" was pressed, because a
    // season means different things in different parts of the country.
    const onChange = jest.fn();
    render(<SeasonalitySurvey formData={{ best_months: [] }} onChange={onChange} />);

    screen.getByRole('button', { name: 'Monsoon' }).click();

    expect(onChange).toHaveBeenCalledWith({
      target: { name: 'best_months', value: [7, 8, 9] }
    });
  });

  test('it renders from an absent form without throwing', () => {
    // The edit page mounts before the place has loaded, so `formData` is briefly empty.
    render(<SeasonalitySurvey onChange={jest.fn()} />);
    expect(screen.getByLabelText('Jan')).not.toBeChecked();
  });

  test('it shows the admin what a traveller will read', () => {
    render(<SeasonalitySurvey formData={{ best_months: [10, 11, 12, 1] }} onChange={jest.fn()} />);
    expect(screen.getByText('October to January')).toBeInTheDocument();
  });

  test('it says plainly that blank is a safe answer', () => {
    // The sentence that keeps the catalogue honest. An admin nudged out of "blank" by a UI that
    // treats it as missing produces guesses, and a guessed month is what this feature replaces.
    render(<SeasonalitySurvey formData={{ best_months: [] }} onChange={jest.fn()} />);
    expect(screen.getByText(/blank is a safe answer/i)).toBeInTheDocument();
  });
});
