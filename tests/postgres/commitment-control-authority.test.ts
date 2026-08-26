import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import {
  createCommitmentControlProposal,
  decideCommitmentControlProposal,
  putCommitmentControlPolicy,
} from "../../src/lib/server/commitment-control-store";
import { getDatabasePool } from "../../src/lib/server/database";
import { RecoveryServiceError } from "../../src/lib/server/recovery-api";
import { submitRecoveryEvidence } from "../../src/lib/server/recovery-store";
import { completeControlPolicyRequest } from "../commitment-control-policy-fixture";

const databaseConfigured = Boolean(process.env.DATABASE_URL);
process.env.COMMITMENT_CONTROL_PILOT_WORKSPACE_IDS = "*";

async function seedOwnerWorkspace(label: string) {
  const pool = getDatabasePool();
  const suffix = randomUUID().slice(0, 8);
  const ownerUserId = randomUUID();
  const workspaceId = randomUUID();
  await pool.query(
    `insert into users (id, email, display_name) values ($1, $2, 'Authority owner')`,
    [ownerUserId, `${label}-owner-${suffix}@example.test`],
  );
  await pool.query(`insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Authority workspace')`, [workspaceId, ownerUserId]);
  await pool.query(
    `insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`,
    [workspaceId, ownerUserId],
  );
  return { pool, suffix, ownerUserId, workspaceId };
}

test("Control policy refuses a no-op category set and outside-policy approve needs a written override", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const desk = await seedOwnerWorkspace("policy");

  try {
    await assert.rejects(
      () => putCommitmentControlPolicy({
        workspaceId: desk.workspaceId,
        actorUserId: desk.ownerUserId,
        expectedVersion: 0,
        idempotencyKey: `authority-incomplete-${desk.suffix}`,
        request: {
          categoryRules: [{ category: "AI_MODEL", posture: "ALLOW" }],
          currencyLimits: [{
            currency: "INR",
            maxPerChargeMinor: "500000",
            maxThirteenWeekMinor: "3000000",
            maxAnnualMinor: "12000000",
          }],
        },
      }),
      (error: unknown) => error instanceof RecoveryServiceError && error.code === "INVALID_EVIDENCE",
    );

    const policy = await putCommitmentControlPolicy({
      workspaceId: desk.workspaceId,
      actorUserId: desk.ownerUserId,
      expectedVersion: 0,
      idempotencyKey: `authority-policy-${desk.suffix}`,
      request: completeControlPolicyRequest({
        currencyLimits: [{
          currency: "INR",
          maxPerChargeMinor: "100000",
          maxThirteenWeekMinor: "300000",
          maxAnnualMinor: "1200000",
        }],
      }),
    });
    const proposal = await createCommitmentControlProposal({
      workspaceId: desk.workspaceId,
      actorUserId: desk.ownerUserId,
      expectedVersion: policy.workspaceVersion,
      idempotencyKey: `authority-outside-${desk.suffix}`,
      request: {
        merchant: "Anthropic",
        purpose: "Claude API",
        category: "AI_MODEL",
        amountMinor: "4500000",
        currency: "INR",
        firstChargeDate: "2026-09-01",
        cadence: "MONTHLY",
        existingCommitmentIds: [],
      },
    });
    assert.equal(proposal.data.evaluation.status, "OUTSIDE_POLICY");

    await assert.rejects(
      () => decideCommitmentControlProposal({
        workspaceId: desk.workspaceId,
        actorUserId: desk.ownerUserId,
        proposalId: proposal.data.proposal.id,
        expectedVersion: proposal.workspaceVersion,
        idempotencyKey: `authority-silent-${desk.suffix}`,
        request: { action: "APPROVE" },
      }),
      (error: unknown) => error instanceof RecoveryServiceError && error.code === "INVALID_EVIDENCE",
    );

    const decided = await decideCommitmentControlProposal({
      workspaceId: desk.workspaceId,
      actorUserId: desk.ownerUserId,
      proposalId: proposal.data.proposal.id,
      expectedVersion: proposal.workspaceVersion,
      idempotencyKey: `authority-override-${desk.suffix}`,
      request: { action: "APPROVE", overrideReason: "Board-approved exception for this vendor." },
    });
    assert.equal(decided.data.decision.overrideReason, "Board-approved exception for this vendor.");
    assert.equal(decided.data.decision.decidedByDisplayName, "Authority owner");
  } finally {
    await desk.pool.query(`delete from workspaces where id = $1`, [desk.workspaceId]).catch(() => undefined);
    await desk.pool.query(`delete from users where id = $1`, [desk.ownerUserId]).catch(() => undefined);
  }
});

