import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { getDatabasePool } from "../../src/lib/server/database";
import {
  authorizeSilentCases,
  invoiceWorkspacePeriod,
  listAutopilotCandidates,
  queueDueNotices,
  recordNoticeDelivery,
  recordOperatorExecution,
  revokeStandingMandate,
  signStandingMandate,
  vetoAutopilotCandidate,
  verifyCoveredWindow,
} from "../../src/lib/server/recovery-autopilot-store";
import { getRecoveryHome, submitRecoveryEvidence } from "../../src/lib/server/recovery-store";

const databaseConfigured = Boolean(process.env.DATABASE_URL);

test("standing mandate shadows OpenAI, protects AWS, never executes, and revoke withdraws candidates", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const pool = getDatabasePool();
  const ownerUserId = randomUUID();
  const workspaceId = randomUUID();
  const suffix = randomUUID().slice(0, 8);

  await pool.query(
    `insert into users (id, email, display_name) values ($1, $2, 'Autopilot owner')`,
    [ownerUserId, `autopilot-owner-${suffix}@example.test`],
  );
  await pool.query(
    `insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Autopilot workspace')`,
    [workspaceId, ownerUserId],
  );
  await pool.query(
    `insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`,
    [workspaceId, ownerUserId],
  );

  try {
    const first = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: 0,
      idempotencyKey: `autopilot-openai-1-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "openai-july",
          text: "OpenAI subscription charged INR 1,999 on 6 July 2026. Renews monthly on 6 August 2026.",
        }],
      },
      now: new Date("2026-08-09T10:00:00.000Z"),
    });
    const second = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: first.workspaceVersion,
      idempotencyKey: `autopilot-openai-2-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "openai-august",
          text: "OpenAI subscription charged INR 1,999 on 6 August 2026. Renews monthly on 6 September 2026.",
        }],
      },
      now: new Date("2026-08-09T11:00:00.000Z"),
    });
    const aws = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: second.workspaceVersion,
      idempotencyKey: `autopilot-aws-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "aws-july",
          text: "AWS Amazon Web Services charged INR 4,200 on 1 July 2026 for cloud hosting. Renews monthly on 1 August 2026.",
        }, {
          clientRef: "aws-august",
          text: "AWS Amazon Web Services charged INR 4,200 on 1 August 2026 for cloud hosting. Renews monthly on 1 September 2026.",
        }],
      },
      now: new Date("2026-08-09T12:00:00.000Z"),
    });

    const signed = await signStandingMandate({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: aws.workspaceVersion,
      idempotencyKey: `autopilot-sign-${suffix}`,
    });
    assert.equal(signed.mandate.status, "ACTIVE");
    assert.equal(signed.mandate.vetoWindowHours, 48);

    const listed = await listAutopilotCandidates({ workspaceId, actorUserId: ownerUserId });
    const openai = listed.items.find((item) => /openai/i.test(item.merchant));
    const amazon = listed.items.find((item) => /aws|amazon/i.test(item.merchant));
    assert.ok(openai, "OpenAI candidate should exist after two dated receipts");
    assert.equal(openai.status, "SHADOW");
    assert.equal(openai.eligibility, "UNSUPPORTED_ROUTE");
    assert.ok(amazon, "AWS candidate should exist");
    assert.equal(amazon.eligibility, "PROTECTED");
    assert.equal(amazon.status, "SHADOW");

    const eligibleLeak = await pool.query<{ count: string }>(
      `select count(*)::text as count
       from recovery_action_candidates
       where workspace_id = $1 and eligibility = 'ELIGIBLE' and commitment_class <> 'discretionary-subscription'`,
      [workspaceId],
    );
    assert.equal(eligibleLeak.rows[0]?.count, "0");

    await assert.rejects(
      pool.query(
        `update recovery_action_candidates
         set eligibility = 'ELIGIBLE', commitment_class = 'usage-based-cloud'
         where workspace_id = $1 and id = $2`,
        [workspaceId, amazon.id],
      ),
      /eligibility|check|discretionary-subscription/i,
    );

    const notices = await queueDueNotices();
    assert.equal(notices.delivered, 0);
    const authorized = await authorizeSilentCases();
    assert.equal(authorized.authorized, 0);

    const home = await getRecoveryHome({ workspaceId, actorUserId: ownerUserId });
    assert.equal(home.autopilot?.mandate?.status, "ACTIVE");
    assert.equal(home.autopilot?.executionEnabled, false);

    const zeroFee = await invoiceWorkspacePeriod({
      workspaceId,
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
      currency: "INR",
    });
    assert.equal(zeroFee.retainedMinor, BigInt(0));
    assert.equal(zeroFee.verifiedSavingMinor, BigInt(0));

    const revoked = await revokeStandingMandate({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: signed.workspaceVersion,
      idempotencyKey: `autopilot-revoke-${suffix}`,
    });
    assert.equal(revoked.mandate.status, "REVOKED");
    const afterRevoke = await listAutopilotCandidates({ workspaceId, actorUserId: ownerUserId });
    assert.ok(afterRevoke.items.every((item) => item.status === "REVOKED" || item.status === "VETOED" || item.status === "WITHDRAWN"));
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [ownerUserId]);
  }
});

test("execution cannot mark a shadow candidate executed, and notices do not start the veto clock until delivered", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const previous = {
    execution: process.env.AUTOPILOT_EXECUTION_ENABLED,
    notice: process.env.AUTOPILOT_NOTICE_ENABLED,
    channel: process.env.AUTOPILOT_NOTICE_CHANNEL_READY,
    proven: process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS,
  };
  process.env.AUTOPILOT_EXECUTION_ENABLED = "true";
  process.env.AUTOPILOT_NOTICE_ENABLED = "true";
  process.env.AUTOPILOT_NOTICE_CHANNEL_READY = "true";
  process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS = "openai";

  const pool = getDatabasePool();
  const ownerUserId = randomUUID();
  const workspaceId = randomUUID();
  const suffix = randomUUID().slice(0, 8);
  await pool.query(
    `insert into users (id, email, display_name) values ($1, $2, 'Autopilot owner')`,
    [ownerUserId, `autopilot-gate-${suffix}@example.test`],
  );
  await pool.query(
    `insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Autopilot gate')`,
    [workspaceId, ownerUserId],
  );
  await pool.query(
    `insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`,
    [workspaceId, ownerUserId],
  );

  try {
    const first = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: 0,
      idempotencyKey: `gate-openai-1-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "openai-july",
          text: "OpenAI subscription charged INR 1,999 on 6 July 2026. Renews monthly on 6 September 2026.",
        }],
      },
      now: new Date("2026-08-09T10:00:00.000Z"),
    });
    const second = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: first.workspaceVersion,
      idempotencyKey: `gate-openai-2-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "openai-august",
          text: "OpenAI subscription charged INR 1,999 on 6 August 2026. Renews monthly on 6 September 2026.",
        }],
      },
      now: new Date("2026-08-09T11:00:00.000Z"),
    });
    await pool.query(
      `update recovery_commitments set confidence_score = 90 where workspace_id = $1`,
      [workspaceId],
    );
    await signStandingMandate({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: second.workspaceVersion,
      idempotencyKey: `gate-sign-${suffix}`,
    });
    const listed = await listAutopilotCandidates({ workspaceId, actorUserId: ownerUserId });
    const openai = listed.items.find((item) => /openai/i.test(item.merchant));
    assert.ok(openai);
    assert.equal(openai.status, "SHADOW");
    assert.equal(openai.eligibility, "ELIGIBLE", openai.reasons.join(","));

    await assert.rejects(
      recordOperatorExecution({
        workspaceId,
        actorUserId: ownerUserId,
        candidateId: openai.id,
        minutes: 5,
        outcome: "EXECUTED",
        proofKind: "MERCHANT_CONFIRMATION_EMAIL",
        proofReference: "msg-shadow",
        idempotencyKey: `exec-shadow-${suffix}`,
      }),
      /Execution blocked: (SHADOW_GATE|STATUS_NOT_AUTHORIZED)/,
    );

    const notices = await queueDueNotices(new Date("2026-08-24T00:00:00.000Z"));
    assert.equal(notices.delivered, 0);
    assert.equal(notices.queued, 1);
    const queued = await listAutopilotCandidates({ workspaceId, actorUserId: ownerUserId });
    const queuedOpenAi = queued.items.find((item) => item.id === openai.id);
    assert.equal(queuedOpenAi?.status, "NOTICE_QUEUED");
    assert.equal(queuedOpenAi?.noticeDeliveredAt, null);
    assert.equal(queuedOpenAi?.vetoDeadlineAt, null);

    const providerMessageId = `resend-test-message-${suffix}`;
    await pool.query(
      `update recovery_veto_notices
       set veto_expires_at = $2
       where workspace_id = $1 and candidate_id = $3`,
      [workspaceId, "2026-09-07T01:00:00.000Z", openai.id],
    );
    const delivered = await recordNoticeDelivery({
      workspaceId,
      candidateId: openai.id,
      providerMessageId,
      deliveredAt: new Date("2026-08-24T01:00:00.000Z"),
    });
    assert.equal(delivered.vetoDeadlineAt.toISOString(), "2026-08-26T01:00:00.000Z");
    const afterDelivery = await listAutopilotCandidates({ workspaceId, actorUserId: ownerUserId });
    const deliveredOpenAi = afterDelivery.items.find((item) => item.id === openai.id);
    assert.ok(deliveredOpenAi?.noticeDeliveredAt);
    assert.ok(deliveredOpenAi?.vetoDeadlineAt);

    const tooSoon = await authorizeSilentCases(new Date("2026-08-25T00:00:00.000Z"));
    assert.equal(tooSoon.authorized, 0);
    const afterClock = await authorizeSilentCases(new Date("2026-08-26T01:00:00.000Z"));
    assert.equal(afterClock.authorized, 0, "shadow gate must still block authorization");

    const proof = await verifyCoveredWindow({ workspaceId, candidateId: openai.id });
    assert.equal(proof.status, "PENDING");
    assert.equal(proof.savingMinor, null);

    await invoiceWorkspacePeriod({
      workspaceId,
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
      currency: "INR",
    });
    await assert.rejects(
      invoiceWorkspacePeriod({
        workspaceId,
        periodStart: "2026-08-15",
        periodEnd: "2026-09-15",
        currency: "INR",
      }),
      /overlap/i,
    );

    await pool.query(
      `insert into recovery_provider_disables (provider_id, disabled, reason)
       values ('openai', true, 'test disable')
       on conflict (provider_id) do update set disabled = true`,
    );
    await pool.query(
      `update recovery_action_candidates
       set status = 'AUTHORIZED_BY_RULE',
           eligibility = 'ELIGIBLE',
           notice_delivered_at = now() - interval '49 hours',
           veto_deadline_at = now() - interval '1 hour'
       where id = $1`,
      [openai.id],
    );
    await assert.rejects(
      recordOperatorExecution({
        workspaceId,
        actorUserId: ownerUserId,
        candidateId: openai.id,
        minutes: 5,
        outcome: "EXECUTED",
        proofKind: "MERCHANT_CONFIRMATION_EMAIL",
        proofReference: "msg-disabled",
        idempotencyKey: `exec-disabled-${suffix}`,
      }),
      /Execution blocked: (SHADOW_GATE|PROVIDER_DISABLED)/,
    );
  } finally {
    process.env.AUTOPILOT_EXECUTION_ENABLED = previous.execution ?? "";
    process.env.AUTOPILOT_NOTICE_ENABLED = previous.notice ?? "";
    process.env.AUTOPILOT_NOTICE_CHANNEL_READY = previous.channel ?? "";
    process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS = previous.proven ?? "";
    if (!previous.execution) delete process.env.AUTOPILOT_EXECUTION_ENABLED;
    if (!previous.notice) delete process.env.AUTOPILOT_NOTICE_ENABLED;
    if (!previous.channel) delete process.env.AUTOPILOT_NOTICE_CHANNEL_READY;
    if (!previous.proven) delete process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS;
    await pool.query(`delete from recovery_provider_disables where provider_id = 'openai'`);
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [ownerUserId]);
  }
});

