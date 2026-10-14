const request = require('supertest');
const app = require('../app');
const { createSchema, resetData, closeDb, resetRateLimits, pool } = require('./helpers/testDb');
const { authHeader } = require('./helpers/firebaseMock');

/**
 * Admin analytics (`IMP-111` second half, `ADR-037`).
 *
 * A dashboard is the easiest place in a product to show a wrong number, because nobody
 * cross-checks a tile — it is *presented* as the authority. So most of these assertions are about
 * the numbers being right for the fixture rather than merely present, and several are about the
 * cases where the honest answer is "none" rather than "zero".
 */

const asAdmin = { Authorization: authHeader({ uid: 'seed-admin-uid' }) };
const asUser = { Authorization: authHeader({ uid: 'seed-user-uid' }) };

const analytics = async (qs = '') => request(app).get(`/api/admin/analytics${qs}`).set(asAdmin);

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

describe('who may read it', () => {
  test('an admin may', async () => {
    expect((await analytics()).status).toBe(200);
  });

  test('a signed-in non-admin may not', async () => {
    // Nothing here is secret in isolation, but the aggregate is operational information about the
    // product and there is no reason for it to be readable by anyone not running it.
    expect((await request(app).get('/api/admin/analytics').set(asUser)).status).toBe(403);
  });

  test('an anonymous caller may not', async () => {
    expect((await request(app).get('/api/admin/analytics')).status).toBe(401);
  });
});

describe('the catalogue figures are the fixture’s, not plausible-looking', () => {
  test('counts match the seed exactly', async () => {
    // Asserting exact values rather than `toBeGreaterThan(0)`: a query joined wrongly still returns
    // a positive number, and "greater than zero" is the assertion that lets it through.
    const { catalogue } = (await analytics()).body;

    expect(catalogue.places).toBe(4);
    expect(catalogue.reviews).toBe(3);
    expect(catalogue.users).toBe(3);
    expect(catalogue.admins).toBe(1);
  });

  test('the average rating is computed per place, not per review', async () => {
    // Seed: Hampi 9/2 = 4.5, Gokarna 3/1 = 3.0, two unrated. The mean of the two place averages is
    // 3.75. The mean of the three raw ratings is 4.0 — a different, defensible-looking number, and
    // the one a naive AVG(rating) over place_reviews would produce.
    const { catalogue } = (await analytics()).body;
    expect(catalogue.average_rating).toBe(3.75);
  });

  test('the average is a number, not the string pg returns for NUMERIC', async () => {
    const { catalogue } = (await analytics()).body;
    expect(typeof catalogue.average_rating).toBe('number');
  });

  test('an unrated catalogue has NO average, rather than an average of zero', async () => {
    // BUG M-2's rule at the dashboard level. "Average rating: 0.0" says every place was rated
    // badly; the truth is that nothing was rated.
    await pool.query('DELETE FROM place_reviews');
    const { catalogue } = (await analytics()).body;

    expect(catalogue.average_rating).toBeNull();
    expect(catalogue.reviews).toBe(0);
  });
});

