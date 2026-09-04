import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Webhook } from "svix";

import { POST as postResendNotice } from "../../src/app/api/webhooks/resend/notice/route";
import {
  applyControlAttentionProviderEvent,
  claimDueControlAttentionNotifications,
  recordControlAttentionProviderAccepted,
  recordControlAttentionSendFailure,
  scheduleControlAttentionNotifications,
} from "../../src/lib/server/commitment-control-attention-store";
import { deliverControlAttentionNotifications } from "../../src/lib/server/commitment-control-attention-delivery";
import {
  createCommitmentControlProposal,
  decideCommitmentControlProposal,
  putCommitmentControlPolicy,
  reconcileCommitmentControlProposal,
  recordCommitmentControlExceptionReview,
} from "../../src/lib/server/commitment-control-store";
import { getDatabasePool } from "../../src/lib/server/database";
import { checkFeatureReadiness } from "../../src/lib/server/feature-readiness";
import { submitRecoveryEvidence } from "../../src/lib/server/recovery-store";
import { completeControlPolicyRequest, futureControlTestDate, testControlOutcome } from "../commitment-control-policy-fixture";

const databaseConfigured = Boolean(process.env.DATABASE_URL);
process.env.COMMITMENT_CONTROL_PILOT_WORKSPACE_IDS = "*";

const skip = databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.";

type Desk = Awaited<ReturnType<typeof seedControlDesk>>;

/**
 * Seeds one synthetic Control desk whose only attention item is DECISION_REQUIRED:
 * the first charge, authorization expiry, and outcome review are all far enough
 * out that no other deterministic item fires.
 */
async function seedControlDesk() {
  const pool = getDatabasePool();
  const suffix = randomUUID().slice(0, 8);
  const workspaceId = randomUUID();
  const ownerUserId = randomUUID();
  const adminUserId = randomUUID();
  const memberUserId = randomUUID();
  const silentAdminUserId = randomUUID();
  const unsubscribedAdminUserId = randomUUID();

  await pool.query(
    `insert into users (id, email, display_name) values
       ($1, $2, 'Attention owner'),
       ($3, $4, 'Attention admin'),
       ($5, $6, 'Attention member'),
       ($7, $8, 'Attention silent admin'),
       ($9, $10, 'Attention unsubscribed admin')`,
    [
      ownerUserId, `attention-owner-${suffix}@example.test`,
      adminUserId, `attention-admin-${suffix}@example.test`,
      memberUserId, `attention-member-${suffix}@example.test`,
      silentAdminUserId, `attention-silent-${suffix}@example.test`,
      unsubscribedAdminUserId, `attention-unsub-${suffix}@example.test`,
    ],
  );
  await pool.query(
    `insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Attention workspace')`,
    [workspaceId, ownerUserId],
  );
  await pool.query(
    `insert into workspace_members (workspace_id, user_id, role) values
       ($1, $2, 'owner'), ($1, $3, 'admin'), ($1, $4, 'member'), ($1, $5, 'admin'), ($1, $6, 'admin')`,
    [workspaceId, ownerUserId, adminUserId, memberUserId, silentAdminUserId, unsubscribedAdminUserId],
  );
  // Consent is opt-in: the silent admin has no preference row at all, and the
  // unsubscribed admin has one that is switched off.
  await pool.query(
    `insert into recovery_notification_preferences (workspace_id, user_id, product_emails) values
       ($1, $2, true), ($1, $3, true), ($1, $4, true)`,
    [workspaceId, ownerUserId, adminUserId, memberUserId],
  );
  await pool.query(
    `insert into recovery_notification_preferences (workspace_id, user_id, product_emails, unsubscribed_at)
     values ($1, $2, false, now())`,
    [workspaceId, unsubscribedAdminUserId],
  );

  await putCommitmentControlPolicy({
    workspaceId,
    actorUserId: ownerUserId,
    expectedVersion: 0,
    idempotencyKey: `attention-policy-${suffix}`,
    request: completeControlPolicyRequest(),
  });
  const firstChargeDate = futureControlTestDate(10);
  const proposal = await createCommitmentControlProposal({
    workspaceId,
    actorUserId: memberUserId,
    expectedVersion: 1,
    idempotencyKey: `attention-proposal-${suffix}`,
    request: {
      merchant: "Synthetic Model Vendor",
      purpose: "Synthetic attention outbox fixture",
      category: "AI_MODEL",
      amountMinor: "199900",
      currency: "INR",
      firstChargeDate,
      cadence: "MONTHLY",
      existingCommitmentIds: [],
      intendedOutcome: testControlOutcome({ reviewOn: futureControlTestDate(30) }),
    },
  });

  return {
    suffix,
    workspaceId,
    ownerUserId,
    adminUserId,
    memberUserId,
    silentAdminUserId,
    unsubscribedAdminUserId,
    proposalId: proposal.data.proposal.id,
    firstChargeDate,
    today: futureControlTestDate(0),
    userIds: [ownerUserId, adminUserId, memberUserId, silentAdminUserId, unsubscribedAdminUserId],
  };
}

async function dropDesk(desk: Desk) {
  const pool = getDatabasePool();
  await pool.query(`delete from workspaces where id = $1`, [desk.workspaceId]).catch(() => undefined);
  await pool.query(`delete from users where id = any($1::uuid[])`, [desk.userIds]).catch(() => undefined);
}

async function readRows(workspaceId: string) {
  const result = await getDatabasePool().query<{
    id: string;
    recipient_user_id: string;
    attention_kind: string;
    due_on: string;
    target_kind: string | null;
    target_id: string | null;
    delivery_state: string;
    state_reason: string | null;
    attempt_count: number;
    next_attempt_at: Date | null;
    locked_by: string | null;
    provider_message_id: string | null;
    provider_accepted_at: Date | null;
    delivered_at: Date | null;
    failed_at: Date | null;
    error_code: string | null;
    last_provider_event_type: string | null;
    last_provider_event_at: Date | null;
  }>(
    `select id, recipient_user_id, attention_kind, to_char(due_on, 'YYYY-MM-DD') as due_on,
       target_kind, target_id::text as target_id,
       delivery_state, state_reason, attempt_count, next_attempt_at, locked_by,
       provider_message_id, provider_accepted_at, delivered_at, failed_at, error_code,
       last_provider_event_type, last_provider_event_at
     from commitment_control_attention_notifications
     where workspace_id = $1
     order by recipient_user_id, attention_kind, created_at, id`,
    [workspaceId],
  );
  return result.rows;
}

async function readRow(workspaceId: string, notificationId: string) {
  const row = (await readRows(workspaceId)).find((candidate) => candidate.id === notificationId);
  assert.ok(row, "the attention row must still exist");
  return row;
}

