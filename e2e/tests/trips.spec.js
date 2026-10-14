const { test, expect } = require('@playwright/test');
const authEmulator = require('../auth-emulator');

/**
 * The trip workspace and its feasibility report, through the real stack (`IMP-109` / `IMP-130`).
 *
 * **Why this exists on top of `backend/tests/trips.test.js`.** That suite is the thorough one — it
 * drives all eleven endpoints in-process with `firebase-admin` mocked, and it is organised around
 * `ADR-031`'s hard part: a `trip_day` and a `trip_item` carry **no `user_id` at all**. They are
 * owned *transitively*, through a join up to `trips`, and forgetting that join in exactly one
 * endpoint is the realistic failure.
 *
 * What it cannot prove is that the boundary holds when the identity is a **real** one — a token
 * signed by the Firebase Auth Emulator and verified by the genuine `verifyIdToken()` on the genuine
 * code path, against a genuine Postgres, behind the real rate limiters (`ADR-028`). Two mock
 * payloads differing by a uid string is a weaker statement than two separately signed identities.
 *
 * **Why this file exists at all.** Until it did, the trip workspace was the largest feature in the
 * product with **zero** browser-layer coverage, and `FV-025`'s feasibility engine had none either —
 * found by walking the `E2E` column of `PRODUCT_ROADMAP.md` §9 against `e2e/tests/` rather than by
 * trusting the matrix, which claimed otherwise.
 *
 * **What is deliberately not here: a drag-and-drop journey.** It used to be blocked — reordering in
 * the workspace UI needs a token from the Firebase **client** SDK, and the cookie the admin specs set
 * reaches the SSR gate rather than `auth.currentUser`. **That blocker is gone** (`TD-024`, Sprint
 * 8.30): `signed-in-workspace.spec.js` signs in for real and drives the workspace as that user.
 *
 * It stays out of *this* file anyway, because this file is about the ownership boundary and a drag
 * is not an ownership question. It is now an ordinary backlog item rather than a thing that cannot
 * be written.
 */

const API = 'http://127.0.0.1:5100/api';

const state = authEmulator.readState();

test.skip(
  !state.enabled,
  `Firebase Auth Emulator unavailable — ${state.reason || 'reason not recorded'}`
);

const auth = (identity) => ({ Authorization: `Bearer ${state.tokens[identity].idToken}` });

/** Leave no rows behind: this suite shares one database with every other spec. */
const clear = async (request, identity) => {
  const listed = await request.get(`${API}/auth/trips`, { headers: auth(identity) });
  if (!listed.ok()) return;
  const { trips = [] } = await listed.json();
  for (const trip of trips) {
    await request.delete(`${API}/auth/trips/${trip.id}`, { headers: auth(identity) });
  }
};

/** A trip with a two-day range, plus the workspace read that exposes the generated day slots. */
const createTrip = async (request, identity) => {
  const created = await request.post(`${API}/auth/trips`, {
    headers: auth(identity),
    data: { title: 'Karnataka in March', start_date: '2026-03-01', end_date: '2026-03-02' }
  });
  expect(created.status()).toBe(201);
  const { trip } = await created.json();

  const workspace = await request.get(`${API}/auth/trips/${trip.id}`, { headers: auth(identity) });
  expect(workspace.status()).toBe(200);
  return (await workspace.json()).trip;
};

test.beforeEach(async ({ request }) => {
  await clear(request, 'nonAdmin');
  await clear(request, 'admin');
});

test.afterAll(async ({ request }) => {
  await clear(request, 'nonAdmin');
  await clear(request, 'admin');
});

