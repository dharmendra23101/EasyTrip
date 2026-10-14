/**
 * Which calendar date a trip day falls on (`BUG-058`).
 *
 * ---------------------------------------------------------------------------
 * The defect this replaces, and why it was invisible
 * ---------------------------------------------------------------------------
 * The version this supersedes lived in `pages/trips/[id].jsx` and did its arithmetic in **local**
 * time:
 *
 *     const date = new Date(trip.start_date);        // 'YYYY-MM-DD' parses as UTC midnight
 *     date.setDate(date.getDate() + dayNumber - 1);  // ...but this is the LOCAL day-of-month
 *     return date.toISOString().slice(0, 10);        // ...and this reads it back as UTC
 *
 * `setDate` preserves the *local* time of day while moving the date, so the result is only correct
 * while the UTC offset stays put. **It does not stay put across a daylight-saving transition**, and
 * the shift is enough to cross midnight in UTC — so every day after the transition renders as the
 * day before.
 *
 * Measured, not reasoned about, for a trip starting 2026-03-01:
 *
 *   | zone                | wrong days (of 120) | first wrong |
 *   |---------------------|---------------------|-------------|
 *   | America/Los_Angeles | 112                 | day 9       |
 *   | Europe/London       | 91                  | day 30      |
 *   | Europe/Lisbon       | 91                  | day 30      |
 *   | Asia/Kolkata        | 0                   | -           |
 *
 * India has no daylight saving, which is why this survived every manual check made here and why the
 * table above is the whole explanation. It is the `BUG-050`/`BUG-051` family a third time: **a
 * calendar date is not an instant, and giving it a time of day invents a timezone question the value
 * never had an answer to.**
 *
 * ---------------------------------------------------------------------------
 * The fix
 * ---------------------------------------------------------------------------
 * Do the arithmetic entirely in UTC, where every day is exactly 86,400 seconds and no offset exists
 * to change. `Date.UTC` handles the month and year rollovers, so this file does not need to know how
 * long February is. The backend's `icsService.addDays` is the same shape for the same reason - that
 * one was written correctly first time because RFC 5545 forced the question into the open.
 */

/**
 * The date of a trip's nth day, as `YYYY-MM-DD`.
 *
 * @param {Object} trip        needs `start_date` as `YYYY-MM-DD` (what the API sends)
 * @param {number} dayNumber   1-based, so day 1 *is* the start date
 * @returns {string|null} `null` when the trip has no start date - a real state, and the reason this
 *   returns a value the caller must check rather than a fallback that would put an invented date on
 *   somebody's itinerary.
 */
export const dayDate = (trip, dayNumber) => {
  if (!trip?.start_date) return null;

  const [year, month, day] = String(trip.start_date).slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return null;

  // `day + dayNumber - 1` rather than a separate add: `Date.UTC` normalises an out-of-range day into
  // the following month, so nothing here has to know that March has 31 days.
  const date = new Date(Date.UTC(year, month - 1, day + dayNumber - 1));
  if (Number.isNaN(date.getTime())) return null;

  return date.toISOString().slice(0, 10);
};

export default dayDate;