async function readPreference(workspaceId: string, userId: string) {
  const result = await getDatabasePool().query<{ product_emails: boolean; unsubscribed_at: Date | null }>(
    `select product_emails, unsubscribed_at
     from recovery_notification_preferences
     where workspace_id = $1 and user_id = $2`,
    [workspaceId, userId],
  );
  return result.rows[0] ?? null;
}

/**
 * Walks the real send path far enough to bind one provider message id, because a
 * provider event is only ever matched by that id — never by a recipient address.
 */
async function bindProviderMessage(desk: Desk, providerMessageId: string, now: Date) {
  await scheduleControlAttentionNotifications({ workspaceIds: [desk.workspaceId], now, today: desk.today });
  const claim = await claimDueControlAttentionNotifications({
    workspaceIds: [desk.workspaceId],
    now,
    lockOwner: "worker-a",
    limit: 1,
    today: desk.today,
  });
  const claimed = claim.ready[0];
  assert.ok(claimed, "one attention row must be claimable");
  await recordControlAttentionProviderAccepted({ notificationId: claimed.id, providerMessageId, now });
  return claimed;
}

test("migration 0065 refuses dishonest Control attention delivery rows", { skip }, async () => {
  const desk = await seedControlDesk();
  const pool = getDatabasePool();
  const insert = (columns: string, values: string, parameters: unknown[]) => pool.query(
    `insert into commitment_control_attention_notifications
       (workspace_id, proposal_id, recipient_user_id, attention_kind, due_on, ${columns})
     values ($1, $2, $3, 'DECISION_REQUIRED', $4::date, ${values})`,
    [desk.workspaceId, desk.proposalId, desk.ownerUserId, desk.firstChargeDate, ...parameters],
  );

  try {
    await assert.rejects(
      () => insert("delivery_state, provider_accepted_at, delivered_at", "'DELIVERED', now(), now()", []),
      /delivered_check/,
      "DELIVERED without a provider message id must be refused",
    );
    await assert.rejects(
      () => insert("delivery_state, provider_accepted_at, provider_message_id, delivered_at", "'PROVIDER_ACCEPTED', now(), 'msg-1', now()", []),
      /delivery_proof_check/,
      "provider acceptance must never carry a delivery timestamp",
    );
    await assert.rejects(
      () => insert("delivery_state", "'PROVIDER_ACCEPTED'", []),
      /accepted_check/,
      "PROVIDER_ACCEPTED requires an acceptance timestamp",
    );
    await assert.rejects(
      () => insert("delivery_state", "'RETRY_SCHEDULED'", []),
      /schedule_check/,
      "RETRY_SCHEDULED requires a next attempt",
    );
    await assert.rejects(
      () => insert("delivery_state, next_attempt_at", "'QUEUED', null", []),
      /schedule_check/,
      "QUEUED requires a next attempt",
    );
    await assert.rejects(
      () => insert("delivery_state, next_attempt_at", "'SENDING', null", []),
      /lock_check/,
      "SENDING requires a lock owner and lock time",
    );
    await assert.rejects(
      () => insert("delivery_state, failed_at", "'DEAD_LETTER', null", []),
      /failure_check/,
      "a failed row must record when it failed",
    );
    await assert.rejects(
      () => insert("delivery_state, next_attempt_at", "'CANCELLED', null", []),
      /reason_check/,
      "CANCELLED requires a stated reason",
    );
    await assert.rejects(
      () => insert("delivery_state, next_attempt_at, attempt_count", "'QUEUED', now(), 9", []),
      /attempt_count/,
      "attempt count is bounded",
    );
    await assert.rejects(
      () => insert("delivery_state, next_attempt_at, channel", "'QUEUED', now(), 'IN_APP'", []),
      /channel/,
      "this outbox is EMAIL only",
    );

    await insert("delivery_state, next_attempt_at", "'QUEUED', now()", []);
    await assert.rejects(
      () => insert("delivery_state, next_attempt_at", "'QUEUED', now()", []),
      /occurrence_key/,
      "one attention occurrence per recipient",
    );
  } finally {
    await dropDesk(desk);
  }
});

test("Control attention scheduling is idempotent and only reaches consented owners and admins", { skip }, async () => {
  const desk = await seedControlDesk();
  try {
    const now = new Date();
    const first = await scheduleControlAttentionNotifications({
      workspaceIds: [desk.workspaceId],
      now,
      today: desk.today,
    });
    assert.equal(first.enqueued, 2);
    assert.equal(first.recipients, 2);
    assert.equal(first.cancelled, 0);

    const second = await scheduleControlAttentionNotifications({
      workspaceIds: [desk.workspaceId],
      now,
      today: desk.today,
    });
    assert.equal(second.enqueued, 0, "re-running the same occurrence must not duplicate rows");

    const rows = await readRows(desk.workspaceId);
    assert.equal(rows.length, 2);
    assert.deepEqual(
      rows.map((row) => row.recipient_user_id).sort(),
      [desk.ownerUserId, desk.adminUserId].sort(),
    );
    for (const row of rows) {
      assert.equal(row.delivery_state, "QUEUED");
      assert.equal(row.attention_kind, "DECISION_REQUIRED");
      assert.equal(row.due_on, desk.firstChargeDate);
      assert.equal(row.attempt_count, 0);
    }

    const unenrolled = await scheduleControlAttentionNotifications({
      workspaceIds: [randomUUID()],
      now,
      today: desk.today,
    });
    assert.equal(unenrolled.workspacesScanned, 0, "a workspace with no Control desk stays silent");
  } finally {
    await dropDesk(desk);
  }
});

test("resolved Control attention is cancelled and never claimed for sending", { skip }, async () => {
  const desk = await seedControlDesk();
  try {
    const now = new Date();
    await scheduleControlAttentionNotifications({ workspaceIds: [desk.workspaceId], now, today: desk.today });

    await decideCommitmentControlProposal({
      workspaceId: desk.workspaceId,
      actorUserId: desk.ownerUserId,
      proposalId: desk.proposalId,
      expectedVersion: 2,
      idempotencyKey: `attention-decision-${desk.suffix}`,
      request: {
        action: "APPROVE",
        authorizationExpiresOn: futureControlTestDate(20),
      },
    });

    const rescheduled = await scheduleControlAttentionNotifications({
      workspaceIds: [desk.workspaceId],
      now,
      today: desk.today,
    });
    assert.equal(rescheduled.cancelled, 2);
    assert.equal(rescheduled.enqueued, 0);

    const rows = await readRows(desk.workspaceId);
    for (const row of rows) {
      assert.equal(row.delivery_state, "CANCELLED");
      assert.equal(row.state_reason, "ATTENTION_RESOLVED");
      assert.equal(row.next_attempt_at, null);
    }

    const claim = await claimDueControlAttentionNotifications({
      workspaceIds: [desk.workspaceId],
      now: new Date(now.getTime() + 60_000),
      lockOwner: "test-runner",
      today: desk.today,
    });
    assert.equal(claim.ready.length, 0, "a cancelled row is never sendable");
  } finally {
    await dropDesk(desk);
  }
});

