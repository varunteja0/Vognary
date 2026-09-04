import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import {
  createCommitmentControlProposal,
  decideCommitmentControlProposal,
  getCommitmentControlBrief,
  putCommitmentControlPolicy,
  recordCommitmentControlExceptionReview,
  recordCommitmentControlOutcomeObservation,
  reconcileCommitmentControlProposal,
} from "../../src/lib/server/commitment-control-store";
import { isCommitmentControlBriefDto } from "../../src/lib/commitment-control/contracts";
import { getDatabasePool } from "../../src/lib/server/database";
import { RecoveryServiceError } from "../../src/lib/server/recovery-api";
import { submitRecoveryEvidence } from "../../src/lib/server/recovery-store";
import { completeControlPolicyRequest, futureControlTestDate, testControlOutcome } from "../commitment-control-policy-fixture";

const databaseConfigured = Boolean(process.env.DATABASE_URL);
const today = futureControlTestDate(0);
const tomorrow = futureControlTestDate(1);
const yesterday = futureControlTestDate(-1);
process.env.COMMITMENT_CONTROL_PILOT_WORKSPACE_IDS = "*";

type Desk = Awaited<ReturnType<typeof seedDesk>>;

async function seedDesk(label: string) {
  const pool = getDatabasePool();
  const suffix = randomUUID().slice(0, 8);
  const ownerUserId = randomUUID();
  const memberUserId = randomUUID();
  const workspaceId = randomUUID();
  await pool.query(
    `insert into users (id, email, display_name) values ($1, $2, 'Follow-through owner'), ($3, $4, 'Follow-through member')`,
    [ownerUserId, `${label}-owner-${suffix}@example.test`, memberUserId, `${label}-member-${suffix}@example.test`],
  );
  await pool.query(`insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Follow-through workspace')`, [workspaceId, ownerUserId]);
  await pool.query(
    `insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner'), ($1, $3, 'member')`,
    [workspaceId, ownerUserId, memberUserId],
  );
  await putCommitmentControlPolicy({
    workspaceId,
    actorUserId: ownerUserId,
    expectedVersion: 0,
    idempotencyKey: `follow-policy-${suffix}`,
    request: completeControlPolicyRequest(),
  });
  return { pool, suffix, ownerUserId, memberUserId, workspaceId };
}

async function currentVersion(desk: Desk) {
  const result = await desk.pool.query<{ version: string }>(
    `select version::text from recovery_workspace_states where workspace_id = $1`,
    [desk.workspaceId],
  );
  return Number(result.rows[0]?.version ?? 0);
}

async function authorizeProposal(desk: Desk, label: string) {
  const proposal = await createCommitmentControlProposal({
    workspaceId: desk.workspaceId,
    actorUserId: desk.ownerUserId,
    expectedVersion: await currentVersion(desk),
    idempotencyKey: `follow-proposal-${label}-${desk.suffix}`,
    request: {
      merchant: "OpenAI",
      purpose: "Production model capacity",
      category: "AI_MODEL",
      amountMinor: "199900",
      currency: "INR",
      firstChargeDate: today,
      cadence: "MONTHLY",
      existingCommitmentIds: [],
      intendedOutcome: testControlOutcome({ reviewOn: today, targetValue: "10", unit: "tasks" }),
    },
  });
  const decision = await decideCommitmentControlProposal({
    workspaceId: desk.workspaceId,
    actorUserId: desk.ownerUserId,
    proposalId: proposal.data.proposal.id,
    expectedVersion: proposal.workspaceVersion,
    idempotencyKey: `follow-decision-${label}-${desk.suffix}`,
    request: { action: "APPROVE_WITH_CAP", approvedCapMinor: "180000", authorizationExpiresOn: today },
  });
  return { proposalId: proposal.data.proposal.id, decisionId: decision.data.decision.id };
}

