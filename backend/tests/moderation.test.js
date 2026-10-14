const request = require('supertest');
const app = require('../app');
const { createSchema, resetData, closeDb, resetRateLimits, pool } = require('./helpers/testDb');
const { authHeader } = require('./helpers/firebaseMock');

/**
 * The review moderation queue (`IMP-111`, `ADR-036`).
 *
 * `review_reports` has existed since migration `003` and been written to since `IMP-019` gave the
 * place page a report button. **Nothing has ever read it** — so the UI said *"Thanks, this review
 * has been reported for moderation"* while no moderation was possible and `status` only ever held
 * `'open'`. These assertions are about the consumer that makes that sentence true.
 *
 * Two properties get the most attention because both are easy to get wrong and neither shows up in
 * a happy-path click-through:
 *
 *   - **The queue's unit is the reviewed *review*, not the report.** Eight people flagging one
 *     review is one decision.
 *   - **Reporter identity never leaves the database.** `IMP-021` keeps *author* identity out of
 *     public responses; this keeps *reporter* identity out of even the admin one.
 */

const asAdmin = { Authorization: authHeader({ uid: 'seed-admin-uid' }) };
const asUser = { Authorization: authHeader({ uid: 'seed-user-uid' }) };
const asOther = { Authorization: authHeader({ uid: 'seed-other-uid' }) };