test("persisted private-pilot loop reaches cited picture, mandate, delivered veto, honest exception, pending window, and zero fee", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const previous = {
    execution: process.env.AUTOPILOT_EXECUTION_ENABLED,
    notice: process.env.AUTOPILOT_NOTICE_ENABLED,
    channel: process.env.AUTOPILOT_NOTICE_CHANNEL_READY,
    proven: process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS,
  };
  process.env.AUTOPILOT_EXECUTION_ENABLED = "true";
  process.env.AUTOPILOT_NOTICE_ENABLED = "true";
  process.env.AUTOPILOT_NOTICE_CHANNEL_READY = "true";
  process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS = "openai";

  const pool = getDatabasePool();
  const ownerUserId = randomUUID();
  const workspaceId = randomUUID();
  const suffix = randomUUID().slice(0, 8);
  await pool.query(
    `insert into users (id, email, display_name) values ($1, $2, 'Pilot loop owner')`,
    [ownerUserId, `pilot-loop-${suffix}@example.test`],
  );
  await pool.query(
    `insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Pilot loop')`,
    [workspaceId, ownerUserId],
  );
  await pool.query(
    `insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`,
    [workspaceId, ownerUserId],
  );

  try {
    const first = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: 0,
      idempotencyKey: `pilot-openai-1-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "openai-july",
          text: "OpenAI subscription charged INR 1,999 on 6 July 2026. Renews monthly on 6 September 2026.",
        }],
      },
      now: new Date("2026-08-09T10:00:00.000Z"),
    });
    const second = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: first.workspaceVersion,
      idempotencyKey: `pilot-openai-2-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "openai-august",
          text: "OpenAI subscription charged INR 1,999 on 6 August 2026. Renews monthly on 6 September 2026.",
        }],
      },
      now: new Date("2026-08-09T11:00:00.000Z"),
    });
    const extras = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: second.workspaceVersion,
      idempotencyKey: `pilot-extras-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "aws-july",
          text: "AWS Amazon Web Services charged INR 4,200 on 1 July 2026 for cloud hosting. Renews monthly on 1 August 2026.",
        }, {
          clientRef: "aws-august",
          text: "AWS Amazon Web Services charged INR 4,200 on 1 August 2026 for cloud hosting. Renews monthly on 1 September 2026.",
        }, {
          clientRef: "notion-july",
          text: "Notion subscription charged INR 800 on 3 July 2026. Renews monthly on 3 August 2026.",
        }, {
          clientRef: "notion-august",
          text: "Notion subscription charged INR 800 on 3 August 2026. Renews monthly on 3 September 2026.",
        }],
      },
      now: new Date("2026-08-09T12:00:00.000Z"),
    });

    const homeBeforeMandate = extras.data.home;
    assert.ok(homeBeforeMandate.monthlyTotals.length >= 1);
    assert.ok(homeBeforeMandate.activeCommitmentCount >= 1);
    assert.ok(homeBeforeMandate.next.length >= 1);

    await pool.query(`update recovery_commitments set confidence_score = 90 where workspace_id = $1`, [workspaceId]);
    const signed = await signStandingMandate({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: extras.workspaceVersion,
      idempotencyKey: `pilot-sign-${suffix}`,
    });
    assert.equal(signed.mandate.status, "ACTIVE");

    const listed = await listAutopilotCandidates({ workspaceId, actorUserId: ownerUserId });
    const openai = listed.items.find((item) => /openai/i.test(item.merchant));
    const amazon = listed.items.find((item) => /aws|amazon/i.test(item.merchant));
    const notion = listed.items.find((item) => /notion/i.test(item.merchant));
    assert.ok(openai);
    assert.equal(openai.eligibility, "ELIGIBLE", openai.reasons.join(","));
    assert.ok(amazon);
    assert.equal(amazon.eligibility, "PROTECTED");
    assert.ok(notion);
    assert.notEqual(notion.eligibility, "ELIGIBLE");

    const notices = await queueDueNotices(new Date("2026-08-24T00:00:00.000Z"));
    assert.equal(notices.queued, 1);
    await pool.query(
      `update recovery_veto_notices set veto_expires_at = $2 where workspace_id = $1 and candidate_id = $3`,
      [workspaceId, "2026-09-07T01:00:00.000Z", openai.id],
    );
    const delivered = await recordNoticeDelivery({
      workspaceId,
      candidateId: openai.id,
      providerMessageId: `resend-pilot-${suffix}`,
      deliveredAt: new Date("2026-08-24T01:00:00.000Z"),
    });
    assert.equal(delivered.vetoDeadlineAt.toISOString(), "2026-08-26T01:00:00.000Z");

    const staleSnapshot = await pool.query<{ id: string }>(
      `insert into recovery_classification_snapshots (
         workspace_id, commitment_id, commitment_class, protected_override, cited_category,
         cited_merchant, confidence_score, evidence_ids
       )
       select workspace_id, commitment_id, commitment_class, protected_override, cited_category,
              cited_merchant, confidence_score, evidence_ids
       from recovery_classification_snapshots
       where workspace_id = $1 and commitment_id = $2
       order by created_at desc, id desc
       limit 1
       returning id`,
      [workspaceId, openai.commitmentId],
    );
    assert.ok(staleSnapshot.rows[0]?.id);
    await assert.rejects(
      recordOperatorExecution({
        workspaceId,
        actorUserId: ownerUserId,
        candidateId: openai.id,
        minutes: 4,
        outcome: "EXECUTED",
        proofKind: "MERCHANT_CONFIRMATION_EMAIL",
        proofReference: "must-not-execute-stale",
        idempotencyKey: `pilot-exec-stale-${suffix}`,
      }),
      /Execution blocked: CLASSIFICATION_STALE/,
    );
    await pool.query(`delete from recovery_classification_snapshots where id = $1`, [staleSnapshot.rows[0].id]);

    const vetoed = await vetoAutopilotCandidate({
      workspaceId,
      actorUserId: ownerUserId,
      candidateId: openai.id,
      expectedVersion: signed.workspaceVersion,
      idempotencyKey: `pilot-veto-${suffix}`,
    });
    assert.equal(vetoed.candidate.status, "VETOED");

    const afterClock = await authorizeSilentCases(new Date("2026-08-26T01:00:00.000Z"));
    assert.equal(afterClock.authorized, 0);

    await assert.rejects(
      recordOperatorExecution({
        workspaceId,
        actorUserId: ownerUserId,
        candidateId: openai.id,
        minutes: 4,
        outcome: "EXECUTED",
        proofKind: "MERCHANT_CONFIRMATION_EMAIL",
        proofReference: "must-not-execute-vetoed",
        idempotencyKey: `pilot-exec-veto-${suffix}`,
      }),
      /Execution blocked: (VETOED|SHADOW_GATE)/,
    );

    const exception = await recordOperatorExecution({
      workspaceId,
      actorUserId: ownerUserId,
      candidateId: notion.id,
      minutes: 2,
      outcome: "EXCEPTION",
      failureReason: "LOGIN_REQUIRED",
      idempotencyKey: `pilot-exception-${suffix}`,
    });
    assert.equal(exception.outcome, "EXCEPTION");
    assert.equal(exception.replayed, false);
    const notionAfter = (await listAutopilotCandidates({ workspaceId, actorUserId: ownerUserId }))
      .items.find((item) => item.id === notion.id);
    assert.equal(notionAfter?.exceptionCode, "LOGIN_REQUIRED");

    await assert.rejects(
      recordOperatorExecution({
        workspaceId,
        actorUserId: ownerUserId,
        candidateId: amazon.id,
        minutes: 3,
        outcome: "EXECUTED",
        proofKind: "MERCHANT_CONFIRMATION_EMAIL",
        proofReference: "must-not-execute-protected",
        idempotencyKey: `pilot-exec-aws-${suffix}`,
      }),
      /Execution blocked:/,
    );

    const proof = await verifyCoveredWindow({ workspaceId, candidateId: openai.id });
    assert.equal(proof.status, "PENDING");
    assert.equal(proof.savingMinor, null);

    const fee = await invoiceWorkspacePeriod({
      workspaceId,
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
      currency: "INR",
    });
    assert.equal(fee.verifiedSavingMinor, BigInt(0));
    assert.equal(fee.retainedMinor, BigInt(0));

    const home = await getRecoveryHome({ workspaceId, actorUserId: ownerUserId });
    assert.equal(home.autopilot?.mandate?.status, "ACTIVE");
    assert.ok(home.monthlyTotals.length >= 1);
    assert.ok(home.next.length >= 1);
  } finally {
    process.env.AUTOPILOT_EXECUTION_ENABLED = previous.execution ?? "";
    process.env.AUTOPILOT_NOTICE_ENABLED = previous.notice ?? "";
    process.env.AUTOPILOT_NOTICE_CHANNEL_READY = previous.channel ?? "";
    process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS = previous.proven ?? "";
    if (!previous.execution) delete process.env.AUTOPILOT_EXECUTION_ENABLED;
    if (!previous.notice) delete process.env.AUTOPILOT_NOTICE_ENABLED;
    if (!previous.channel) delete process.env.AUTOPILOT_NOTICE_CHANNEL_READY;
    if (!previous.proven) delete process.env.AUTOPILOT_TEST_PROVEN_PROVIDER_IDS;
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [ownerUserId]);
  }
});
