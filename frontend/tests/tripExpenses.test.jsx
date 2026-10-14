import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TripExpenses from '../src/components/trips/TripExpenses';
import tripService from '../src/services/tripService';
import expenseService from '../src/services/expenseService';
import { ApiClientError } from '../src/services/apiClient';

/**
 * The expenses panel (`FV-008`).
 *
 * **The arithmetic is not this file's subject** — `backend/tests/settlement.test.js` owns that, and
 * it can be exhaustive because the engine is pure. What is here is the three ways a panel about
 * money can mislead:
 *
 *   1. **Claiming the settlement is minimal.** It is greedy, the API says `optimal: false`, and the
 *      panel must not put the word "minimal" on screen. `FP-012`.
 *   2. **Rendering nothing when there is no settlement.** A mixed-currency trip has no honest sum,
 *      and an empty space reads as "nobody owes anything" — a factual claim, and the wrong one.
 *   3. **Showing money wrong.** Amounts cross the wire as integer minor units; ₹90.00 displayed as
 *      ₹9,000 is the kind of error that looks like a number rather than like a bug.
 */

jest.mock('../src/services/tripService', () => ({
  __esModule: true,
  default: { listCollaborators: jest.fn() }
}));
jest.mock('../src/services/expenseService', () => ({
  __esModule: true,
  default: {
    listExpenses: jest.fn(),
    createExpense: jest.fn(),
    deleteExpense: jest.fn(),
    getSettlement: jest.fn()
  }
}));

const getToken = jest.fn().mockResolvedValue('token');

const EXPENSES = [
  {
    id: 1,
    description: 'Dinner',
    amount_minor: '9000',
    currency: 'INR',
    paid_by: 'u-owner',
    participants: ['u-otto', 'u-owner']
  }
];

const SETTLEMENT = {
  balances: [
    { user_id: 'u-owner', amount_minor: 4500 },
    { user_id: 'u-otto', amount_minor: -4500 }
  ],
  transfers: [{ from: 'u-otto', to: 'u-owner', amount_minor: 4500 }],
  optimal: false,
  currency: 'INR',
  expense_count: 1
};

beforeEach(() => {
  jest.clearAllMocks();
  expenseService.listExpenses.mockResolvedValue(EXPENSES);
  expenseService.getSettlement.mockResolvedValue(SETTLEMENT);
  tripService.listCollaborators.mockResolvedValue({ your_role: 'owner', collaborators: [] });
  expenseService.createExpense.mockResolvedValue({ id: 2 });
  expenseService.deleteExpense.mockResolvedValue(true);
});

describe('money is shown as money', () => {
  test('minor units are rendered as an amount, not as a raw integer', async () => {
    // 9000 paise is ₹90.00. Rendering "9,000" would look like a number rather than like a bug.
    render(<TripExpenses tripId={7} getToken={getToken} />);

    expect(await screen.findByText(/Dinner/)).toBeInTheDocument();
    expect(screen.getByText(/₹90\.00/)).toBeInTheDocument();
  });

  test('an expense says how many ways it was split', async () => {
    render(<TripExpenses tripId={7} getToken={getToken} />);

    expect(await screen.findByText(/split 2 ways/i)).toBeInTheDocument();
  });

  test('rupees typed in the field become paise on the wire', async () => {
    // The one conversion in the component, and the one that turns a correct-looking form into a
    // hundredfold error if it is missing.
    const user = userEvent.setup();
    render(<TripExpenses tripId={7} getToken={getToken} />);

    await user.type(await screen.findByLabelText(/what was it for/i), 'Taxi');
    await user.type(screen.getByLabelText(/how much/i), '250.50');
    await user.click(screen.getByRole('button', { name: /record/i }));

    await waitFor(() =>
      expect(expenseService.createExpense).toHaveBeenCalledWith(
        7,
        { description: 'Taxi', amount_minor: 25050, currency: 'INR' },
        'token'
      )
    );
  });
});