async function linkedEvidenceId(desk: Desk, label: string) {
  await submitRecoveryEvidence({
    workspaceId: desk.workspaceId,
    actorUserId: desk.ownerUserId,
    expectedVersion: await currentVersion(desk),
    idempotencyKey: `follow-evidence-${label}-${desk.suffix}`,
    request: {
      kind: "RECEIPT_PASTE",
      receipts: [{ clientRef: `openai-${label}`, text: `OpenAI invoice paid INR 1,999.00 on ${today}. Monthly.` }],
    },
  });
  const result = await desk.pool.query<{ id: string }>(
    `select id from recovery_evidence where workspace_id = $1 order by created_at desc limit 1`,
    [desk.workspaceId],
  );
  const evidenceId = result.rows[0]?.id;
  assert.ok(evidenceId);
  return evidenceId;
}

async function cleanUp(desk: Desk) {
  await desk.pool.query(`delete from workspaces where id = $1`, [desk.workspaceId]).catch(() => undefined);
  await desk.pool.query(`delete from users where id = any($1::uuid[])`, [[desk.ownerUserId, desk.memberUserId]]).catch(() => undefined);
}

test("an outcome observation is recorded without any evidence and returns a deterministic MET or MISSED verdict", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const desk = await seedDesk("verdict");
  try {
    const met = await authorizeProposal(desk, "met");
    const metRecord = await recordCommitmentControlOutcomeObservation({
      workspaceId: desk.workspaceId,
      actorUserId: desk.ownerUserId,
      proposalId: met.proposalId,
      expectedVersion: await currentVersion(desk),
      idempotencyKey: `follow-outcome-met-${desk.suffix}`,
      request: { observedOutcome: { value: "012.000", observedOn: today } },
    });
    assert.equal(metRecord.data.observation.verdict, "MET");
    assert.equal(metRecord.data.observation.observedValue, "12");
    assert.equal(metRecord.data.observation.observationBasis, "USER_ENTERED_OBSERVATION");
    assert.equal(metRecord.data.observation.decisionId, met.decisionId);
    assert.deepEqual(metRecord.data.observation.target, {
      metric: "Resolved fixture tasks",
      targetDirection: "AT_LEAST",
      targetValue: "10",
      unit: "tasks",
      reviewOn: today,
    });
    assert.equal(metRecord.data.observation.observedByUserId, desk.ownerUserId);
    assert.equal(metRecord.replayed, false);

    const reconciliationCount = await desk.pool.query<{ count: string }>(
      `select count(*)::text as count from commitment_control_reconciliations where workspace_id = $1`,
      [desk.workspaceId],
    );
    assert.equal(reconciliationCount.rows[0]?.count, "0");

    const missed = await authorizeProposal(desk, "missed");
    const missedRecord = await recordCommitmentControlOutcomeObservation({
      workspaceId: desk.workspaceId,
      actorUserId: desk.ownerUserId,
      proposalId: missed.proposalId,
      expectedVersion: await currentVersion(desk),
      idempotencyKey: `follow-outcome-missed-${desk.suffix}`,
      request: { observedOutcome: { value: "9", observedOn: today } },
    });
    assert.equal(missedRecord.data.observation.verdict, "MISSED");

    const replay = await recordCommitmentControlOutcomeObservation({
      workspaceId: desk.workspaceId,
      actorUserId: desk.ownerUserId,
      proposalId: missed.proposalId,
      expectedVersion: missedRecord.workspaceVersion - 1,
      idempotencyKey: `follow-outcome-missed-${desk.suffix}`,
      request: { observedOutcome: { value: "9", observedOn: today } },
    });
    assert.equal(replay.replayed, true);
    assert.equal(replay.data.observation.id, missedRecord.data.observation.id);
    assert.equal(replay.workspaceVersion, missedRecord.workspaceVersion);

    const mutations = await desk.pool.query<{ mutation_kind: string }>(
      `select mutation_kind from recovery_workspace_versions
       where workspace_id = $1 and mutation_kind = 'CONTROL_OUTCOME_OBSERVATION'`,
      [desk.workspaceId],
    );
    assert.equal(mutations.rowCount, 2);

    const audit = await desk.pool.query<{ metadata: { action?: string; verdict?: string } }>(
      `select metadata from audit_log
       where workspace_id = $1 and action = 'commitment-control.record-outcome'
       order by created_at desc limit 1`,
      [desk.workspaceId],
    );
    assert.equal(audit.rows[0]?.metadata.action, "outcome_recorded");
    assert.equal(audit.rows[0]?.metadata.verdict, "MISSED");
  } finally {
    await cleanUp(desk);
  }
});

