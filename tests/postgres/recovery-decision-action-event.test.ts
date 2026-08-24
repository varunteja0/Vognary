import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { recordConsentGrant } from "../../src/lib/server/consent-store";
import { getDatabasePool } from "../../src/lib/server/database";
import { recordConsentedProductEvent } from "../../src/lib/server/product-event-store";
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

test("product-event persistence failure cannot roll back or duplicate a frozen decision cycle", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const pool = getDatabasePool();
  const ownerUserId = randomUUID();
  const workspaceId = randomUUID();
  const suffix = randomUUID().replaceAll("-", "");
  const triggerName = `inject_review_event_failure_${suffix}`;
  const functionName = `inject_review_event_failure_${suffix}`;
  const email = `decision-event-failure-${suffix.slice(0, 8)}@example.test`;

  await pool.query(`insert into users (id, email, display_name) values ($1, $2, 'Decision failure owner')`, [ownerUserId, email]);
  await pool.query(`insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Decision failure workspace')`, [workspaceId, ownerUserId]);
  await pool.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [workspaceId, ownerUserId]);

  try {
    const evidence = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: 0,
      idempotencyKey: `decision-failure-evidence-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "cursor-july",
          text: "Cursor invoice paid INR 1,999.00 on 6 July 2026. Cursor Pro monthly subscription. Next billing date: 6 August 2026.",
        }],
      },
      now: new Date("2026-07-20T10:00:00.000Z"),
    });
    const commitmentId = evidence.data.commitments[0]?.id;
    assert.ok(commitmentId);

    await recordConsentGrant({
      workspaceId,
      userId: ownerUserId,
      subjectEmail: email,
      purpose: "product-analytics-opt-in",
      noticeVersion: "privacy-2026-07-11",
      source: "decision-event-failure-test",
      scopes: ["privacy-safe-product-events"],
    });

    await pool.query(`
      create function ${functionName}()
      returns trigger
      language plpgsql
      as $trigger$
      begin
        if new.workspace_id = '${workspaceId}'::uuid
          and new.event_name = 'review.action_recorded'
        then
          raise exception 'injected review.action_recorded persistence failure';
        end if;
        return new;
      end;
      $trigger$
    `);
    await pool.query(`
      create trigger ${triggerName}
      before insert on product_events
      for each row execute function ${functionName}()
    `);

    await assert.rejects(
      () => recordConsentedProductEvent({
        workspaceId,
        userId: ownerUserId,
        eventName: "review.action_recorded",
        occurredAt: "2026-07-20T10:04:00.000Z",
        source: "workspace-api",
        status: "succeeded",
      }),
      /injected review\.action_recorded persistence failure/i,
    );

    const decided = await putRecoveryDecision({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: evidence.workspaceVersion,
      idempotencyKey: `decision-failure-keep-${suffix}`,
      request: { commitmentId, decision: "KEEP", action: "KEEP" },
      now: new Date("2026-07-20T10:05:00.000Z"),
    });
    assert.equal(decided.replayed, false);
    assert.equal(decided.data.decision.value, "KEEP");

    const frozen = await pool.query<{
      cycle_count: string;
      expected_amount_minor: string | null;
      user_action: string | null;
      decision: string | null;
      event_count: string;
    }>(
      `select
         (select count(*)::text from recovery_decision_cycles
          where workspace_id = $1 and commitment_id = $2) as cycle_count,
         (select expected_amount_minor::text from recovery_decision_cycles
          where workspace_id = $1 and commitment_id = $2) as expected_amount_minor,
         (select user_action from recovery_decision_cycles
          where workspace_id = $1 and commitment_id = $2) as user_action,
         (select decision from recovery_decisions
          where workspace_id = $1 and commitment_id = $2) as decision,
         (select count(*)::text from product_events
          where workspace_id = $1 and event_name = 'review.action_recorded') as event_count`,
      [workspaceId, commitmentId],
    );
    assert.deepEqual(frozen.rows[0], {
      cycle_count: "1",
      expected_amount_minor: "199900",
      user_action: "KEEP",
      decision: "KEEP",
      event_count: "0",
    });

    const replay = await putRecoveryDecision({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: evidence.workspaceVersion,
      idempotencyKey: `decision-failure-keep-${suffix}`,
      request: { commitmentId, decision: "KEEP", action: "KEEP" },
      now: new Date("2026-07-20T10:05:00.000Z"),
    });
    assert.equal(replay.replayed, true);

    const afterReplay = await pool.query<{
      cycle_count: string;
      expected_amount_minor: string | null;
      event_count: string;
    }>(
      `select
         (select count(*)::text from recovery_decision_cycles
          where workspace_id = $1 and commitment_id = $2) as cycle_count,
         (select expected_amount_minor::text from recovery_decision_cycles
          where workspace_id = $1 and commitment_id = $2) as expected_amount_minor,
         (select count(*)::text from product_events
          where workspace_id = $1 and event_name = 'review.action_recorded') as event_count`,
      [workspaceId, commitmentId],
    );
    assert.deepEqual(afterReplay.rows[0], {
      cycle_count: "1",
      expected_amount_minor: "199900",
      event_count: "0",
    });
  } finally {
    await pool.query(`drop trigger if exists ${triggerName} on product_events`).catch(() => undefined);
    await pool.query(`drop function if exists ${functionName}()`).catch(() => undefined);
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [ownerUserId]);
  }
});