describe('the settlement does not claim to be minimal', () => {
  test('it is offered as "a short way", and the word minimal never appears', async () => {
    render(<TripExpenses tripId={7} getToken={getToken} />);

    expect(await screen.findByText(/a short way to settle up/i)).toBeInTheDocument();
    expect(screen.queryByText(/minimal/i)).not.toBeInTheDocument();
    expect(
      screen.getByText(/not necessarily the one with the fewest payments/i)
    ).toBeInTheDocument();
  });

  test('each transfer says who pays whom, and how much', async () => {
    render(<TripExpenses tripId={7} getToken={getToken} />);

    // The names are their own <span>s, so the sentence lives on the <li> that holds them.
    const transfer = (await screen.findByText(/u-otto/)).closest('li');
    expect(transfer).toHaveTextContent(/pays/);
    expect(transfer).toHaveTextContent(/₹45\.00/);
  });

  test('settled up is said plainly rather than left blank', async () => {
    expenseService.getSettlement.mockResolvedValue({ ...SETTLEMENT, transfers: [] });

    render(<TripExpenses tripId={7} getToken={getToken} />);

    expect(await screen.findByText(/everybody is square/i)).toBeInTheDocument();
  });
});

describe('what it does when there is no honest answer', () => {
  test('a mixed-currency trip shows the reason, and still shows the expenses', async () => {
    // The individual amounts are all still true; it is only the sum that has no answer without a
    // rate. Hiding the list too would lose information that is perfectly good.
    expenseService.getSettlement.mockRejectedValue(
      new ApiClientError(
        'This trip has expenses in INR and USD. EasyTrip does not convert between currencies.',
        422
      )
    );

    render(<TripExpenses tripId={7} getToken={getToken} />);

    expect(await screen.findByText(/does not convert between currencies/i)).toBeInTheDocument();
    expect(screen.getByText('Dinner')).toBeInTheDocument();
    expect(screen.queryByText(/a short way to settle up/i)).not.toBeInTheDocument();
  });

  test('nothing recorded is said plainly', async () => {
    expenseService.listExpenses.mockResolvedValue([]);
    expenseService.getSettlement.mockResolvedValue({
      ...SETTLEMENT,
      transfers: [],
      expense_count: 0
    });

    render(<TripExpenses tripId={7} getToken={getToken} />);

    expect(await screen.findByText(/nothing recorded yet/i)).toBeInTheDocument();
    // And it does not also say everybody is square, which would be a claim about a ledger that
    // does not exist.
    expect(screen.queryByText(/everybody is square/i)).not.toBeInTheDocument();
  });

  test('a failed read renders nothing rather than an empty ledger', async () => {
    expenseService.listExpenses.mockRejectedValue(new ApiClientError('network', 500));

    render(<TripExpenses tripId={7} getToken={getToken} />);

    await waitFor(() => expect(expenseService.listExpenses).toHaveBeenCalled());
    expect(screen.queryByRole('heading', { name: /what this trip cost/i })).not.toBeInTheDocument();
  });
});

describe('who is offered the form', () => {
  test('an owner is', async () => {
    render(<TripExpenses tripId={7} getToken={getToken} />);

    expect(await screen.findByLabelText(/what was it for/i)).toBeInTheDocument();
  });

  test('an editor is', async () => {
    tripService.listCollaborators.mockResolvedValue({ your_role: 'editor', collaborators: [] });

    render(<TripExpenses tripId={7} getToken={getToken} />);

    expect(await screen.findByLabelText(/what was it for/i)).toBeInTheDocument();
  });

  test('a viewer is not, but still sees what was spent', async () => {
    // The server refuses either way; offering a form that is known to fail is what teaches people
    // to distrust an interface.
    tripService.listCollaborators.mockResolvedValue({ your_role: 'viewer', collaborators: [] });

    render(<TripExpenses tripId={7} getToken={getToken} />);

    expect(await screen.findByText('Dinner')).toBeInTheDocument();
    expect(screen.queryByLabelText(/what was it for/i)).not.toBeInTheDocument();
  });
});
