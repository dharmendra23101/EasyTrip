import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import AccessNeeds from '../src/components/AccessNeeds';

/**
 * The traveller's own access needs (`FV-029` stage c).
 *
 * **The mirror image of `AccessibilitySurvey`, and the asymmetry is the design.** That one records a
 * claim about the world somebody had to verify — four answers, a source, a date, and a database that
 * refuses an unattributed one. This records a statement about the person filling it in: nobody has
 * to check it, there is no `unknown`, and there is no `partial`, because a requirement half-met is a
 * requirement not met.
 *
 * So the assertions here are almost all about **what the copy promises**. Two checkboxes have no
 * interesting behaviour; what can be wrong is the sentence beside them, and on this feature an
 * over-promise is how somebody plans a trip believing the tool checked something it did not.
 */

const empty = { requires_step_free: false, requires_accessible_restroom: false };

describe('a traveller who has stated nothing', () => {
  test('both boxes are clear, and neither is preselected for them', () => {
    render(<AccessNeeds values={empty} onChange={jest.fn()} />);

    expect(screen.getByLabelText(/I need step-free access/)).not.toBeChecked();
    expect(screen.getByLabelText(/I need an accessible restroom/)).not.toBeChecked();
  });

  test('it renders from nothing at all without throwing', () => {
    // The profile page mounts before the stored profile has loaded, so `values` is briefly absent.
    render(<AccessNeeds onChange={jest.fn()} />);
    expect(screen.getByLabelText(/I need step-free access/)).not.toBeChecked();
  });
});

describe('what it promises, which is exactly what stage (d) does', () => {
  test('it says stops are flagged — not hidden, and not replaced', () => {
    // Over-promising here is the same failure as an unmarked claim on a place. "Flagged" is what
    // `FV-025` actually does; anything stronger would be a claim about a feature nobody built.
    render(<AccessNeeds values={empty} onChange={jest.fn()} />);
    expect(screen.getByText(/flagged when you check a trip/i)).toBeInTheDocument();
  });

  test('it says an absence of warnings is not an all-clear', () => {
    // The most important sentence in the component. Almost the whole catalogue is unsurveyed, so
    // silence means "nobody has checked these places" — and a traveller who reads it as "these are
    // fine" is the person this feature exists to protect.
    render(<AccessNeeds values={empty} onChange={jest.fn()} />);
    expect(
      screen.getByText(/No warning means nobody has surveyed those stops/i)
    ).toBeInTheDocument();
  });

  test('it says where the data goes, because this is health-adjacent', () => {
    render(<AccessNeeds values={empty} onChange={jest.fn()} />);
    expect(screen.getByText(/never shown to anyone else/i)).toBeInTheDocument();
  });
});

describe('changing an answer', () => {
  test('reports the column name the API takes, not a friendlier alias', async () => {
    // The profile page spreads this straight into the `PUT /auth/profile` body, so a rename here
    // silently stops the field saving and changes nothing visible.
    const onChange = jest.fn();
    render(<AccessNeeds values={empty} onChange={onChange} />);

    await userEvent.click(screen.getByLabelText(/I need step-free access/));

    expect(onChange).toHaveBeenCalledWith('requires_step_free', true);
  });

  test('unchecking reports false, which is how a requirement is withdrawn', async () => {
    // `false` has to travel. The API's validator uses `optional({ values: 'null' })` for exactly
    // this reason — under `'falsy'` an unchecked box would be indistinguishable from an absent key
    // and the requirement could never be removed.
    const onChange = jest.fn();
    render(
      <AccessNeeds values={{ ...empty, requires_accessible_restroom: true }} onChange={onChange} />
    );

    await userEvent.click(screen.getByLabelText(/I need an accessible restroom/));

    expect(onChange).toHaveBeenCalledWith('requires_accessible_restroom', false);
  });

  test('the two are independent', async () => {
    const onChange = jest.fn();
    render(<AccessNeeds values={{ ...empty, requires_step_free: true }} onChange={onChange} />);

    expect(screen.getByLabelText(/I need step-free access/)).toBeChecked();
    expect(screen.getByLabelText(/I need an accessible restroom/)).not.toBeChecked();

    await userEvent.click(screen.getByLabelText(/I need an accessible restroom/));
    expect(onChange).toHaveBeenCalledWith('requires_accessible_restroom', true);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