test("an outcome observation refuses a date before the frozen review date, a future date, and a non-admin actor", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const desk = await seedDesk("bounds");
  try {
    const authorized = await authorizeProposal(desk, "bounds");

    await assert.rejects(
      async () => recordCommitmentControlOutcomeObservation({
        workspaceId: desk.workspaceId,
        actorUserId: desk.ownerUserId,
        proposalId: authorized.proposalId,
        expectedVersion: 3,
        idempotencyKey: `follow-outcome-early-${desk.suffix}`,
        request: { observedOutcome: { value: "12", observedOn: yesterday } },
      }),
      (error: unknown) => error instanceof RecoveryServiceError
        && error.code === "INVALID_EVIDENCE"
        && /before the intended review date/i.test(error.message),
    );

    await assert.rejects(
      async () => recordCommitmentControlOutcomeObservation({
        workspaceId: desk.workspaceId,
        actorUserId: desk.ownerUserId,
        proposalId: authorized.proposalId,
        expectedVersion: 3,
        idempotencyKey: `follow-outcome-future-${desk.suffix}`,
        request: { observedOutcome: { value: "12", observedOn: tomorrow } },
      }),
      (error: unknown) => error instanceof RecoveryServiceError
        && error.code === "INVALID_EVIDENCE"
        && /cannot be in the future/i.test(error.message),
    );

    await assert.rejects(
      async () => recordCommitmentControlOutcomeObservation({
        workspaceId: desk.workspaceId,
        actorUserId: desk.memberUserId,
        proposalId: authorized.proposalId,
        expectedVersion: 3,
        idempotencyKey: `follow-outcome-member-${desk.suffix}`,
        request: { observedOutcome: { value: "12", observedOn: today } },
      }),
      (error: unknown) => error instanceof RecoveryServiceError && error.code === "FORBIDDEN",
    );

    await assert.rejects(
      async () => recordCommitmentControlExceptionReview({
        workspaceId: desk.workspaceId,
        actorUserId: desk.memberUserId,
        proposalId: authorized.proposalId,
        expectedVersion: 3,
        idempotencyKey: `follow-review-member-${desk.suffix}`,
        request: {
          targetKind: "OUTCOME_OBSERVATION",
          targetId: randomUUID(),
          disposition: "NO_FURTHER_ACTION",
          note: "Member should not be able to write this.",
        },
      }),
      (error: unknown) => error instanceof RecoveryServiceError && error.code === "FORBIDDEN",
    );

    const stored = await desk.pool.query<{ count: string }>(
      `select count(*)::text as count from commitment_control_outcome_observations where workspace_id = $1`,
      [desk.workspaceId],
    );
    assert.equal(stored.rows[0]?.count, "0");
  } finally {
    await cleanUp(desk);
  }
});