test("stale attention claimed before it resolves is cancelled instead of sent", { skip }, async () => {
  const desk = await seedControlDesk();
  try {
    const now = new Date();
    await scheduleControlAttentionNotifications({ workspaceIds: [desk.workspaceId], now, today: desk.today });
    await decideCommitmentControlProposal({
      workspaceId: desk.workspaceId,
      actorUserId: desk.ownerUserId,
      proposalId: desk.proposalId,
      expectedVersion: 2,
      idempotencyKey: `attention-decision-${desk.suffix}`,
      request: { action: "APPROVE", authorizationExpiresOn: futureControlTestDate(20) },
    });

    const claim = await claimDueControlAttentionNotifications({
      workspaceIds: [desk.workspaceId],
      now: new Date(now.getTime() + 60_000),
      lockOwner: "test-runner",
      today: desk.today,
    });
    assert.equal(claim.ready.length, 0);
    assert.equal(claim.cancelled, 2);

    const rows = await readRows(desk.workspaceId);
    for (const row of rows) {
      assert.equal(row.delivery_state, "CANCELLED");
      assert.equal(row.state_reason, "ATTENTION_RESOLVED");
      assert.equal(row.locked_by, null);
    }
  } finally {
    await dropDesk(desk);
  }
});

test("Control attention claiming is exclusive and stale in-flight sends fail closed without resending", { skip }, async () => {
  const desk = await seedControlDesk();
  const pool = getDatabasePool();
  try {
    const now = new Date();
    await scheduleControlAttentionNotifications({ workspaceIds: [desk.workspaceId], now, today: desk.today });
    const claimNow = new Date(now.getTime() + 60_000);

    const bounded = await claimDueControlAttentionNotifications({
      workspaceIds: [desk.workspaceId],
      now: claimNow,
      lockOwner: "worker-a",
      limit: 1,
      today: desk.today,
    });
    assert.equal(bounded.ready.length, 1, "batch size is respected");
    assert.equal(bounded.ready[0]?.attempt, 1);
    assert.equal(bounded.ready[0]?.item.kind, "DECISION_REQUIRED");
    assert.ok(bounded.ready[0]?.recipientEmail.endsWith("@example.test"));

    const holder = await pool.connect();
    try {
      await holder.query("begin");
      await holder.query(
        `select id from commitment_control_attention_notifications
         where workspace_id = $1 and delivery_state = 'QUEUED' for update`,
        [desk.workspaceId],
      );
      const blocked = await claimDueControlAttentionNotifications({
        workspaceIds: [desk.workspaceId],
        now: claimNow,
        lockOwner: "worker-b",
        today: desk.today,
      });
      assert.equal(blocked.ready.length, 0, "a row locked by another worker is skipped, not awaited");
      await holder.query("rollback");
    } finally {
      holder.release();
    }

    const second = await claimDueControlAttentionNotifications({
      workspaceIds: [desk.workspaceId],
      now: claimNow,
      lockOwner: "worker-b",
      today: desk.today,
    });
    assert.equal(second.ready.length, 1);

    // Both rows are now SENDING. Nothing is due until the locks go stale.
    const none = await claimDueControlAttentionNotifications({
      workspaceIds: [desk.workspaceId],
      now: claimNow,
      lockOwner: "worker-c",
      today: desk.today,
    });
    assert.equal(none.ready.length, 0);

    const unresolved = await claimDueControlAttentionNotifications({
      workspaceIds: [desk.workspaceId],
      now: new Date(claimNow.getTime() + 31 * 60_000),
      lockOwner: "worker-c",
      staleLockMinutes: 30,
      today: desk.today,
    });
    assert.equal(unresolved.ready.length, 0, "an unknown provider outcome is never sent again");
    assert.equal(unresolved.deadLettered, 2);
    const staleRows = await readRows(desk.workspaceId);
    assert.deepEqual(staleRows.map((row) => row.attempt_count), [1, 1], "stale recovery does not spend retry budget");
    assert.ok(staleRows.every((row) => row.delivery_state === "DEAD_LETTER"));
    assert.ok(staleRows.every((row) => row.error_code === "ACCEPTANCE_OUTCOME_UNKNOWN"));
  } finally {
    await dropDesk(desk);
  }
});

test("provider acceptance is recorded separately from delivery", { skip }, async () => {
  const desk = await seedControlDesk();
  try {
    const now = new Date();
    await scheduleControlAttentionNotifications({ workspaceIds: [desk.workspaceId], now, today: desk.today });
    const claim = await claimDueControlAttentionNotifications({
      workspaceIds: [desk.workspaceId],
      now,
      lockOwner: "worker-a",
      limit: 1,
      today: desk.today,
    });
    const claimed = claim.ready[0];
    assert.ok(claimed);

    const accepted = await recordControlAttentionProviderAccepted({
      notificationId: claimed.id,
      providerMessageId: "synthetic-provider-message",
      now,
    });
    assert.equal(accepted.state, "PROVIDER_ACCEPTED");
    const afterAccept = (await readRows(desk.workspaceId)).find((row) => row.id === claimed.id);
    assert.equal(afterAccept?.delivered_at, null, "acceptance is not delivery");
    assert.equal(afterAccept?.locked_by, null);
    assert.notEqual(afterAccept?.provider_accepted_at, null);

    const acceptedReplay = await recordControlAttentionProviderAccepted({
      notificationId: claimed.id,
      providerMessageId: "synthetic-provider-message",
      now: new Date(now.getTime() + 500),
    });
    assert.equal(acceptedReplay.state, "PROVIDER_ACCEPTED", "a recovered worker may persist the same provider acceptance twice");

    const delivered = await applyControlAttentionProviderEvent({
      providerMessageId: "synthetic-provider-message",
      type: "email.delivered",
      occurredAt: now,
    });
    assert.equal(delivered.state, "DELIVERED");
    const afterDelivery = (await readRows(desk.workspaceId)).find((row) => row.id === claimed.id);
    assert.notEqual(afterDelivery?.delivered_at, null);
    assert.equal(afterDelivery?.provider_message_id, "synthetic-provider-message");

    const deliveredReplay = await recordControlAttentionProviderAccepted({
      notificationId: claimed.id,
      providerMessageId: "synthetic-provider-message",
      now: new Date(now.getTime() + 1_000),
    });
    assert.equal(deliveredReplay.state, "DELIVERED", "late acceptance cannot retract signed delivery");

    const other = (await readRows(desk.workspaceId)).find((row) => row.id !== claimed.id);
    assert.equal(other?.delivery_state, "QUEUED", "one recipient's delivery says nothing about another");
  } finally {
    await dropDesk(desk);
  }
});

