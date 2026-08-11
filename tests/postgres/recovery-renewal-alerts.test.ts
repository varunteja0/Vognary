import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import {
  createRecoveryCorrection,
  putRecoveryDecision,
  submitRecoveryEvidence,
} from "../../src/lib/server/recovery-store";
import { getDatabasePool } from "../../src/lib/server/database";
import {
  scheduleRenewalAlertsForWorkspace,
  updateRenewalAlertPreference,
} from "../../src/lib/server/renewal-alert-store";

const databaseConfigured = Boolean(process.env.DATABASE_URL);

test("Recovery date corrections and decisions reconcile reminder deliveries atomically", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const pool = getDatabasePool();
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const email = `${userId}@recovery-reminders.test`;

  try {
    await pool.query(`insert into users (id, email) values ($1, $2)`, [userId, email]);
    await pool.query(`insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Recovery reminder test')`, [workspaceId, userId]);
    await pool.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [workspaceId, userId]);
    await updateRenewalAlertPreference({
      workspaceId,
      userId,
      email,
      preference: {
        enabled: true,
        weeklyDigestEnabled: false,
        sevenDayEnabled: true,
        oneDayEnabled: true,
        timeZone: "UTC",
        sendHourLocal: 9,
      },
    });
    const dates = (await pool.query<{ charged_on: string; old_date: string; new_date: string }>(
      `select (current_date - 1)::text as charged_on,
              (current_date + 30)::text as old_date,
              (current_date + 45)::text as new_date`,
    )).rows[0]!;
    await submitRecoveryEvidence({
      workspaceId,
      actorUserId: userId,
      expectedVersion: 0,
      idempotencyKey: `reminder-evidence-${randomUUID()}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "reminder-plan",
          text: `OpenAI subscription charged INR 1,000 on ${dates.charged_on}. Renews monthly on ${dates.old_date}.`,
        }],
      },
      now: new Date(),
    });
    const commitmentId = (await pool.query<{ id: string }>(
      `select id from recovery_commitments where workspace_id = $1`,
      [workspaceId],
    )).rows[0]?.id;
    assert.ok(commitmentId);

    await scheduleRenewalAlertsForWorkspace(workspaceId);
    assert.deepEqual(await deliveryCounts(pool, workspaceId, dates.old_date), { scheduled: 2, cancelled: 0 });

    const corrected = await createRecoveryCorrection({
      workspaceId,
      actorUserId: userId,
      commitmentId,
      expectedVersion: 1,
      idempotencyKey: `reminder-date-${randomUUID()}`,
      request: { patch: { field: "NEXT_EXPECTED_DATE", value: { date: dates.new_date } } },
    });
    assert.equal(corrected.workspaceVersion, 2);
    assert.deepEqual(await deliveryCounts(pool, workspaceId, dates.old_date), { scheduled: 0, cancelled: 2 });
    assert.deepEqual(await deliveryCounts(pool, workspaceId, dates.new_date), { scheduled: 2, cancelled: 0 });

    const kept = await putRecoveryDecision({
      workspaceId,
      actorUserId: userId,
      expectedVersion: 2,
      idempotencyKey: `reminder-keep-${randomUUID()}`,
      request: { commitmentId, decision: "KEEP" },
    });
    assert.equal(kept.workspaceVersion, 3);
    assert.deepEqual(await deliveryCounts(pool, workspaceId, dates.new_date), { scheduled: 0, cancelled: 2 });

    const monitored = await putRecoveryDecision({
      workspaceId,
      actorUserId: userId,
      expectedVersion: 3,
      idempotencyKey: `reminder-monitor-${randomUUID()}`,
      request: { commitmentId, decision: "MONITOR" },
    });
    assert.equal(monitored.workspaceVersion, 4);
    assert.deepEqual(await deliveryCounts(pool, workspaceId, dates.new_date), { scheduled: 2, cancelled: 0 });
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from consent_grants where user_id = $1`, [userId]);
    await pool.query(`delete from users where id = $1`, [userId]);
  }
});

async function deliveryCounts(pool: ReturnType<typeof getDatabasePool>, workspaceId: string, renewalDate: string) {
  const result = await pool.query<{ scheduled: string; cancelled: string }>(
    `select
       count(*) filter (where status = 'scheduled')::text as scheduled,
       count(*) filter (where status = 'cancelled')::text as cancelled
     from renewal_alert_deliveries
     where workspace_id = $1 and renewal_date = $2`,
    [workspaceId, renewalDate],
  );
  return {
    scheduled: Number(result.rows[0]?.scheduled ?? 0),
    cancelled: Number(result.rows[0]?.cancelled ?? 0),
  };
}