test("a proposal holds one observed outcome in total, in both directions, and NOT_OBSERVED never blocks one", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const desk = await seedDesk("single");
  try {
    const reconciledFirst = await authorizeProposal(desk, "reconciled-first");
    const firstEvidence = await linkedEvidenceId(desk, "reconciled-first");
    await reconcileCommitmentControlProposal({
      workspaceId: desk.workspaceId,
      actorUserId: desk.ownerUserId,
      proposalId: reconciledFirst.proposalId,
      expectedVersion: await currentVersion(desk),
      idempotencyKey: `follow-reconcile-first-${desk.suffix}`,
      request: { evidenceId: firstEvidence, observedOutcome: { value: "12", observedOn: today } },
    });
    await assert.rejects(
      async () => recordCommitmentControlOutcomeObservation({
        workspaceId: desk.workspaceId,
        actorUserId: desk.ownerUserId,
        proposalId: reconciledFirst.proposalId,
        expectedVersion: await currentVersion(desk),
        idempotencyKey: `follow-outcome-after-reconcile-${desk.suffix}`,
        request: { observedOutcome: { value: "14", observedOn: today } },
      }),
      (error: unknown) => error instanceof RecoveryServiceError && error.code === "CONFLICT",
    );

    const observedFirst = await authorizeProposal(desk, "observed-first");
    await recordCommitmentControlOutcomeObservation({
      workspaceId: desk.workspaceId,
      actorUserId: desk.ownerUserId,
      proposalId: observedFirst.proposalId,
      expectedVersion: await currentVersion(desk),
      idempotencyKey: `follow-outcome-first-${desk.suffix}`,
      request: { observedOutcome: { value: "12", observedOn: today } },
    });
    const secondEvidence = await linkedEvidenceId(desk, "observed-first");
    await assert.rejects(
      async () => reconcileCommitmentControlProposal({
        workspaceId: desk.workspaceId,
        actorUserId: desk.ownerUserId,
        proposalId: observedFirst.proposalId,
        expectedVersion: await currentVersion(desk),
        idempotencyKey: `follow-reconcile-after-outcome-${desk.suffix}`,
        request: { evidenceId: secondEvidence, observedOutcome: { value: "14", observedOn: today } },
      }),
      (error: unknown) => error instanceof RecoveryServiceError && error.code === "CONFLICT",
    );

    const costOnly = await reconcileCommitmentControlProposal({
      workspaceId: desk.workspaceId,
      actorUserId: desk.ownerUserId,
      proposalId: observedFirst.proposalId,
      expectedVersion: await currentVersion(desk),
      idempotencyKey: `follow-reconcile-cost-only-${desk.suffix}`,
      request: { evidenceId: secondEvidence },
    });
    assert.equal(costOnly.data.reconciliation.outcome?.verdict, "NOT_OBSERVED");

    const notObservedFirst = await authorizeProposal(desk, "not-observed-first");
    const thirdEvidence = await linkedEvidenceId(desk, "not-observed-first");
    await reconcileCommitmentControlProposal({
      workspaceId: desk.workspaceId,
      actorUserId: desk.ownerUserId,
      proposalId: notObservedFirst.proposalId,
      expectedVersion: await currentVersion(desk),
      idempotencyKey: `follow-reconcile-not-observed-${desk.suffix}`,
      request: { evidenceId: thirdEvidence },
    });
    const afterNotObserved = await recordCommitmentControlOutcomeObservation({
      workspaceId: desk.workspaceId,
      actorUserId: desk.ownerUserId,
      proposalId: notObservedFirst.proposalId,
      expectedVersion: await currentVersion(desk),
      idempotencyKey: `follow-outcome-after-not-observed-${desk.suffix}`,
      request: { observedOutcome: { value: "12", observedOn: today } },
    });
    assert.equal(afterNotObserved.data.observation.verdict, "MET");
  } finally {
    await cleanUp(desk);
  }
});