test("retryable Control attention failures back off within budget, then dead-letter", { skip }, async () => {
  const desk = await seedControlDesk();
  const pool = getDatabasePool();
  try {
    // One eligible recipient at a time, so each claim returns the same row.
    await pool.query(
      `update recovery_notification_preferences set product_emails = false
       where workspace_id = $1 and user_id = $2`,
      [desk.workspaceId, desk.adminUserId],
    );
    const start = new Date();
    await scheduleControlAttentionNotifications({ workspaceIds: [desk.workspaceId], now: start, today: desk.today });

    let cursor = start;
    let state = "";
    for (const expectedDelayMinutes of [2, 8, 32]) {
      const claim = await claimDueControlAttentionNotifications({
        workspaceIds: [desk.workspaceId],
        now: cursor,
        lockOwner: "worker-a",
        limit: 1,
        today: desk.today,
      });
      assert.equal(claim.ready.length, 1);
      const failure = await recordControlAttentionSendFailure({
        notificationId: claim.ready[0]!.id,
        errorCode: "SYNTHETIC_TIMEOUT",
        retryable: true,
        now: cursor,
      });
      assert.equal(failure.state, "RETRY_SCHEDULED");
      assert.ok(failure.nextAttemptAt);
      assert.equal(
        Date.parse(failure.nextAttemptAt) - cursor.getTime(),
        expectedDelayMinutes * 60_000,
        "backoff reuses the shared notification schedule",
      );
      cursor = new Date(Date.parse(failure.nextAttemptAt));
      state = failure.state;
    }
    assert.equal(state, "RETRY_SCHEDULED");

    const final = await claimDueControlAttentionNotifications({
      workspaceIds: [desk.workspaceId],
      now: cursor,
      lockOwner: "worker-a",
      limit: 1,
      today: desk.today,
    });
    assert.equal(final.ready.length, 1);
    const exhausted = await recordControlAttentionSendFailure({
      notificationId: final.ready[0]!.id,
      errorCode: "SYNTHETIC_TIMEOUT",
      retryable: true,
      now: cursor,
    });
    assert.equal(exhausted.state, "DEAD_LETTER");
    assert.equal(exhausted.nextAttemptAt, null);

    await pool.query(
      `update recovery_notification_preferences set product_emails = true
       where workspace_id = $1 and user_id = $2`,
      [desk.workspaceId, desk.adminUserId],
    );
    const reopened = await scheduleControlAttentionNotifications({
      workspaceIds: [desk.workspaceId],
      now: cursor,
      today: desk.today,
    });
    assert.equal(reopened.enqueued, 1, "a dead-lettered occurrence is not re-queued for the same recipient");

    const hard = await claimDueControlAttentionNotifications({
      workspaceIds: [desk.workspaceId],
      now: cursor,
      lockOwner: "worker-a",
      limit: 1,
      today: desk.today,
    });
    assert.equal(hard.ready.length, 1, "the second recipient is untouched by the first failure");
    const rejected = await recordControlAttentionSendFailure({
      notificationId: hard.ready[0]!.id,
      errorCode: "SYNTHETIC_REJECTED_ADDRESS",
      retryable: false,
      now: cursor,
    });
    assert.equal(rejected.state, "FAILED");
    assert.equal(rejected.nextAttemptAt, null);

    const rows = await readRows(desk.workspaceId);
    assert.deepEqual(rows.map((row) => row.delivery_state).sort(), ["DEAD_LETTER", "FAILED"]);
    for (const row of rows) {
      assert.equal(row.locked_by, null);
      assert.equal(row.next_attempt_at, null);
    }
  } finally {
    await dropDesk(desk);
  }
});

test("Control attention rows are erased with the workspace, proposal, or recipient", { skip }, async () => {
  const pool = getDatabasePool();
  const proposalDesk = await seedControlDesk();
  try {
    await scheduleControlAttentionNotifications({
      workspaceIds: [proposalDesk.workspaceId],
      now: new Date(),
      today: proposalDesk.today,
    });
    assert.equal((await readRows(proposalDesk.workspaceId)).length, 2);

    await pool.query(`delete from users where id = $1`, [proposalDesk.adminUserId]);
    assert.equal((await readRows(proposalDesk.workspaceId)).length, 1, "recipient erasure removes their attention rows");

    // A proposal cannot be deleted on its own (Control rows are immutable while
    // the workspace exists), so the proposal cascade is asserted on the key.
    const proposalForeignKey = await pool.query<{ definition: string }>(
      `select pg_get_constraintdef(constraint_.oid) as definition
       from pg_constraint constraint_
       where constraint_.conrelid = 'commitment_control_attention_notifications'::regclass
         and constraint_.contype = 'f'
         and constraint_.confrelid = 'commitment_control_proposals'::regclass`,
    );
    assert.match(proposalForeignKey.rows[0]?.definition ?? "", /ON DELETE CASCADE/);
  } finally {
    await dropDesk(proposalDesk);
  }

  const workspaceDesk = await seedControlDesk();
  try {
    await scheduleControlAttentionNotifications({
      workspaceIds: [workspaceDesk.workspaceId],
      now: new Date(),
      today: workspaceDesk.today,
    });
    assert.equal((await readRows(workspaceDesk.workspaceId)).length, 2);
    await pool.query(`delete from workspaces where id = $1`, [workspaceDesk.workspaceId]);
    assert.equal((await readRows(workspaceDesk.workspaceId)).length, 0, "workspace erasure cascades");
  } finally {
    await dropDesk(workspaceDesk);
  }
});

