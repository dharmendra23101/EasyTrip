/**
 * Date formatting, in one place (IMP-122, partial).
 *
 * Five copies of a `formatDate` existed across the frontend, and no two agreed. **All five are now
 * here**, as named functions rather than one with an options bag: they differ in precision, in
 * month width, AND in what they return for missing input, and each of those is a property of the
 * caller rather than a preference.
 *
 * The header used to end *"`PlaceCard.jsx` and `admin/users.jsx` still carry their own — the rest
 * of `IMP-122`"*, and had outlived that by two sprints: `admin/users.jsx` imports
 * `formatDateShort`, and `PlaceCard` delegates to `formatRelativeOrShort` below. A comment naming
 * work that is finished sends the next reader to fix something that is not broken.
 *
 * One deliberate exception exists app-wide, and it is not a straggler: `BrowseFilterPanel` formats
 * the *reader's own* "today" in the reader's zone, which is the opposite requirement to everything
 * here. It is lint-suppressed at the line with its reason attached.
 *
 * **All three name their locale and their time zone.** Anything left to the runtime differs
 * between Node and the browser, which is how `BUG-044` (locale) and `BUG-046` (zone) happened.
 */

/** UTC, deliberately: a rendered date must not depend on who is looking at it. */
const ZONE = 'UTC';

/**
 * A date as editorial prose — "January 1, 2026" — or `null`.
 *
 * `null` rather than a placeholder string, because every caller renders it inside `{x && …}`.
 */
export const formatDate = (dateString) => {
  if (!dateString) return null;
  // Same reason as `formatDateTime`: bad input yields the literal string "Invalid Date" rather
  // than an exception, and rendering that in an article byline would be worse than rendering
  // nothing. (Pre-existing behaviour — this guard is new, the callers all use `{x && …}`.)
  const parsed = new Date(dateString);
  if (Number.isNaN(parsed.getTime())) return null;
  try {
    return parsed.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: ZONE
    });
  } catch {
    return null;
  }
};

/**
 * The short weekday of a calendar date — "Mon" — or `null`.
 *
 * Added for the weather forecast strip (`IMP-110`), which labels seven columns and has no room for
 * a full date. Noon is substituted for the missing time before parsing: a bare `YYYY-MM-DD` is
 * interpreted as UTC midnight, which lands on the previous day for anyone behind UTC and would
 * label Tuesday's forecast "Mon" — `BUG-046` in a new place. Midday is far enough from both
 * boundaries that no zone can move it.
 */
export const formatWeekdayShort = (dateString) => {
  if (!dateString) return null;
  const parsed = new Date(`${dateString}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  try {
    return parsed.toLocaleDateString('en-US', { weekday: 'short', timeZone: ZONE });
  } catch {
    return null;
  }
};

/**
 * A compact date — "Jan 1, 2026" — or `'N/A'`.
 *
 * For dense tables, where a long month name pushes the column wide and the reader is scanning
 * rather than reading. `'N/A'` rather than `null` for the same reason `formatDateTime` uses it:
 * a blank table cell is indistinguishable from a real empty value.
 */
export const formatDateShort = (dateString) => {
  if (!dateString) return 'N/A';
  const parsed = new Date(dateString);
  if (Number.isNaN(parsed.getTime())) return 'Invalid Date';
  try {
    return parsed.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: ZONE
    });
  } catch {
    return 'Invalid Date';
  }
};

/**
 * "Today", "Yesterday", "3 days ago" — or the compact date, once it is a week old.
 *
 * ---------------------------------------------------------------------------
 * `now` is a parameter, and that is the whole point (`BUG-059`)
 * ---------------------------------------------------------------------------
 * This logic lived inside `PlaceCard.jsx` and read `Date.now()` **during render**, which made a
 * server-rendered component's output a function of *when* it rendered. The card ships on an ISR
 * page (`revalidate: 300`), so cached markup could say "Yesterday" while the hydrating browser
 * computed "Today" — the `BUG-044` / `BUG-046` hydration family a third time. Those two were the
 * locale and the time zone inherited from the runtime, and the rule in `eslint.config.mjs` now
 * prevents both; this one is the **clock**, which that rule cannot see.
 *
 * Taking `now` as an argument makes the function pure, which is what makes it testable at a
 * boundary instead of only near one. The caller decides where the clock comes from, and
 * `PlaceCard` reads it after mount so that the server and the first client render agree.
 *
 * ---------------------------------------------------------------------------
 * Why the fallback is `formatDateShort` and not a second opinion
 * ---------------------------------------------------------------------------
 * Anything older than a week is the shared formatter's answer, unchanged. `dateFormat.js`'s header
 * named `PlaceCard.jsx` as one of two modules still carrying their own date logic — *"the rest of
 * `IMP-122`"*. This is half of that debt paid: the relative branch is here now, next to the
 * absolute one, pinned to the same locale and the same zone.
 *
 * @param {String|null|undefined} dateString
 * @param {Number} now - epoch milliseconds; injected, never read from the clock in here
 * @returns {String}
 */
export const formatRelativeOrShort = (dateString, now) => {
  if (!dateString) return formatDateShort(dateString);
  const parsed = new Date(dateString);
  if (Number.isNaN(parsed.getTime())) return formatDateShort(dateString);

  // No clock supplied — the server, or a client that has not mounted yet. The absolute date is the
  // honest answer for both, and it is what makes the two renders identical.
  if (typeof now !== 'number' || Number.isNaN(now)) return formatDateShort(dateString);

  // `floor`, not `ceil` (`BUG-060`). Over a *millisecond* difference `ceil` rounds any non-zero
  // elapsed time up to a whole day, so a row six hours old reported 1 and rendered "Yesterday",
  // and `'Today'` needed `now` to equal the timestamp exactly — an unreachable branch. `floor`
  // makes the count mean "whole days elapsed", which is what all three labels already claim.
  const diffDays = Math.floor(Math.abs(now - parsed.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays >= 7) return formatDateShort(dateString);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return `${diffDays} days ago`;
};

/**
 * A timestamp with its time — "January 1, 2026 at 10:30 AM UTC".
 *
 * Separate from `formatDate` rather than an option, because the two differ in what they return
 * for missing input as well as in precision. This one is for audit trails (created/updated by
 * whom, when), where dropping the time loses the thing the row is for, and where a blank cell
 * would be indistinguishable from a real empty value — hence `'N/A'`.
 *
 * The zone is named in the output because an admin comparing this against a server log needs to
 * know which clock it is.
 */
export const formatDateTime = (dateString) => {
  if (!dateString) return 'N/A';
  // An unparseable string does NOT throw: `new Date('x').toLocaleString(...)` returns the string
  // "Invalid Date". So the catch below never fires for bad input, and appending " UTC"
  // unconditionally produced "Invalid Date UTC". Check the date itself instead.
  const parsed = new Date(dateString);
  if (Number.isNaN(parsed.getTime())) return 'Invalid Date';
  try {
    return `${parsed.toLocaleString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hour12: true,
      timeZone: ZONE
    })} UTC`;
  } catch {
    return 'Invalid Date';
  }
};
