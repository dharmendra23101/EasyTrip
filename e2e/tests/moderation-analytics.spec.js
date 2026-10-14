const { test, expect } = require('@playwright/test');
const authEmulator = require('../auth-emulator');

/**
 * The moderation queue and the analytics dashboard, through the real stack (`IMP-111`,
 * `ADR-036`/`ADR-037`).
 *
 * **Why this exists on top of `moderation.test.js` and `analytics.test.js`.** Those suites are the
 * thorough ones and they run against a `firebase-admin` mock, where "this caller is an admin" is a
 * fact the test asserted into existence. These two endpoints are the most privileged in the
 * product — one exposes a report queue, the other the whole catalogue's figures — so the question
 * worth re-asking end to end is whether the gate holds for **tokens somebody actually signed**.
 *
 * The identity that makes this worth the runtime is `claimOnly`: a genuine Auth-Emulator token
 * **carrying `admin: true` as a custom claim**, for a user whose `users.is_admin` is `false`. It is
 * signed, it is valid, it says admin, and it must still be refused — `IMP-002`, proven against a
 * real signature rather than against a mock that was told what to return.
 *
 * The second property is one no unit test observes from outside: **a reporter's identity never
 * leaves the database.** `moderationModel` deliberately does not select `reporter_uid`, and the
 * assertion below searches the entire serialised response for the uid that did the reporting
 * rather than checking a field list — a field nobody selects today can be added tomorrow.
 *
 * ---------------------------------------------------------------------------
 * Why every test owns its own review, and why nothing is resolved in `beforeEach`
 * ---------------------------------------------------------------------------
 * `review_reports` is `UNIQUE (review_id, reporter_uid)` and the insert is
 * **`ON CONFLICT DO NOTHING`**, so an identity gets exactly one report per review *for the lifetime
 * of the database*: once it is resolved, that pair can never produce an open report again.
 *
 * The first draft of this file resolved everything in `beforeEach` for tidiness. It cost two
 * failures and, worse, one **test that passed for the wrong reason** — the privacy assertion was
 * searching an empty queue, which contains nobody's uid. So: no shared cleanup, and each test uses
 * a review nothing else touches. `global-setup` truncates and re-seeds with `RESTART IDENTITY`, so
 * these ids are the same on every run.
 */

const API = 'http://127.0.0.1:5100/api';

const state = authEmulator.readState();

test.skip(
  !state.enabled,
  `Firebase Auth Emulator unavailable — ${state.reason || 'reason not recorded'}`
);

const auth = (identity) => ({ Authorization: `Bearer ${state.tokens[identity].idToken}` });

/**
 * The seed has exactly **three** reviews, and each carries its own place — the report route is
 * `/places/:id/reviews/:reviewId/report`, so a review addressed through the wrong place is a 404.
 *
 * | id | place | author |
 * |----|-------|--------|
 * | 1  | 1     | `seed-user-uid` |
 * | 2  | 1     | `seed-other-uid` |
 * | 3  | 3     | `seed-user-uid` |
 *
 * None belongs to an E2E identity, so nobody here reports their own review — which the API refuses.
 * Three reviews and three identities give nine distinct `(review, reporter)` pairs, which is more
 * than enough for one pair per assertion.
 */
const REVIEW = {
  grouping: { id: 1, place: 1 },
  privacy: { id: 2, place: 1 },
  forbidden: { id: 2, place: 1 },
  resolve: { id: 3, place: 3 }
};

const reportReview = (request, identity, review) =>
  request.post(`${API}/places/${review.place}/reviews/${review.id}/report`, {
    headers: auth(identity),
    data: { reason: 'spam' }
  });

const queue = async (request) => {
  const response = await request.get(`${API}/admin/reports`, { headers: auth('admin') });
  expect(response.status()).toBe(200);
  return response;
};

test.describe('the moderation queue is admin-only, against real signatures', () => {
  test('no token is a 401', async ({ request }) => {
    expect((await request.get(`${API}/admin/reports`)).status()).toBe(401);
  });

  test('a real, valid, non-admin token is a 403 — not a 401 and not a queue', async ({
    request
  }) => {
    // The distinction matters: 401 would mean "we did not believe your token". This token is
    // perfectly good; the caller simply is not an admin.
    expect(
      (await request.get(`${API}/admin/reports`, { headers: auth('nonAdmin') })).status()
    ).toBe(403);
  });

  test('a signed token claiming admin: true is still refused — the database decides', async ({
    request
  }) => {
    // `IMP-002`, and the reason this file is worth its runtime. The claim is real and so is the
    // signature; `users.is_admin` is false, and that is the only answer that counts.
    expect(
      (await request.get(`${API}/admin/reports`, { headers: auth('claimOnly') })).status()
    ).toBe(403);
  });

  test('a real admin token is let through', async ({ request }) => {
    expect(await (await queue(request)).json()).toMatchObject({ data: expect.any(Array) });
  });
});