test("the Control attention worker records provider acceptance without claiming delivery", { skip }, async () => {
  const desk = await seedControlDesk();
  const previousAdapter = process.env.CONTROL_ATTENTION_TEST_ADAPTER;
  process.env.CONTROL_ATTENTION_TEST_ADAPTER = "true";
  try {
    const result = await deliverControlAttentionNotifications({
      workspaceIds: [desk.workspaceId],
      now: new Date(),
      today: desk.today,
      lockOwner: "synthetic-attention-worker",
    });

    assert.deepEqual(result, {
      status: "completed",
      scheduled: 2,
      selected: 2,
      providerAccepted: 2,
      retryScheduled: 0,
      failed: 0,
      deadLettered: 0,
      cancelled: 0,
      suppressed: 0,
      unsubscribed: 0,
    });
    assert.doesNotMatch(JSON.stringify(result), /@example\.test|Synthetic Model Vendor/);
    const rows = await readRows(desk.workspaceId);
    assert.deepEqual(rows.map((row) => row.delivery_state), ["PROVIDER_ACCEPTED", "PROVIDER_ACCEPTED"]);
    assert.ok(rows.every((row) => row.provider_message_id?.startsWith("test-")));
    assert.ok(rows.every((row) => row.delivered_at === null), "provider acceptance is not inbox delivery");
  } finally {
    if (previousAdapter === undefined) delete process.env.CONTROL_ATTENTION_TEST_ADAPTER;
    else process.env.CONTROL_ATTENTION_TEST_ADAPTER = previousAdapter;
    await dropDesk(desk);
  }
});

test("the signed Resend webhook is the only path that records Control email delivery", { skip }, async () => {
  const desk = await seedControlDesk();
  const previousSecret = process.env.RESEND_NOTICE_WEBHOOK_SECRET;
  const signingSecret = "whsec_testcontrolattentionsecret";
  process.env.RESEND_NOTICE_WEBHOOK_SECRET = signingSecret;
  try {
    const now = new Date();
    await scheduleControlAttentionNotifications({ workspaceIds: [desk.workspaceId], now, today: desk.today });
    const claim = await claimDueControlAttentionNotifications({
      workspaceIds: [desk.workspaceId],
      now,
      lockOwner: "signed-webhook-test",
      limit: 1,
      today: desk.today,
    });
    const notification = claim.ready[0];
    assert.ok(notification);
    const providerMessageId = `control-${randomUUID()}`;
    await recordControlAttentionProviderAccepted({ notificationId: notification.id, providerMessageId, now });

    const response = await postResendNotice(signedNoticeRequest({
      type: "email.delivered",
      created_at: new Date(now.getTime() + 1_000).toISOString(),
      data: {
        email_id: providerMessageId,
        tags: [{ name: "vognary", value: "control-attention" }],
      },
    }, signingSecret));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "applied" });

    const delivered = (await readRows(desk.workspaceId)).find((row) => row.id === notification.id);
    assert.equal(delivered?.delivery_state, "DELIVERED");
    assert.notEqual(delivered?.delivered_at, null);

    const unrelated = await postResendNotice(signedNoticeRequest({
      type: "email.delivered",
      created_at: new Date(now.getTime() + 2_000).toISOString(),
      data: {
        email_id: providerMessageId,
        tags: [{ name: "vognary", value: "unrelated" }],
      },
    }, signingSecret));
    assert.deepEqual(await unrelated.json(), { status: "ignored" });
  } finally {
    if (previousSecret === undefined) delete process.env.RESEND_NOTICE_WEBHOOK_SECRET;
    else process.env.RESEND_NOTICE_WEBHOOK_SECRET = previousSecret;
    await dropDesk(desk);
  }
});

test("Control readiness cannot borrow delivery proof from a previously enrolled workspace", { skip }, async () => {
  const deliveredDesk = await seedControlDesk();
  const currentDesk = await seedControlDesk();
  const previousEnrollment = process.env.COMMITMENT_CONTROL_PILOT_WORKSPACE_IDS;
  try {
    const now = new Date();
    await scheduleControlAttentionNotifications({
      workspaceIds: [deliveredDesk.workspaceId],
      now,
      today: deliveredDesk.today,
    });
    const claim = await claimDueControlAttentionNotifications({
      workspaceIds: [deliveredDesk.workspaceId],
      now,
      lockOwner: "historical-workspace",
      limit: 1,
      today: deliveredDesk.today,
    });
    const notification = claim.ready[0];
    assert.ok(notification);
    const providerMessageId = `control-${randomUUID()}`;
    await recordControlAttentionProviderAccepted({ notificationId: notification.id, providerMessageId, now });
    await applyControlAttentionProviderEvent({
      providerMessageId,
      type: "email.delivered",
      occurredAt: new Date(now.getTime() + 1_000),
    });

    process.env.COMMITMENT_CONTROL_PILOT_WORKSPACE_IDS = currentDesk.workspaceId;
    const readiness = await checkFeatureReadiness();
    assert.equal(readiness.controlAttention.enrolledWorkspaceCount, 1);
    assert.equal(readiness.controlAttention.workspacesWithDelivery, 0);
    assert.equal(readiness.controlAttention.lastDeliveredAt, null);
  } finally {
    if (previousEnrollment === undefined) delete process.env.COMMITMENT_CONTROL_PILOT_WORKSPACE_IDS;
    else process.env.COMMITMENT_CONTROL_PILOT_WORKSPACE_IDS = previousEnrollment;
    await dropDesk(deliveredDesk);
    await dropDesk(currentDesk);
  }
});

function signedNoticeRequest(payload: object, signingSecret: string) {
  const raw = JSON.stringify(payload);
  const messageId = `msg_${randomUUID()}`;
  const timestamp = new Date();
  const signature = new Webhook(signingSecret).sign(messageId, timestamp, raw);
  return new Request("https://vognary.test/api/webhooks/resend/notice", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "svix-id": messageId,
      "svix-timestamp": String(Math.floor(timestamp.getTime() / 1_000)),
      "svix-signature": signature,
    },
    body: raw,
  });
}

