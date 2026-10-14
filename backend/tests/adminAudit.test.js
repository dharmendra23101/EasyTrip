const request = require('supertest');
const app = require('../app');
const { createSchema, resetData, closeDb, resetRateLimits, pool } = require('./helpers/testDb');
const { authHeader, __mock } = require('./helpers/firebaseMock');

/**
 * The admin audit log (`PE-013`, `FV-023` part 1, `ADR-056`).
 *
 * ---------------------------------------------------------------------------
 * This table was refused once. These assertions are what makes it different.
 * ---------------------------------------------------------------------------
 * `ADR-022` deleted four `INSERT INTO audit_logs` calls in Sprint 2.3 rather than create the
 * tables they implied, on the ground that *"a table with writers and no readers is not an audit
 * trail — it is write amplification that looks like diligence"*. Three of those inserts were
 * `.catch`-swallowed and had therefore never written a row in production.
 *
 * So the properties worth asserting here are not "a row appears". They are:
 *
 *   1. **The row commits with the action, or neither does.** An `is_admin` flip that nothing
 *      recorded is the exact hole this table exists to close, and a fire-and-forget insert leaves
 *      it wide open — invisibly, which is how the last one survived for twenty sprints.
 *   2. **A privilege change that returned 500 is still recorded.** `addAdmin` writes the column
 *      and *then* syncs the Firebase claim; when that throws the caller sees a failure and the
 *      person is nonetheless an admin. A log that agrees with the HTTP status would omit the one
 *      entry a reader most needs.
 *   3. **It records admins acting on other people, and nothing else.** An author deleting their
 *      own review is an ordinary user action; logging it would turn accountability into
 *      surveillance and bury the handful of entries somebody actually came for.
 *   4. **Nobody can rewrite it.** There is no edit or delete route, and the reader cannot filter
 *      out their own entries.
 */

const asAdmin = { Authorization: authHeader({ uid: 'seed-admin-uid' }) };
const asUser = { Authorization: authHeader({ uid: 'seed-user-uid' }) };

const ADMIN_EMAIL = 'admin@easytrip.test';
const OTHER_EMAIL = 'other@easytrip.test';

const auditRows = async (action = null) => {
  const { rows } = await pool.query(
    `SELECT * FROM admin_audit_log ${action ? 'WHERE action = $1' : ''} ORDER BY id`,
    action ? [action] : []
  );
  return rows;
};

const report = (reviewId, reporterUid) =>
  pool.query(
    `INSERT INTO review_reports (review_id, reporter_uid, reason) VALUES ($1, $2, NULL)
     ON CONFLICT DO NOTHING`,
    [reviewId, reporterUid]
  );

beforeAll(async () => {
  await createSchema();
});

beforeEach(async () => {
  await resetData();
  resetRateLimits(app);
  await pool.query('TRUNCATE admin_audit_log RESTART IDENTITY');
  __mock.resetFirebaseUsers();
  __mock.setCustomUserClaims.mockClear();
  __mock.setCustomUserClaims.mockResolvedValue(undefined);
  // Both sides of the grant/revoke pair need to be resolvable by email.
  __mock.registerFirebaseUser({ uid: 'seed-admin-uid', email: ADMIN_EMAIL, displayName: 'Ada' });
  __mock.registerFirebaseUser({ uid: 'seed-other-uid', email: OTHER_EMAIL, displayName: 'Otto' });
});

afterAll(async () => {
  await closeDb();
});