test("an exception review is accepted for each adverse target kind and refused for a non-adverse record", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const desk = await seedDesk("review");
  try {
    const overCap = await authorizeProposal(desk, "over-cap");
    const overCapEvidence = await linkedEvidenceId(desk, "over-cap");
    const overCapReconciliation = await reconcileCommitmentControlProposal({
      workspaceId: desk.workspaceId,
      actorUserId: desk.ownerUserId,
      proposalId: overCap.proposalId,
      expectedVersion: await currentVersion(desk),
      idempotencyKey: `follow-reconcile-over-cap-${desk.suffix}`,
      request: { evidenceId: overCapEvidence },
    });
    assert.equal(overCapReconciliation.data.reconciliation.verdict, "OVER_CAP");

    const reviewed = await recordCommitmentControlExceptionReview({
      workspaceId: desk.workspaceId,
      actorUserId: desk.ownerUserId,
      proposalId: overCap.proposalId,
      expectedVersion: await currentVersion(desk),
      idempotencyKey: `follow-review-over-cap-${desk.suffix}`,
      request: {
        targetKind: "RECONCILIATION",
        targetId: overCapReconciliation.data.reconciliation.id,
        disposition: "NEW_PROPOSAL_REQUIRED",
        note: "The overage was real. A fresh proposal will carry the higher cap.",
      },
    });
    assert.equal(reviewed.data.review.targetKind, "RECONCILIATION");
    assert.equal(reviewed.data.review.targetId, overCapReconciliation.data.reconciliation.id);
    assert.equal(reviewed.data.review.decisionId, overCap.decisionId);
    assert.equal(reviewed.data.review.reviewedByUserId, desk.ownerUserId);

    await assert.rejects(
      async () => recordCommitmentControlExceptionReview({
        workspaceId: desk.workspaceId,
        actorUserId: desk.ownerUserId,
        proposalId: overCap.proposalId,
        expectedVersion: await currentVersion(desk),
        idempotencyKey: `follow-review-over-cap-twice-${desk.suffix}`,
        request: {
          targetKind: "RECONCILIATION",
          targetId: overCapReconciliation.data.reconciliation.id,
          disposition: "NO_FURTHER_ACTION",
          note: "A second disposition for the same record.",
        },
      }),
      (error: unknown) => error instanceof RecoveryServiceError && error.code === "CONFLICT",
    );

    const missed = await authorizeProposal(desk, "missed-observation");
    const missedObservation = await recordCommitmentControlOutcomeObservation({
      workspaceId: desk.workspaceId,
      actorUserId: desk.ownerUserId,
      proposalId: missed.proposalId,
      expectedVersion: await currentVersion(desk),
      idempotencyKey: `follow-outcome-review-missed-${desk.suffix}`,
      request: { observedOutcome: { value: "4", observedOn: today } },
    });
    assert.equal(missedObservation.data.observation.verdict, "MISSED");
    const observationReview = await recordCommitmentControlExceptionReview({
      workspaceId: desk.workspaceId,
      actorUserId: desk.ownerUserId,
      proposalId: missed.proposalId,
      expectedVersion: await currentVersion(desk),
      idempotencyKey: `follow-review-missed-${desk.suffix}`,
      request: {
        targetKind: "OUTCOME_OBSERVATION",
        targetId: missedObservation.data.observation.id,
        disposition: "CORRECTED_OUTSIDE_VOGNARY",
        note: "The team renegotiated the plan directly with the vendor.",
      },
    });
    assert.equal(observationReview.data.review.targetKind, "OUTCOME_OBSERVATION");

    const withinCap = await authorizeProposal(desk, "within-cap");
    const withinCapObservation = await recordCommitmentControlOutcomeObservation({
      workspaceId: desk.workspaceId,
      actorUserId: desk.ownerUserId,
      proposalId: withinCap.proposalId,
      expectedVersion: await currentVersion(desk),
      idempotencyKey: `follow-outcome-within-cap-${desk.suffix}`,
      request: { observedOutcome: { value: "12", observedOn: today } },
    });
    assert.equal(withinCapObservation.data.observation.verdict, "MET");
    await assert.rejects(
      async () => recordCommitmentControlExceptionReview({
        workspaceId: desk.workspaceId,
        actorUserId: desk.ownerUserId,
        proposalId: withinCap.proposalId,
        expectedVersion: await currentVersion(desk),
        idempotencyKey: `follow-review-non-adverse-${desk.suffix}`,
        request: {
          targetKind: "OUTCOME_OBSERVATION",
          targetId: withinCapObservation.data.observation.id,
          disposition: "NO_FURTHER_ACTION",
          note: "Nothing went wrong, so nothing should be reviewable.",
        },
      }),
      (error: unknown) => error instanceof RecoveryServiceError
        && error.code === "CONFLICT"
        && /adverse/i.test(error.message),
    );

    await assert.rejects(
      async () => recordCommitmentControlExceptionReview({
        workspaceId: desk.workspaceId,
        actorUserId: desk.ownerUserId,
        proposalId: withinCap.proposalId,
        expectedVersion: await currentVersion(desk),
        idempotencyKey: `follow-review-foreign-target-${desk.suffix}`,
        request: {
          targetKind: "OUTCOME_OBSERVATION",
          targetId: missedObservation.data.observation.id,
          disposition: "NO_FURTHER_ACTION",
          note: "A target that belongs to another proposal decision.",
        },
      }),
      (error: unknown) => error instanceof RecoveryServiceError && error.code === "NOT_FOUND",
    );

    const brief = await getCommitmentControlBrief({ workspaceId: desk.workspaceId, actorUserId: desk.ownerUserId });
    assert.equal(isCommitmentControlBriefDto(brief.data), true);
    const byProposal = new Map(brief.data.proposals.map((entry) => [entry.proposal.id, entry]));
    assert.equal(byProposal.get(overCap.proposalId)?.exceptionReviews.length, 1);
    assert.equal(byProposal.get(overCap.proposalId)?.outcomeObservations.length, 0);
    assert.equal(byProposal.get(missed.proposalId)?.outcomeObservations[0]?.verdict, "MISSED");
    assert.equal(byProposal.get(missed.proposalId)?.exceptionReviews[0]?.disposition, "CORRECTED_OUTSIDE_VOGNARY");
    assert.equal(byProposal.get(withinCap.proposalId)?.exceptionReviews.length, 0);
  } finally {
    await cleanUp(desk);
  }
});