test("migration 0066 binds one provider message id to one attention row", { skip }, async () => {
  const desk = await seedControlDesk();
  const pool = getDatabasePool();
  const insert = (recipientUserId: string, columns: string, values: string) => pool.query(
    `insert into commitment_control_attention_notifications
       (workspace_id, proposal_id, recipient_user_id, attention_kind, due_on, ${columns})
     values ($1, $2, $3, 'DECISION_REQUIRED', $4::date, ${values})`,
    [desk.workspaceId, desk.proposalId, recipientUserId, desk.firstChargeDate],
  );

  try {
    await insert(
      desk.ownerUserId,
      "delivery_state, provider_accepted_at, provider_message_id",
      "'PROVIDER_ACCEPTED', now(), 'synthetic-message-a'",
    );
    await assert.rejects(
      () => insert(
        desk.adminUserId,
        "delivery_state, provider_accepted_at, provider_message_id",
        "'PROVIDER_ACCEPTED', now(), 'synthetic-message-a'",
      ),
      /provider_message_key/,
      "a provider message id identifies at most one attention row",
    );

    await assert.rejects(
      () => insert(
        desk.adminUserId,
        "delivery_state, next_attempt_at, last_provider_event_type, last_provider_event_at",
        "'QUEUED', now(), 'email.delivered', now()",
      ),
      /provider_event_binding_check/,
      "a provider event cursor requires a bound provider message id",
    );
    await assert.rejects(
      () => insert(
        desk.adminUserId,
        "delivery_state, provider_accepted_at, provider_message_id, last_provider_event_at",
        "'PROVIDER_ACCEPTED', now(), 'synthetic-message-b', now()",
      ),
      /provider_event_pair_check/,
      "an event time without an event type is not an ordering fact",
    );
    await assert.rejects(
      () => insert(
        desk.adminUserId,
        "delivery_state, provider_accepted_at, provider_message_id, last_provider_event_type, last_provider_event_at",
        "'PROVIDER_ACCEPTED', now(), 'synthetic-message-b', 'email.opened', now()",
      ),
      /provider_event_type_check/,
      "only the recognized Resend notice event types may be recorded",
    );

    await assert.rejects(
      () => insert(
        desk.adminUserId,
        "delivery_state, provider_accepted_at, delivered_at",
        "'UNSUBSCRIBED', now(), now()",
      ),
      /delivery_proof_check/,
      "a delivery timestamp still requires the provider message that proves it",
    );
    await insert(
      desk.adminUserId,
      "delivery_state, provider_accepted_at, provider_message_id, delivered_at",
      "'UNSUBSCRIBED', now(), 'synthetic-message-b', now()",
    );
  } finally {
    await dropDesk(desk);
  }
});

test("a provider event for an unbound message id stays pending so the provider retries", { skip }, async () => {
  const desk = await seedControlDesk();
  try {
    const now = new Date();
    await scheduleControlAttentionNotifications({ workspaceIds: [desk.workspaceId], now, today: desk.today });
    const claim = await claimDueControlAttentionNotifications({
      workspaceIds: [desk.workspaceId],
      now,
      lockOwner: "worker-a",
      limit: 1,
      today: desk.today,
    });
    assert.equal(claim.ready.length, 1);

    const pending = await applyControlAttentionProviderEvent({
      providerMessageId: "synthetic-unbound-message",
      type: "email.delivered",
      occurredAt: now,
    });
    assert.deepEqual(pending, { result: "pending", notificationId: null, state: null });

    const row = await readRow(desk.workspaceId, claim.ready[0]!.id);
    assert.equal(row.delivery_state, "SENDING", "an unmatched event never touches a live row");
    assert.equal(row.last_provider_event_type, null);
  } finally {
    await dropDesk(desk);
  }
});

test("a provider sent or delayed event never claims Control attention delivery", { skip }, async () => {
  const desk = await seedControlDesk();
  try {
    const now = new Date();
    const claimed = await bindProviderMessage(desk, "synthetic-message-sent", now);

    const sent = await applyControlAttentionProviderEvent({
      providerMessageId: "synthetic-message-sent",
      type: "email.sent",
      occurredAt: new Date(now.getTime() + 1_000),
    });
    assert.equal(sent.result, "duplicate", "the provider taking the message is the acceptance we already hold");
    assert.equal(sent.state, "PROVIDER_ACCEPTED");

    const delayed = await applyControlAttentionProviderEvent({
      providerMessageId: "synthetic-message-sent",
      type: "email.delivery_delayed",
      occurredAt: new Date(now.getTime() + 2_000),
    });
    assert.equal(delayed.result, "applied");
    assert.equal(delayed.state, "PROVIDER_ACCEPTED", "a delay is not a delivery");

    const row = await readRow(desk.workspaceId, claimed.id);
    assert.equal(row.delivery_state, "PROVIDER_ACCEPTED");
    assert.equal(row.delivered_at, null);
    assert.equal(row.last_provider_event_type, "email.delivery_delayed");
    assert.equal(row.last_provider_event_at?.getTime(), now.getTime() + 2_000);
  } finally {
    await dropDesk(desk);
  }
});

test("delivery is recorded once and repeats preserve the first delivered timestamp", { skip }, async () => {
  const desk = await seedControlDesk();
  try {
    const now = new Date();
    const claimed = await bindProviderMessage(desk, "synthetic-message-delivered", now);
    const deliveredAt = new Date(now.getTime() + 5_000);

    const applied = await applyControlAttentionProviderEvent({
      providerMessageId: "synthetic-message-delivered",
      type: "email.delivered",
      occurredAt: deliveredAt,
    });
    assert.equal(applied.result, "applied");
    assert.equal(applied.state, "DELIVERED");

    const replay = await applyControlAttentionProviderEvent({
      providerMessageId: "synthetic-message-delivered",
      type: "email.delivered",
      occurredAt: deliveredAt,
    });
    assert.equal(replay.result, "duplicate");

    const later = await applyControlAttentionProviderEvent({
      providerMessageId: "synthetic-message-delivered",
      type: "email.delivered",
      occurredAt: new Date(now.getTime() + 9_000),
    });
    assert.equal(later.result, "duplicate", "a second delivery claim adds nothing");

    const row = await readRow(desk.workspaceId, claimed.id);
    assert.equal(row.delivery_state, "DELIVERED");
    assert.equal(row.delivered_at?.getTime(), deliveredAt.getTime(), "the first delivery time is the one on record");
    assert.equal(row.provider_accepted_at?.getTime(), now.getTime());
    assert.notEqual(row.provider_accepted_at?.getTime(), row.delivered_at?.getTime());
  } finally {
    await dropDesk(desk);
  }
});

test("an older provider event never overwrites newer Control attention state", { skip }, async () => {
  const desk = await seedControlDesk();
  try {
    const now = new Date();
    const claimed = await bindProviderMessage(desk, "synthetic-message-stale", now);
    const deliveredAt = new Date(now.getTime() + 10_000);
    await applyControlAttentionProviderEvent({
      providerMessageId: "synthetic-message-stale",
      type: "email.delivered",
      occurredAt: deliveredAt,
    });

    const stale = await applyControlAttentionProviderEvent({
      providerMessageId: "synthetic-message-stale",
      type: "email.bounced",
      occurredAt: new Date(now.getTime() + 4_000),
    });
    assert.equal(stale.result, "ignored");
    assert.equal(stale.state, "DELIVERED");

    const staleRow = await readRow(desk.workspaceId, claimed.id);
    assert.equal(staleRow.delivery_state, "DELIVERED");
    assert.equal(staleRow.failed_at, null);
    assert.equal(staleRow.delivered_at?.getTime(), deliveredAt.getTime());
    assert.equal(staleRow.last_provider_event_type, "email.delivered");
    assert.equal(staleRow.last_provider_event_at?.getTime(), deliveredAt.getTime());

    const lateSent = await applyControlAttentionProviderEvent({
      providerMessageId: "synthetic-message-stale",
      type: "email.sent",
      occurredAt: new Date(now.getTime() + 20_000),
    });
    assert.equal(lateSent.result, "ignored", "a late acceptance cannot unsay delivery");
    const afterLateSent = await readRow(desk.workspaceId, claimed.id);
    assert.equal(afterLateSent.delivery_state, "DELIVERED");
    assert.equal(afterLateSent.delivered_at?.getTime(), deliveredAt.getTime());
    assert.equal(afterLateSent.last_provider_event_at?.getTime(), now.getTime() + 20_000);
  } finally {
    await dropDesk(desk);
  }
});

