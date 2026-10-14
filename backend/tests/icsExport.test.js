const request = require('supertest');
const app = require('../app');
const { createSchema, resetData, closeDb, resetRateLimits } = require('./helpers/testDb');
const { authHeader } = require('./helpers/firebaseMock');
const { buildTripCalendar, foldLine, escapeText } = require('../src/services/icsService');

/**
 * Trip export as iCalendar (`FV-009` stage a, RFC 5545).
 *
 * **The interesting failures here are all in the format, not in the data.** A `.ics` file that is
 * subtly malformed does not error: the calendar application opens it, silently drops the events it
 * could not parse, and the traveller finds out at the airport. So this suite is mostly about the
 * three ways iCalendar is quietly wrong —
 *
 *   1. **Escaping.** A title as ordinary as "Hampi, then Badami" ends the value at the comma.
 *   2. **Folding.** Content lines are limited to 75 **octets**, and a multi-byte character split
 *      across the boundary is invalid UTF-8.
 *   3. **Time zones.** `trip_items.start_time` is a `TIME` meaning "ten in the morning where the
 *      traveller is standing" (`ADR-031`). Exporting it as UTC shifts every stop.
 *
 * — and the rest is about refusing to export what cannot honestly be exported.
 */

const USER = { uid: 'seed-user-uid' };
const OTHER = { uid: 'seed-other-uid' };
const asUser = { Authorization: authHeader(USER) };
const asOther = { Authorization: authHeader(OTHER) };

const NOW = new Date('2026-02-01T09:30:00Z');

/** The shape `getTripWorkspace` returns, built by hand so a test can vary exactly one thing. */
const tripWith = (items, overrides = {}) => ({
  id: 1,
  title: 'Karnataka in March',
  start_date: '2026-03-01',
  days: [{ id: 10, day_number: 1, items }],
  ...overrides
});

const lines = (ics) => ics.split('\r\n');

beforeAll(async () => {
  await createSchema();
});
beforeEach(async () => {
  await resetData();
  resetRateLimits(app);
});
afterAll(async () => {
  await closeDb();
});

// ---------------------------------------------------------------------------
// 1 — escaping
// ---------------------------------------------------------------------------
describe('a comma in a title does not end the value', () => {
  test('commas, semicolons and backslashes are escaped', () => {
    expect(escapeText('Hampi, then Badami')).toBe('Hampi\\, then Badami');
    expect(escapeText('a;b')).toBe('a\\;b');
    expect(escapeText('a\\b')).toBe('a\\\\b');
  });

  test('the backslash is escaped first, or every comma arrives doubled', () => {
    // The ordering bug: escape commas first and the backslash pass then escapes the backslash this
    // function just inserted, producing `\\,` for every comma in the file.
    expect(escapeText('a\\,b')).toBe('a\\\\\\,b');
  });

  test('a newline becomes the two-character escape, not a real line break', () => {
    // A literal newline inside a value is read as the start of the next property.
    expect(escapeText('one\ntwo')).toBe('one\\ntwo');
    expect(escapeText('one\r\ntwo')).toBe('one\\ntwo');
  });

  test('an escaped title survives into the file as one line', () => {
    const ics = buildTripCalendar(
      tripWith([{ id: 1, title: 'Hampi, then Badami', start_time: '10:00:00' }]),
      NOW
    );

    expect(lines(ics)).toContain('SUMMARY:Hampi\\, then Badami');
  });
});

// ---------------------------------------------------------------------------
// 2 — folding
// ---------------------------------------------------------------------------
describe('no content line exceeds 75 octets', () => {
  test('a long line is folded with CRLF and a single space', () => {
    const folded = foldLine(`SUMMARY:${'x'.repeat(200)}`);

    folded.split('\r\n').forEach((line) => {
      expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
    });
    // Every continuation begins with the one space the parser strips on unfolding.
    folded
      .split('\r\n')
      .slice(1)
      .forEach((line) => expect(line.startsWith(' ')).toBe(true));
  });

  test('a short line is left alone', () => {
    expect(foldLine('SUMMARY:Hampi')).toBe('SUMMARY:Hampi');
  });

  test('folding counts octets, not characters, and never splits one', () => {
    // "café" and an emoji are longer on the wire than `.length` suggests. A character-counted fold
    // produces over-long lines; a byte-counted one that cuts mid-character produces invalid UTF-8.
    const folded = foldLine(`SUMMARY:${'é'.repeat(60)}🚌`);

    folded.split('\r\n').forEach((line) => {
      expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
    });
    // Round-trips: unfolding restores exactly the input, which a split character would not.
    expect(folded.replace(/\r\n /g, '')).toBe(`SUMMARY:${'é'.repeat(60)}🚌`);
  });

  test('every line of a real export is within the limit', () => {
    const ics = buildTripCalendar(
      tripWith([
        {
          id: 1,
          title: 'A stop with a deliberately very long name that will certainly need folding',
          notes: 'And a note that is also long enough to require the parser to unfold it again.',
          start_time: '10:00:00',
          place_name: 'Virupaksha Temple',
          place_location: 'Hampi'
        }
      ]),
      NOW
    );

    lines(ics).forEach((line) => expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75));
  });
});

