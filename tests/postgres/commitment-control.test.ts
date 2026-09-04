import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { getDatabasePool } from "../../src/lib/server/database";
import {
  createCommitmentControlProposal,
  decideCommitmentControlProposal,
  getCommitmentControlBrief,
  putCommitmentControlPolicy,
  reconcileCommitmentControlProposal,
} from "../../src/lib/server/commitment-control-store";
import { RecoveryServiceError } from "../../src/lib/server/recovery-api";
import { submitRecoveryEvidence } from "../../src/lib/server/recovery-store";
import { completeControlPolicyRequest } from "../commitment-control-policy-fixture";

const databaseConfigured = Boolean(process.env.DATABASE_URL);
process.env.COMMITMENT_CONTROL_PILOT_WORKSPACE_IDS = "*";

test("Commitment Control persists one tenant-safe immutable authorization chain", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const pool = getDatabasePool();
  const ownerUserId = randomUUID();
  const memberUserId = randomUUID();
  const otherUserId = randomUUID();
  const workspaceId = randomUUID();
  const otherWorkspaceId = randomUUID();
  const suffix = randomUUID().slice(0, 8);

  await pool.query(
    `insert into users (id, email, display_name) values
       ($1, $2, 'Control owner'),
       ($3, $4, 'Control member'),
       ($5, $6, 'Other control owner')`,
    [
      ownerUserId, `control-owner-${suffix}@example.test`,
      memberUserId, `control-member-${suffix}@example.test`,
      otherUserId, `control-other-${suffix}@example.test`,
    ],
  );
  await pool.query(
    `insert into workspaces (id, owner_user_id, name) values
       ($1, $2, 'Control workspace'),
       ($3, $4, 'Other control workspace')`,
    [workspaceId, ownerUserId, otherWorkspaceId, otherUserId],
  );
  await pool.query(
    `insert into workspace_members (workspace_id, user_id, role) values
       ($1, $2, 'owner'),
       ($1, $3, 'member'),
       ($4, $5, 'owner')`,
    [workspaceId, ownerUserId, memberUserId, otherWorkspaceId, otherUserId],
  );

  const policyRequest = completeControlPolicyRequest();

  try {
    const policy = await putCommitmentControlPolicy({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: 0,
      idempotencyKey: `control-policy-${suffix}`,
      request: policyRequest,
      now: new Date("2026-08-25T09:00:00.000Z"),
    });
    assert.equal(policy.workspaceVersion, 1);
    assert.equal(policy.replayed, false);
    assert.equal(policy.data.policy.policyVersion, 1);

    const replay = await putCommitmentControlPolicy({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: 0,
      idempotencyKey: `control-policy-${suffix}`,
      request: policyRequest,
      now: new Date("2026-08-25T09:00:00.000Z"),
    });
    assert.equal(replay.replayed, true);
    assert.equal(replay.workspaceVersion, 1);

    await assert.rejects(
      () => putCommitmentControlPolicy({
        workspaceId,
        actorUserId: ownerUserId,
        expectedVersion: 1,
        idempotencyKey: `control-policy-${suffix}`,
        request: { ...policyRequest, currencyLimits: [{ ...policyRequest.currencyLimits[0], maxPerChargeMinor: "400000" }] },
      }),
      (error: unknown) => error instanceof RecoveryServiceError && error.code === "CONFLICT",
    );

    const proposal = await createCommitmentControlProposal({
      workspaceId,
      actorUserId: memberUserId,
      expectedVersion: 1,
      idempotencyKey: `control-proposal-${suffix}`,
      request: {
        merchant: "OpenAI",
        purpose: "Production model capacity",
        category: "AI_MODEL",
        amountMinor: "199900",
        currency: "INR",
        firstChargeDate: "2026-09-01",
        cadence: "MONTHLY",
        existingCommitmentIds: [],
        intendedOutcome: {
          metric: "Resolved support cases",
          targetDirection: "AT_LEAST",
          targetValue: "1200",
          unit: "cases",
          reviewOn: "2026-09-15",
        },
      },
      now: new Date("2026-08-24T18:30:00.000Z"),
    });
    assert.equal(proposal.workspaceVersion, 2);
    assert.equal(proposal.data.proposal.asOfDate, "2026-08-25");
    assert.equal(proposal.data.evaluation.status, "WITHIN_POLICY");
    assert.equal(proposal.data.proposal.assumptionBasis, "USER_ENTERED_ASSUMPTION");
    assert.equal(proposal.data.proposal.intendedOutcome?.targetValue, "1200");

    await assert.rejects(
      () => createCommitmentControlProposal({
        workspaceId,
        actorUserId: memberUserId,
        expectedVersion: 1,
        idempotencyKey: `control-stale-${suffix}`,
        request: {
          merchant: "Anthropic",
          purpose: "Research model capacity",
          category: "AI_MODEL",
          amountMinor: "249900",
          currency: "INR",
          firstChargeDate: "2026-09-02",
          cadence: "MONTHLY",
          existingCommitmentIds: [],
          intendedOutcome: {
            metric: "Research tasks completed",
            targetDirection: "AT_LEAST",
            targetValue: "20",
            unit: "tasks",
            reviewOn: "2026-09-15",
          },
        },
      }),
      (error: unknown) => error instanceof RecoveryServiceError && error.code === "STALE_STATE" && error.currentVersion === 2,
    );

    await assert.rejects(
      () => decideCommitmentControlProposal({
        workspaceId,
        actorUserId: memberUserId,
        proposalId: proposal.data.proposal.id,
        expectedVersion: 2,
        idempotencyKey: `control-member-decision-${suffix}`,
        request: { action: "APPROVE", authorizationExpiresOn: "2026-09-10" },
      }),
      (error: unknown) => error instanceof RecoveryServiceError && error.code === "FORBIDDEN",
    );

    const decision = await decideCommitmentControlProposal({
      workspaceId,
      actorUserId: ownerUserId,
      proposalId: proposal.data.proposal.id,
      expectedVersion: 2,
      idempotencyKey: `control-owner-decision-${suffix}`,
      request: {
        action: "APPROVE_WITH_CAP",
        approvedCapMinor: "180000",
        authorizationExpiresOn: "2026-09-10",
      },
      now: new Date("2026-08-25T09:10:00.000Z"),
    });
    assert.equal(decision.workspaceVersion, 3);
    assert.equal(decision.data.decision.approvedCapMinor, "180000");
    assert.equal(decision.data.decision.authorizationExpiresOn, "2026-09-10");

    const declinedProposal = await createCommitmentControlProposal({
      workspaceId,
      actorUserId: memberUserId,
      expectedVersion: 3,
      idempotencyKey: `control-declined-proposal-${suffix}`,
      request: {
        merchant: "Campaign partner",
        purpose: "One-time launch campaign",
        category: "CAMPAIGN",
        amountMinor: "100000",
        currency: "INR",
        firstChargeDate: "2026-09-01",
        cadence: "ONE_TIME",
        existingCommitmentIds: [],
        intendedOutcome: {
          metric: "Qualified launch conversations",
          targetDirection: "AT_LEAST",
          targetValue: "10",
          unit: "conversations",
          reviewOn: "2026-09-15",
        },
      },
      now: new Date("2026-08-25T09:11:00.000Z"),
    });
    const declined = await decideCommitmentControlProposal({
      workspaceId,
      actorUserId: ownerUserId,
      proposalId: declinedProposal.data.proposal.id,
      expectedVersion: declinedProposal.workspaceVersion,
      idempotencyKey: `control-declined-decision-${suffix}`,
      request: { action: "DECLINE" },
      now: new Date("2026-08-25T09:12:00.000Z"),
    });

    const observed = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: declined.workspaceVersion,
      idempotencyKey: `control-evidence-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "openai-observed",
          text: "OpenAI invoice paid INR 1,999.00 on 1 September 2026. Monthly subscription.",
        }],
      },
      now: new Date("2026-09-01T09:00:00.000Z"),
    });
    assert.equal(observed.workspaceVersion, 6);
    const evidenceId = (await pool.query<{ id: string }>(
      `select id from recovery_evidence where workspace_id = $1 order by created_at desc limit 1`,
      [workspaceId],
    )).rows[0]?.id;
    assert.ok(evidenceId);

    await submitRecoveryEvidence({
      workspaceId: otherWorkspaceId,
      actorUserId: otherUserId,
      expectedVersion: 0,
      idempotencyKey: `control-other-evidence-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{ clientRef: "foreign", text: "AWS invoice paid USD 100.00 on 1 September 2026. Monthly." }],
      },
      now: new Date("2026-09-01T09:00:00.000Z"),
    });
    const foreignEvidenceId = (await pool.query<{ id: string }>(
      `select id from recovery_evidence where workspace_id = $1 limit 1`,
      [otherWorkspaceId],
    )).rows[0]?.id;
    assert.ok(foreignEvidenceId);

    await assert.rejects(
      () => reconcileCommitmentControlProposal({
        workspaceId,
        actorUserId: ownerUserId,
        proposalId: declinedProposal.data.proposal.id,
        expectedVersion: observed.workspaceVersion,
        idempotencyKey: `control-declined-reconcile-${suffix}`,
        request: { evidenceId },
      }),
      (error: unknown) => error instanceof RecoveryServiceError && error.code === "CONFLICT",
    );

    await assert.rejects(
      () => reconcileCommitmentControlProposal({
        workspaceId,
        actorUserId: ownerUserId,
        proposalId: proposal.data.proposal.id,
        expectedVersion: observed.workspaceVersion,
        idempotencyKey: `control-foreign-reconcile-${suffix}`,
        request: { evidenceId: foreignEvidenceId },
      }),
      (error: unknown) => error instanceof RecoveryServiceError && error.code === "NOT_FOUND",
    );

    const reconciliation = await reconcileCommitmentControlProposal({
      workspaceId,
      actorUserId: ownerUserId,
      proposalId: proposal.data.proposal.id,
      expectedVersion: observed.workspaceVersion,
      idempotencyKey: `control-reconcile-${suffix}`,
      request: {
        evidenceId,
        observedOutcome: { value: "1250", observedOn: "2026-09-15" },
      },
      now: new Date("2026-09-15T09:05:00.000Z"),
    });
    assert.equal(reconciliation.workspaceVersion, 7);
    assert.equal(reconciliation.data.reconciliation.verdict, "OVER_CAP");
    assert.equal(reconciliation.data.reconciliation.observedEvidenceDate, "2026-09-01");
    assert.equal(reconciliation.data.reconciliation.outcome?.verdict, "MET");
    assert.equal(reconciliation.data.reconciliation.outcome?.observationBasis, "USER_ENTERED_OBSERVATION");
    assert.equal(reconciliation.data.decision.approvedCapMinor, "180000");

    const expiredEvidence = await submitRecoveryEvidence({
      workspaceId,
      actorUserId: ownerUserId,
      expectedVersion: reconciliation.workspaceVersion,
      idempotencyKey: `control-expired-evidence-${suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "openai-after-expiry",
          text: "OpenAI invoice paid INR 1,999.00 on 1 October 2026. Monthly subscription.",
        }],
      },
      now: new Date("2026-10-01T09:00:00.000Z"),
    });
    const expiredEvidenceId = (await pool.query<{ id: string }>(
      `select id from recovery_evidence
       where workspace_id = $1 and evidence_date = '2026-10-01'::date
       order by created_at desc limit 1`,
      [workspaceId],
    )).rows[0]?.id;
    assert.ok(expiredEvidenceId);
    const expired = await reconcileCommitmentControlProposal({
      workspaceId,
      actorUserId: ownerUserId,
      proposalId: proposal.data.proposal.id,
      expectedVersion: expiredEvidence.workspaceVersion,
      idempotencyKey: `control-expired-reconcile-${suffix}`,
      request: { evidenceId: expiredEvidenceId },
      now: new Date("2026-10-01T09:05:00.000Z"),
    });
    assert.equal(expired.data.reconciliation.verdict, "AUTHORIZATION_EXPIRED");
    assert.equal(expired.data.reconciliation.observedEvidenceDate, "2026-10-01");
    assert.equal(expired.data.decision.approvedCapMinor, "180000");

    const brief = await getCommitmentControlBrief({ workspaceId, actorUserId: memberUserId });
    assert.equal(brief.workspaceVersion, 9);
    const approvedBrief = brief.data.proposals.find((item) => item.proposal.id === proposal.data.proposal.id);
    assert.equal(approvedBrief?.decision?.action, "APPROVE_WITH_CAP");
    assert.equal(approvedBrief?.proposal.submittedByDisplayName, "Control member");
    assert.equal(approvedBrief?.decision?.decidedByDisplayName, "Control owner");
    assert.equal(approvedBrief?.decision?.authorizationExpiresOn, "2026-09-10");
    assert.equal(approvedBrief?.reconciliations.some((item) => item.verdict === "OVER_CAP"), true);
    assert.equal(approvedBrief?.reconciliations.some((item) => item.verdict === "AUTHORIZATION_EXPIRED"), true);
    const outcomeReconciliation = approvedBrief?.reconciliations.find((item) => item.outcome?.verdict === "MET");
    assert.equal(outcomeReconciliation?.outcome?.observedValue, "1250");

    await assert.rejects(
      () => pool.query(
        `update commitment_control_decisions set approved_cap_minor = 1 where workspace_id = $1`,
        [workspaceId],
      ),
      /cannot be updated|immutable/i,
    );
    await assert.rejects(
      () => pool.query(
        `delete from commitment_control_proposals where workspace_id = $1`,
        [workspaceId],
      ),
      /cannot be deleted|immutable/i,
    );

    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    const erased = await pool.query<{ count: string }>(
      `select count(*)::text as count from commitment_control_proposals where workspace_id = $1`,
      [workspaceId],
    );
    assert.equal(erased.rows[0]?.count, "0");
  } finally {
    await pool.query(`delete from workspaces where id = any($1::uuid[])`, [[workspaceId, otherWorkspaceId]]).catch(() => undefined);
    await pool.query(`delete from users where id = any($1::uuid[])`, [[ownerUserId, memberUserId, otherUserId]]).catch(() => undefined);
  }
});