test("the database itself refuses a second observed outcome, a non-adverse review, and any later edit", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const desk = await seedDesk("database");
  try {
    const authorized = await authorizeProposal(desk, "database");
    const observation = await recordCommitmentControlOutcomeObservation({
      workspaceId: desk.workspaceId,
      actorUserId: desk.ownerUserId,
      proposalId: authorized.proposalId,
      expectedVersion: await currentVersion(desk),
      idempotencyKey: `follow-db-outcome-${desk.suffix}`,
      request: { observedOutcome: { value: "12", observedOn: today } },
    });

    await assert.rejects(
      () => desk.pool.query(
        `insert into commitment_control_outcome_observations (
           workspace_id, proposal_id, decision_id, observed_value, observed_on,
           target_metric, target_direction, target_value, target_unit, target_review_on, verdict
         ) values ($1, $2, $3, '13', $4::date, 'Resolved fixture tasks', 'AT_LEAST', '10', 'tasks', $4::date, 'MET')`,
        [desk.workspaceId, authorized.proposalId, authorized.decisionId, today],
      ),
      (error: unknown) => (error as { code?: string }).code === "23505",
    );

    await assert.rejects(
      () => desk.pool.query(
        `insert into commitment_control_outcome_observations (
           workspace_id, proposal_id, decision_id, observed_value, observed_on,
           target_metric, target_direction, target_value, target_unit, target_review_on, verdict
         ) values ($1, $2, $3, '9', $4::date, 'Resolved fixture tasks', 'AT_LEAST', '10', 'tasks', $4::date, 'MISSED')`,
        [desk.workspaceId, randomUUID(), authorized.decisionId, today],
      ),
      (error: unknown) => (error as { code?: string }).code === "23503",
    );

    await assert.rejects(
      () => desk.pool.query(
        `insert into commitment_control_exception_reviews (
           workspace_id, proposal_id, decision_id, outcome_observation_id, disposition, note
         ) values ($1, $2, $3, $4, 'NO_FURTHER_ACTION', 'A met outcome is not adverse.')`,
        [desk.workspaceId, authorized.proposalId, authorized.decisionId, observation.data.observation.id],
      ),
      (error: unknown) => (error as { code?: string }).code === "23514",
    );

    // The trigger resolves the named target first, so a row naming two targets
    // cannot resolve one and is refused before the single-target check is reached.
    await assert.rejects(
      () => desk.pool.query(
        `insert into commitment_control_exception_reviews (
           workspace_id, proposal_id, decision_id, reconciliation_id, outcome_observation_id, disposition, note
         ) values ($1, $2, $3, $4, $4, 'NO_FURTHER_ACTION', 'Two targets is not one target.')`,
        [desk.workspaceId, authorized.proposalId, authorized.decisionId, observation.data.observation.id],
      ),
      (error: unknown) => (error as { code?: string }).code === "23503",
    );
    const targetConstraint = await desk.pool.query<{ definition: string }>(
      `select pg_get_constraintdef(oid) as definition
       from pg_constraint where conname = 'cc_exception_reviews_target_check'`,
    );
    assert.match(targetConstraint.rows[0]?.definition ?? "", /num_nonnulls\(reconciliation_id, outcome_observation_id\) = 1/);

    await assert.rejects(
      () => desk.pool.query(
        `update commitment_control_outcome_observations set observed_value = '99' where id = $1`,
        [observation.data.observation.id],
      ),
      (error: unknown) => (error as { code?: string }).code === "55000",
    );
    await assert.rejects(
      () => desk.pool.query(
        `delete from commitment_control_outcome_observations where id = $1`,
        [observation.data.observation.id],
      ),
      (error: unknown) => (error as { code?: string }).code === "55000",
    );

    const missed = await authorizeProposal(desk, "database-missed");
    const missedObservation = await recordCommitmentControlOutcomeObservation({
      workspaceId: desk.workspaceId,
      actorUserId: desk.ownerUserId,
      proposalId: missed.proposalId,
      expectedVersion: await currentVersion(desk),
      idempotencyKey: `follow-db-missed-${desk.suffix}`,
      request: { observedOutcome: { value: "1", observedOn: today } },
    });
    const review = await recordCommitmentControlExceptionReview({
      workspaceId: desk.workspaceId,
      actorUserId: desk.ownerUserId,
      proposalId: missed.proposalId,
      expectedVersion: await currentVersion(desk),
      idempotencyKey: `follow-db-review-${desk.suffix}`,
      request: {
        targetKind: "OUTCOME_OBSERVATION",
        targetId: missedObservation.data.observation.id,
        disposition: "NO_FURTHER_ACTION",
        note: "Recorded and closed.",
      },
    });
    await assert.rejects(
      () => desk.pool.query(
        `update commitment_control_exception_reviews set note = 'edited' where id = $1`,
        [review.data.review.id],
      ),
      (error: unknown) => (error as { code?: string }).code === "55000",
    );
  } finally {
    await cleanUp(desk);
  }
});

