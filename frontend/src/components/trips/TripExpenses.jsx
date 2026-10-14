import { useCallback, useEffect, useState } from 'react';
import { FiDollarSign, FiTrash2 } from 'react-icons/fi';

import tripService from '../../services/tripService';
import expenseService from '../../services/expenseService';
import { formatMinor, formatMinorAbs } from '../../utils/money';

/**
 * What the trip cost, and who owes whom (`FV-008`).
 *
 * ---------------------------------------------------------------------------
 * The settlement says what it is, and what it is not
 * ---------------------------------------------------------------------------
 * The engine is greedy, and minimising transfers is NP-hard — so the API returns `optimal: false`
 * and this panel does not print the word "minimal". It says *"a short way to settle up"*, which is
 * true, instead of a word that would be a claim about optimality nobody has established.
 *
 * `FP-012`, third time in this codebase: the recommendation panel says it is comparing tags rather
 * than predicting, the fit score refuses to be ranked, and this refuses to call a good answer the
 * best one.
 *
 * ---------------------------------------------------------------------------
 * Mixed currencies are shown as a refusal with a reason, not as an empty panel
 * ---------------------------------------------------------------------------
 * A trip with expenses in two currencies gets a 422 from the settlement endpoint carrying a sentence
 * and the currency codes. Rendering nothing there would look like "nobody owes anything", which is a
 * factual claim about money and the wrong one. The expenses list still renders — the individual
 * amounts are all still true; it is only the *sum* that has no honest answer without a rate.
 *
 * ---------------------------------------------------------------------------
 * Amounts stay integers until they are displayed
 * ---------------------------------------------------------------------------
 * Everything on the wire is minor units. `formatMinor` is the only division, and nothing computed
 * from its output goes back into arithmetic.
 */

/** Rupees in the field, paise on the wire — the conversion happens once, here, on submit. */
const toMinor = (major) => Math.round(Number(major) * 100);

export const TripExpenses = ({ tripId, getToken }) => {
  const [expenses, setExpenses] = useState([]);
  const [settlement, setSettlement] = useState(null);
  const [settlementError, setSettlementError] = useState(null);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  // Whether this reader may record one. Read from the collaborator endpoint, which is the only place
  // that reports a role — one extra request on a page that already makes several, and consistent
  // with every other panel here fetching its own data rather than riding on the workspace read.
  const [canEdit, setCanEdit] = useState(false);

  const load = useCallback(async () => {
    if (!getToken) return;
    try {
      const token = await getToken();
      setExpenses(await expenseService.listExpenses(tripId, token));
      const access = await tripService.listCollaborators(tripId, token);
      setCanEdit(access.your_role === 'owner' || access.your_role === 'editor');
      setLoadFailed(false);

      // Fetched separately and allowed to fail on its own: a mixed-currency trip has a perfectly
      // good expense list and no settlement, and one request for both would lose the list.
      try {
        setSettlement(await expenseService.getSettlement(tripId, token));
        setSettlementError(null);
      } catch (failure) {
        setSettlement(null);
        setSettlementError(failure);
      }
    } catch {
      setLoadFailed(true);
    } finally {
      setLoaded(true);
    }
  }, [tripId, getToken]);

  useEffect(() => {
    load();
  }, [load]);

  const record = async (event) => {
    event.preventDefault();
    const text = description.trim();
    if (!text || !amount) return;

    setBusy(true);
    setError(null);
    try {
      await expenseService.createExpense(
        tripId,
        { description: text, amount_minor: toMinor(amount), currency: 'INR' },
        await getToken()
      );
      setDescription('');
      setAmount('');
      await load();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (expenseId) => {
    setBusy(true);
    setError(null);
    try {
      await expenseService.deleteExpense(tripId, expenseId, await getToken());
      await load();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };

  if (!loaded || loadFailed) return null;

  return (
    <section
      aria-labelledby="expenses-heading"
      className="rounded-xl border border-gray-200 bg-white p-6"
    >
      <h2
        id="expenses-heading"
        className="mb-1 flex items-center gap-2 text-lg font-semibold text-gray-900"
      >
        <FiDollarSign className="h-5 w-5 text-primary-600" aria-hidden="true" />
        What this trip cost
      </h2>
      <p className="mb-4 text-sm text-gray-600">
        Split evenly between everyone on the trip. Anyone here can see it; only the person who paid,
        or the trip’s owner, can remove an entry.
      </p>

      {expenses.length === 0 ? (
        <p className="text-sm text-gray-500">Nothing recorded yet.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {expenses.map((expense) => (
            <li key={expense.id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-gray-900">
                  {expense.description}
                </span>
                <span className="block text-xs text-gray-500">
                  split {expense.participants.length}{' '}
                  {expense.participants.length === 1 ? 'way' : 'ways'}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-3">
                <span className="text-sm font-medium text-gray-900">
                  {formatMinor(expense.amount_minor, expense.currency)}
                </span>
                <button
                  type="button"
                  onClick={() => remove(expense.id)}
                  disabled={busy}
                  aria-label={`Remove ${expense.description}`}
                  className="flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:text-red-600 disabled:opacity-50"
                >
                  <FiTrash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* The settlement, or the reason there is not one. */}
      {settlementError && (
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {settlementError.message}
        </p>
      )}

      {settlement && settlement.transfers.length > 0 && (
        <div className="mt-4 border-t border-gray-100 pt-3">
          <h3 className="mb-2 text-sm font-semibold text-gray-900">
            {/* Not "minimal". See the header — the engine is greedy and says so. */}A short way to
            settle up
          </h3>
          <ul className="space-y-1 text-sm text-gray-700">
            {settlement.transfers.map((transfer) => (
              <li key={`${transfer.from}-${transfer.to}-${transfer.amount_minor}`}>
                <span className="font-medium">{transfer.from}</span> pays{' '}
                <span className="font-medium">{transfer.to}</span>{' '}
                {formatMinorAbs(transfer.amount_minor, settlement.currency)}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-gray-500">
            One of several ways to clear these balances — not necessarily the one with the fewest
            payments.
          </p>
        </div>
      )}

      {settlement && settlement.expense_count > 0 && settlement.transfers.length === 0 && (
        <p className="mt-4 text-sm text-gray-600">Everybody is square.</p>
      )}

      {canEdit && (
        <form onSubmit={record} className="mt-4" aria-label="Record an expense">
          <div className="flex flex-wrap gap-2">
            <label className="sr-only" htmlFor="expense-description">
              What was it for
            </label>
            <input
              id="expense-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Dinner"
              maxLength={200}
              className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
            <label className="sr-only" htmlFor="expense-amount">
              How much, in rupees
            </label>
            <input
              id="expense-amount"
              type="number"
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="₹"
              className="w-28 rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={busy || !description.trim() || !amount}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-60"
            >
              Record
            </button>
          </div>
        </form>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error.message}
        </p>
      )}
    </section>
  );
};

export default TripExpenses;
