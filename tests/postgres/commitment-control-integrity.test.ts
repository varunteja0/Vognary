import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { recordConsentGrant } from "../../src/lib/server/consent-store";
import {
  createCommitmentControlProposal,
  decideCommitmentControlProposal,
  getCommitmentControlBrief,
  putCommitmentControlPolicy,
  reconcileCommitmentControlProposal,
} from "../../src/lib/server/commitment-control-store";
import { getDatabasePool } from "../../src/lib/server/database";
import { RecoveryServiceError } from "../../src/lib/server/recovery-api";
import { submitRecoveryEvidence } from "../../src/lib/server/recovery-store";
import { completeControlPolicyRequest, futureControlTestDate } from "../commitment-control-policy-fixture";

const databaseConfigured = Boolean(process.env.DATABASE_URL);
const futureFirstChargeDate = futureControlTestDate();
process.env.COMMITMENT_CONTROL_PILOT_WORKSPACE_IDS = "*";

test("selected Recovery exposure stays cited and currency-separated through persistence", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const pool = getDatabasePool();
  const ownerUserId = randomUUID();
  const workspaceId = randomUUID();
  const suffix = randomUUID().slice(0, 8);
  await seedWorkspace(pool, { ownerUserId, workspaceId, suffix, label: "Control exposure" });

  try {
    const evidence = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: 0,
      idempotencyKey: `control-exposure-evidence-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [
          { clientRef: "openai-june", text: "OpenAI invoice paid INR 1,999.00 on 1 June 2026. Monthly subscription. Next billing date: 1 July 2026." },
          { clientRef: "openai-july", text: "OpenAI invoice paid INR 1,999.00 on 1 July 2026. Monthly subscription. Next billing date: 1 August 2026." },
          { clientRef: "aws-june", text: "AWS invoice paid USD 100.00 on 2 June 2026. Monthly cloud service. Next billing date: 2 July 2026." },
          { clientRef: "aws-july", text: "AWS invoice paid USD 100.00 on 2 July 2026. Monthly cloud service. Next billing date: 2 August 2026." },
        ],
      },
      now: new Date("2026-08-25T08:00:00.000Z"),
    });
    const commitments = await pool.query<{ id: string; currency: string }>(
      `select id, base_currency as currency
       from recovery_commitments where workspace_id = $1 order by base_currency`,
      [workspaceId],
    );
    assert.deepEqual(commitments.rows.map((row) => row.currency), ["INR", "USD"]);

    const policy = await putCommitmentControlPolicy({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: evidence.workspaceVersion,
      idempotencyKey: `control-exposure-policy-${suffix}`,
      request: completeControlPolicyRequest({
        currencyLimits: [
          { currency: "INR", maxPerChargeMinor: "500000", maxThirteenWeekMinor: "5000000", maxAnnualMinor: "20000000" },
          { currency: "USD", maxPerChargeMinor: "50000", maxThirteenWeekMinor: "100000", maxAnnualMinor: "500000" },
        ],
      }),
    });
    const proposal = await createCommitmentControlProposal({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: policy.workspaceVersion,
      idempotencyKey: `control-exposure-proposal-${suffix}`,
      request: {
        merchant: "Anthropic",
        purpose: "Production model capacity",
        category: "AI_MODEL",
        amountMinor: "249900",
        currency: "INR",
        firstChargeDate: "2026-09-01",
        cadence: "MONTHLY",
        existingCommitmentIds: commitments.rows.map((row) => row.id),
      },
      now: new Date("2026-08-25T09:00:00.000Z"),
    });

    assert.deepEqual(proposal.data.evaluation.currencyResults.map((result) => result.currency), ["INR", "USD"]);
    assert.equal(proposal.data.evaluation.currencyResults[1]?.proposedAnnualMinor, "0");
    assert.equal(proposal.data.evaluation.citedEvidenceIds.length, 4);
    const links = await pool.query<{ count: string }>(
      `select count(*)::text as count
       from commitment_control_evaluation_evidence
       where workspace_id = $1 and evaluation_id = $2`,
      [workspaceId, proposal.data.evaluation.id],
    );
    assert.equal(links.rows[0]?.count, "4");
  } finally {
    await eraseWorkspace(pool, workspaceId, [ownerUserId]);
  }
});

test("concurrent decisions serialize, and consented events do not duplicate on replay", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const pool = getDatabasePool();
  const ownerUserId = randomUUID();
  const workspaceId = randomUUID();
  const suffix = randomUUID().slice(0, 8);
  const email = `control-events-${suffix}@example.test`;
  await seedWorkspace(pool, { ownerUserId, workspaceId, suffix, label: "Control events", email });

  try {
    await recordConsentGrant({
      workspaceId,
      userId: ownerUserId,
      subjectEmail: email,
      purpose: "product-analytics-opt-in",
      noticeVersion: "privacy-2026-07-11",
      source: "commitment-control-integrity-test",
      scopes: ["privacy-safe-product-events"],
    });
    const policyInput = {
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: 0,
      idempotencyKey: `control-events-policy-${suffix}`,
      request: completeControlPolicyRequest(),
    };
    const policy = await putCommitmentControlPolicy(policyInput);
    await putCommitmentControlPolicy(policyInput);
    const proposal = await createCommitmentControlProposal({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: policy.workspaceVersion,
      idempotencyKey: `control-events-proposal-${suffix}`,
      request: {
        merchant: "OpenAI",
        purpose: "Production capacity",
        category: "AI_MODEL",
        amountMinor: "199900",
        currency: "INR",
        firstChargeDate: futureFirstChargeDate,
        cadence: "MONTHLY",
        existingCommitmentIds: [],
      },
    });

    const attempts = await Promise.allSettled([
      decideCommitmentControlProposal({
        workspaceId,
        actorUserId: ownerUserId,
        proposalId: proposal.data.proposal.id,
        expectedVersion: proposal.workspaceVersion,
        idempotencyKey: `control-events-approve-${suffix}`,
        request: { action: "APPROVE" },
      }),
      decideCommitmentControlProposal({
        workspaceId,
        actorUserId: ownerUserId,
        proposalId: proposal.data.proposal.id,
        expectedVersion: proposal.workspaceVersion,
        idempotencyKey: `control-events-decline-${suffix}`,
        request: { action: "DECLINE" },
      }),
    ]);
    assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 1);
    const rejected = attempts.find((attempt): attempt is PromiseRejectedResult => attempt.status === "rejected");
    assert.ok(rejected?.reason instanceof RecoveryServiceError);
    assert.equal(rejected.reason.code, "STALE_STATE");

    const events = await pool.query<{ event_name: string; count: string; metrics_empty: boolean }>(
      `select event_name, count(*)::text as count,
              bool_and(metrics = '{}'::jsonb) as metrics_empty
       from product_events
       where workspace_id = $1 and event_name like 'control.%'
       group by event_name order by event_name`,
      [workspaceId],
    );
    assert.deepEqual(events.rows.map((row) => [row.event_name, row.count]), [
      ["control.decision_recorded", "1"],
      ["control.policy_recorded", "1"],
      ["control.proposal_submitted", "1"],
    ]);
    assert.equal(events.rows.every((row) => row.metrics_empty), true);
  } finally {
    await eraseWorkspace(pool, workspaceId, [ownerUserId]);
  }
});

test("deleting an actor nulls identity fields without mutating immutable financial facts", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const pool = getDatabasePool();
  const ownerUserId = randomUUID();
  const adminUserId = randomUUID();
  const workspaceId = randomUUID();
  const suffix = randomUUID().slice(0, 8);
  await seedWorkspace(pool, { ownerUserId, workspaceId, suffix, label: "Control actor erasure" });
  await pool.query(`insert into users (id, email, display_name) values ($1, $2, 'Control admin')`, [adminUserId, `control-admin-${suffix}@example.test`]);
  await pool.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'admin')`, [workspaceId, adminUserId]);

  try {
    const policy = await putCommitmentControlPolicy({
      workspaceId,
      actorUserId: adminUserId,
      expectedVersion: 0,
      idempotencyKey: `control-erasure-policy-${suffix}`,
      request: completeControlPolicyRequest(),
    });
    const proposal = await createCommitmentControlProposal({
      workspaceId,
      actorUserId: adminUserId,
      expectedVersion: policy.workspaceVersion,
      idempotencyKey: `control-erasure-proposal-${suffix}`,
      request: {
        merchant: "OpenAI",
        purpose: "Production capacity",
        category: "AI_MODEL",
        amountMinor: "199900",
        currency: "INR",
        firstChargeDate: futureFirstChargeDate,
        cadence: "MONTHLY",
        existingCommitmentIds: [],
      },
    });
    const decision = await decideCommitmentControlProposal({
      workspaceId,
      actorUserId: ownerUserId,
      proposalId: proposal.data.proposal.id,
      expectedVersion: proposal.workspaceVersion,
      idempotencyKey: `control-erasure-decision-${suffix}`,
      request: { action: "APPROVE_WITH_CAP", approvedCapMinor: "180000" },
    });
    const evidence = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: decision.workspaceVersion,
      idempotencyKey: `control-erasure-evidence-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{ clientRef: "observed", text: "OpenAI invoice paid INR 1,999.00 on 1 September 2026. Monthly." }],
      },
      now: new Date("2026-09-01T09:00:00.000Z"),
    });
    const evidenceId = (await pool.query<{ id: string }>(
      `select id from recovery_evidence where workspace_id = $1 order by created_at desc limit 1`,
      [workspaceId],
    )).rows[0]?.id;
    assert.ok(evidenceId);
    await reconcileCommitmentControlProposal({
      workspaceId,
      actorUserId: adminUserId,
      proposalId: proposal.data.proposal.id,
      expectedVersion: evidence.workspaceVersion,
      idempotencyKey: `control-erasure-reconcile-${suffix}`,
      request: { evidenceId },
    });

    await pool.query(`delete from users where id = $1`, [adminUserId]);
    const brief = await getCommitmentControlBrief({ workspaceId, actorUserId: ownerUserId });
    const item = brief.data.proposals.find((entry) => entry.proposal.id === proposal.data.proposal.id);
    assert.equal(brief.data.policy?.createdByUserId, null);
    assert.equal(item?.proposal.submittedByUserId, null);
    assert.equal(item?.proposal.submittedByDisplayName, "Control admin");
    assert.equal(item?.decision?.decidedByUserId, ownerUserId);
    assert.equal(item?.decision?.decidedByDisplayName, "Control actor erasure owner");
    assert.equal(item?.decision?.approvedCapMinor, "180000");
    assert.equal(item?.reconciliations[0]?.reconciledByUserId, null);
    assert.equal(item?.reconciliations[0]?.verdict, "OVER_CAP");
  } finally {
    await eraseWorkspace(pool, workspaceId, [ownerUserId, adminUserId]);
  }
});

test("analytics failure cannot roll back or duplicate a frozen Control decision", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const pool = getDatabasePool();
  const ownerUserId = randomUUID();
  const workspaceId = randomUUID();
  const suffix = randomUUID().replaceAll("-", "");
  const email = `control-event-failure-${suffix.slice(0, 8)}@example.test`;
  const triggerName = `inject_control_event_failure_${suffix}`;
  const functionName = `inject_control_event_failure_${suffix}`;
  await seedWorkspace(pool, { ownerUserId, workspaceId, suffix: suffix.slice(0, 8), label: "Control event failure", email });

  try {
    await recordConsentGrant({
      workspaceId,
      userId: ownerUserId,
      subjectEmail: email,
      purpose: "product-analytics-opt-in",
      noticeVersion: "privacy-2026-07-11",
      source: "commitment-control-event-failure-test",
      scopes: ["privacy-safe-product-events"],
    });
    const policy = await putCommitmentControlPolicy({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: 0,
      idempotencyKey: `control-event-failure-policy-${suffix}`,
      request: completeControlPolicyRequest(),
    });
    const proposal = await createCommitmentControlProposal({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: policy.workspaceVersion,
      idempotencyKey: `control-event-failure-proposal-${suffix}`,
      request: {
        merchant: "OpenAI",
        purpose: "Production capacity",
        category: "AI_MODEL",
        amountMinor: "199900",
        currency: "INR",
        firstChargeDate: futureFirstChargeDate,
        cadence: "MONTHLY",
        existingCommitmentIds: [],
      },
    });
    await pool.query(`
      create function ${functionName}()
      returns trigger
      language plpgsql
      as $trigger$
      begin
        if new.workspace_id = '${workspaceId}'::uuid
          and new.event_name = 'control.decision_recorded'
        then
          raise exception 'injected control decision event failure';
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

    const decisionInput = {
      workspaceId,
      actorUserId: ownerUserId,
      proposalId: proposal.data.proposal.id,
      expectedVersion: proposal.workspaceVersion,
      idempotencyKey: `control-event-failure-decision-${suffix}`,
      request: { action: "APPROVE" as const },
    };
    const decision = await decideCommitmentControlProposal(decisionInput);
    assert.equal(decision.replayed, false);
    assert.equal(decision.data.decision.action, "APPROVE");

    const replay = await decideCommitmentControlProposal(decisionInput);
    assert.equal(replay.replayed, true);
    assert.equal(replay.data.decision.id, decision.data.decision.id);
    const persisted = await pool.query<{ decisions: string; events: string }>(
      `select
         (select count(*)::text from commitment_control_decisions
          where workspace_id = $1 and proposal_id = $2) as decisions,
         (select count(*)::text from product_events
          where workspace_id = $1 and event_name = 'control.decision_recorded') as events`,
      [workspaceId, proposal.data.proposal.id],
    );
    assert.deepEqual(persisted.rows[0], { decisions: "1", events: "0" });
  } finally {
    await pool.query(`drop trigger if exists ${triggerName} on product_events`).catch(() => undefined);
    await pool.query(`drop function if exists ${functionName}()`).catch(() => undefined);
    await eraseWorkspace(pool, workspaceId, [ownerUserId]);
  }
});

async function seedWorkspace(
  pool: ReturnType<typeof getDatabasePool>,
  input: { ownerUserId: string; workspaceId: string; suffix: string; label: string; email?: string },
) {
  await pool.query(
    `insert into users (id, email, display_name) values ($1, $2, $3)`,
    [input.ownerUserId, input.email ?? `control-integrity-${input.suffix}@example.test`, `${input.label} owner`],
  );
  await pool.query(
    `insert into workspaces (id, owner_user_id, name) values ($1, $2, $3)`,
    [input.workspaceId, input.ownerUserId, input.label],
  );
  await pool.query(
    `insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`,
    [input.workspaceId, input.ownerUserId],
  );
}

async function eraseWorkspace(
  pool: ReturnType<typeof getDatabasePool>,
  workspaceId: string,
  userIds: string[],
) {
  await pool.query(`delete from workspaces where id = $1`, [workspaceId]).catch(() => undefined);
  await pool.query(`delete from consent_grants where user_id = any($1::uuid[])`, [userIds]).catch(() => undefined);
  await pool.query(`delete from users where id = any($1::uuid[])`, [userIds]).catch(() => undefined);
}