test("follow-through records stay inside their tenant and survive only their own workspace", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const desk = await seedDesk("tenant-a");
  const other = await seedDesk("tenant-b");
  try {
    const mine = await authorizeProposal(desk, "tenant-a");
    const observation = await recordCommitmentControlOutcomeObservation({
      workspaceId: desk.workspaceId,
      actorUserId: desk.ownerUserId,
      proposalId: mine.proposalId,
      expectedVersion: await currentVersion(desk),
      idempotencyKey: `follow-tenant-outcome-${desk.suffix}`,
      request: { observedOutcome: { value: "1", observedOn: today } },
    });
    assert.equal(observation.data.observation.verdict, "MISSED");

    await assert.rejects(
      async () => recordCommitmentControlOutcomeObservation({
        workspaceId: other.workspaceId,
        actorUserId: other.ownerUserId,
        proposalId: mine.proposalId,
        expectedVersion: await currentVersion(other),
        idempotencyKey: `follow-tenant-cross-outcome-${other.suffix}`,
        request: { observedOutcome: { value: "12", observedOn: today } },
      }),
      (error: unknown) => error instanceof RecoveryServiceError && error.code === "NOT_FOUND",
    );

    const theirs = await authorizeProposal(other, "tenant-b");
    await assert.rejects(
      async () => recordCommitmentControlExceptionReview({
        workspaceId: other.workspaceId,
        actorUserId: other.ownerUserId,
        proposalId: theirs.proposalId,
        expectedVersion: await currentVersion(other),
        idempotencyKey: `follow-tenant-cross-review-${other.suffix}`,
        request: {
          targetKind: "OUTCOME_OBSERVATION",
          targetId: observation.data.observation.id,
          disposition: "NO_FURTHER_ACTION",
          note: "Another tenant's record must not be reviewable here.",
        },
      }),
      (error: unknown) => error instanceof RecoveryServiceError && error.code === "NOT_FOUND",
    );

    const otherBrief = await getCommitmentControlBrief({ workspaceId: other.workspaceId, actorUserId: other.ownerUserId });
    assert.equal(otherBrief.data.proposals.every((entry) => entry.outcomeObservations.length === 0), true);

    await desk.pool.query(`delete from workspaces where id = $1`, [desk.workspaceId]);
    const remaining = await desk.pool.query<{ observations: string; reviews: string }>(
      `select
         (select count(*)::text from commitment_control_outcome_observations where workspace_id = $1) as observations,
         (select count(*)::text from commitment_control_exception_reviews where workspace_id = $1) as reviews`,
      [desk.workspaceId],
    );
    assert.deepEqual(remaining.rows[0], { observations: "0", reviews: "0" });
  } finally {
    await cleanUp(desk);
    await cleanUp(other);
  }
});

