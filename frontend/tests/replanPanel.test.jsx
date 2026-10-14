import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import ReplanPanel from '../src/components/trips/ReplanPanel';

/**
 * The replan, as a user meets it (`FV-027` stage b).
 *
 * The backend proves *which* moves are proposed. What no API test can see is the half that decides
 * whether this feature is trustworthy rather than merely correct:
 *
 * - **nothing moves without a second, deliberate press** — the item's kill criteria end the feature
 *   if the replan cannot be reviewed before it is applied;
 * - **the reason is on screen beside the button**, so accepting is a decision rather than an act of
 *   faith in a tool;
 * - **and what it declined to touch is visible**, because a wet day left silently alone reads as a
 *   broken feature rather than a considered one.
 */

const PROPOSAL = {
  item_id: 7,
  title: 'Boulders at Hampi',
  from_day_number: 1,
  to_day_number: 3,
  to_day_id: 42,
  because: {
    from_condition: 'Rain',
    from_precipitation_mm: 12.4,
    to_condition: 'Clear sky',
    source: 'Open-Meteo'
  },
  message: 'Day 1 is forecast rain at "Boulders at Hampi" — day 3 is clear sky.'
};

const DECLINED = {
  item_id: 9,
  day_number: 1,
  reason: 'scheduled_at_a_fixed_time',
  message: '"Sunset point" is scheduled at 17:00, so it is left where you put it.'
};

const replan = (over = {}) => ({
  proposals: [PROPOSAL],
  declined: [],
  considered: 1,
  ...over
});

const panel = (props = {}) =>
  render(
    <ReplanPanel
      replan={null}
      replanning={false}
      error={null}
      busy={false}
      onSuggest={jest.fn()}
      onApply={jest.fn()}
      {...props}
    />
  );

describe('it says nothing until it is asked', () => {
  test('no proposal is shown before a check has run', () => {
    panel();

    expect(screen.getByText(/Nothing changes until you say so/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Move to day/i })).not.toBeInTheDocument();
  });

  test('the button asks for the check, and is disabled while one is in flight', async () => {
    const onSuggest = jest.fn();
    const { unmount } = panel({ onSuggest });

    await userEvent.click(screen.getByRole('button', { name: /check the forecast/i }));
    expect(onSuggest).toHaveBeenCalledTimes(1);

    unmount();
    panel({ replanning: true });
    expect(screen.getByRole('button', { name: /checking/i })).toBeDisabled();
  });
});

describe('a proposal is readable before it is accepted', () => {
  test('it shows which stop, from which day, to which day', () => {
    panel({ replan: replan() });

    expect(screen.getByText('Boulders at Hampi')).toBeInTheDocument();
    // The move itself is one labelled element rather than two loose numbers — "Day 1" appears in
    // the chip *and* in the forecast comparison beneath it, so a bare text match is ambiguous, and
    // a screen reader hearing "Day 1 Day 3" learns nothing about the direction.
    expect(screen.getByLabelText('Move from day 1 to day 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Move to day 3/i })).toBeInTheDocument();
  });

  test('the reason sits beside the button, not behind a link', () => {
    // Accepting has to be a decision. A proposal whose justification is one click away is a
    // proposal most people will accept without reading — which is the failure this panel exists to
    // avoid, dressed up as convenience.
    panel({ replan: replan() });

    expect(screen.getByText(/Rain/)).toBeInTheDocument();
    expect(screen.getByText(/12.4 mm/)).toBeInTheDocument();
    expect(screen.getByText(/Clear sky/)).toBeInTheDocument();
  });

  test('the forecast is attributed, because it is somebody else’s data', () => {
    // Open-Meteo is CC-BY, and attribution follows the data rather than the page it first appeared
    // on — the same rule the feasibility findings follow.
    panel({ replan: replan() });
    expect(screen.getByText(/Forecast from Open-Meteo/i)).toBeInTheDocument();
  });
});

describe('nothing moves on its own', () => {
  test('rendering a proposal applies nothing', () => {
    // The kill criterion, asserted directly: *silently rewriting somebody's trip is worse than
    // having no feature at all*.
    const onApply = jest.fn();
    panel({ replan: replan(), onApply });

    expect(onApply).not.toHaveBeenCalled();
  });

  test('applying takes a deliberate press, and carries the destination with it', async () => {
    const onApply = jest.fn();
    panel({ replan: replan(), onApply });

    await userEvent.click(screen.getByRole('button', { name: /Move to day 3/i }));

    expect(onApply).toHaveBeenCalledTimes(1);
    // The whole proposal, so the caller has `to_day_id` and never has to map an ordinal back to a
    // row id.
    expect(onApply.mock.calls[0][0].to_day_id).toBe(42);
  });

  test('a write in flight disables the button, so one press cannot become two', async () => {
    panel({ replan: replan(), busy: true });
    expect(screen.getByRole('button', { name: /Move to day 3/i })).toBeDisabled();
  });
});

describe('what it left alone is visible', () => {
  test('a declined item is shown with its reason', () => {
    // A wet day quietly unchanged is indistinguishable from a feature that did not notice. This is
    // the difference between "nothing to suggest" and "nothing was looked at".
    panel({ replan: replan({ proposals: [], declined: [DECLINED], considered: 1 }) });

    expect(screen.getByText(/Left alone/i)).toBeInTheDocument();
    expect(screen.getByText(/scheduled at 17:00/i)).toBeInTheDocument();
  });

  test('a trip with nothing at risk says so positively', () => {
    // A blank panel after pressing a button is indistinguishable from a button that did nothing.
    panel({ replan: replan({ proposals: [], declined: [], considered: 0 }) });

    expect(screen.getByText(/Nothing outdoors is forecast to be rained on/i)).toBeInTheDocument();
  });

  test('a failed check shows the error instead of a stale list', () => {
    // The dangerous stale state is the *reassuring* one — a list of moves that were true about a
    // plan that has since changed.
    panel({ replan: replan(), error: new Error('Could not reach the forecast') });

    expect(screen.getByText(/Could not reach the forecast/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Move to day 3/i })).not.toBeInTheDocument();
  });
});