test.describe('a trip belongs to one verified identity, and so does everything under it', () => {
  test('a trip created with a real token is listed for that identity, with its days', async ({
    request
  }) => {
    const trip = await createTrip(request, 'nonAdmin');

    // The day slots come from the date range rather than from the client, which is `ADR-031`'s
    // "a day is an ordinal, not a date" decision observed from outside.
    expect(trip.days).toHaveLength(2);
    expect(trip.days.map((day) => day.day_number)).toEqual([1, 2]);

    const listed = await request.get(`${API}/auth/trips`, { headers: auth('nonAdmin') });
    expect((await listed.json()).trips.map((t) => t.id)).toContain(trip.id);
  });

  test('a second real identity cannot read the trip, and is not told it exists', async ({
    request
  }) => {
    const trip = await createTrip(request, 'nonAdmin');

    const attempt = await request.get(`${API}/auth/trips/${trip.id}`, { headers: auth('admin') });

    // 404 rather than 403, deliberately: a 403 confirms the id is real. An admin token is used as
    // the attacker on purpose — elevated privilege elsewhere must not reach a personal itinerary.
    expect(attempt.status()).toBe(404);

    const theirs = await request.get(`${API}/auth/trips`, { headers: auth('admin') });
    expect((await theirs.json()).trips).toEqual([]);
  });

  test('a second real identity cannot add an item to a day it does not own', async ({
    request
  }) => {
    const trip = await createTrip(request, 'nonAdmin');

    // The assertion the whole schema rests on: `trip_days` carries no uid, so this endpoint is only
    // safe if it joins up to `trips`. A missing join here returns 201 and silently writes into
    // somebody else's itinerary.
    const attempt = await request.post(
      `${API}/auth/trips/${trip.id}/days/${trip.days[0].id}/items`,
      {
        headers: auth('admin'),
        data: { place_id: 1, title: 'Inserted by the wrong person', position: 0 }
      }
    );
    expect(attempt.status()).toBe(404);

    const owner = await request.get(`${API}/auth/trips/${trip.id}`, { headers: auth('nonAdmin') });
    expect((await owner.json()).trip.days[0].items).toEqual([]);
  });

  test('no token at all is a 401, not an empty list', async ({ request }) => {
    const response = await request.get(`${API}/auth/trips`);
    expect(response.status()).toBe(401);
  });

  test('a token that is not a token is a 401', async ({ request }) => {
    const response = await request.get(`${API}/auth/trips`, {
      headers: { Authorization: 'Bearer not-a-real-token' }
    });
    // The real `verifyIdToken` rejects this. The in-process suite proves the same thing against a
    // mock that was told to; only one of the two proves a signature is actually checked.
    expect(response.status()).toBe(401);
  });
});

test.describe('the feasibility report, fed by the real write path (FV-025)', () => {
  test('a plan with nothing wrong with it is reported feasible, and invents no findings', async ({
    request
  }) => {
    const trip = await createTrip(request, 'nonAdmin');

    const report = await request.get(`${API}/auth/trips/${trip.id}/feasibility`, {
      headers: auth('nonAdmin')
    });
    expect(report.status()).toBe(200);
    const { feasibility } = await report.json();

    expect(feasibility.feasible).toBe(true);
    expect(feasibility.findings).toEqual([]);

    // The assumptions travel with the result, because a straight-line estimate presented as a
    // measurement is fabricated data with a validator's authority (`ADR-041`).
    expect(feasibility.assumptions.average_speed_kmh).toBe(40);
    expect(feasibility.assumptions.road_factor).toBe(1.3);
  });

  test('two items claiming the same hour are reported through the real stack', async ({
    request
  }) => {
    const trip = await createTrip(request, 'nonAdmin');
    const dayId = trip.days[0].id;

    for (const item of [
      {
        place_id: 1,
        title: 'Morning at Hampi',
        start_time: '08:00',
        end_time: '10:00',
        position: 0
      },
      { place_id: 2, title: 'Also at nine', start_time: '09:00', end_time: '11:00', position: 1 }
    ]) {
      const written = await request.post(`${API}/auth/trips/${trip.id}/days/${dayId}/items`, {
        headers: auth('nonAdmin'),
        data: item
      });
      expect(written.status()).toBe(201);
    }

    const report = await request.get(`${API}/auth/trips/${trip.id}/feasibility`, {
      headers: auth('nonAdmin')
    });
    const { feasibility } = await report.json();

    // An overlap is chosen rather than a travel-time finding on purpose: it is pure clock
    // arithmetic, so this assertion cannot become flaky if the seeded coordinates ever move.
    expect(feasibility.feasible).toBe(false);
    expect(feasibility.findings.map((f) => f.code)).toContain('items_overlap');

    const overlap = feasibility.findings.find((f) => f.code === 'items_overlap');
    expect(overlap.severity).toBe('error');
    expect(overlap.day_number).toBe(1);
  });

  test('the feasibility of a trip is not readable by another identity', async ({ request }) => {
    const trip = await createTrip(request, 'nonAdmin');

    const attempt = await request.get(`${API}/auth/trips/${trip.id}/feasibility`, {
      headers: auth('admin')
    });
    // The report describes the itinerary, so it is exactly as private as the itinerary is.
    expect(attempt.status()).toBe(404);
  });
});

test.describe('the workspace is not a public page', () => {
  test('the trips page is not reachable without signing in', async ({ page }) => {
    // Worth having on top of the API 401: a client-side guard that only *fetches* correctly would
    // still paint the chrome of somebody's private workspace first.
    await page.goto('/trips');

    await expect(page).toHaveURL(/\/login/);
  });
});