test("eligible uncited exposure cannot be within policy, and irregular spend cites observation-only", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const desk = await seedOwnerWorkspace("exposure");

  try {
    const evidence = await submitRecoveryEvidence({
      workspaceId: desk.workspaceId,
      actorUserId: desk.ownerUserId,
      expectedVersion: 0,
      idempotencyKey: `authority-evidence-${desk.suffix}`,
      request: {
        kind: "RECEIPT_PASTE",
        receipts: [{
          clientRef: "irregular-design",
          text: "OpenAI invoice paid INR 1,999.00 on 1 August 2026. Monthly subscription.",
        }],
      },
      now: new Date("2026-08-01T09:00:00.000Z"),
    });
    await desk.pool.query(
      `update recovery_commitments
       set effective_cadence = 'IRREGULAR', effective_next_expected_date = null
       where workspace_id = $1`,
      [desk.workspaceId],
    );
    const commitment = await desk.pool.query<{ id: string }>(
      `select id from recovery_commitments where workspace_id = $1 limit 1`,
      [desk.workspaceId],
    );
    assert.ok(commitment.rows[0]?.id);

    const policy = await putCommitmentControlPolicy({
      workspaceId: desk.workspaceId,
      actorUserId: desk.ownerUserId,
      expectedVersion: evidence.workspaceVersion,
      idempotencyKey: `authority-exposure-policy-${desk.suffix}`,
      request: completeControlPolicyRequest(),
    });

    const uncited = await createCommitmentControlProposal({
      workspaceId: desk.workspaceId,
      actorUserId: desk.ownerUserId,
      expectedVersion: policy.workspaceVersion,
      idempotencyKey: `authority-uncited-${desk.suffix}`,
      request: {
        merchant: "Anthropic",
        purpose: "Claude API",
        category: "AI_MODEL",
        amountMinor: "199900",
        currency: "INR",
        firstChargeDate: "2026-09-01",
        cadence: "MONTHLY",
        existingCommitmentIds: [],
      },
    });
    assert.equal(uncited.data.evaluation.status, "REVIEW_REQUIRED");
    assert.ok(uncited.data.evaluation.reasonCodes.includes("EXPOSURE_NOT_CITED"));
    assert.equal(uncited.data.evaluation.citedExposureBasis, "NONE");

    const cited = await createCommitmentControlProposal({
      workspaceId: desk.workspaceId,
      actorUserId: desk.ownerUserId,
      expectedVersion: uncited.workspaceVersion,
      idempotencyKey: `authority-cited-${desk.suffix}`,
      request: {
        merchant: "Anthropic",
        purpose: "Claude API follow-on",
        category: "AI_MODEL",
        amountMinor: "199900",
        currency: "INR",
        firstChargeDate: "2026-09-01",
        cadence: "MONTHLY",
        existingCommitmentIds: [commitment.rows[0]!.id],
      },
    });
    assert.equal(cited.data.evaluation.citedExposureBasis, "OBSERVATION_ONLY");
    assert.equal(cited.data.evaluation.currencyResults[0]?.existingThirteenWeekMinor, cited.data.evaluation.currencyResults[0]?.existingAnnualMinor);
  } finally {
    await desk.pool.query(`delete from workspaces where id = $1`, [desk.workspaceId]).catch(() => undefined);
    await desk.pool.query(`delete from users where id = $1`, [desk.ownerUserId]).catch(() => undefined);
  }
});