describe('the actionable figures', () => {
  test('places with no coordinates are counted', async () => {
    // Relative to the fixture, not an absolute 1: the seed's Coorg already has null coordinates
    // (deliberately — it is what the map's "no marker" case is tested against). An absolute
    // expectation here was wrong on the first run and would have been wrong again the next time
    // somebody added a fixture.
    const before = (await analytics()).body.catalogue.places_without_coordinates;
    expect(before).toBeGreaterThanOrEqual(1);

    await pool.query(
      `INSERT INTO places (name, location, created_at, updated_at)
       VALUES ('Uncoordinated', 'Nowhere', NOW(), NOW())`
    );

    expect((await analytics()).body.catalogue.places_without_coordinates).toBe(before + 1);
  });

  test('a place with only ONE coordinate counts as missing them', async () => {
    // Half a coordinate pins nothing. A `latitude IS NULL AND longitude IS NULL` test would call
    // this place complete and it would silently never appear on the map.
    const before = (await analytics()).body.catalogue.places_without_coordinates;

    await pool.query(
      `INSERT INTO places (name, location, latitude, created_at, updated_at)
       VALUES ('Half Pinned', 'Nowhere', 15.3, NOW(), NOW())`
    );

    expect((await analytics()).body.catalogue.places_without_coordinates).toBe(before + 1);
  });

  test('a gallery image counts, so a place is not reported as imageless when it has one', async () => {
    // `primary_image_url` is not the only source — `place_images` is the gallery IMP-014 built.
    // Counting only the primary would send an admin to "fix" a place that renders fine.
    const { rows } = await pool.query(
      `INSERT INTO places (name, location, created_at, updated_at)
       VALUES ('Gallery Only', 'Nowhere', NOW(), NOW()) RETURNING id`
    );
    const before = (await analytics()).body.catalogue.places_without_images;

    await pool.query(
      `INSERT INTO place_images (place_id, image_url) VALUES ($1, 'https://img.example/a.jpg')`,
      [rows[0].id]
    );

    expect((await analytics()).body.catalogue.places_without_images).toBe(before - 1);
  });

  test('an empty-string image url counts as no image', async () => {
    // `''` is not `NULL` and passes an `IS NOT NULL` test while rendering a broken image.
    await pool.query(
      `INSERT INTO places (name, location, primary_image_url, created_at, updated_at)
       VALUES ('Blank Image', 'Nowhere', '', NOW(), NOW())`
    );
    const { needsAttention } = (await analytics()).body;
    expect(needsAttention.some((p) => p.name === 'Blank Image' && p.missing_image)).toBe(true);
  });

  test('open reports are surfaced, counted by review', async () => {
    await pool.query(
      `INSERT INTO review_reports (review_id, reporter_uid) VALUES (1, 'a'), (1, 'b'), (2, 'c')`
    );
    // Two reviews reported, three reports. The dashboard counts decisions, matching the queue.
    expect((await analytics()).body.catalogue.open_reports).toBe(2);
  });

  test('needsAttention says WHY each place is listed', async () => {
    await pool.query(
      `INSERT INTO places (name, location, created_at, updated_at)
       VALUES ('Needs Both', 'Nowhere', NOW(), NOW())`
    );
    const row = (await analytics()).body.needsAttention.find((p) => p.name === 'Needs Both');

    expect(row).toMatchObject({ missing_coordinates: true, missing_image: true });
    // The id is what lets a tile link to the fix rather than describe it.
    expect(row.id).toEqual(expect.any(Number));
  });

  test('a complete place is not listed as needing attention', async () => {
    await pool.query(
      `INSERT INTO places (name, location, latitude, longitude, primary_image_url, created_at, updated_at)
       VALUES ('Complete', 'Somewhere', 15.3, 76.4, 'https://img.example/c.jpg', NOW(), NOW())`
    );
    const { needsAttention } = (await analytics()).body;
    expect(needsAttention.some((p) => p.name === 'Complete')).toBe(false);
  });
});

describe('the rating distribution', () => {
  test('every bucket 1–5 is present, even at zero', async () => {
    // A bar chart with five bars, not with however many happen to be non-empty.
    const { ratings } = (await analytics()).body;
    expect(Object.keys(ratings).sort()).toEqual(['1', '2', '3', '4', '5']);
  });

  test('the buckets are the fixture’s ratings', async () => {
    // Seed: a 5 and a 4 on Hampi, a 3 on Gokarna.
    const { ratings } = (await analytics()).body;
    expect(ratings).toEqual({ 1: 0, 2: 0, 3: 1, 4: 1, 5: 1 });
  });

  test('the buckets sum to the review count', async () => {
    // Two numbers on one screen that must agree. A distribution that quietly dropped a rating
    // would still look like a reasonable chart.
    const { ratings, catalogue } = (await analytics()).body;
    const total = Object.values(ratings).reduce((sum, n) => sum + n, 0);
    expect(total).toBe(catalogue.reviews);
  });
});

