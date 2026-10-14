import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TravelPreferences from '../src/components/TravelPreferences';
import { THEMES } from '../src/constants/themes';
import { DIETARY_NEEDS } from '../src/constants/preferences';

/**
 * The travel-preference form (`FV-020` stage a).
 *
 * **Two claims, and both are easy to break by accident:**
 *
 *   1. **Nothing is set by default.** `021_travel_preferences.sql` gives every scalar a NULL default
 *      because *not said is not a default* — and a `<select>` whose first option is a real value
 *      undoes that in the interface, quietly attributing an opinion to somebody who never gave one.
 *   2. **Interests are the product's own tags.** A parallel vocabulary would be a preference that
 *      can never match a place, which is worse than no preference at all.
 *
 * The dietary list also carries a privacy sentence, and that is asserted: somebody deciding whether
 * to tell a travel site they keep kosher should be told where it goes *before* they type it.
 */

const empty = {
  interests: [],
  budget_band: null,
  travel_pace: null,
  party_type: null,
  dietary_needs: []
};

describe('nothing is set until somebody sets it', () => {
  test('every choice starts on an explicit "Not set"', () => {
    render(<TravelPreferences values={empty} onChange={jest.fn()} />);

    expect(screen.getByLabelText(/budget/i)).toHaveValue('');
    expect(screen.getByLabelText(/pace/i)).toHaveValue('');
    expect(screen.getByLabelText(/usually travelling/i)).toHaveValue('');
  });

  test('"Not set" is a real option on each, not just the absence of a value', () => {
    // If it were absent, a preference could be set and never cleared through the form.
    render(<TravelPreferences values={empty} onChange={jest.fn()} />);

    for (const label of [/budget/i, /pace/i, /usually travelling/i]) {
      const select = screen.getByLabelText(label);
      expect(select.querySelector('option[value=""]')).not.toBeNull();
    }
  });

  test('it renders from nothing at all without throwing', () => {
    // The same assertion `accessNeeds.test.jsx` makes, for the same reason: these two components
    // are siblings in one fieldset on one page, and one of them tolerating an absent `values`
    // while the other throws is an asymmetry nobody would find until the page loaded differently.
    render(<TravelPreferences onChange={jest.fn()} />);

    expect(screen.getByLabelText(/budget/i)).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Beach' })).toHaveAttribute('aria-pressed', 'false');
  });

  test('the form says that leaving something unset means exactly that', () => {
    render(<TravelPreferences values={empty} onChange={jest.fn()} />);

    expect(screen.getByText(/does not assume a default on your behalf/i)).toBeInTheDocument();
  });

  test('clearing a chosen value reports an empty string, which the API turns into NULL', async () => {
    const onChange = jest.fn();
    const user = userEvent.setup();
    render(<TravelPreferences values={{ ...empty, budget_band: 'mid' }} onChange={onChange} />);

    await user.selectOptions(screen.getByLabelText(/budget/i), '');

    expect(onChange).toHaveBeenCalledWith('budget_band', '');
  });
});

describe('interests are the tags places already carry', () => {
  test('every theme in the product vocabulary is offered', () => {
    // Not a sample — all of them, so this fails if the two lists ever diverge.
    render(<TravelPreferences values={empty} onChange={jest.fn()} />);

    for (const theme of THEMES) {
      expect(screen.getByRole('button', { name: theme.label })).toBeInTheDocument();
    }
  });

  test('choosing one reports the theme id, not its label', async () => {
    const onChange = jest.fn();
    const user = userEvent.setup();
    render(<TravelPreferences values={empty} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'Beach' }));

    expect(onChange).toHaveBeenCalledWith('interests', ['beach']);
  });

  test('choosing one that is already chosen removes it', async () => {
    const onChange = jest.fn();
    const user = userEvent.setup();
    render(<TravelPreferences values={{ ...empty, interests: ['beach'] }} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'Beach' }));

    expect(onChange).toHaveBeenCalledWith('interests', []);
  });

  test('a chosen interest is announced as pressed, not only coloured', async () => {
    // Colour alone is not a state a screen reader can convey.
    render(<TravelPreferences values={{ ...empty, interests: ['beach'] }} onChange={jest.fn()} />);

    expect(screen.getByRole('button', { name: 'Beach' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Mountain' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
  });
});

describe('the dietary list says where it goes before somebody types in it', () => {
  test('it names the three places it is not shown', () => {
    render(<TravelPreferences values={empty} onChange={jest.fn()} />);

    const notice = screen.getByText(/private to your profile/i);
    expect(notice).toHaveTextContent(/never shown on a place/i);
    expect(notice).toHaveTextContent(/never copied onto a trip/i);
    expect(notice).toHaveTextContent(/share an itinerary with cannot see it/i);
  });

  test('every dietary option in the vocabulary is offered', () => {
    render(<TravelPreferences values={empty} onChange={jest.fn()} />);

    for (const need of DIETARY_NEEDS) {
      expect(screen.getByRole('button', { name: need.label })).toBeInTheDocument();
    }
  });

  test('choosing one reports its id', async () => {
    const onChange = jest.fn();
    const user = userEvent.setup();
    render(<TravelPreferences values={empty} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'Halal' }));

    expect(onChange).toHaveBeenCalledWith('dietary_needs', ['halal']);
  });
});
