const {
  splitEvenly,
  balances,
  settle,
  settleExpenses
} = require('../src/services/settlementService');

/**
 * Expense settlement (`FV-008`).
 *
 * The engine is pure, so this file needs no database and can be exhaustive about the parts that
 * actually go wrong. Four of them, and only the first is obvious:
 *
 *   1. **Money is created or destroyed by rounding.** ₹100 across three people is not ₹33.33 each.
 *      The split has to sum back to exactly what was spent, every time, including for refunds.
 *   2. **Balances stop summing to zero.** Every rupee somebody is owed is a rupee somebody else
 *      owes. If that invariant breaks, the settlement is unsatisfiable and no test that checks a
 *      specific pair of people will notice.
 *   3. **The answer changes between runs.** Two people with equal balances settled in Map order
 *      means the same expenses produce different instructions on different days.
 *   4. **It claims to be optimal.** It is greedy, and minimising transfers is NP-hard. `FP-012`.
 */

const expense = (paid_by, amount_minor, participants) => ({ paid_by, amount_minor, participants });

const sum = (values) => values.reduce((total, value) => total + value, 0);

// ---------------------------------------------------------------------------
// Splitting
// ---------------------------------------------------------------------------
describe('a split loses nothing, including when it does not divide', () => {
  test('an even split is even', () => {
    const shares = splitEvenly(9000, ['a', 'b', 'c']);
    expect([...shares.values()]).toEqual([3000, 3000, 3000]);
  });

  test('a remainder is given out, not dropped', () => {
    // 10000 / 3 = 3333.33. The obvious implementation returns 3333 three times and quietly loses a
    // paisa; this is the assertion that catches that.
    const shares = splitEvenly(10000, ['a', 'b', 'c']);

    expect(sum([...shares.values()])).toBe(10000);
    expect([...shares.values()]).toEqual([3334, 3333, 3333]);
  });

  test('the same expense splits the same way every time', () => {
    // Somebody has to absorb the extra paisa. Which somebody is arbitrary; that it is the *same*
    // somebody on every run is not, or a settlement recomputed tomorrow disagrees with the one
    // people acted on today.
    const first = [...splitEvenly(10000, ['a', 'b', 'c']).entries()];
    const second = [...splitEvenly(10000, ['a', 'b', 'c']).entries()];

    expect(first).toEqual(second);
  });

  test('a refund splits toward zero, the same way a payment does', () => {
    // `Math.floor` would give -3334/-3333/-3333 and put the remainder on the wrong side.
    const shares = splitEvenly(-10000, ['a', 'b', 'c']);

    expect(sum([...shares.values()])).toBe(-10000);
    expect([...shares.values()]).toEqual([-3334, -3333, -3333]);
  });

  test('one participant takes all of it', () => {
    expect([...splitEvenly(777, ['a']).values()]).toEqual([777]);
  });

  test('nobody to split between produces nothing rather than dividing by zero', () => {
    expect(splitEvenly(1000, []).size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Balances
// ---------------------------------------------------------------------------
describe('balances always sum to zero', () => {
  test('one person paying for three', () => {
    const net = balances([expense('a', 9000, ['a', 'b', 'c'])]);

    expect(net.get('a')).toBe(6000);
    expect(net.get('b')).toBe(-3000);
    expect(net.get('c')).toBe(-3000);
    expect(sum([...net.values()])).toBe(0);
  });

  test('somebody who paid for others but did not take part', () => {
    // The payer is credited the whole amount and debited only their own share — and they have none
    // here, so they end up owed all of it. No special case needed for this, which is why the payer
    // is not skipped when the shares are applied.
    const net = balances([expense('a', 6000, ['b', 'c'])]);

    expect(net.get('a')).toBe(6000);
    expect(net.get('b')).toBe(-3000);
    expect(sum([...net.values()])).toBe(0);
  });

  test('an expense with no participants is ignored rather than crashing', () => {
    const net = balances([expense('a', 5000, [])]);
    expect(net.size).toBe(0);
  });

  test('across many uneven expenses, still exactly zero', () => {
    const net = balances([
      expense('a', 10000, ['a', 'b', 'c']),
      expense('b', 7777, ['a', 'b']),
      expense('c', 101, ['a', 'b', 'c']),
      expense('a', -500, ['a', 'b'])
    ]);

    expect(sum([...net.values()])).toBe(0);
  });

  test('a hundred random expense sets all balance', () => {
    // The invariant is the point, so it is checked against input nobody chose. A specific fixture
    // can be satisfied by an implementation that is wrong in a way the fixture happens to miss.
    const people = ['a', 'b', 'c', 'd', 'e'];
    let seed = 42;
    const random = (max) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % max;
    };

    for (let run = 0; run < 100; run++) {
      const expenses = [];
      for (let i = 0; i < 1 + random(6); i++) {
        const participants = people.filter(() => random(2) === 0);
        expenses.push(expense(people[random(people.length)], random(20000) - 2000, participants));
      }

      const net = balances(expenses);
      expect(sum([...net.values()])).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Settling
// ---------------------------------------------------------------------------
describe('the transfers actually settle the debts', () => {
  test('the simple case is one transfer', () => {
    const { transfers } = settle(
      new Map([
        ['a', 3000],
        ['b', -3000]
      ])
    );

    expect(transfers).toEqual([{ from: 'b', to: 'a', amount_minor: 3000 }]);
  });

  test('n people need at most n - 1 transfers', () => {
    // The bound greedy actually guarantees, and the one worth asserting — as opposed to minimality,
    // which it does not guarantee and does not claim.
    const net = new Map([
      ['a', 5000],
      ['b', 3000],
      ['c', -2000],
      ['d', -6000]
    ]);

    const { transfers } = settle(net);

    expect(transfers.length).toBeLessThanOrEqual(net.size - 1);
  });

  test('applying the transfers leaves everybody at zero', () => {
    // The only property that matters: after everyone pays what they are told to, nobody is owed
    // anything. Asserting the specific transfers would pin an implementation detail instead.
    const net = new Map([
      ['a', 7000],
      ['b', -1500],
      ['c', -2500],
      ['d', -3000]
    ]);

    const { transfers } = settle(new Map(net));

    const after = new Map(net);
    for (const { from, to, amount_minor } of transfers) {
      after.set(from, after.get(from) + amount_minor);
      after.set(to, after.get(to) - amount_minor);
    }

    for (const amount of after.values()) expect(amount).toBe(0);
  });

  test('nobody owing anything produces no transfers', () => {
    expect(settle(new Map([['a', 0]])).transfers).toEqual([]);
    expect(settle(new Map()).transfers).toEqual([]);
  });

  test('equal balances settle deterministically', () => {
    // Two creditors owed the same amount: without the uid tiebreak the order depends on Map
    // insertion, which depends on the order the expenses happened to be written down.
    const build = () =>
      new Map([
        ['b', 1000],
        ['a', 1000],
        ['c', -2000]
      ]);

    expect(settle(build()).transfers).toEqual(settle(build()).transfers);
    expect(settle(build()).transfers[0].to).toBe('a');
  });
});

// ---------------------------------------------------------------------------
// What it refuses to claim
// ---------------------------------------------------------------------------
describe('it does not claim to be optimal', () => {
  test('the result says so, in the payload rather than in a comment', () => {
    // `FV-008` asks for "minimal-transaction settlement". Minimising transfers is NP-hard, so a
    // greedy answer that called itself minimal would be the "AI-powered sorting" problem in a new
    // place — `FP-012`. The flag is what stops an interface saying it by accident.
    const { optimal } = settleExpenses([expense('a', 9000, ['a', 'b', 'c'])]);

    expect(optimal).toBe(false);
  });

  test('the whole answer is ordered, so two reads agree', () => {
    const expenses = [expense('a', 10000, ['a', 'b', 'c']), expense('b', 3000, ['a', 'b'])];

    expect(settleExpenses(expenses)).toEqual(settleExpenses(expenses));
  });

  test('balances come back sorted, creditors first', () => {
    const { balances: sorted } = settleExpenses([expense('a', 9000, ['a', 'b', 'c'])]);

    expect(sorted[0].user_id).toBe('a');
    expect(sorted[0].amount_minor).toBeGreaterThan(0);
  });
});