test("erasing the acting user forgets the actor and keeps the recorded follow-through", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const desk = await seedDesk("erasure");
  const actorUserId = randomUUID();
  try {
    const authorized = await authorizeProposal(desk, "erasure");
    await desk.pool.query(
      `insert into users (id, email, display_name) values ($1, $2, 'Follow-through admin')`,
      [actorUserId, `erasure-admin-${desk.suffix}@example.test`],
    );
    await desk.pool.query(
      `insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'admin')`,
      [desk.workspaceId, actorUserId],
    );
    const observation = await recordCommitmentControlOutcomeObservation({
      workspaceId: desk.workspaceId,
      actorUserId,
      proposalId: authorized.proposalId,
      expectedVersion: await currentVersion(desk),
      idempotencyKey: `follow-erasure-outcome-${desk.suffix}`,
      request: { observedOutcome: { value: "2", observedOn: today } },
    });
    const review = await recordCommitmentControlExceptionReview({
      workspaceId: desk.workspaceId,
      actorUserId,
      proposalId: authorized.proposalId,
      expectedVersion: await currentVersion(desk),
      idempotencyKey: `follow-erasure-review-${desk.suffix}`,
      request: {
        targetKind: "OUTCOME_OBSERVATION",
        targetId: observation.data.observation.id,
        disposition: "NEW_PROPOSAL_REQUIRED",
        note: "The target was missed; a new proposal will restate it.",
      },
    });

    await desk.pool.query(`delete from users where id = $1`, [actorUserId]);
    const after = await desk.pool.query<{ observed_by: string | null; reviewed_by: string | null; verdict: string; note: string }>(
      `select observation.observed_by_user_id as observed_by, review.reviewed_by_user_id as reviewed_by,
         observation.verdict, review.note
       from commitment_control_outcome_observations observation
       join commitment_control_exception_reviews review on review.outcome_observation_id = observation.id
       where observation.id = $1 and review.id = $2`,
      [observation.data.observation.id, review.data.review.id],
    );
    assert.deepEqual(after.rows[0], {
      observed_by: null,
      reviewed_by: null,
      verdict: "MISSED",
      note: "The target was missed; a new proposal will restate it.",
    });
  } finally {
    await desk.pool.query(`delete from users where id = $1`, [actorUserId]).catch(() => undefined);
    await cleanUp(desk);
  }
});
