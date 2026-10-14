/**
 * A trip as an iCalendar file (`FV-009` stage a, RFC 5545).
 *
 * ---------------------------------------------------------------------------
 * Why `.ics` first, and why it is a real feature rather than a stringify
 * ---------------------------------------------------------------------------
 * `FV-009` puts `.ics` before Google Calendar OAuth because it needs **no third party at all**: the
 * file is generated here and opened by whatever the traveller already uses. What it does need is the
 * format to be right, and iCalendar has three ways to be quietly wrong that a naive template hits
 * immediately - escaping, folding, and time zones. Each is handled below and each has a test.
 *
 * ---------------------------------------------------------------------------
 * The time zone question, which this schema already answered
 * ---------------------------------------------------------------------------
 * `trip_items.start_time` is a `TIME`, deliberately: *"an itinerary says 10:00, meaning ten in the
 * morning where the traveller is standing"* (`ADR-031`). A `TIMESTAMPTZ` would anchor it to a zone
 * and shift it for anyone reading from elsewhere.
 *
 * iCalendar has exactly the right construct for that and it is the least-used one: a **floating
 * time** - `DTSTART:20260301T100000`, with no `Z` and no `TZID`. RFC 5545 §3.3.5 defines it as local
 * time in whatever zone the *viewer* is in, which is precisely what the column means. The tempting
 * alternatives are both wrong:
 *
 *   - `...T100000Z` claims the stop is at 10:00 UTC, so it lands at 15:30 for a traveller reading in
 *     India - the `BUG-050`/`BUG-051` class of defect, exported.
 *   - `TZID=Asia/Kolkata` invents a zone the database never recorded and would be wrong for every
 *     trip outside it.
 *
 * ---------------------------------------------------------------------------
 * What is exported, and what is honestly skipped
 * ---------------------------------------------------------------------------
 * A day becomes a date by counting from `trips.start_date`. **A trip with no start date exports
 * nothing**, and that is the honest answer rather than a failure: an itinerary that is not on any
 * date cannot be put on a calendar, and picking today would place somebody's plans on days they
 * never chose.
 */

/** RFC 5545 requires CRLF between content lines, not LF. Some parsers are lenient; not all are. */
const CRLF = '\r\n';

/**
 * Escape a TEXT value (RFC 5545 §3.3.11).
 *
 * **The backslash must be replaced first**, or the backslashes this function itself inserts get
 * escaped a second time and every comma in the file arrives as `\\,`.
 *
 * Without this a title as ordinary as *"Hampi, then Badami"* ends the value at the comma and the
 * rest becomes a malformed parameter - the file opens, and the event is silently wrong or missing.
 */
const escapeText = (value) =>
  String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    // A literal newline inside a value would be read as the start of the next property. `\n` is the
    // encoding RFC 5545 defines for it. Carriage returns are dropped rather than escaped, so a
    // Windows-typed note does not arrive with a blank line between every line.
    .replace(/\r\n|\r|\n/g, '\\n');

/**
 * Fold a content line to 75 octets (RFC 5545 §3.1).
 *
 * **Measured in octets, not characters**, which is why this counts `Buffer.byteLength` rather than
 * `.length`: a note containing "café" or an emoji is longer on the wire than it looks, and a
 * character-counted fold produces lines that are still too long.
 *
 * The continuation is CRLF followed by a **single space**, which the parser removes on unfolding. A
 * multi-byte character must never be split across the boundary - a half-character is not valid UTF-8
 * and the parser is entitled to reject the whole file - so this walks by code point and breaks
 * before the character that would cross 75.
 */
const foldLine = (line) => {
  if (Buffer.byteLength(line, 'utf8') <= 75) return line;

  const parts = [];
  let current = '';
  // A continuation line carries one leading space, so it has one octet less room for content.
  let limit = 75;

  for (const character of line) {
    const size = Buffer.byteLength(character, 'utf8');
    if (Buffer.byteLength(current, 'utf8') + size > limit) {
      parts.push(current);
      current = '';
      limit = 74;
    }
    current += character;
  }
  parts.push(current);

  return parts.join(`${CRLF} `);
};

/** `2026-03-01` plus n days, as `YYYYMMDD`. Built in UTC so no local zone can shift the date. */
const addDays = (isoDate, offset) => {
  const [year, month, day] = String(isoDate).slice(0, 10).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + offset));

  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
};

/** `10:00:00` -> `100000`. Postgres returns `TIME` as `HH:MM:SS`. */
const compactTime = (time) => String(time).slice(0, 8).replace(/:/g, '');

