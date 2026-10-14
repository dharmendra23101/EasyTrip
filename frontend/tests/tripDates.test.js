import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { dayDate } from '../src/utils/tripDates';

/**
 * Which calendar date a trip day falls on (`BUG-058`).
 *
 * **This suite runs in `America/Los_Angeles`** (`jest.env.js`), which is not incidental — it is the
 * zone the defect reproduces in. The version this replaces did its arithmetic in local time with
 * `setDate`, which preserves the local time of day while moving the date. That is fine until the UTC
 * offset changes, and then it is off by a whole day: measured on a trip starting 2026-03-01, **112 of
 * the first 120 days rendered as the day before** in this zone, beginning at the US daylight-saving
 * transition on day 9.
 *
 * It was invisible for as long as it was because India, where this project is developed and checked,
 * has no daylight saving at all — `Asia/Kolkata` agrees with the correct answer on every one of those
 * 120 days. So the guard that matters is not any single assertion below but the fact that the suite
 * runs somewhere with DST, and `dateFormat.test.js` already fails loudly if that ever stops being
 * true.
 */

const TRIP = { start_date: '2026-03-01' };

describe('the environment this test needs', () => {
  test('runs in a zone that observes daylight saving, or the suite below proves nothing', () => {
    // Guarding the guard, the same way `dateFormat.test.js` does. In a zone with no DST every
    // assertion here passes against the *broken* implementation too.
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(zone).toBe('America/Los_Angeles');

    const january = new Date('2026-01-15T12:00:00Z').getTimezoneOffset();
    const july = new Date('2026-07-15T12:00:00Z').getTimezoneOffset();
    expect(january).not.toBe(july);
  });
});

/**
 * The one property no in-process assertion can check.
 *
 * **This suite runs in exactly one zone, and that is the blind spot `BUG-058` came through.** The
 * broken implementation was invisible because development happens in `Asia/Kolkata`, which has no
 * DST. Running the tests in `America/Los_Angeles` catches *that* mistake — and introduces the mirror
 * image of it, because a different wrong implementation is invisible here:
 *
 *     new Date(year, month - 1, day).toISOString().slice(0, 10)   // local construction
 *
 * Local midnight in a zone **behind** UTC is 07:00-08:00 the same UTC day, so this agrees with the
 * correct answer on every date in Los Angeles. Measured in zones **ahead** of UTC it is wrong on all
 * 60 days of a 60-day trip (`Asia/Kolkata`, `Australia/Sydney`) — off by one, every time.
 *
 * So the property under test is not "the answer is X" but **"the answer does not depend on the
 * machine's time zone"**, and checking it means evaluating the helper somewhere else. That is what
 * the subprocess below is for. It reads the real source file rather than a copy — the only change is
 * turning ESM exports into CommonJS ones, because this package is CommonJS and a subprocess cannot
 * `require` an ES module.
 */
describe('the answer does not depend on the machine it is computed on', () => {
  const SOURCE = join(__dirname, '../src/utils/tripDates.js');

  /** Run `dayDate` for days 1..n under a given zone, in a separate process. */
  const datesUnder = (timeZone, startDate, count) => {
    const dir = mkdtempSync(join(tmpdir(), 'tripdates-'));
    const modulePath = join(dir, 'tripDates.cjs');

    // The real file, with only its module syntax rewritten. Copying the *logic* into this test
    // would test the copy, which is precisely the mistake that makes a guard useless.
    writeFileSync(
      modulePath,
      readFileSync(SOURCE, 'utf8')
        .replace('export const dayDate', 'const dayDate')
        .replace('export default dayDate;', 'module.exports = { dayDate };')
    );

    const script = join(dir, 'run.cjs');
    writeFileSync(
      script,
      `const { dayDate } = require(${JSON.stringify(modulePath)});
       const out = [];
       for (let n = 1; n <= ${count}; n += 1) out.push(dayDate({ start_date: ${JSON.stringify(startDate)} }, n));
       process.stdout.write(JSON.stringify(out));`
    );

    return JSON.parse(
      execFileSync(process.execPath, [script], {
        env: { ...process.env, TZ: timeZone },
        encoding: 'utf8'
      })
    );
  };

  test('four zones on four continents agree, day for day', () => {
    // `Asia/Kolkata` and `Australia/Sydney` are ahead of UTC, where local construction is wrong on
    // every day; `Europe/London` changes offset mid-trip; `Pacific/Kiritimati` is UTC+14, the
    // furthest ahead there is.
    const reference = datesUnder('UTC', '2026-03-01', 120);

    ['Asia/Kolkata', 'Australia/Sydney', 'Europe/London', 'Pacific/Kiritimati'].forEach((zone) => {
      expect({ zone, dates: datesUnder(zone, '2026-03-01', 120) }).toEqual({
        zone,
        dates: reference
      });
    });
  });

  test('the reference itself is right, so agreement is not agreement on a wrong answer', () => {
    // Four zones agreeing proves independence, not correctness — they could agree on nonsense.
    const reference = datesUnder('UTC', '2026-03-01', 120);

    expect(reference[0]).toBe('2026-03-01');
    expect(reference[8]).toBe('2026-03-09');
    expect(reference[119]).toBe('2026-06-28');
  });
});