// ---------------------------------------------------------------------------
// 3 — the time zone, which the schema already decided
// ---------------------------------------------------------------------------
describe('a time is floating, because the column means "where the traveller is standing"', () => {
  test('a timed stop carries no Z and no TZID', () => {
    // `...T100000Z` would place a 10:00 stop at 15:30 for a reader in India — `BUG-050` exported.
    const ics = buildTripCalendar(
      tripWith([{ id: 1, title: 'Hampi', start_time: '10:00:00', end_time: '12:30:00' }]),
      NOW
    );

    expect(lines(ics)).toContain('DTSTART:20260301T100000');
    expect(lines(ics)).toContain('DTEND:20260301T123000');
    expect(ics).not.toMatch(/DTSTART[^\r\n]*Z/);
    expect(ics).not.toMatch(/TZID/);
  });

  test('DTSTAMP is in UTC, because it is an instant rather than a wall clock', () => {
    // The one value in the file that genuinely is a moment in real time.
    const ics = buildTripCalendar(tripWith([{ id: 1, title: 'Hampi' }]), NOW);
    expect(lines(ics)).toContain('DTSTAMP:20260201T093000Z');
  });

  test('an untimed stop is an all-day event whose end is the next day', () => {
    // RFC 5545 makes DTEND exclusive. Off by one and a one-day event has zero length and vanishes
    // from the grid entirely.
    const ics = buildTripCalendar(tripWith([{ id: 1, title: 'Hampi' }]), NOW);

    expect(lines(ics)).toContain('DTSTART;VALUE=DATE:20260301');
    expect(lines(ics)).toContain('DTEND;VALUE=DATE:20260302');
  });

  test('an open-ended stop gets no invented end time', () => {
    // A stop with no end is a real thing an itinerary says. Filling it in would put a duration on
    // the calendar that nobody planned.
    const ics = buildTripCalendar(
      tripWith([{ id: 1, title: 'Hampi', start_time: '10:00:00' }]),
      NOW
    );

    expect(ics).toContain('DTSTART:20260301T100000');
    expect(ics).not.toMatch(/DTEND/);
  });
});

// ---------------------------------------------------------------------------
// Dates, days and structure
// ---------------------------------------------------------------------------
describe('a day becomes a date by counting from the start', () => {
  test('day 1 is the start date itself', () => {
    const ics = buildTripCalendar(tripWith([{ id: 1, title: 'Hampi' }]), NOW);
    expect(ics).toContain('DTSTART;VALUE=DATE:20260301');
  });

  test('later days count forward, and the count crosses a month end', () => {
    // Built in UTC so no local zone can shift a date, and arithmetic rather than string work so
    // February's length is not something this file has to know.
    const trip = {
      id: 1,
      title: 'Long trip',
      start_date: '2026-02-27',
      days: [
        { id: 1, day_number: 1, items: [{ id: 1, title: 'First' }] },
        { id: 2, day_number: 3, items: [{ id: 2, title: 'Third' }] }
      ]
    };

    const ics = buildTripCalendar(trip, NOW);
    expect(ics).toContain('DTSTART;VALUE=DATE:20260227');
    expect(ics).toContain('DTSTART;VALUE=DATE:20260301');
  });

  test('the envelope carries what RFC 5545 requires', () => {
    const ics = buildTripCalendar(tripWith([{ id: 1, title: 'Hampi' }]), NOW);
    const all = lines(ics);

    expect(all[0]).toBe('BEGIN:VCALENDAR');
    expect(all).toContain('VERSION:2.0');
    expect(all).toContain('PRODID:-//EasyTrip//Trip Export//EN');
    expect(all.filter((line) => line !== '').pop()).toBe('END:VCALENDAR');
    // CRLF throughout, not LF. Some parsers are lenient; not all are.
    expect(ics).not.toMatch(/[^\r]\n/);
  });

  test('a UID is stable across exports, so re-importing updates rather than duplicates', () => {
    const first = buildTripCalendar(tripWith([{ id: 42, title: 'Hampi' }]), NOW);
    const second = buildTripCalendar(tripWith([{ id: 42, title: 'Hampi' }]), new Date());

    expect(first).toContain('UID:trip-item-42@easytrip');
    expect(second).toContain('UID:trip-item-42@easytrip');
  });

  test('a place becomes a LOCATION a phone can navigate to', () => {
    const ics = buildTripCalendar(
      tripWith([
        { id: 1, title: 'Sunrise', place_name: 'Virupaksha Temple', place_location: 'Hampi' }
      ]),
      NOW
    );

    expect(ics).toContain('LOCATION:Virupaksha Temple\\, Hampi');
  });
});