/**
 * A stable, globally unique id for an event (RFC 5545 §3.8.4.7).
 *
 * Stable is the important half: re-importing the file must **update** the event rather than create a
 * second copy of it, and that is decided entirely by whether the `UID` matches. Deriving it from the
 * item's primary key means a trip exported twice produces the same ids both times, which a random
 * one would not.
 */
const uid = (itemId) => `trip-item-${itemId}@easytrip`;

/**
 * `DTSTAMP` — when this file was generated, which RFC 5545 requires on every event.
 *
 * This one **is** in UTC, correctly: it is an instant in real time rather than a wall-clock time in
 * the traveller's day, so the distinction the rest of this module makes does not apply to it.
 */
const stamp = (now) => `${now.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;

/**
 * One VEVENT per item.
 *
 * An item **with a start time** becomes a timed event in floating time. An item **without one**
 * becomes an all-day event on its day: `VALUE=DATE`, with `DTEND` on the following day because RFC
 * 5545 makes the end exclusive. Getting that off by one is how a one-day event renders as zero-length
 * and disappears from the grid.
 */
const buildEvent = (item, date, now) => {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${uid(item.id)}`,
    `DTSTAMP:${stamp(now)}`,
    `SUMMARY:${escapeText(item.title)}`
  ];

  if (item.start_time) {
    lines.push(`DTSTART:${date}T${compactTime(item.start_time)}`);
    // Only when it is present. An open-ended stop is a real thing an itinerary says, and inventing a
    // duration to fill the field would put a length on the calendar that nobody planned.
    if (item.end_time) lines.push(`DTEND:${date}T${compactTime(item.end_time)}`);
  } else {
    lines.push(`DTSTART;VALUE=DATE:${date}`);
    lines.push(`DTEND;VALUE=DATE:${addDays(dateToIso(date), 1)}`);
  }

  // The place, when the item has one. `LOCATION` is what a phone offers to navigate to, so the
  // human-readable name and area are more useful here than coordinates.
  const location = [item.place_name, item.place_location].filter(Boolean).join(', ');
  if (location) lines.push(`LOCATION:${escapeText(location)}`);

  if (item.notes) lines.push(`DESCRIPTION:${escapeText(item.notes)}`);

  lines.push('END:VEVENT');
  return lines;
};

/** `20260301` -> `2026-03-01`, so `addDays` can take it back. */
const dateToIso = (compact) =>
  `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;

/**
 * A trip workspace as an iCalendar document.
 *
 * @param {Object} trip  the shape `tripModel.getTripWorkspace` returns
 * @param {Date}   [now] injected so a test can assert `DTSTAMP` rather than tolerate it
 * @returns {string|null} the file, or `null` when the trip has no start date and therefore no
 *   position on any calendar. `null` rather than an empty calendar: a file containing no events
 *   looks like a working export of an empty trip.
 */
const buildTripCalendar = (trip, now = new Date()) => {
  if (!trip?.start_date) return null;

  const events = [];
  for (const day of trip.days ?? []) {
    // `day_number` is 1-based, so day 1 is the start date itself and the offset is one less.
    const date = addDays(trip.start_date, day.day_number - 1);
    for (const item of day.items ?? []) {
      events.push(...buildEvent(item, date, now));
    }
  }

  // No events is not the same as no start date, and it is exported: a trip with dates and no stops
  // yet is a calendar somebody can add to, and refusing it would be refusing a valid trip.
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    // RFC 5545 requires PRODID to identify the software that made the file.
    'PRODID:-//EasyTrip//Trip Export//EN',
    // The itinerary is a plan, not an invitation to negotiate.
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(trip.title)}`,
    ...events,
    'END:VCALENDAR'
  ];

  // Folded last, so folding applies to finished content lines rather than to fragments that are
  // later concatenated - folding a fragment inserts a break in the middle of a property name.
  return lines.map(foldLine).join(CRLF) + CRLF;
};

/**
 * A filename a traveller can find again.
 *
 * Everything outside `[A-Za-z0-9-]` becomes a hyphen. This is not cosmetic: the value goes into a
 * `Content-Disposition` header, where a quote or a newline in a user-supplied title would let the
 * caller inject a header - the trip title is attacker-controlled in exactly the way a header value
 * must not be.
 */
const calendarFilename = (title) => {
  const slug = String(title ?? 'trip')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug || 'trip'}.ics`;
};

module.exports = { buildTripCalendar, calendarFilename, escapeText, foldLine };
