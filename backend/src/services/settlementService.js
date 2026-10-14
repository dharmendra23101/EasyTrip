/**
 * Who owes whom, after a trip somebody paid for in pieces (`FV-008`).
 *
 * ---------------------------------------------------------------------------
 * Pure, for the same reason `feasibilityService` is
 * ---------------------------------------------------------------------------
 * No database, no clock, no network. Every function here is a function of its arguments, so a
 * settlement can always be reproduced from the expenses that produced it — which matters more here
 * than almost anywhere else in this codebase, because the output is a list of amounts people are
 * expected to hand each other.
 *
 * ---------------------------------------------------------------------------
 * Integer minor units, and never a float
 * ---------------------------------------------------------------------------
 * Amounts are integers in the currency's minor unit (paise, cents). `0.1 + 0.2 !== 0.3` is a curiosity
 * in most code and a wrong number in this one, and the error compounds: every division by a group
 * size is another chance to produce `33.33333333333333`.
 *
 * The division problem does not go away by using integers, it just becomes **visible and decidable**.
 * ₹100 split three ways is 3,334 + 3,333 + 3,333 paise, and somebody has to be the one who pays the
 * extra paisa. `splitEvenly` gives the remainder to the earliest participants in a stable order, so
 * the same expense always splits the same way — an arbitrary rule, applied consistently, which is
 * the only honest option when the money does not divide.
 *
 * ---------------------------------------------------------------------------
 * "Minimal transactions" is what the roadmap asked for; this is not that, and says so
 * ---------------------------------------------------------------------------
 * `FV-008` is written as *"minimal-transaction settlement"*. **Minimising the number of transfers
 * that settle a set of debts is NP-hard** — it contains the partition problem — so an implementation
 * that runs in milliseconds and calls its answer minimal is claiming something it cannot know.
 *
 * `settle` is the standard greedy: repeatedly pay the largest creditor from the largest debtor. It
 * guarantees **at most n − 1 transfers** for n people with non-zero balances, which is both a real
 * bound and usually far better in practice. It does not guarantee the fewest possible.
 *
 * So the function is called `settle`, the result carries `optimal: false`, and `FP-012`'s rule
 * applies exactly as it did to the recommendation score: *build it properly or call it what it is*.
 * A settlement that says "minimal" while being merely good is the same class of untruth as
 * "AI-powered sorting" over a set intersection.
 */

/**
 * Split an amount across participants, in minor units, losing nothing.
 *
 * The sum of the returned shares is **exactly** `amountMinor`. That is the property worth stating,
 * because the obvious implementation — `Math.round(amount / n)` for everybody — silently creates or
 * destroys money, and a settlement built on it fails to balance for reasons nobody can find later.
 *
 * @param {number} amountMinor integer, may be negative
 * @param {string[]} participants stable order; the first few absorb the remainder
 * @returns {Map<string, number>} uid -> share in minor units
 */
const splitEvenly = (amountMinor, participants) => {
  const shares = new Map();
  if (participants.length === 0) return shares;

  // `Math.trunc` rather than `Math.floor`, so a negative amount (a refund) splits toward zero the
  // same way a positive one does. With `floor`, -100 across 3 gives -34/-33/-33 and the remainder
  // arithmetic below then has the wrong sign.
  const base = Math.trunc(amountMinor / participants.length);
  const remainder = amountMinor - base * participants.length;
  const step = remainder >= 0 ? 1 : -1;

  participants.forEach((uid, index) => {
    const extra = index < Math.abs(remainder) ? step : 0;
    shares.set(uid, base + extra);
  });

  return shares;
};

/**
 * What each person is up or down, across every expense.
 *
 * Positive means they are owed; negative means they owe. **The balances always sum to zero**, which
 * is the invariant `splitEvenly` exists to protect and the one the tests check on random input.
 *
 * @param {Array<{ paid_by: string, amount_minor: number, participants: string[] }>} expenses
 * @returns {Map<string, number>}
 */
const balances = (expenses) => {
  const net = new Map();
  const bump = (uid, delta) => net.set(uid, (net.get(uid) || 0) + delta);

  for (const expense of expenses) {
    const participants = expense.participants || [];
    if (participants.length === 0) continue;

    // The payer is credited the whole amount and debited their own share, rather than being skipped:
    // a payer who is not a participant (somebody paying for other people) then falls out correctly,
    // and a participant who did not pay needs no special case.
    bump(expense.paid_by, expense.amount_minor);
    for (const [uid, share] of splitEvenly(expense.amount_minor, participants)) {
      bump(uid, -share);
    }
  }

  return net;
};

/**
 * Turn balances into transfers.
 *
 * Greedy: largest debtor pays largest creditor, repeat. Ties are broken by uid so the output is
 * deterministic — two runs over the same expenses produce the same list, which is what makes it
 * something people can act on and re-check.
 *
 * @returns {{ transfers: Array<{ from: string, to: string, amount_minor: number }>, optimal: boolean }}
 */
const settle = (netBalances) => {
  const creditors = [];
  const debtors = [];

  for (const [uid, amount] of netBalances) {
    if (amount > 0) creditors.push({ uid, amount });
    else if (amount < 0) debtors.push({ uid, amount: -amount });
  }

  // Sorted by amount, then uid: without the second key the order of two equal balances depends on
  // Map insertion order, which depends on the order expenses were written down.
  const byAmountThenUid = (a, b) => b.amount - a.amount || a.uid.localeCompare(b.uid);
  creditors.sort(byAmountThenUid);
  debtors.sort(byAmountThenUid);

  const transfers = [];
  let c = 0;
  let d = 0;

  while (c < creditors.length && d < debtors.length) {
    const amount = Math.min(creditors[c].amount, debtors[d].amount);

    transfers.push({ from: debtors[d].uid, to: creditors[c].uid, amount_minor: amount });

    creditors[c].amount -= amount;
    debtors[d].amount -= amount;

    if (creditors[c].amount === 0) c += 1;
    if (debtors[d].amount === 0) d += 1;
  }

  return {
    transfers,
    // Stated rather than implied. See the header: minimising transfers is NP-hard, this is greedy,
    // and a caller that wants to say "minimal" in an interface must not be able to do so by
    // accident.
    optimal: false
  };
};

/** The whole answer, from raw expenses. */
const settleExpenses = (expenses) => {
  const net = balances(expenses);
  const { transfers, optimal } = settle(net);

  return {
    balances: [...net.entries()]
      .map(([user_id, amount_minor]) => ({ user_id, amount_minor }))
      .sort((a, b) => b.amount_minor - a.amount_minor || a.user_id.localeCompare(b.user_id)),
    transfers,
    optimal
  };
};

module.exports = { splitEvenly, balances, settle, settleExpenses };
