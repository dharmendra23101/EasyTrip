const tripExpenseModel = require('../models/tripExpenseModel');
const tripAccessModel = require('../models/tripAccessModel');
const { settleExpenses } = require('../services/settlementService');
const logger = require('../utils/logger');

/**
 * Trip expenses and the settlement they add up to (`FV-008`).
 *
 * ---------------------------------------------------------------------------
 * Mixed currencies are refused, not converted
 * ---------------------------------------------------------------------------
 * `GET /settlement` answers **422** when a trip holds expenses in more than one currency, and says
 * which ones. It does not convert, because an exchange rate is a fact about a moment that this
 * project has no source for — and a made-up rate would put a fabricated number into a list of
 * amounts people are expected to hand each other. That is `FP-012` in the place it would do the
 * most damage.
 *
 * Multi-currency is `FV-012`, and it needs a rate provider rather than a schema change.
 *
 * ---------------------------------------------------------------------------
 * 404 for everything a caller may not see
 * ---------------------------------------------------------------------------
 * Consistent with the rest of the trip surface: a trip that is not yours and a trip that does not
 * exist answer alike, so no endpoint becomes an oracle for which ids are real.
 */

const notFound = (res) => res.status(404).json({ message: 'Trip not found' });

/** GET /api/auth/trips/:tripId/expenses */
const listExpenses = async (req, res) => {
  try {
    const tripId = Number(req.params.tripId);
    const role = await tripAccessModel.roleOnTrip(req.user.uid, tripId);
    if (!role) return notFound(res);

    const expenses = await tripExpenseModel.listExpenses(req.user.uid, tripId);
    res.status(200).json({ expenses });
  } catch (error) {
    logger.error({ err: error }, 'Error listing trip expenses');
    res.status(500).json({ message: 'Error loading what has been spent' });
  }
};

/**
 * POST /api/auth/trips/:tripId/expenses
 *
 * `participants` is optional and defaults to **everyone on the trip**, which is what a dinner
 * usually is. Sending it explicitly is how an expense that was only for some people gets recorded.
 */
const createExpense = async (req, res) => {
  try {
    const tripId = Number(req.params.tripId);

    const result = await tripExpenseModel.createExpense(req.user.uid, tripId, {
      description: req.body.description,
      amount_minor: req.body.amount_minor,
      currency: String(req.body.currency).toUpperCase(),
      paid_by: req.body.paid_by,
      participants: req.body.participants
    });

    if (!result.ok && result.reason === 'not_editable') return notFound(res);

    if (!result.ok && result.reason === 'unknown_person') {
      return res.status(422).json({
        message: 'Everybody an expense involves has to be somebody who can see this trip.'
      });
    }

    res.status(201).json({ expense: result.expense });
  } catch (error) {
    logger.error({ err: error }, 'Error recording a trip expense');
    res.status(500).json({ message: 'Error recording this expense' });
  }
};

/** DELETE /api/auth/trips/:tripId/expenses/:expenseId — the owner's or the payer's. */
const deleteExpense = async (req, res) => {
  try {
    const tripId = Number(req.params.tripId);
    const removed = await tripExpenseModel.deleteExpense(
      req.user.uid,
      tripId,
      Number(req.params.expenseId)
    );

    if (!removed) return res.status(404).json({ message: 'Expense not found' });

    res.status(204).send();
  } catch (error) {
    logger.error({ err: error }, 'Error deleting a trip expense');
    res.status(500).json({ message: 'Error deleting this expense' });
  }
};

/**
 * GET /api/auth/trips/:tripId/settlement
 *
 * Derived on every read rather than stored. A settlement is a **function of the expenses**, and a
 * cached one is a number that goes quietly wrong the moment somebody records a dinner — which is
 * the class of bug this project has already paid for twice with denormalised aggregates.
 */
const getSettlement = async (req, res) => {
  try {
    const tripId = Number(req.params.tripId);
    const role = await tripAccessModel.roleOnTrip(req.user.uid, tripId);
    if (!role) return notFound(res);

    const expenses = await tripExpenseModel.listExpenses(req.user.uid, tripId);
    const currencies = [...new Set(expenses.map((expense) => expense.currency))];

    if (currencies.length > 1) {
      return res.status(422).json({
        message:
          `This trip has expenses in ${currencies.sort().join(' and ')}. EasyTrip does not ` +
          'convert between currencies, because it has no exchange rate it can stand behind — so ' +
          'there is no single set of transfers to suggest.',
        currencies: currencies.sort()
      });
    }

    // `amount_minor` is a BIGINT and node-pg hands those back as strings, so it is converted here
    // rather than inside the engine — which is pure and should not know what a driver does.
    const settlement = settleExpenses(
      expenses.map((expense) => ({
        paid_by: expense.paid_by,
        amount_minor: Number(expense.amount_minor),
        participants: expense.participants
      }))
    );

    res.status(200).json({
      ...settlement,
      currency: currencies[0] || null,
      expense_count: expenses.length
    });
  } catch (error) {
    logger.error({ err: error }, 'Error settling trip expenses');
    res.status(500).json({ message: 'Error working out who owes what' });
  }
};

module.exports = { listExpenses, createExpense, deleteExpense, getSettlement };
