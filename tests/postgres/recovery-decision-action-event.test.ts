import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { recordConsentGrant } from "../../src/lib/server/consent-store";
import { getDatabasePool } from "../../src/lib/server/database";
import { putRecoveryDecision, submitRecoveryEvidence } from "../../src/lib/server/recovery-store";

const databaseConfigured = Boolean(process.env.DATABASE_URL);

test("review.action_recorded is consent-gated, has no metrics payload, and does not fire on replay", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const pool = getDatabasePool();
  const ownerUserId = randomUUID();
  const workspaceId = randomUUID();
  const suffix = randomUUID().slice(0, 8);
  const email = `decision-event-${suffix}@example.test`;

  await pool.query(`insert into users (id, email, display_name) values ($1, $2, 'Decision event owner')`, [ownerUserId, email]);
  await pool.query(`insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Decision event workspace')`, [workspaceId, ownerUserId]);
  await pool.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [workspaceId, ownerUserId]);

  const eventCount = async () => Number((await pool.query<{ n: string }>(
    `select count(*)::text as n from product_events where workspace_id = $1 and event_name = 'review.action_recorded'`,
    [workspaceId],
  )).rows[0]?.n ?? 0);

  try {
    const first = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: 0,
      idempotencyKey: `decision-event-first-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "notion-july",
          text: "Notion invoice paid INR 800.00 on 6 July 2026. Notion Plus monthly. Next billing date: 6 August 2026.",
        }],
      },
      now: new Date("2026-07-20T10:00:00.000Z"),
    });
    const commitmentId = first.data.commitments[0]?.id;
    assert.ok(commitmentId);

    const withoutConsent = await putRecoveryDecision({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: first.workspaceVersion,
      idempotencyKey: `decision-event-keep-${suffix}`,
      request: { commitmentId, decision: "KEEP", action: "KEEP" },
      now: new Date("2026-07-20T10:05:00.000Z"),
    });
    assert.equal(withoutConsent.data.decision.value, "KEEP");
    assert.equal(await eventCount(), 0);

    await recordConsentGrant({
      workspaceId,
      userId: ownerUserId,
      subjectEmail: email,
      purpose: "product-analytics-opt-in",
      noticeVersion: "privacy-2026-07-11",
      source: "decision-event-test",
      scopes: ["privacy-safe-product-events"],
    });

    const replay = await putRecoveryDecision({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: first.workspaceVersion,
      idempotencyKey: `decision-event-keep-${suffix}`,
      request: { commitmentId, decision: "KEEP", action: "KEEP" },
      now: new Date("2026-07-20T10:05:00.000Z"),
    });
    assert.equal(replay.replayed, true);
    assert.equal(await eventCount(), 0);

    const cancelled = await putRecoveryDecision({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: withoutConsent.workspaceVersion,
      idempotencyKey: `decision-event-cancel-${suffix}`,
      request: { commitmentId, decision: "CANCEL", action: "PLAN_TO_CANCEL" },
      now: new Date("2026-07-20T10:10:00.000Z"),
    });
    assert.equal(cancelled.data.decision.value, "CANCEL");
    assert.equal(await eventCount(), 1);
    const recorded = await pool.query<{ metrics: unknown }>(
      `select metrics from product_events
       where workspace_id = $1 and event_name = 'review.action_recorded'`,
      [workspaceId],
    );
    assert.deepEqual(recorded.rows[0]?.metrics, {});
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [ownerUserId]);
  }
});