test("a provider terminal failure stops the Control attention email without a retry", { skip }, async () => {
  const desk = await seedControlDesk();
  try {
    const now = new Date();
    const claimed = await bindProviderMessage(desk, "synthetic-message-bounced", now);

    const bounced = await applyControlAttentionProviderEvent({
      providerMessageId: "synthetic-message-bounced",
      type: "email.bounced",
      occurredAt: new Date(now.getTime() + 3_000),
    });
    assert.equal(bounced.result, "applied");
    assert.equal(bounced.state, "FAILED");

    const row = await readRow(desk.workspaceId, claimed.id);
    assert.equal(row.delivery_state, "FAILED");
    assert.equal(row.failed_at?.getTime(), now.getTime() + 3_000);
    assert.equal(row.delivered_at, null);
    assert.equal(row.next_attempt_at, null, "a provider terminal failure is never retried");
    assert.equal(row.error_code, "PROVIDER_BOUNCED");

    const repeat = await applyControlAttentionProviderEvent({
      providerMessageId: "synthetic-message-bounced",
      type: "email.failed",
      occurredAt: new Date(now.getTime() + 4_000),
    });
    assert.equal(repeat.result, "duplicate");
    assert.equal((await readRow(desk.workspaceId, claimed.id)).failed_at?.getTime(), now.getTime() + 3_000);

    const reclaim = await claimDueControlAttentionNotifications({
      workspaceIds: [desk.workspaceId],
      now: new Date(now.getTime() + 60 * 60_000),
      lockOwner: "worker-b",
      today: desk.today,
    });
    assert.ok(
      reclaim.ready.every((entry) => entry.id !== claimed.id),
      "a bounced address is never picked up for another attempt",
    );
  } finally {
    await dropDesk(desk);
  }
});

test("a complaint unsubscribes the recipient even after delivery", { skip }, async () => {
  const desk = await seedControlDesk();
  try {
    const now = new Date();
    const claimed = await bindProviderMessage(desk, "synthetic-message-complaint", now);
    const deliveredAt = new Date(now.getTime() + 6_000);
    await applyControlAttentionProviderEvent({
      providerMessageId: "synthetic-message-complaint",
      type: "email.delivered",
      occurredAt: deliveredAt,
    });

    const complainedAt = new Date(now.getTime() + 12_000);
    const complaint = await applyControlAttentionProviderEvent({
      providerMessageId: "synthetic-message-complaint",
      type: "email.complained",
      occurredAt: complainedAt,
    });
    assert.equal(complaint.result, "applied");
    assert.equal(complaint.state, "UNSUBSCRIBED");

    const row = await readRow(desk.workspaceId, claimed.id);
    assert.equal(row.delivery_state, "UNSUBSCRIBED");
    assert.equal(row.state_reason, null);
    assert.equal(row.delivered_at?.getTime(), deliveredAt.getTime(), "the delivery that was complained about stays on record");

    const preference = await readPreference(desk.workspaceId, claimed.recipientUserId);
    assert.equal(preference?.product_emails, false);
    assert.equal(preference?.unsubscribed_at?.getTime(), complainedAt.getTime());

    const otherUserId = [desk.ownerUserId, desk.adminUserId].find((userId) => userId !== claimed.recipientUserId);
    const otherPreference = await readPreference(desk.workspaceId, otherUserId!);
    assert.equal(otherPreference?.product_emails, true, "one complaint never silences another person");
    assert.equal(otherPreference?.unsubscribed_at, null);

    const repeat = await applyControlAttentionProviderEvent({
      providerMessageId: "synthetic-message-complaint",
      type: "email.complained",
      occurredAt: new Date(now.getTime() + 20_000),
    });
    assert.equal(repeat.result, "duplicate");
    assert.equal(
      (await readPreference(desk.workspaceId, claimed.recipientUserId))?.unsubscribed_at?.getTime(),
      complainedAt.getTime(),
      "the first opt-out time is the one on record",
    );

    const afterComplaint = await applyControlAttentionProviderEvent({
      providerMessageId: "synthetic-message-complaint",
      type: "email.delivered",
      occurredAt: new Date(now.getTime() + 30_000),
    });
    assert.equal(afterComplaint.result, "ignored", "nothing reverses an unsubscribe");
    assert.equal((await readRow(desk.workspaceId, claimed.id)).delivery_state, "UNSUBSCRIBED");
  } finally {
    await dropDesk(desk);
  }
});

async function currentWorkspaceVersion(workspaceId: string) {
  const result = await getDatabasePool().query<{ version: string }>(
    `select version::text from recovery_workspace_states where workspace_id = $1`,
    [workspaceId],
  );
  return Number(result.rows[0]?.version ?? 0);
}

/**
 * Authorizes the seeded proposal and links two receipts that are both above the
 * frozen cap on the same evidence date, so one proposal holds two distinct
 * adverse reconciliations that share an attention kind and a due date. Only the
 * reviewed record differs between them.
 */
