/**
 * Money, formatted the same way for everybody (`FV-008`).
 *
 * ---------------------------------------------------------------------------
 * The same trap `dateFormat.js` exists for, one type over
 * ---------------------------------------------------------------------------
 * `IMP-122` bans bare `toLocaleString` across this codebase because it silently inherits the
 * **locale and the time zone** from whatever runtime it happens to run in — which shipped `BUG-044`
 * (Node rendering "1 Jan 2026" while the browser rendered "Jan 1, 2026", failing hydration on every
 * card) and `BUG-046`.
 *
 * `Intl.NumberFormat` is not covered by that lint rule, and it has exactly the same defect: called
 * without a locale it picks up the runtime's. `₹1,00,000` in `en-IN` is `₹100,000` in `en-US` — the
 * Indian digit grouping is genuinely different, so a server-rendered amount and a client-rendered
 * one can disagree character for character. So the locale is named here, once, and no caller gets to
 * omit it.
 *
 * ---------------------------------------------------------------------------
 * Minor units in, a string out
 * ---------------------------------------------------------------------------
 * Amounts cross the wire as integers in the currency's minor unit (`019_trip_expenses.sql`), and
 * they stay integers until the moment they are displayed. This is the only place that divides, and
 * it divides for a human rather than for arithmetic — nothing computed from this value ever goes
 * back into a balance.
 */

/**
 * Pinned, for the reason above. `en-IN` because this is a product about travel in India and its
 * grouping is what a reader here expects; the point is that it is *stated* rather than inherited.
 */
const LOCALE = 'en-IN';

/**
 * How many minor units make one major unit.
 *
 * Almost every currency is 100, and the exceptions are real: JPY and KRW have no minor unit at all,
 * and a few Gulf currencies use 1000. Getting this wrong turns ¥5,000 into ¥50.00 — which looks
 * plausible, which is what makes it worth a table rather than a hardcoded 100.
 */
const MINOR_UNITS = {
  JPY: 1,
  KRW: 1,
  VND: 1,
  BHD: 1000,
  KWD: 1000,
  OMR: 1000,
  TND: 1000
};

const minorUnitsFor = (currency) => MINOR_UNITS[currency] ?? 100;

/**
 * Format an integer amount of minor units as money.
 *
 * @param {number|string} amountMinor integer, possibly negative, possibly a string from a BIGINT
 * @param {string} currency ISO 4217
 * @returns {string}
 */
export const formatMinor = (amountMinor, currency) => {
  const divisor = minorUnitsFor(currency);
  const amount = Number(amountMinor) / divisor;

  try {
    return new Intl.NumberFormat(LOCALE, {
      style: 'currency',
      currency,
      // Stated rather than inferred: with a currency style `Intl` already picks the right number of
      // digits, and saying so keeps a JPY amount from acquiring decimals if the table above is ever
      // wrong about it.
      minimumFractionDigits: divisor === 1 ? 0 : 2,
      maximumFractionDigits: divisor === 1 ? 0 : 2
    }).format(amount);
  } catch {
    // `Intl` throws on a currency code it does not recognise, and a well-formed but unknown code is
    // a data-entry error rather than a reason for a panel to disappear. The number is still the
    // useful part.
    return `${amount.toFixed(divisor === 1 ? 0 : 2)} ${currency}`;
  }
};

/** For the settlement's own sentences: an amount with no sign, since the direction is in the words. */
export const formatMinorAbs = (amountMinor, currency) =>
  formatMinor(Math.abs(Number(amountMinor)), currency);
