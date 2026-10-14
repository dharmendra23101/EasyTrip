import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AccessibilitySurvey } from '../src/components/admin/AccessibilitySurvey';
import { surveyProblem, isClaimed } from '../src/constants/placeAccessibility';
import { collectErrors } from '../src/utils/placeFormValidation';

/**
 * The accessibility survey control (`FV-029` stage a, `BL-136`).
 *
 * **The one control in this product where a careless answer hurts somebody.** The item's kill
 * criterion is not about data quality — *"a wrong step-free claim strands somebody at the bottom of
 * a staircase"* — so these tests are about restraint and about making the cautious answer easy:
 *
 * - the default is `Not surveyed`, and it is offered as an answer rather than a blank;
 * - a claim reveals the provenance fields, because that is when they become required;
 * - the rule the database enforces is stated in the browser, before the save rather than after it;
 * - and notes, which assert nothing, never demand a source.
 *
 * `TD-023` is why the control ships in the same sprint as its columns: `places.setting` shipped a
 * migration, a validator, a constraint and an index with no way to set any of it, and two features
 * then read a column the whole catalogue had left at `unknown`.
 */

const base = {
  step_free_access: 'unknown',
  accessible_restroom: 'unknown',
  accessibility_notes: '',
  accessibility_source: '',
  accessibility_checked_on: ''
};

const TODAY = new Date().toISOString().slice(0, 10);

describe('an unsurveyed place, which is the whole catalogue today', () => {
  test('both axes default to "Not surveyed"', () => {
    render(<AccessibilitySurvey formData={base} onChange={jest.fn()} />);

    expect(
      screen.getByLabelText(/Not surveyed/, { selector: '#step_free_access-unknown' })
    ).toBeChecked();
    expect(
      screen.getByLabelText(/Not surveyed/, { selector: '#accessible_restroom-unknown' })
    ).toBeChecked();
  });

  test('"Not surveyed" is described as a safe answer, not a missing one', () => {
    render(<AccessibilitySurvey formData={base} onChange={jest.fn()} />);
    // An admin nudged out of `unknown` by a UI that treats it as a blank produces guesses, and a
    // guess here is the harm this feature exists to avoid.
    expect(screen.getAllByText(/this is a safe answer, not a missing one/i).length).toBeGreaterThan(
      0
    );
  });

  test('no provenance is asked for, because nothing has been claimed', () => {
    render(<AccessibilitySurvey formData={base} onChange={jest.fn()} />);
    expect(screen.queryByLabelText(/Where did this come from/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/When was it last checked/)).not.toBeInTheDocument();
  });

  test('"No" is offered as a useful answer rather than a failure', () => {
    // A catalogue where only `Yes` feels worth recording is silent about every inaccessible place,
    // and silence is what sends somebody on the wasted journey.
    render(<AccessibilitySurvey formData={base} onChange={jest.fn()} />);
    expect(screen.getAllByText(/saves a wasted journey/i).length).toBeGreaterThan(0);
  });
});

describe('the moment something is claimed', () => {
  const claimed = { ...base, step_free_access: 'yes' };

  test('the provenance fields appear', () => {
    render(<AccessibilitySurvey formData={claimed} onChange={jest.fn()} />);
    expect(screen.getByLabelText(/Where did this come from/)).toBeInTheDocument();
    expect(screen.getByLabelText(/When was it last checked/)).toBeInTheDocument();
  });

  test('and the form says, in words, that it will not save without them', () => {
    render(<AccessibilitySurvey formData={claimed} onChange={jest.fn()} />);
    expect(screen.getByText(/who checked and when/i)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/source/i);
  });

  test('a complete survey raises no complaint', () => {
    render(
      <AccessibilitySurvey
        formData={{
          ...claimed,
          accessibility_source: 'site_visit',
          accessibility_checked_on: '2026-08-01'
        }}
        onChange={jest.fn()}
      />
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('the date input refuses a future day at the widget level too', () => {
    render(<AccessibilitySurvey formData={claimed} onChange={jest.fn()} />);
    expect(screen.getByLabelText(/When was it last checked/)).toHaveAttribute('max', TODAY);
  });

  test('choosing an answer reports the field name the form state uses', async () => {
    const onChange = jest.fn();
    render(<AccessibilitySurvey formData={base} onChange={onChange} />);

    await userEvent.click(
      screen.getByLabelText(/^Partly/, { selector: '#step_free_access-partial' })
    );

    // The API column name, not a UI-friendly alias: `handleChange` writes `[name]: value` straight
    // into the payload, so a rename here silently stops saving.
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls[0][0].target.name).toBe('step_free_access');
    expect(onChange.mock.calls[0][0].target.value).toBe('partial');
  });
});

describe('notes assert nothing, and are treated that way', () => {
  test('a note alone does not demand a source', () => {
    render(
      <AccessibilitySurvey
        formData={{ ...base, accessibility_notes: 'Lift was out of order in August.' }}
        onChange={jest.fn()}
      />
    );
    expect(screen.queryByLabelText(/Where did this come from/)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('the notes field says so, so an admin does not self-censor', () => {
    render(<AccessibilitySurvey formData={base} onChange={jest.fn()} />);
    expect(screen.getByText(/needs no source/i)).toBeInTheDocument();
  });
});

describe('the rule itself, which the database also enforces', () => {
  test.each([
    [{ ...base }, null],
    [{ ...base, accessibility_notes: 'anything' }, null],
    [{ ...base, step_free_access: 'yes' }, /source/i],
    [{ ...base, accessible_restroom: 'no' }, /source/i],
    [{ ...base, step_free_access: 'yes', accessibility_source: 'operator' }, /date/i],
    [
      {
        ...base,
        step_free_access: 'yes',
        accessibility_source: 'operator',
        accessibility_checked_on: '2099-01-01'
      },
      /future/i
    ],
    [
      {
        ...base,
        step_free_access: 'yes',
        accessibility_source: 'operator',
        accessibility_checked_on: '2026-08-01'
      },
      null
    ]
  ])('surveyProblem(%o)', (input, expected) => {
    const problem = surveyProblem(input);
    if (expected === null) expect(problem).toBeNull();
    else expect(problem).toMatch(expected);
  });

  test('"unknown" is not a claim, and "no" is', () => {
    // The distinction the whole feature rests on. Collapsing them is the single change that turns
    // this into the harm it is designed to avoid.
    expect(isClaimed('unknown')).toBe(false);
    expect(isClaimed('no')).toBe(true);
    expect(isClaimed('yes')).toBe(true);
    expect(isClaimed('partial')).toBe(true);
  });

  test('the save is blocked before the request is made', () => {
    // The database would reject it anyway. Catching it here is the difference between a rule and an
    // obstacle: the admin learns it beside the field instead of as a 400 after typing everything.
    const errors = collectErrors(
      { ...base, name: 'A Place', location: 'Somewhere', step_free_access: 'yes' },
      null
    );
    expect(errors.accessibility_source).toMatch(/source/i);
  });

  test('and an ordinary place with no survey saves cleanly', () => {
    const errors = collectErrors({ ...base, name: 'A Place', location: 'Somewhere' }, null);
    expect(errors.accessibility_source).toBeUndefined();
  });
});