/** Seed fixtures: review 1 is Tom's on Hampi, review 2 is Otto's on Hampi, review 3 is on Gokarna. */
const report = (reviewId, reporterUid, reason = null) =>
  pool.query(
    `INSERT INTO review_reports (review_id, reporter_uid, reason) VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [reviewId, reporterUid, reason]
  );

const queue = async (qs = '') => request(app).get(`/api/admin/reports${qs}`).set(asAdmin);

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

describe('who may see the queue', () => {
  test('an admin may', async () => {
    expect((await queue()).status).toBe(200);
  });

  test('a signed-in non-admin may not', async () => {
    expect((await request(app).get('/api/admin/reports').set(asUser)).status).toBe(403);
  });

  test('an anonymous caller may not', async () => {
    expect((await request(app).get('/api/admin/reports')).status).toBe(401);
  });

  test('resolving is admin-only too', async () => {
    const res = await request(app)
      .patch('/api/admin/reports/reviews/1')
      .send({ resolution: 'dismissed' })
      .set(asUser);
    expect(res.status).toBe(403);
  });
});

describe('the queue groups by review, not by report', () => {
  test('eight reports on one review are one row', async () => {
    // The unit of the queue is the unit of the decision. A per-report list would make a moderator
    // read the same review eight times and act on it eight times, and the eighth action would find
    // the review already gone.
    for (let i = 0; i < 8; i += 1) await report(1, `reporter-${i}`);

    const res = await queue();
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ review_id: 1, report_count: 8 });
  });

  test('the total counts reviews, not reports', async () => {
    // "3 of 12" must not mean two different things in one response — the page counts one way and
    // the total another is a classic off-by-a-lot.
    for (let i = 0; i < 5; i += 1) await report(1, `reporter-${i}`);
    await report(2, 'someone');

    const res = await queue();
    expect(res.body.pagination.total).toBe(2);
    expect(res.body.data).toHaveLength(2);
  });

  test('it carries the review and the place a moderator needs to judge it', async () => {
    await report(1, 'reporter-a', 'Spam');

    const [row] = (await queue()).body.data;
    expect(row).toMatchObject({
      review_id: 1,
      place_id: 1,
      place_name: 'Hampi',
      report_count: 1,
      reasons: ['Spam']
    });
    expect(row.comment).toEqual(expect.any(String));
    expect(row.rating).toEqual(expect.any(Number));
  });

  test('reasons are omitted rather than rendered as nulls', async () => {
    // The current report button sends no reason at all, so this is the common case.
    await report(1, 'reporter-a');
    await report(1, 'reporter-b', 'Abusive');

    const [row] = (await queue()).body.data;
    expect(row.reasons).toEqual(['Abusive']);
  });

  test('most-reported first, ahead of a lower review id', async () => {
    // The fixture has to make the ordering rule disagree with `ORDER BY review_id`, or the
    // assertion passes for a query that does not sort at all. The first version of this test used
    // review 1 as the most-reported one and was caught by the IMP-111 mutation run (`M-4`), where
    // deleting the ORDER BY entirely still produced `[1, 2]`.
    for (let i = 0; i < 3; i += 1) await report(2, `reporter-${i}`);
    await report(1, 'single-reporter');

    expect((await queue()).body.data.map((r) => r.review_id)).toEqual([2, 1]);
  });

  test('among equally-reported reviews, the longest-waiting leads', async () => {
    // Same requirement: review 3 is reported first but has the HIGHER id, so an unsorted query
    // returns the other order.
    await pool.query(
      `INSERT INTO review_reports (review_id, reporter_uid, created_at)
       VALUES (3, 'early', NOW() - INTERVAL '10 days')`
    );
    await report(1, 'recent');

    expect((await queue()).body.data.map((r) => r.review_id)).toEqual([3, 1]);
  });

  test('the model refuses a resolution the database CHECK would reject', async () => {
    // Asserted at the model rather than through HTTP. The route validator rejects a bad resolution
    // first, so an API-level test can never reach this guard — which is why the IMP-111 mutation
    // run saw it survive (`M-7`). The guard is not redundant: the model is a module, and the next
    // caller (a script, a future admin tool) will not come through that validator.
    const moderationModel = require('../src/models/moderationModel');
    await expect(moderationModel.resolveReportsForReview(1, 'deleted')).rejects.toThrow(
      /Unsupported resolution/
    );
    await expect(moderationModel.resolveReportsForReview(1, 'open')).rejects.toThrow();
  });
});

describe('reporter identity never leaves the database', () => {
  test('no reporter uid appears anywhere in the response', async () => {
    // A moderator who can see who reported whom can be lobbied, and a leak exposes the people who
    // flagged abuse. IMP-021's reasoning, applied to the other side of the interaction.
    await report(1, 'seed-other-uid', 'Spam');

    const res = await queue();
    const serialised = JSON.stringify(res.body);

    expect(serialised).not.toContain('seed-other-uid');
    expect(serialised).not.toContain('reporter_uid');
  });

  test('nor does the review author’s uid', async () => {
    // The review author is anonymised everywhere else (IMP-021); the moderation view must not be
    // the one place the correlation is available.
    await report(1, 'reporter-a');

    const res = await queue();
    expect(JSON.stringify(res.body)).not.toContain('seed-user-uid');
    expect(res.body.data[0]).not.toHaveProperty('user_id');
  });

  test('the display name IS shown, because a moderator has to read it', async () => {
    // The name on a review is already public on the place page. Withholding it here would mean
    // moderating a comment without seeing the byline that may be the thing being reported.
    await report(1, 'reporter-a');
    expect((await queue()).body.data[0].review_author_name).toEqual(expect.any(String));
  });
});

describe('resolving', () => {
  test('resolving handles every open report on that review at once', async () => {
    for (let i = 0; i < 4; i += 1) await report(1, `reporter-${i}`);

    const res = await request(app)
      .patch('/api/admin/reports/reviews/1')
      .send({ resolution: 'dismissed' })
      .set(asAdmin);

    expect(res.status).toBe(200);
    expect(res.body.resolved).toBe(4);
    // Resolving one of four would leave the review in the queue with a lower count — "partly
    // handled", a state nobody wants to reason about.
    expect((await queue()).body.data).toHaveLength(0);
  });

  test('a resolved review is still findable under its new status', async () => {
    await report(1, 'reporter-a');
    await request(app)
      .patch('/api/admin/reports/reviews/1')
      .send({ resolution: 'reviewed' })
      .set(asAdmin);

    expect((await queue('?status=open')).body.data).toHaveLength(0);
    expect((await queue('?status=reviewed')).body.data).toHaveLength(1);
    expect((await queue('?status=dismissed')).body.data).toHaveLength(0);
  });

  test('resolving twice is a 409, so a second moderator learns the first already acted', async () => {
    // Two people can have the queue on screen at once. A success that changed nothing would tell
    // the second one they handled it.
    await report(1, 'reporter-a');
    const body = { resolution: 'dismissed' };

    expect(
      (await request(app).patch('/api/admin/reports/reviews/1').send(body).set(asAdmin)).status
    ).toBe(200);

    const second = await request(app).patch('/api/admin/reports/reviews/1').send(body).set(asAdmin);
    expect(second.status).toBe(409);
    expect(second.body.resolved).toBe(0);
  });

  test('a review with no reports at all is a 409, not a silent success', async () => {
    const res = await request(app)
      .patch('/api/admin/reports/reviews/999')
      .send({ resolution: 'dismissed' })
      .set(asAdmin);
    expect(res.status).toBe(409);
  });

  test('an unsupported resolution is refused by the validator, not by the database', async () => {
    // The enum here and the CHECK constraint in schema.sql are two declarations of one set. A value
    // the constraint rejects must never reach it — that is a 500, where this is a 400.
    for (const resolution of ['deleted', 'open', '', 'DISMISSED']) {
      const res = await request(app)
        .patch('/api/admin/reports/reviews/1')
        .send({ resolution })
        .set(asAdmin);
      expect([res.status, resolution]).toEqual([400, resolution]);
    }
  });

  test('an unrecognised status filter is refused rather than silently emptied', async () => {
    // Falling back to `open` for a typo would make a mistyped filter look like an empty queue.
    expect((await queue('?status=pending')).status).toBe(400);
  });
});

describe('removing a review, which is a different decision', () => {
  test('an admin may delete a review they did not write', async () => {
    // Moderation needs this and IMP-117 forbade a second delete route, so the existing owner-gated
    // path was extended rather than duplicated.
    const res = await request(app).delete('/api/places/1/reviews/1').set(asAdmin);
    expect(res.status).toBe(204);

    const remaining = await pool.query('SELECT id FROM place_reviews WHERE id = 1');
    expect(remaining.rowCount).toBe(0);
  });

  test('a non-admin still cannot delete somebody else’s', async () => {
    // The whole security property of that route. Extending it for admins must not widen it further.
    const res = await request(app).delete('/api/places/1/reviews/1').set(asOther);
    expect(res.status).toBe(403);

    expect((await pool.query('SELECT id FROM place_reviews WHERE id = 1')).rowCount).toBe(1);
  });

  test('an author may still delete their own', async () => {
    expect((await request(app).delete('/api/places/1/reviews/1').set(asUser)).status).toBe(204);
  });

  test('deleting a review takes its reports with it', async () => {
    // `review_reports.review_id` is ON DELETE CASCADE. A removed review that left its reports
    // behind would resurface in the queue pointing at nothing.
    await report(1, 'reporter-a');
    expect((await queue()).body.data).toHaveLength(1);

    await request(app).delete('/api/places/1/reviews/1').set(asAdmin);

    expect((await queue()).body.data).toHaveLength(0);
    expect((await pool.query('SELECT id FROM review_reports WHERE review_id = 1')).rowCount).toBe(
      0
    );
  });

  test('deleting a review recomputes the place rating', async () => {
    // The trigger does this; asserted here because moderation is now a second caller of the delete
    // path and a rating left stale by a removal is a wrong number on a public page.
    const before = await pool.query('SELECT rating_count, rating_sum FROM places WHERE id = 1');
    await request(app).delete('/api/places/1/reviews/1').set(asAdmin);
    const after = await pool.query('SELECT rating_count, rating_sum FROM places WHERE id = 1');

    expect(after.rows[0].rating_count).toBe(before.rows[0].rating_count - 1);
    expect(after.rows[0].rating_sum).toBeLessThan(before.rows[0].rating_sum);
  });
});

describe('the counts a badge would render', () => {
  test('every status is present, even at zero', async () => {
    // A missing key forces every caller into `counts.open ?? 0`, and the one that forgets renders
    // "undefined" in a badge.
    const res = await queue();
    expect(res.body.counts).toEqual({ open: 0, reviewed: 0, dismissed: 0 });
  });

  test('they follow the reports', async () => {
    await report(1, 'reporter-a');
    await report(2, 'reporter-b');
    await request(app)
      .patch('/api/admin/reports/reviews/1')
      .send({ resolution: 'reviewed' })
      .set(asAdmin);

    expect((await queue()).body.counts).toEqual({ open: 1, reviewed: 1, dismissed: 0 });
  });
});

describe('paging', () => {
  test('the page and the total agree, and hasMore is honest', async () => {
    await report(1, 'a');
    await report(2, 'b');
    await report(3, 'c');

    const first = await queue('?limit=2&offset=0');
    expect(first.body.data).toHaveLength(2);
    expect(first.body.pagination.total).toBe(3);
    expect(first.body.pagination.hasMore).toBe(true);

    const second = await queue('?limit=2&offset=2');
    expect(second.body.data).toHaveLength(1);
    expect(second.body.pagination.hasMore).toBe(false);
  });

  test('an over-large limit is refused rather than clamped', async () => {
    expect((await queue('?limit=1000')).status).toBe(400);
  });
});