describe('the activity series', () => {
  test('it is a dense series — quiet days are present with zero', async () => {
    // A sparse series plotted as a line draws a straight segment across a quiet week, which reads
    // as steady activity rather than none.
    const { activity } = (await analytics()).body;
    expect(activity).toHaveLength(30);
    expect(activity.filter((d) => d.reviews === 0).length).toBeGreaterThan(0);
  });

  test('dates are plain YYYY-MM-DD strings, not timestamps', async () => {
    // A Date serialised to JSON is UTC midnight, and re-parsing that in a browser behind UTC lands
    // on the previous day — the BUG-044/BUG-046 class, designed out rather than tested for.
    const { activity } = (await analytics()).body;
    for (const day of activity) expect(day.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('the window is caller-adjustable within bounds', async () => {
    expect((await analytics('?days=7')).body.activity).toHaveLength(7);
    expect((await analytics('?days=90')).body.activity).toHaveLength(90);
  });

  test('an out-of-range window is refused rather than silently clamped', async () => {
    expect((await analytics('?days=365')).status).toBe(400);
    expect((await analytics('?days=0')).status).toBe(400);
  });

  test('today’s reviews land on today', async () => {
    const { activity } = (await analytics()).body;
    const today = activity[activity.length - 1];

    await pool.query(
      `INSERT INTO place_reviews (place_id, user_id, user_name, rating, created_at, updated_at)
       VALUES (4, 'activity-uid', 'A', 5, NOW(), NOW())`
    );

    const after = (await analytics()).body.activity;
    expect(after[after.length - 1].date).toBe(today.date);
    expect(after[after.length - 1].reviews).toBe(today.reviews + 1);
  });

  test('all three series are present on every day, at zero rather than absent', async () => {
    // `FV-022`. A missing key is not the same as a zero: `undefined` plotted as a point lands at
    // the bottom of a chart looking exactly like "none happened", and summed into a total it makes
    // the total NaN. Every day carries all three.
    const { activity } = (await analytics()).body;

    for (const day of activity) {
      expect(typeof day.reviews).toBe('number');
      expect(typeof day.trips).toBe('number');
      expect(typeof day.reports).toBe('number');
    }
  });

  test('a trip created today lands on today, and moves only the trips series', async () => {
    // The series must be independent. One correlated subquery accidentally joined to the wrong
    // day column moves two lines at once, which is invisible on a chart and wrong in a way nobody
    // would question.
    const { activity } = (await analytics()).body;
    const before = activity[activity.length - 1];

    await pool.query(
      `INSERT INTO trips (user_id, title, status) VALUES ('seed-user-uid', 'Activity trip', 'draft')`
    );

    const after = (await analytics()).body.activity;
    const today = after[after.length - 1];

    expect(today.trips).toBe(before.trips + 1);
    expect(today.reviews).toBe(before.reviews);
    expect(today.reports).toBe(before.reports);
  });

  test('a report counts as inflow on the day it arrived, even once resolved', async () => {
    // `reports` is arrival, not backlog — the open count in `catalogue` is the backlog. Counting
    // only open reports here would make the series shrink as a moderator works, so a productive
    // afternoon would look like a drop in reports being filed.
    const { activity } = (await analytics()).body;
    const before = activity[activity.length - 1];

    await pool.query(
      `INSERT INTO review_reports (review_id, reporter_uid, reason, status)
       VALUES (1, 'activity-reporter', NULL, 'reviewed')`
    );

    const after = (await analytics()).body.activity;
    expect(after[after.length - 1].reports).toBe(before.reports + 1);
  });
});

describe('an empty catalogue is not an error', () => {
  test('every figure is zero or null, and nothing throws', async () => {
    // The state a brand-new deployment is in, and the one most likely to divide by zero.
    //
    // `users` is deliberately NOT truncated: the admin making this request lives there, and
    // removing them turns the assertion into a 403 about authentication rather than anything about
    // analytics. (It did, on the first run.) A real empty deployment has an admin too.
    await pool.query(
      'TRUNCATE places, place_reviews, review_reports, trips, user_saved_places CASCADE'
    );

    const res = await analytics();
    expect(res.status).toBe(200);
    expect(res.body.catalogue).toMatchObject({
      places: 0,
      reviews: 0,
      average_rating: null,
      open_reports: 0
    });
    expect(res.body.needsAttention).toEqual([]);
    expect(res.body.ratings).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
    expect(res.body.activity).toHaveLength(30);
  });
});
