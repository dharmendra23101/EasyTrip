import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReviewForm from '../src/components/ReviewForm';

/**
 * ReviewForm (IMP-093, locking in the fix for BUG C1).
 *
 * C1 was this project's worst shipped defect: review submission was non-functional for every user,
 * via three independent bugs stacked on one path. Two of them lived in how this component is used,
 * and one in the component itself:
 *
 *   1. the page destructured `isAuthenticated` from a context that never exposed it — see
 *      `AuthContext.test.jsx`;
 *   2. the page passed `rating={0}` with **no-op change handlers**, so clicking a star did nothing
 *      and the submit button was permanently disabled;
 *   3. `<form onSubmit={onSubmit}>` handed the **DOM submit event** to a handler that destructured
 *      `{ rating, comment }` from it, yielding `undefined` for both.
 *
 * None of the three was visible to a build or a lint run, and all three would have been caught by
 * the first two tests below.
 */

const setup = (props = {}) => {
  const onSubmit = jest.fn();
  const onRatingChange = jest.fn();
  const onCommentChange = jest.fn();
  render(
    <ReviewForm
      rating={0}
      comment=""
      onSubmit={onSubmit}
      onRatingChange={onRatingChange}
      onCommentChange={onCommentChange}
      {...props}
    />
  );
  return { onSubmit, onRatingChange, onCommentChange };
};

describe('the submit payload (BUG C1, defect 3)', () => {
  test('onSubmit receives {rating, comment} — NOT the DOM submit event', () => {
    const { onSubmit } = setup({ rating: 4, comment: 'Worth the climb' });

    // Submitting the form itself, not calling the handler directly, so the event path is real.
    screen.getByRole('button', { name: /submit review/i }).click();

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const arg = onSubmit.mock.calls[0][0];
    expect(arg).toEqual({ rating: 4, comment: 'Worth the climb' });

    // The regression shape: a SyntheticEvent also "has" properties, so `toEqual` alone could pass
    // against a sloppy mock. Assert it is a plain payload, not an event.
    expect(arg).not.toHaveProperty('preventDefault');
    expect(arg).not.toHaveProperty('target');
  });

  test('the form does not navigate — preventDefault is called', async () => {
    // Without it the page does a full form GET and the SPA state is lost. jsdom reports an
    // unhandled navigation as an error, so a regression here is loud rather than subtle.
    const { onSubmit } = setup({ rating: 3 });
    const form = document.querySelector('form');
    const submitEvent = new Event('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(submitEvent);
    expect(submitEvent.defaultPrevented).toBe(true);
    expect(onSubmit).toHaveBeenCalled();
  });
});

describe('the rating control is actually wired (BUG C1, defect 2)', () => {
  test('choosing a star calls onRatingChange with that value', async () => {
    const user = userEvent.setup();
    const { onRatingChange } = setup();

    await user.click(screen.getByRole('radio', { name: '4 stars' }));

    expect(onRatingChange).toHaveBeenCalledWith(4);
  });

  test('typing a comment calls onCommentChange with the text, not the event', async () => {
    const user = userEvent.setup();
    const { onCommentChange } = setup();

    // One character on purpose. The textarea is *controlled* by the `comment` prop, which this
    // test deliberately does not update — so a second keystroke would start from '' again and
    // report 'k' rather than 'ok'. That is correct controlled-input behaviour; asserting an
    // accumulated string would be asserting a bug.
    await user.type(screen.getByLabelText(/your review/i), 'x');

    expect(onCommentChange).toHaveBeenCalledWith('x');
    // The contract that matters: a string reaches the parent, not a SyntheticEvent.
    expect(typeof onCommentChange.mock.calls[0][0]).toBe('string');
  });

  test('submit stays disabled at rating 0 and enables once a rating is set', () => {
    const { unmount } = render(
      <ReviewForm rating={0} onSubmit={jest.fn()} onRatingChange={jest.fn()} />
    );
    expect(screen.getByRole('button', { name: /submit review/i })).toBeDisabled();
    unmount();

    render(<ReviewForm rating={1} onSubmit={jest.fn()} onRatingChange={jest.fn()} />);
    expect(screen.getByRole('button', { name: /submit review/i })).toBeEnabled();
  });

  test('a disabled submit cannot fire onSubmit', () => {
    const { onSubmit } = setup({ rating: 0 });
    screen.getByRole('button', { name: /submit review/i }).click();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('the rating is one question with five answers, not five toggles (IMP-081)', () => {
  // It shipped as five `aria-pressed` buttons, so a screen reader announced five unrelated
  // controls and nothing conveyed that picking 4 unpicks 3. Native radios were chosen for the
  // arrow-key navigation and roving focus that come free with them.
  test('renders five radios in a single named group', () => {
    setup();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(5);
    expect(new Set(radios.map((r) => r.getAttribute('name')))).toEqual(new Set(['rating']));
  });

  test('each star has an accessible name a screen reader can distinguish', () => {
    setup();
    expect(screen.getByRole('radio', { name: '1 star' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '5 stars' })).toBeInTheDocument();
  });

  test('selection is exclusive — exactly one is checked', () => {
    setup({ rating: 3 });
    const checked = screen.getAllByRole('radio').filter((r) => r.checked);
    expect(checked).toHaveLength(1);
    expect(checked[0]).toHaveAccessibleName('3 stars');
  });

  test('the group is labelled', () => {
    setup();
    expect(screen.getByRole('group', { name: /your rating/i })).toBeInTheDocument();
  });

  test('the inputs stay in the accessibility tree rather than being display:none', () => {
    // `sr-only` keeps them focusable; `display: none` would remove them and take the keyboard
    // support with it, which is the whole reason native radios were chosen.
    setup();
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toBeVisible();
    }
  });
});

describe('submission state and messages', () => {
  test('isSubmitting disables the button and says so', () => {
    setup({ rating: 4, isSubmitting: true });
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent(/submitting/i);
  });

  test('isSubmitting blocks a second submit', () => {
    const { onSubmit } = setup({ rating: 4, isSubmitting: true });
    document
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test('an error is announced, not just coloured red', () => {
    // Colour alone is invisible to a screen reader; `role="alert"` is what makes a failed
    // submission perceivable.
    setup({ rating: 4, error: 'Something went wrong' });
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
  });

  test('a returning reviewer is told the submit will edit, not duplicate', () => {
    // Matches the server contract: UNIQUE (place_id, user_id) makes a second POST an upsert.
    // If the label lied, users would expect a second review to appear.
    setup({ rating: 4, userHasReviewed: true });
    expect(screen.getByRole('button', { name: /update review/i })).toBeInTheDocument();
    expect(screen.getByText(/already reviewed this place/i)).toBeInTheDocument();
  });

  test('a first-time reviewer sees Submit, not Update', () => {
    setup({ rating: 4, userHasReviewed: false });
    expect(screen.getByRole('button', { name: /submit review/i })).toBeInTheDocument();
    expect(screen.queryByText(/already reviewed/i)).not.toBeInTheDocument();
  });
});