async function seedTwoAdverseReconciliations(desk: Desk) {
  await decideCommitmentControlProposal({
    workspaceId: desk.workspaceId,
    actorUserId: desk.ownerUserId,
    proposalId: desk.proposalId,
    expectedVersion: await currentWorkspaceVersion(desk.workspaceId),
    idempotencyKey: `attention-target-decision-${desk.suffix}`,
    request: {
      action: "APPROVE_WITH_CAP",
      approvedCapMinor: "180000",
      authorizationExpiresOn: futureControlTestDate(20),
    },
  });

  const reconciliationIds: string[] = [];
  for (const receipt of [{ ref: "target-a", amount: "1,999.00" }, { ref: "target-b", amount: "2,499.00" }]) {
    await submitRecoveryEvidence({
      workspaceId: desk.workspaceId,
      actorUserId: desk.ownerUserId,
      expectedVersion: await currentWorkspaceVersion(desk.workspaceId),
      idempotencyKey: `attention-evidence-${receipt.ref}-${desk.suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: `${receipt.ref}-${desk.suffix}`,
          text: `Synthetic Model Vendor invoice paid INR ${receipt.amount} on ${desk.today}. Monthly.`,
        }],
      },
    });
    const evidenceId = (await getDatabasePool().query<{ id: string }>(
      `select id from recovery_evidence where workspace_id = $1 order by created_at desc, id desc limit 1`,
      [desk.workspaceId],
    )).rows[0]?.id;
    assert.ok(evidenceId, "the pasted receipt must produce linkable evidence");
    const reconciled = await reconcileCommitmentControlProposal({
      workspaceId: desk.workspaceId,
      actorUserId: desk.ownerUserId,
      proposalId: desk.proposalId,
      expectedVersion: await currentWorkspaceVersion(desk.workspaceId),
      idempotencyKey: `attention-reconcile-${receipt.ref}-${desk.suffix}`,
      request: { evidenceId },
    });
    assert.equal(reconciled.data.reconciliation.verdict, "OVER_CAP");
    assert.equal(reconciled.data.reconciliation.observedEvidenceDate, desk.today);
    reconciliationIds.push(reconciled.data.reconciliation.id);
  }
  return reconciliationIds;
}

test("a second adverse target on one proposal schedules its own attention row after the first is reviewed", { skip }, async () => {
  const desk = await seedControlDesk();
  try {
    const reconciliationIds = await seedTwoAdverseReconciliations(desk);
    const now = new Date();

    const first = await scheduleControlAttentionNotifications({
      workspaceIds: [desk.workspaceId],
      now,
      today: desk.today,
    });
    assert.equal(first.enqueued, 2, "one email per consented recipient");
    const queued = await readRows(desk.workspaceId);
    assert.equal(queued.length, 2);
    const firstTargetId = queued[0]!.target_id;
    assert.ok(firstTargetId && reconciliationIds.includes(firstTargetId));
    for (const row of queued) {
      assert.equal(row.attention_kind, "RECONCILIATION_EXCEPTION");
      assert.equal(row.target_kind, "RECONCILIATION");
      assert.equal(row.due_on, desk.today);
      assert.equal(row.target_id, firstTargetId, "email still interrupts once per proposal");
    }

    await recordCommitmentControlExceptionReview({
      workspaceId: desk.workspaceId,
      actorUserId: desk.ownerUserId,
      proposalId: desk.proposalId,
      expectedVersion: await currentWorkspaceVersion(desk.workspaceId),
      idempotencyKey: `attention-target-review-${desk.suffix}`,
      request: {
        targetKind: "RECONCILIATION",
        targetId: firstTargetId,
        disposition: "NO_FURTHER_ACTION",
        note: "The vendor credited this overage outside Vognary.",
      },
    });

    const second = await scheduleControlAttentionNotifications({
      workspaceIds: [desk.workspaceId],
      now: new Date(now.getTime() + 60_000),
      today: desk.today,
    });
    assert.equal(second.cancelled, 2, "the reviewed target stops interrupting");
    assert.equal(
      second.enqueued,
      2,
      "the unreviewed target is a distinct occurrence even at the same kind and due date",
    );

    const rows = await readRows(desk.workspaceId);
    assert.equal(rows.length, 4);
    const secondTargetId = reconciliationIds.find((id) => id !== firstTargetId);
    for (const row of rows) {
      assert.equal(row.attention_kind, "RECONCILIATION_EXCEPTION");
      assert.equal(row.due_on, desk.today);
      assert.equal(row.target_kind, "RECONCILIATION");
      assert.equal(
        row.target_id,
        row.delivery_state === "QUEUED" ? secondTargetId : firstTargetId,
      );
    }
    const live = rows.filter((row) => row.delivery_state === "QUEUED");
    assert.equal(live.length, 2);
    assert.equal(
      new Set(live.map((row) => row.recipient_user_id)).size,
      2,
      "one live email per proposal per recipient still holds",
    );

    const claim = await claimDueControlAttentionNotifications({
      workspaceIds: [desk.workspaceId],
      now: new Date(now.getTime() + 120_000),
      lockOwner: "target-identity-worker",
      today: desk.today,
    });
    assert.equal(claim.ready.length, 2, "the live rows still match live attention");
    for (const entry of claim.ready) {
      assert.equal(entry.item.targetId, secondTargetId);
      assert.equal(entry.item.targetKind, "RECONCILIATION");
    }
  } finally {
    await dropDesk(desk);
  }
});

test("migration 0068 requires target identity only where the attention kind has a target", { skip }, async () => {
  const desk = await seedControlDesk();
  const pool = getDatabasePool();
  const insert = (attentionKind: string, targetKind: string | null, targetId: string | null) => pool.query(
    `insert into commitment_control_attention_notifications
       (workspace_id, proposal_id, recipient_user_id, attention_kind, due_on,
        target_kind, target_id, delivery_state, next_attempt_at)
     values ($1, $2, $3, $4, $5::date, $6, $7::uuid, 'QUEUED', now())`,
    [desk.workspaceId, desk.proposalId, desk.ownerUserId, attentionKind, desk.firstChargeDate, targetKind, targetId],
  );

  try {
    await assert.rejects(
      () => insert("RECONCILIATION_EXCEPTION", null, null),
      /target identity/i,
      "a targeted attention kind must name the record it is about",
    );
    await assert.rejects(
      () => insert("DECISION_REQUIRED", "RECONCILIATION", randomUUID()),
      /untargeted_kind_check/,
      "an untargeted attention kind must carry no target",
    );
    await assert.rejects(
      () => insert("RECONCILIATION_EXCEPTION", "RECONCILIATION", null),
      /target_pair_check/,
      "a target kind without a target id identifies nothing",
    );
    await assert.rejects(
      () => insert("DECISION_REQUIRED", null, randomUUID()),
      /target_pair_check/,
      "a target id without a target kind identifies nothing",
    );
    await assert.rejects(
      () => insert("RECONCILIATION_EXCEPTION", "EVIDENCE", randomUUID()),
      /target_kind_check/,
      "only the two Control exception target kinds exist",
    );

    const targetA = randomUUID();
    const targetB = randomUUID();
    await insert("OUTCOME_MISSED", "OUTCOME_OBSERVATION", targetA);
    await assert.rejects(
      () => insert("OUTCOME_MISSED", "OUTCOME_OBSERVATION", targetA),
      /targeted_occurrence_key/,
      "one attention occurrence per recipient and target",
    );
    await insert("OUTCOME_MISSED", "OUTCOME_OBSERVATION", targetB);

    await insert("DECISION_REQUIRED", null, null);
    await assert.rejects(
      () => insert("DECISION_REQUIRED", null, null),
      /untargeted_occurrence_key/,
      "untargeted occurrences still dedupe on a null target",
    );
  } finally {
    await dropDesk(desk);
  }
});