// ---------------------------------------------------------------------------
// What is refused, and why
// ---------------------------------------------------------------------------
describe('a trip with no start date is not on any calendar', () => {
  test('the builder returns null rather than an empty calendar', () => {
    // An empty `.ics` downloads and opens as a working export of nothing.
    expect(
      buildTripCalendar(tripWith([{ id: 1, title: 'Hampi' }], { start_date: null }), NOW)
    ).toBeNull();
  });

  test('a dated trip with no stops still exports', () => {
    // Different from having no dates: this is a calendar somebody can add to, and refusing it would
    // be refusing a valid trip.
    const ics = buildTripCalendar(tripWith([]), NOW);

    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).not.toContain('BEGIN:VEVENT');
  });
});

// ---------------------------------------------------------------------------
// The endpoint
// ---------------------------------------------------------------------------
describe('GET /api/auth/trips/:tripId/calendar.ics', () => {
  const makeTrip = async (headers = asUser, body = {}) => {
    const res = await request(app)
      .post('/api/auth/trips')
      .set(headers)
      .send({
        title: 'Karnataka in March',
        start_date: '2026-03-01',
        end_date: '2026-03-03',
        ...body
      });
    expect(res.status).toBe(201);
    return res.body.trip;
  };

  test('downloads as a calendar file', async () => {
    const trip = await makeTrip();

    const res = await request(app).get(`/api/auth/trips/${trip.id}/calendar.ics`).set(asUser);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/calendar/);
    expect(res.headers['content-disposition']).toMatch(
      /attachment; filename="karnataka-in-march\.ics"/
    );
    expect(res.text).toContain('BEGIN:VCALENDAR');
  });

  test('the filename cannot carry a header injection from the trip title', async () => {
    // The title is attacker-controlled and lands in `Content-Disposition`. A quote or a newline
    // there is a header-splitting bug, not a cosmetic one.
    const trip = await makeTrip(asUser, { title: 'evil"\r\nX-Injected: yes' });

    const res = await request(app).get(`/api/auth/trips/${trip.id}/calendar.ics`).set(asUser);

    expect(res.status).toBe(200);
    expect(res.headers['x-injected']).toBeUndefined();
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="[a-z0-9-]+\.ics"$/);
  });

  test('a trip with no start date is a 422 that says why', async () => {
    const trip = await makeTrip(asUser, { start_date: null, end_date: null });

    const res = await request(app).get(`/api/auth/trips/${trip.id}/calendar.ics`).set(asUser);

    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/no start date/i);
  });

  test('somebody else’s trip is a 404, not a 403', async () => {
    const trip = await makeTrip();

    const res = await request(app).get(`/api/auth/trips/${trip.id}/calendar.ics`).set(asOther);

    expect(res.status).toBe(404);
  });

  test('it requires a token', async () => {
    const trip = await makeTrip();
    const res = await request(app).get(`/api/auth/trips/${trip.id}/calendar.ics`);
    expect(res.status).toBe(401);
  });

  test('a real itinerary round-trips through the database', async () => {
    // The one test here that exercises the whole path: a stop written through the API, read back
    // through the model, and rendered with the times the database actually returned.
    const trip = await makeTrip();
    const workspace = await request(app).get(`/api/auth/trips/${trip.id}`).set(asUser);
    const dayId = workspace.body.trip.days[0].id;

    await request(app)
      .post(`/api/auth/trips/${trip.id}/days/${dayId}/items`)
      .set(asUser)
      .send({ title: 'Hampi, at dawn', start_time: '06:30', end_time: '09:00' });

    const res = await request(app).get(`/api/auth/trips/${trip.id}/calendar.ics`).set(asUser);

    expect(res.text).toContain('SUMMARY:Hampi\\, at dawn');
    expect(res.text).toContain('DTSTART:20260301T063000');
    expect(res.text).toContain('DTEND:20260301T090000');
  });

  test('an id that is not a number is a 400', async () => {
    const res = await request(app).get('/api/auth/trips/not-a-number/calendar.ics').set(asUser);
    expect(res.status).toBe(400);
  });
});