describe('a day number becomes the date it actually falls on', () => {
  test('day 1 is the start date itself', () => {
    expect(dayDate(TRIP, 1)).toBe('2026-03-01');
  });

  test('the day before the transition is unaffected', () => {
    // 2026-03-08 is when the US clocks go forward. Day 8 is the last one the old version got right.
    expect(dayDate(TRIP, 8)).toBe('2026-03-08');
  });

  test('the day the clocks change is not the day before', () => {
    // The exact assertion the old implementation fails: it returned 2026-03-08 for day 9.
    expect(dayDate(TRIP, 9)).toBe('2026-03-09');
  });

  test('every day of a long trip is one more than the last, across two transitions', () => {
    // A 300-day span crosses both the March transition and November's. Checking the *sequence*
    // rather than a handful of dates is what makes this a guard against the class rather than
    // against two known-bad days.
    const dates = Array.from({ length: 300 }, (unused, index) => dayDate(TRIP, index + 1));

    dates.forEach((date, index) => {
      if (index === 0) return;
      const previous = Date.parse(`${dates[index - 1]}T00:00:00Z`);
      expect(Date.parse(`${date}T00:00:00Z`) - previous).toBe(86_400_000);
    });
  });

  test('month and year rollovers are handled by Date.UTC, not by counting days in February', () => {
    expect(dayDate({ start_date: '2026-02-27' }, 3)).toBe('2026-03-01');
    // 2028 is a leap year, so day 3 from 27 February is the 29th.
    expect(dayDate({ start_date: '2028-02-27' }, 3)).toBe('2028-02-29');
    expect(dayDate({ start_date: '2026-12-30' }, 3)).toBe('2027-01-01');
  });
});

describe('what has no date has no date', () => {
  test('a trip with no start date returns null, not today', () => {
    // The reason this returns a value the caller must check: a fallback would put an invented date
    // on somebody's itinerary, which is the thing every honest-data rule in this project forbids.
    expect(dayDate({ start_date: null }, 1)).toBeNull();
    expect(dayDate({}, 1)).toBeNull();
    expect(dayDate(undefined, 1)).toBeNull();
  });

  test('an unparseable start date returns null rather than "Invalid Date"', () => {
    expect(dayDate({ start_date: 'not-a-date' }, 1)).toBeNull();
    expect(dayDate({ start_date: '' }, 1)).toBeNull();
  });

  test('year zero is refused rather than silently becoming 1900', () => {
    // `Date.UTC` maps a two-digit year onto 1900-1999, so `Date.UTC(0, 0, 1)` is 1900-01-01 — an
    // invented date, confidently rendered. The `!year` guard is what stops it, and mutation `T4`
    // (which removes that guard) survived every other assertion in this file.
    expect(dayDate({ start_date: '0000-01-01' }, 1)).toBeNull();
  });

  test('a timestamptz-shaped value is accepted, because the API has sent one before', () => {
    // `to_char(...)` gives 'YYYY-MM-DD' today, but `BUG-050` was exactly a date arriving with a time
    // attached. Truncating rather than trusting costs nothing.
    expect(dayDate({ start_date: '2026-03-01T00:00:00.000Z' }, 9)).toBe('2026-03-09');
  });
});