// ---------------------------------------------------------------------------
// Privilege changes
// ---------------------------------------------------------------------------
describe('granting and revoking admin leaves a record', () => {
  test('a grant records the actor, the target, and the action', async () => {
    const res = await request(app).post('/api/admin/admins').set(asAdmin).send({
      email: OTHER_EMAIL
    });
    expect(res.status).toBe(200);

    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor_uid: 'seed-admin-uid',
      action: 'admin.granted',
      target_type: 'user',
      target_id: 'seed-other-uid',
      // Denormalised on purpose: the row has to still name them after the account is gone.
      target_label: OTHER_EMAIL,
      outcome: 'succeeded'
    });
  });

  test('a revoke records the mirror action', async () => {
    await pool.query(`UPDATE users SET is_admin = true WHERE firebase_uid = 'seed-other-uid'`);

    const res = await request(app).delete(`/api/admin/admins/${OTHER_EMAIL}`).set(asAdmin);
    expect(res.status).toBe(200);

    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'admin.revoked', target_id: 'seed-other-uid' });
  });

  test('a grant that 500s on the Firebase claim is still recorded, as partially_applied', async () => {
    // **The case the `outcome` column exists for.** The database write has already committed, so
    // the person really is an admin in the column that authorises them — while the admin who did
    // it was told it failed. A log that only recorded successful responses would lose this
    // entirely, and it is the one a reader would most want to find.
    __mock.setCustomUserClaims.mockRejectedValueOnce(new Error('firebase is down'));

    const res = await request(app).post('/api/admin/admins').set(asAdmin).send({
      email: OTHER_EMAIL
    });
    expect(res.status).toBe(500);

    const stored = await pool.query(
      `SELECT is_admin FROM users WHERE firebase_uid = 'seed-other-uid'`
    );
    expect(stored.rows[0].is_admin).toBe(true);

    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'admin.granted', outcome: 'partially_applied' });
  });

  test('a revoke that 500s on the claim is recorded the same way', async () => {
    await pool.query(`UPDATE users SET is_admin = true WHERE firebase_uid = 'seed-other-uid'`);
    __mock.setCustomUserClaims.mockRejectedValueOnce(new Error('firebase is down'));

    const res = await request(app).delete(`/api/admin/admins/${OTHER_EMAIL}`).set(asAdmin);
    expect(res.status).toBe(500);

    const rows = await auditRows();
    expect(rows[0]).toMatchObject({ action: 'admin.revoked', outcome: 'partially_applied' });
  });

  test('revoking somebody who is not in the database records nothing', async () => {
    // The 404 path. Nothing changed, so nothing is logged — an audit trail of attempts that
    // altered no state is noise that hides the entries that did.
    await pool.query(`DELETE FROM users WHERE firebase_uid = 'seed-other-uid'`);

    const res = await request(app).delete(`/api/admin/admins/${OTHER_EMAIL}`).set(asAdmin);
    expect(res.status).toBe(404);
    expect(await auditRows()).toHaveLength(0);
  });

  test('a non-admin cannot cause an entry, because they cannot reach the route', async () => {
    const res = await request(app).post('/api/admin/admins').set(asUser).send({
      email: OTHER_EMAIL
    });
    expect(res.status).toBe(403);
    expect(await auditRows()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Moderation
// ---------------------------------------------------------------------------
describe('moderation decisions are recorded, non-decisions are not', () => {
  test('resolving reports records the resolution and how many closed', async () => {
    await report(1, 'seed-other-uid');
    await report(1, 'seed-admin-uid');

    const res = await request(app)
      .patch('/api/admin/reports/reviews/1')
      .set(asAdmin)
      .send({ resolution: 'dismissed' });
    expect(res.status).toBe(200);

    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'report.resolved',
      target_type: 'review',
      target_id: '1',
      // `IMP-021` keeps review authorship out of moderator-facing surfaces; the id is the handle.
      target_label: null
    });
    expect(rows[0].detail).toEqual({ resolution: 'dismissed', reports_closed: 2 });
  });

  test('a second moderator resolving nothing leaves no entry', async () => {
    // Two moderators, one queue. The second gets a 409 because the first already acted — and
    // logging that click would record a decision nobody made.
    await report(1, 'seed-other-uid');
    await request(app)
      .patch('/api/admin/reports/reviews/1')
      .set(asAdmin)
      .send({ resolution: 'reviewed' });

    const second = await request(app)
      .patch('/api/admin/reports/reviews/1')
      .set(asAdmin)
      .send({ resolution: 'reviewed' });

    expect(second.status).toBe(409);
    expect(await auditRows('report.resolved')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Review deletion — the distinction that keeps this a trail and not surveillance
// ---------------------------------------------------------------------------
describe('only an admin deleting somebody else is recorded', () => {
  test("an admin deleting another person's review is recorded with the place", async () => {
    const res = await request(app).delete('/api/places/1/reviews/1').set(asAdmin);
    expect(res.status).toBe(204);

    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor_uid: 'seed-admin-uid',
      action: 'review.deleted_by_admin',
      target_type: 'review',
      target_id: '1',
      target_label: null
    });
    // The review is gone, so "which place lost a review" is the only context still actionable —
    // and it is answerable without naming the author.
    expect(rows[0].detail).toEqual({ place_id: 1 });
  });

  test('an author deleting their OWN review is not an admin action and is not recorded', async () => {
    // Review 1 belongs to `seed-user-uid`. This is the line between an accountability trail and a
    // log of what ordinary users do to their own content.
    const res = await request(app).delete('/api/places/1/reviews/1').set(asUser);
    expect(res.status).toBe(204);
    expect(await auditRows()).toHaveLength(0);
  });

  test('an admin deleting their own review is also not recorded', async () => {
    // The admin flag is not what makes an entry — acting on somebody else is. Asserted separately
    // because an implementation keyed only on `callerIsAdmin` passes the test above and fails here.
    await pool.query(
      `INSERT INTO place_reviews (place_id, user_id, user_name, rating, comment)
       VALUES (2, 'seed-admin-uid', 'Ada Admin', 5, 'Mine.')`
    );
    const { rows } = await pool.query(
      `SELECT id FROM place_reviews WHERE user_id = 'seed-admin-uid'`
    );

    const res = await request(app).delete(`/api/places/2/reviews/${rows[0].id}`).set(asAdmin);
    expect(res.status).toBe(204);
    expect(await auditRows()).toHaveLength(0);
  });

  test('a failed delete records nothing', async () => {
    const res = await request(app).delete('/api/places/1/reviews/99999').set(asAdmin);
    expect(res.status).toBe(404);
    expect(await auditRows()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// The reader — the thing that makes this an audit trail rather than write amplification
// ---------------------------------------------------------------------------
describe('GET /api/admin/audit', () => {
  const seedEntries = async () => {
    await request(app).post('/api/admin/admins').set(asAdmin).send({ email: OTHER_EMAIL });
    await report(1, 'seed-other-uid');
    await request(app)
      .patch('/api/admin/reports/reviews/1')
      .set(asAdmin)
      .send({ resolution: 'reviewed' });
  };

  test('it is admin-only', async () => {
    const res = await request(app).get('/api/admin/audit').set(asUser);
    expect(res.status).toBe(403);
  });

  test('it requires authentication', async () => {
    const res = await request(app).get('/api/admin/audit');
    expect(res.status).toBe(401);
  });

  test('it returns entries newest first, with a total', async () => {
    await seedEntries();

    const res = await request(app).get('/api/admin/audit').set(asAdmin);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.entries).toHaveLength(2);
    // Newest first: the moderation decision happened after the grant.
    expect(res.body.entries[0].action).toBe('report.resolved');
    expect(res.body.entries[1].action).toBe('admin.granted');
  });

  test('it filters by action, and the total reflects the filter', async () => {
    await seedEntries();

    const res = await request(app).get('/api/admin/audit?action=admin.granted').set(asAdmin);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.entries.every((e) => e.action === 'admin.granted')).toBe(true);
  });

  test('an unknown action is rejected rather than silently ignored', async () => {
    // A filter that quietly falls back to "everything" is how somebody concludes there are no
    // entries of a kind they misspelled.
    const res = await request(app).get('/api/admin/audit?action=admin.invented').set(asAdmin);
    expect(res.status).toBe(400);
  });

  test('an admin sees their own entries — there is no self-filter', async () => {
    await seedEntries();

    const res = await request(app).get('/api/admin/audit').set(asAdmin);
    expect(res.body.entries.every((e) => e.actor_uid === 'seed-admin-uid')).toBe(true);
  });

  test('paging is stable, and limit is capped', async () => {
    await seedEntries();

    const first = await request(app).get('/api/admin/audit?limit=1').set(asAdmin);
    const second = await request(app).get('/api/admin/audit?limit=1&offset=1').set(asAdmin);

    expect(first.body.entries).toHaveLength(1);
    expect(second.body.entries).toHaveLength(1);
    expect(first.body.entries[0].id).not.toBe(second.body.entries[0].id);

    const tooMany = await request(app).get('/api/admin/audit?limit=5000').set(asAdmin);
    expect(tooMany.status).toBe(400);
  });

  test('there is no route that edits or deletes an entry', async () => {
    // An audit trail an admin can rewrite records nothing. Asserted rather than assumed, because
    // adding a "clean up the log" endpoint is an easy and plausible future mistake.
    const patched = await request(app).patch('/api/admin/audit/1').set(asAdmin).send({});
    const deleted = await request(app).delete('/api/admin/audit/1').set(asAdmin);

    expect(patched.status).toBe(404);
    expect(deleted.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Atomicity
// ---------------------------------------------------------------------------
describe('the entry and the action commit together', () => {
  test('a transaction that fails AFTER the audit row leaves no orphan entry', async () => {
    // **The property the whole design rests on, and the one the test below does not actually
    // prove.** That test breaks the audit insert, so the error propagates and rolls everything
    // back — which happens whether the insert used the transaction's client or a pooled
    // connection of its own. It passes for the wrong reason.
    //
    // This one lets the audit insert *succeed* and then fails the enclosing transaction at COMMIT,
    // using a DEFERRABLE constraint. Now the two implementations differ observably: a row written
    // on the transaction's client vanishes with the rollback, and one written on a separate
    // connection has already committed and survives — an audit entry claiming a privilege change
    // that never happened, which is worse than no entry at all.
    //
    // Staged so the failure lands at COMMIT rather than at the statement. A CHECK cannot be
    // deferred in Postgres and a partial unique index cannot be a constraint, so the lever is a
    // deferrable UNIQUE on a column the grant actually writes: removing the target from `users`
    // sends `addAdmin` down its INSERT branch, and a decoy row already holding that display name
    // makes the insert legal on its own and illegal at commit time.
    await pool.query(`DELETE FROM users WHERE firebase_uid = 'seed-other-uid'`);
    await pool.query(
      `INSERT INTO users (firebase_uid, email, name, is_admin)
       VALUES ('decoy-uid', 'decoy@easytrip.test', 'Otto', false)`
    );
    await pool.query(
      `ALTER TABLE users ADD CONSTRAINT users_name_deferred
         UNIQUE (name) DEFERRABLE INITIALLY DEFERRED`
    );

    try {
      const res = await request(app).post('/api/admin/admins').set(asAdmin).send({
        email: OTHER_EMAIL
      });
      expect(res.status).toBe(500);

      // With the insert on the transaction's own client this is empty. With it on a pooled
      // connection there is exactly one row here — recording a grant that was rolled back.
      expect(await auditRows()).toHaveLength(0);

      const stored = await pool.query(`SELECT 1 FROM users WHERE firebase_uid = 'seed-other-uid'`);
      expect(stored.rowCount).toBe(0);
    } finally {
      await pool.query('ALTER TABLE users DROP CONSTRAINT users_name_deferred');
    }
  });

  test('the same holds for a moderation decision', async () => {
    // The moderation path has its own transaction and needs its own proof — the admin one passing
    // says nothing about this one, and a copy-pasted `pool` here would be just as invisible.
    //
    // Same lever, different collision: one open report and one already-resolved report, plus a
    // deferrable UNIQUE on `status`. Resolving the open one to the same value makes two rows share
    // a status — legal per statement, illegal at COMMIT.
    await report(1, 'seed-other-uid');
    await pool.query(
      `INSERT INTO review_reports (review_id, reporter_uid, reason, status)
       VALUES (3, 'seed-admin-uid', NULL, 'reviewed')`
    );
    await pool.query(
      `ALTER TABLE review_reports ADD CONSTRAINT reports_status_deferred
         UNIQUE (status) DEFERRABLE INITIALLY DEFERRED`
    );

    try {
      const res = await request(app)
        .patch('/api/admin/reports/reviews/1')
        .set(asAdmin)
        .send({ resolution: 'reviewed' });
      expect(res.status).toBe(500);

      expect(await auditRows()).toHaveLength(0);

      // And the decision itself did not land either.
      const still = await pool.query(
        `SELECT status FROM review_reports WHERE review_id = 1 AND reporter_uid = 'seed-other-uid'`
      );
      expect(still.rows[0].status).toBe('open');
    } finally {
      await pool.query('ALTER TABLE review_reports DROP CONSTRAINT reports_status_deferred');
    }
  });

  test('a rejected audit row rolls the privilege change back', async () => {
    // The property the whole design rests on, forced by breaking the CHECK constraint the insert
    // must satisfy. If the audit write were fire-and-forget, `is_admin` would be true here and
    // nothing would have recorded it — silently, which is how `ADR-022`'s predecessor survived
    // twenty sprints.
    await pool.query('ALTER TABLE admin_audit_log DROP CONSTRAINT admin_audit_log_action_known');
    await pool.query(
      `ALTER TABLE admin_audit_log ADD CONSTRAINT admin_audit_log_action_known CHECK (action = 'nothing.matches')`
    );

    try {
      const res = await request(app).post('/api/admin/admins').set(asAdmin).send({
        email: OTHER_EMAIL
      });
      expect(res.status).toBe(500);

      const stored = await pool.query(
        `SELECT is_admin FROM users WHERE firebase_uid = 'seed-other-uid'`
      );
      expect(stored.rows[0].is_admin).toBe(false);
      expect(await auditRows()).toHaveLength(0);
    } finally {
      await pool.query('ALTER TABLE admin_audit_log DROP CONSTRAINT admin_audit_log_action_known');
      await pool.query(
        `ALTER TABLE admin_audit_log ADD CONSTRAINT admin_audit_log_action_known CHECK (
           action IN ('admin.granted', 'admin.revoked', 'report.resolved', 'review.deleted_by_admin')
         )`
      );
    }
  });
});