test.describe('what the queue says, and what it must never say', () => {
  test('two people reporting one review is one row, not two', async ({ request }) => {
    // `ADR-036`: the queue is keyed on the review, because an admin decides about the review once
    // however many people complained about it.
    expect((await reportReview(request, 'nonAdmin', REVIEW.grouping)).status()).toBe(200);
    expect((await reportReview(request, 'admin', REVIEW.grouping)).status()).toBe(200);

    const { data } = await (await queue(request)).json();
    const rows = data.filter((r) => r.review_id === REVIEW.grouping.id);

    expect(rows).toHaveLength(1);
    expect(rows[0].report_count).toBe(2);
  });

  test('the reporter’s identity is nowhere in the admin response', async ({ request }) => {
    expect((await reportReview(request, 'nonAdmin', REVIEW.privacy)).status()).toBe(200);

    // One read, used twice: Playwright's APIResponse is not a Fetch Response and has no `clone()`.
    const body = await (await queue(request)).text();
    const { data } = JSON.parse(body);

    // Proving the row is there first, so this cannot pass by searching an empty queue — which is
    // exactly how the first draft of this test passed while asserting nothing.
    expect(data.some((r) => r.review_id === REVIEW.privacy.id)).toBe(true);

    expect(body).not.toContain(state.tokens.nonAdmin.uid);
    expect(body).not.toContain('reporter_uid');
  });

  test('resolving clears the review, and resolving again says so rather than silently succeeding', async ({
    request
  }) => {
    expect((await reportReview(request, 'claimOnly', REVIEW.resolve)).status()).toBe(200);

    const first = await request.patch(`${API}/admin/reports/reviews/${REVIEW.resolve.id}`, {
      headers: auth('admin'),
      data: { resolution: 'dismissed' }
    });
    expect(first.status()).toBe(200);
    expect((await first.json()).resolved).toBeGreaterThan(0);

    const { data } = await (await queue(request)).json();
    expect(data.find((r) => r.review_id === REVIEW.resolve.id)).toBeUndefined();

    // 409, not 404 and not a second 200. Two moderators can hold the queue on screen at once, and
    // the second one has to learn that the first already acted (`moderationController`).
    const again = await request.patch(`${API}/admin/reports/reviews/${REVIEW.resolve.id}`, {
      headers: auth('admin'),
      data: { resolution: 'dismissed' }
    });
    expect(again.status()).toBe(409);
    expect((await again.json()).resolved).toBe(0);
  });

  test('a non-admin cannot resolve a report, and the report survives the attempt', async ({
    request
  }) => {
    expect((await reportReview(request, 'claimOnly', REVIEW.forbidden)).status()).toBe(200);

    const attempt = await request.patch(`${API}/admin/reports/reviews/${REVIEW.forbidden.id}`, {
      headers: auth('nonAdmin'),
      data: { resolution: 'dismissed' }
    });
    expect(attempt.status()).toBe(403);

    // A refused write that still wrote would be the interesting failure here.
    const { data } = await (await queue(request)).json();
    expect(data.some((r) => r.review_id === REVIEW.forbidden.id)).toBe(true);
  });
});

test.describe('the analytics dashboard reports the catalogue, to admins only', () => {
  test('no token is a 401, a real non-admin token is a 403', async ({ request }) => {
    expect((await request.get(`${API}/admin/analytics`)).status()).toBe(401);
    expect(
      (await request.get(`${API}/admin/analytics`, { headers: auth('nonAdmin') })).status()
    ).toBe(403);
  });

  test('a signed admin claim does not open the dashboard either', async ({ request }) => {
    expect(
      (await request.get(`${API}/admin/analytics`, { headers: auth('claimOnly') })).status()
    ).toBe(403);
  });

  test('the figures describe the real catalogue rather than placeholders', async ({ request }) => {
    const response = await request.get(`${API}/admin/analytics`, { headers: auth('admin') });
    expect(response.status()).toBe(200);
    const body = await response.json();

    // Asserted against the catalogue the same stack can be asked for, not against a hard-coded
    // number — a fixture change must not fail this for a reason unrelated to analytics.
    const places = await request.get(`${API}/places?limit=100`);
    const total = (await places.json()).pagination.total;

    expect(body.catalogue.places).toBe(total);
    expect(Object.keys(body.ratings)).toEqual(['1', '2', '3', '4', '5']);

    // `ADR-037`: the panel exists to be acted on, so every entry names a place and what is wrong
    // with it, rather than being a number an admin can do nothing with.
    for (const entry of body.needsAttention) {
      expect(entry).toMatchObject({ id: expect.any(Number), name: expect.any(String) });
      expect(entry.missing_coordinates || entry.missing_image).toBe(true);
    }
  });

  test('the activity series is dense and carries all three counts (FV-022)', async ({
    request
  }) => {
    // The window is computed by Postgres over `generate_series`, so a day with nothing on it is a
    // real row at zero rather than an absent one. Asserted through the deployed stack because the
    // date arithmetic is the server's, and a series that skipped quiet days would draw a straight
    // line across them and read as steady activity.
    const response = await request.get(`${API}/admin/analytics?days=7`, { headers: auth('admin') });
    expect(response.status()).toBe(200);

    const { activity } = await response.json();
    expect(activity).toHaveLength(7);

    for (const day of activity) {
      expect(day.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof day.reviews).toBe('number');
      expect(typeof day.trips).toBe('number');
      expect(typeof day.reports).toBe('number');
    }
  });
});
