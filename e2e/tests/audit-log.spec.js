const { test, expect } = require('@playwright/test');
const authEmulator = require('../auth-emulator');

/**
 * The admin audit log, through the real stack (`PE-013`, `FV-023`, `ADR-056`).
 *
 * **Why this exists on top of `adminAudit.test.js`.** That suite is the thorough one — 23
 * assertions — and it runs against a `firebase-admin` mock, where "this caller is an admin" is a
 * fact the test asserted into existence. This endpoint returns *who did what to whom*, which makes
 * it among the most privileged reads in the product, so the question worth re-asking end to end is
 * whether the gate holds for **tokens somebody actually signed**.
 *
 * The identity that earns the runtime is `claimOnly`: a genuine Auth-Emulator token **carrying
 * `admin: true` as a custom claim**, for a user whose `users.is_admin` is `false`. Signed, valid,
 * says admin — and it must still be refused. `IMP-002` against a real signature rather than a mock
 * that was told what to return.
 *
 * The second property no unit test observes from outside: **an entry is written by the action, not
 * by the test.** The journey below performs a real privilege change through the real route and then
 * reads it back through the real reader, which is the only way to show the two halves are wired to
 * each other rather than each to a fixture.
 */

const API = 'http://127.0.0.1:5100/api';

const state = authEmulator.readState();

test.skip(
  !state.enabled,
  `Firebase Auth Emulator unavailable — ${state.reason || 'reason not recorded'}`
);

const auth = (identity) => ({ Authorization: `Bearer ${state.tokens[identity].idToken}` });

test.describe('the audit log is admin-only, against real signatures', () => {
  test('an anonymous request is refused', async ({ request }) => {
    const response = await request.get(`${API}/admin/audit`);
    expect(response.status()).toBe(401);
  });

  test('a valid non-admin token is refused', async ({ request }) => {
    const response = await request.get(`${API}/admin/audit`, { headers: auth('nonAdmin') });
    expect(response.status()).toBe(403);
  });

  test('a signed token claiming admin: true is still refused', async ({ request }) => {
    // The one this file is really for. `users.is_admin` is the authority; a custom claim is a
    // cache of it, and a disagreement resolves to *not* admin.
    const response = await request.get(`${API}/admin/audit`, { headers: auth('claimOnly') });
    expect(response.status()).toBe(403);
  });
});

test.describe('an action writes an entry the reader can find', () => {
  test('a real grant, read back through the real route', async ({ request }) => {
    // `nonAdmin` is a real emulator user, so `getUserByEmail` resolves them for real rather than
    // out of a mock's map.
    const target = state.tokens.nonAdmin.email;

    const before = await request.get(`${API}/admin/audit?action=admin.granted`, {
      headers: auth('admin')
    });
    expect(before.ok()).toBeTruthy();
    const startingTotal = (await before.json()).total;

    const granted = await request.post(`${API}/admin/admins`, {
      headers: auth('admin'),
      data: { email: target }
    });
    expect(granted.ok()).toBeTruthy();

    const after = await request.get(`${API}/admin/audit?action=admin.granted`, {
      headers: auth('admin')
    });
    const page = await after.json();

    expect(page.total).toBe(startingTotal + 1);

    const entry = page.entries[0];
    expect(entry.action).toBe('admin.granted');
    expect(entry.target_label).toBe(target);
    expect(entry.outcome).toBe('succeeded');
    // The actor is the admin whose token made the call — not a value the request supplied.
    expect(entry.actor_uid).toBe(state.tokens.admin.uid);

    // Put the fixture back, so the ordering of this file cannot change what another file sees.
    const revoked = await request.delete(`${API}/admin/admins/${encodeURIComponent(target)}`, {
      headers: auth('admin')
    });
    expect(revoked.ok()).toBeTruthy();
  });

  test('the log cannot be edited or deleted through the API', async ({ request }) => {
    // An audit trail an admin can rewrite records nothing. There is deliberately no such route,
    // and this asserts that from outside rather than trusting the router's shape.
    const patched = await request.patch(`${API}/admin/audit/1`, {
      headers: auth('admin'),
      data: {}
    });
    const deleted = await request.delete(`${API}/admin/audit/1`, { headers: auth('admin') });

    expect(patched.status()).toBe(404);
    expect(deleted.status()).toBe(404);
  });
});
