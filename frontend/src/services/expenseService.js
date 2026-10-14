import apiClient, { ApiClientError } from './apiClient';

/**
 * What a trip cost, and who owes whom (`FV-008`).
 *
 * Split out of `tripService.js` when that file crossed the 500-line exit criterion (`check:size`) —
 * the expense calls were the ones that took it over, and they are the cleanest seam: a distinct
 * resource with its own endpoints, its own panel and its own tests. `tripService` keeps the trip,
 * its days, its items, its sharing and its people.
 *
 * The error mapping is the same shape as its neighbour's, and deliberately so: an `ApiClientError`
 * that already carries a status is rethrown untouched, because the API writes sentences for readers
 * — the mixed-currency 422 in particular — and a generic fallback would swallow them.
 */

const authed = (token) => ({ headers: { Authorization: `Bearer ${token}` } });

const withFallback = (error, fallback) => {
  if (error instanceof ApiClientError && error.status) return error;
  return new ApiClientError(fallback, error?.status, error?.data);
};

const listExpenses = async (tripId, token) => {
  try {
    const { data } = await apiClient.get(`/auth/trips/${tripId}/expenses`, authed(token));
    return data?.expenses ?? [];
  } catch (error) {
    throw withFallback(error, 'Could not load what has been spent');
  }
};

/** `amount_minor` is an integer in the currency's minor unit, all the way to the server. */
const createExpense = async (tripId, expense, token) => {
  try {
    const { data } = await apiClient.post(`/auth/trips/${tripId}/expenses`, expense, authed(token));
    return data?.expense ?? null;
  } catch (error) {
    throw withFallback(error, 'Could not record this expense');
  }
};

const deleteExpense = async (tripId, expenseId, token) => {
  try {
    await apiClient.delete(`/auth/trips/${tripId}/expenses/${expenseId}`, authed(token));
    return true;
  } catch (error) {
    throw withFallback(error, 'Could not delete this expense');
  }
};

/**
 * Who owes whom.
 *
 * The 422 for a mixed-currency trip carries a sentence written for a reader, and `withFallback`
 * rethrows an error that already has a status untouched — so the panel can show *why* there is no
 * settlement rather than a generic failure.
 */
const getSettlement = async (tripId, token) => {
  try {
    const { data } = await apiClient.get(`/auth/trips/${tripId}/settlement`, authed(token));
    return data ?? null;
  } catch (error) {
    throw withFallback(error, 'Could not work out who owes what');
  }
};

const expenseService = {
  listExpenses,
  createExpense,
  deleteExpense,
  getSettlement
};

export default expenseService;
export { listExpenses, createExpense, deleteExpense, getSettlement };
