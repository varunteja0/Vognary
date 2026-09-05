import "server-only";

import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { formatCalendarDate, parseIsoDateOnly } from "@/lib/date-only";
import type {
  CommitmentControlBriefDto,
  ControlDecisionDto,
  ControlEvaluationDto,
  ControlExceptionReviewDto,
  ControlOutcomeObservationDto,
  ControlPolicyDto,
  ControlProposalDto,
  ControlReconciliationDto,
  CreateControlProposalRequest,
  DecideControlProposalRequest,
  PutControlPolicyRequest,
  ReconcileControlProposalRequest,
  RecordControlExceptionReviewRequest,
  RecordControlOutcomeObservationRequest,
} from "@/lib/commitment-control/contracts";
import { isCommitmentControlWorkspaceEnrolled } from "@/lib/commitment-control/enrollment";
import { authorizeProposalDecision, type ProposalDecisionAction } from "@/lib/commitment-control/decision";
import { addMinorUnits, requireUuid } from "@/lib/commitment-control/money";
import {
  evaluateProposalPolicy,
  normalizeProposalPolicy,
  type ExistingExposure,
  type ProposalCategory,
  type ProposalPolicy,
  type ProposalPolicyEvaluation,
} from "@/lib/commitment-control/policy";
import { calendarDateInTimeZone, projectProposalExposure, type ProposalCadence } from "@/lib/commitment-control/project";
import { reconcileControlOutcome } from "@/lib/commitment-control/outcome";
import { reconcileAuthorizedProposal } from "@/lib/commitment-control/reconcile";
import {
  selectControlReconciliationCandidates,
  type ControlReconciliationCandidatesDto,
  type ControlReconciliationEvidenceInput,
} from "@/lib/commitment-control/reconciliation-candidates";
import { advanceDateByFrequency, type Frequency } from "@/lib/recurring-audit";
import { getDatabasePool } from "@/lib/server/database";
import { hashRecoveryRequest, RecoveryServiceError } from "@/lib/server/recovery-api";
import { recordConsentedProductEvent } from "@/lib/server/product-event-store";
import { countAuthorizingAdmins } from "@/lib/server/workspace-invite-store";

type WorkspaceRole = "viewer" | "member" | "admin" | "owner";
type ControlMutationKind =
  | "CONTROL_POLICY"
  | "CONTROL_PROPOSAL"
  | "CONTROL_DECISION"
  | "CONTROL_RECONCILIATION"
  | "CONTROL_OUTCOME_OBSERVATION"
  | "CONTROL_EXCEPTION_REVIEW";

type WorkspaceStateRow = {
  version: string;
  baseline_version: string | null;
  latest_changed_state: "NO_PRIOR_BASELINE" | "COMPARED";
  latest_from_version: string | null;
  latest_changed_version: string | null;
};

const roleRank: Record<WorkspaceRole, number> = { viewer: 1, member: 2, admin: 3, owner: 4 };
const eventByMutation: Record<ControlMutationKind,
  | "control.policy_recorded"
  | "control.proposal_submitted"
  | "control.decision_recorded"
  | "control.reconciliation_recorded"
  | "control.outcome_recorded"
  | "control.exception_reviewed"> = {
  CONTROL_POLICY: "control.policy_recorded",
  CONTROL_PROPOSAL: "control.proposal_submitted",
  CONTROL_DECISION: "control.decision_recorded",
  CONTROL_RECONCILIATION: "control.reconciliation_recorded",
  CONTROL_OUTCOME_OBSERVATION: "control.outcome_recorded",
  CONTROL_EXCEPTION_REVIEW: "control.exception_reviewed",
};
const adverseReconciliationVerdicts = new Set<ControlReconciliationDto["verdict"]>([
  "OVER_CAP",
  "CURRENCY_MISMATCH",
  "CANNOT_EVALUATE",
  "AUTHORIZATION_EXPIRED",
]);

export async function putCommitmentControlPolicy(input: {
  workspaceId: string;
  actorUserId: string;
  expectedVersion: number;
  idempotencyKey: string;
  request: PutControlPolicyRequest;
  now?: Date;
}) {
  return runControlMutation({
    ...input,
    minimumRole: "admin",
    operation: "commitment-control.put-policy",
    mutationKind: "CONTROL_POLICY",
    requestForHash: input.request,
    write: async (client, now) => {
      const latest = await client.query<{ version: number }>(
        `select version from commitment_control_policies where workspace_id = $1 order by version desc limit 1`,
        [input.workspaceId],
      );
      const policyVersion = (latest.rows[0]?.version ?? 0) + 1;
      const policy = normalizeProposalPolicy({ ...input.request, policyVersion });
      const inserted = await client.query<PolicyRow>(
        `insert into commitment_control_policies (
           workspace_id, version, category_rules, currency_limits, created_by_user_id, created_at
         ) values ($1, $2, $3::jsonb, $4::jsonb, $5, $6)
         returning workspace_id, version, category_rules, currency_limits, created_by_user_id, created_at`,
        [input.workspaceId, policyVersion, JSON.stringify(policy.categoryRules), JSON.stringify(policy.currencyLimits), input.actorUserId, now],
      );
      const row = inserted.rows[0];
      if (!row) throw new RecoveryServiceError("SAVE_FAILED");
      return {
        data: { policy: mapPolicy(row) },
        entityId: input.workspaceId,
        auditMetadata: { action: "policy_recorded", policyVersion },
      };
    },
  });
}

export async function createCommitmentControlProposal(input: {
  workspaceId: string;
  actorUserId: string;
  expectedVersion: number;
  idempotencyKey: string;
  request: CreateControlProposalRequest;
  now?: Date;
}) {
  return runControlMutation({
    ...input,
    minimumRole: "member",
    operation: "commitment-control.create-proposal",
    mutationKind: "CONTROL_PROPOSAL",
    requestForHash: input.request,
    write: async (client, now) => {
      const policy = await loadLatestPolicy(client, input.workspaceId);
      if (!policy) throw new RecoveryServiceError("FEATURE_UNAVAILABLE", "Commitment Control policy must be configured before proposals are submitted.");
      const proposalId = randomUUID();
      const asOfDate = calendarDateInTimeZone(now, "Asia/Kolkata");
      const projection = projectProposalExposure([{
        proposalId,
        amountMinor: input.request.amountMinor,
        currency: input.request.currency,
        firstChargeDate: input.request.firstChargeDate,
        cadence: input.request.cadence,
      }], { asOfDate });
      const projected = projection.proposals[0];
      if (!projected) throw new RecoveryServiceError("INVALID_EVIDENCE", "Proposal projection is empty.");
      const existingExposure = await loadExistingExposure(client, input.workspaceId, input.request.existingCommitmentIds, asOfDate);
      const eligibleUncited = input.request.existingCommitmentIds.length === 0
        && await workspaceHasEligibleExposure(client, input.workspaceId);
      const evaluation = evaluateProposalPolicy({
        proposal: {
          proposalId,
          amountMinor: projected.amountMinor,
          currency: projected.currency,
          category: input.request.category,
          thirteenWeekMinor: projected.thirteenWeekMinor,
          annualMinor: projected.annualMinor,
        },
        policy,
        existingExposure,
        eligibleUncited,
      });
      const merchant = boundedText(input.request.merchant, "Proposal merchant", 1, 240);
      const purpose = boundedText(input.request.purpose, "Proposal purpose", 1, 500);
      const intendedOutcome = input.request.intendedOutcome;
      const submittedByDisplayName = await readActorDisplayName(client, input.actorUserId);
      const proposalResult = await client.query<ProposalRow>(
        `insert into commitment_control_proposals (
           id, workspace_id, submitted_by_user_id, submitted_by_display_name, merchant, purpose, category,
           amount_minor, currency, first_charge_date, cadence, as_of_date,
           projected_13_week_minor, projected_annual_minor, intended_outcome_metric,
           intended_outcome_direction, intended_outcome_target_value, intended_outcome_unit,
           intended_outcome_review_on, created_at
         ) values (
           $1, $2, $3, $4, $5, $6, $7, $8::bigint, $9, $10::date, $11, $12::date,
           $13::bigint, $14::bigint, $15, $16, $17, $18, $19::date, $20
         )
         returning id, submitted_by_user_id, submitted_by_display_name, merchant, purpose, category, amount_minor::text,
           currency, first_charge_date, cadence, as_of_date, projected_13_week_minor::text,
           projected_annual_minor::text, intended_outcome_metric, intended_outcome_direction,
           intended_outcome_target_value, intended_outcome_unit, intended_outcome_review_on,
           assumption_basis, created_at`,
        [
          proposalId, input.workspaceId, input.actorUserId, submittedByDisplayName, merchant, purpose, input.request.category,
          projected.amountMinor, projected.currency, projected.firstChargeDate, projected.cadence,
          asOfDate, projected.thirteenWeekMinor, projected.annualMinor, intendedOutcome.metric,
          intendedOutcome.targetDirection, intendedOutcome.targetValue, intendedOutcome.unit,
          intendedOutcome.reviewOn, now,
        ],
      );
      const evaluationId = randomUUID();
      const evaluationResult = await client.query<EvaluationRow>(
        `insert into commitment_control_evaluations (
           id, workspace_id, proposal_id, policy_version, status, human_decision_required,
           assumption_fields, reason_codes, currency_results, cited_exposure_basis, evaluated_at
         ) values ($1, $2, $3, $4, $5, true, $6::text[], $7::text[], $8::jsonb, $9, $10)
         returning id, proposal_id, policy_version, status, human_decision_required,
           assumption_fields, reason_codes, currency_results, cited_exposure_basis, evaluated_at`,
        [
          evaluationId, input.workspaceId, proposalId, evaluation.policyVersion, evaluation.status,
          evaluation.assumptionFields, evaluation.reasonCodes, JSON.stringify(evaluation.currencyResults),
          evaluation.citedExposureBasis, now,
        ],
      );
      for (const evidenceId of evaluation.citedEvidenceIds) {
        await client.query(
          `insert into commitment_control_evaluation_evidence (workspace_id, evaluation_id, evidence_id, linked_at)
           values ($1, $2, $3, $4)`,
          [input.workspaceId, evaluationId, evidenceId, now],
        );
      }
      const proposalRow = proposalResult.rows[0];
      const evaluationRow = evaluationResult.rows[0];
      if (!proposalRow || !evaluationRow) throw new RecoveryServiceError("SAVE_FAILED");
      return {
        data: {
          proposal: mapProposal(proposalRow),
          evaluation: mapEvaluation(evaluationRow, evaluation.citedEvidenceIds),
        },
        entityId: proposalId,
        auditMetadata: {
          action: "proposal_submitted",
          merchant,
          currency: projected.currency,
          amountMinor: projected.amountMinor,
          policyVersion: evaluation.policyVersion,
        },
      };
    },
  });
}

export async function decideCommitmentControlProposal(input: {
  workspaceId: string;
  actorUserId: string;
  proposalId: string;
  expectedVersion: number;
  idempotencyKey: string;
  request: DecideControlProposalRequest;
  now?: Date;
}) {
  const proposalId = requireUuid(input.proposalId, "Proposal id");
  return runControlMutation({
    ...input,
    minimumRole: "admin",
    operation: "commitment-control.decide-proposal",
    mutationKind: "CONTROL_DECISION",
    requestForHash: { proposalId, ...input.request },
    write: async (client, now, membership) => {
      const loaded = await loadProposalEvaluation(client, input.workspaceId, proposalId);
      if (!loaded) throw new RecoveryServiceError("NOT_FOUND");
      const authorizingAdminCount = await countAuthorizingAdmins(client, input.workspaceId).catch(() => 1);
      const decidedByDisplayName = await readActorDisplayName(client, input.actorUserId);
      let authorized;
      try {
        authorized = authorizeProposalDecision({
          actorRole: membership.role,
          actorUserId: input.actorUserId,
          evaluation: loaded.evaluation,
          action: input.request.action,
          approvedCapMinor: input.request.approvedCapMinor,
          authorizationExpiresOn: input.request.authorizationExpiresOn,
          outcomeReviewOn: loaded.proposal.intendedOutcome?.reviewOn,
          decidedAt: now.toISOString(),
          submittedByUserId: loaded.proposal.submittedByUserId,
          authorizingAdminCount,
          overrideReason: input.request.overrideReason,
        });
      } catch (error) {
        if (error instanceof Error && /second owner or admin/i.test(error.message)) {
          throw new RecoveryServiceError("FORBIDDEN", error.message);
        }
        throw error;
      }
      const decisionId = randomUUID();
      const result = await client.query<DecisionRow>(
        `insert into commitment_control_decisions (
           id, workspace_id, proposal_id, evaluation_id, action, expected_amount_minor,
           approved_cap_minor, currency, decided_by_user_id, decided_by_display_name,
           override_reason, authorization_expires_on, decided_at
         ) values ($1, $2, $3, $4, $5, $6::bigint, $7::bigint, $8, $9, $10, $11, $12::date, $13)
         returning id, proposal_id, evaluation_id, action, expected_amount_minor::text,
           approved_cap_minor::text, currency, decided_by_user_id, decided_by_display_name,
           override_reason, authorization_expires_on, decided_at`,
        [
          decisionId, input.workspaceId, proposalId, loaded.evaluation.id, authorized.action,
          authorized.expectedAmountMinor, authorized.approvedCapMinor, authorized.currency,
          input.actorUserId, decidedByDisplayName, authorized.overrideReason,
          authorized.authorizationExpiresOn, authorized.decidedAt,
        ],
      );
      const row = result.rows[0];
      if (!row) throw new RecoveryServiceError("SAVE_FAILED");
      return {
        data: { decision: mapDecision(row, loaded.evaluation.policyVersion) },
        entityId: decisionId,
        auditMetadata: {
          action: authorized.action,
          merchant: loaded.proposal.merchant,
          currency: authorized.currency,
          amountMinor: authorized.expectedAmountMinor,
          policyVersion: loaded.evaluation.policyVersion,
        },
      };
    },
  });
}

export async function reconcileCommitmentControlProposal(input: {
  workspaceId: string;
  actorUserId: string;
  proposalId: string;
  expectedVersion: number;
  idempotencyKey: string;
  request: ReconcileControlProposalRequest;
  now?: Date;
}) {
  const proposalId = requireUuid(input.proposalId, "Proposal id");
  const evidenceId = requireUuid(input.request.evidenceId, "Evidence id");
  return runControlMutation({
    ...input,
    minimumRole: "admin",
    operation: "commitment-control.reconcile-proposal",
    mutationKind: "CONTROL_RECONCILIATION",
    requestForHash: { proposalId, ...input.request },
    write: async (client, now) => {
      const loaded = await loadProposalEvaluation(client, input.workspaceId, proposalId);
      if (!loaded?.decision) throw new RecoveryServiceError("NOT_FOUND", "An authorized proposal decision is required before reconciliation.");
      if (loaded.decision.action === "DECLINE") {
        throw new RecoveryServiceError("CONFLICT", "A declined proposal cannot be reconciled to observed spend.");
      }
      const evidence = await client.query<{ id: string; amount_minor: string | null; currency: string | null; evidence_date: Date | string | null; observed_at: Date | string | null }>(
        `select id, amount_minor::text, currency, evidence_date, observed_at
         from recovery_evidence where workspace_id = $1 and id = $2`,
        [input.workspaceId, evidenceId],
      );
      const evidenceRow = evidence.rows[0];
      if (!evidenceRow) throw new RecoveryServiceError("NOT_FOUND");
      if (evidenceRow.observed_at === null) {
        throw new RecoveryServiceError("INVALID_EVIDENCE", "Reconciliation requires an observed financial charge, not a scheduled renewal.");
      }
      const reconciled = reconcileAuthorizedProposal({
        decision: loaded.decision,
        evidence: {
          evidenceId,
          amountMinor: evidenceRow.amount_minor,
          currency: evidenceRow.currency,
          evidenceDate: evidenceRow.evidence_date ? toDateOnly(evidenceRow.evidence_date) : null,
        },
        intendedOutcome: loaded.proposal.intendedOutcome ?? undefined,
        observedOutcome: input.request.observedOutcome,
        observedThrough: calendarDateInTimeZone(now, "Asia/Kolkata"),
      });
      const reconciliationId = randomUUID();
      const result = await client.query<ReconciliationRow>(
        `insert into commitment_control_reconciliations (
           id, workspace_id, proposal_id, decision_id, evidence_id, verdict,
           expected_amount_minor, approved_cap_minor, authorization_currency,
           observed_amount_minor, observed_currency, observed_evidence_date, observed_outcome_value,
           observed_outcome_on, outcome_observation_basis, outcome_verdict,
           reconciled_by_user_id, reconciled_at
         ) values (
           $1, $2, $3, $4, $5, $6, $7::bigint, $8::bigint, $9, $10::bigint, $11,
           $12::date, $13, $14::date, $15, $16, $17, $18
         )
         returning id, proposal_id, decision_id, evidence_id, verdict,
           expected_amount_minor::text, approved_cap_minor::text, authorization_currency,
           observed_amount_minor::text, observed_currency, observed_evidence_date, observed_outcome_value,
           observed_outcome_on, outcome_observation_basis, outcome_verdict,
           reconciled_by_user_id, reconciled_at`,
        [
          reconciliationId, input.workspaceId, proposalId, loaded.decision.id, evidenceId,
          reconciled.verdict, reconciled.expectedAmountMinor, reconciled.approvedCapMinor,
          reconciled.authorizationCurrency, reconciled.observedAmountMinor, reconciled.observedCurrency,
          reconciled.observedEvidenceDate, reconciled.outcome?.observedValue ?? null, reconciled.outcome?.observedOn ?? null,
          reconciled.outcome?.observationBasis ?? null, reconciled.outcome?.verdict ?? null,
          input.actorUserId, now,
        ],
      );
      const row = result.rows[0];
      if (!row) throw new RecoveryServiceError("SAVE_FAILED");
      return {
        data: {
          proposal: loaded.proposal,
          decision: loaded.decision,
          reconciliation: mapReconciliation(row, loaded.proposal.intendedOutcome),
        },
        entityId: reconciliationId,
      };
    },
  });
}

/**
 * A business outcome is user-entered and cites no receipt: no financial
 * evidence can prove it. The frozen target is copied onto the record so the
 * verdict stays readable against the boundary that existed at authorization.
 */
export async function recordCommitmentControlOutcomeObservation(input: {
  workspaceId: string;
  actorUserId: string;
  proposalId: string;
  expectedVersion: number;
  idempotencyKey: string;
  request: RecordControlOutcomeObservationRequest;
  now?: Date;
}) {
  const proposalId = requireUuid(input.proposalId, "Proposal id");
  return runControlMutation({
    ...input,
    minimumRole: "admin",
    operation: "commitment-control.record-outcome",
    mutationKind: "CONTROL_OUTCOME_OBSERVATION",
    requestForHash: { proposalId, ...input.request },
    write: async (client, now) => {
      const loaded = await loadProposalEvaluation(client, input.workspaceId, proposalId);
      if (!loaded?.decision) throw new RecoveryServiceError("NOT_FOUND", "An authorized proposal decision is required before an outcome is recorded.");
      if (loaded.decision.action === "DECLINE") {
        throw new RecoveryServiceError("CONFLICT", "A declined proposal has no authorized outcome to observe.");
      }
      const intendedOutcome = loaded.proposal.intendedOutcome;
      if (!intendedOutcome) {
        throw new RecoveryServiceError("CONFLICT", "This proposal froze no intended outcome, so there is no target to observe against.");
      }
      const outcome = reconcileControlOutcome(
        intendedOutcome,
        input.request.observedOutcome,
        calendarDateInTimeZone(now, "Asia/Kolkata"),
      );
      if (outcome.verdict === "NOT_OBSERVED" || outcome.observedValue === null || outcome.observedOn === null) {
        throw new RecoveryServiceError("INVALID_EVIDENCE", "An outcome observation requires an observed value and date.");
      }
      const observationId = randomUUID();
      const result = await client.query<OutcomeObservationRow>(
        `insert into commitment_control_outcome_observations (
           id, workspace_id, proposal_id, decision_id, observed_value, observed_on,
           target_metric, target_direction, target_value, target_unit, target_review_on,
           verdict, observed_by_user_id, observed_at
         ) values ($1, $2, $3, $4, $5, $6::date, $7, $8, $9, $10, $11::date, $12, $13, $14)
         returning id, proposal_id, decision_id, observed_value, observed_on, target_metric,
           target_direction, target_value, target_unit, target_review_on, verdict,
           observation_basis, observed_by_user_id, observed_at`,
        [
          observationId, input.workspaceId, proposalId, loaded.decision.id, outcome.observedValue,
          outcome.observedOn, outcome.metric, outcome.targetDirection, outcome.targetValue,
          outcome.unit, outcome.reviewOn, outcome.verdict, input.actorUserId, now,
        ],
      );
      const row = result.rows[0];
      if (!row) throw new RecoveryServiceError("SAVE_FAILED");
      return {
        data: {
          proposal: loaded.proposal,
          decision: loaded.decision,
          observation: mapOutcomeObservation(row),
        },
        entityId: observationId,
        auditMetadata: {
          action: "outcome_recorded",
          merchant: loaded.proposal.merchant,
          verdict: outcome.verdict,
          observationBasis: outcome.observationBasis,
          metric: outcome.metric,
        },
      };
    },
  });
}

/** Records what a person concluded about an adverse record. It resolves nothing on its own. */
export async function recordCommitmentControlExceptionReview(input: {
  workspaceId: string;
  actorUserId: string;
  proposalId: string;
  expectedVersion: number;
  idempotencyKey: string;
  request: RecordControlExceptionReviewRequest;
  now?: Date;
}) {
  const proposalId = requireUuid(input.proposalId, "Proposal id");
  return runControlMutation({
    ...input,
    minimumRole: "admin",
    operation: "commitment-control.record-exception-review",
    mutationKind: "CONTROL_EXCEPTION_REVIEW",
    requestForHash: { proposalId, ...input.request },
    write: async (client, now) => {
      const loaded = await loadProposalEvaluation(client, input.workspaceId, proposalId);
      if (!loaded?.decision) throw new RecoveryServiceError("NOT_FOUND", "An authorized proposal decision is required before an exception review.");
      if (loaded.decision.action === "DECLINE") {
        throw new RecoveryServiceError("CONFLICT", "A declined proposal has no adverse record to review.");
      }
      await assertAdverseExceptionTarget(client, {
        workspaceId: input.workspaceId,
        proposalId,
        decisionId: loaded.decision.id,
        targetKind: input.request.targetKind,
        targetId: input.request.targetId,
      });
      const reviewId = randomUUID();
      const result = await client.query<ExceptionReviewRow>(
        `insert into commitment_control_exception_reviews (
           id, workspace_id, proposal_id, decision_id, reconciliation_id,
           outcome_observation_id, disposition, note, reviewed_by_user_id, reviewed_at
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         returning id, proposal_id, decision_id, reconciliation_id, outcome_observation_id,
           disposition, note, reviewed_by_user_id, reviewed_at`,
        [
          reviewId, input.workspaceId, proposalId, loaded.decision.id,
          input.request.targetKind === "RECONCILIATION" ? input.request.targetId : null,
          input.request.targetKind === "OUTCOME_OBSERVATION" ? input.request.targetId : null,
          input.request.disposition, input.request.note, input.actorUserId, now,
        ],
      );
      const row = result.rows[0];
      if (!row) throw new RecoveryServiceError("SAVE_FAILED");
      return {
        data: { review: mapExceptionReview(row) },
        entityId: reviewId,
        auditMetadata: {
          action: "exception_reviewed",
          merchant: loaded.proposal.merchant,
          targetKind: input.request.targetKind,
          disposition: input.request.disposition,
        },
      };
    },
  });
}

export async function getCommitmentControlBrief(input: { workspaceId: string; actorUserId: string }) {
  assertControlEnrollment(input.workspaceId);
  const client = await getDatabasePool().connect();
  try {
    await client.query("begin isolation level repeatable read read only");
    await assertRole(client, input.actorUserId, input.workspaceId, "viewer");
    const state = await client.query<{ version: string }>(
      `select version::text from recovery_workspace_states where workspace_id = $1`,
      [input.workspaceId],
    );
    const policy = await loadLatestPolicyRow(client, input.workspaceId);
    const proposals = await client.query<ProposalRow>(
      `select id, submitted_by_user_id, submitted_by_display_name, merchant, purpose, category, amount_minor::text,
         currency, first_charge_date, cadence, as_of_date, projected_13_week_minor::text,
        projected_annual_minor::text, intended_outcome_metric, intended_outcome_direction,
        intended_outcome_target_value, intended_outcome_unit, intended_outcome_review_on,
        assumption_basis, created_at
       from commitment_control_proposals where workspace_id = $1
       order by created_at desc, id`,
      [input.workspaceId],
    );
    const evaluations = await client.query<EvaluationRow & { cited_evidence_ids: string[] }>(
      `select evaluation.id, evaluation.proposal_id, evaluation.policy_version, evaluation.status,
         evaluation.human_decision_required, evaluation.assumption_fields, evaluation.reason_codes,
         evaluation.currency_results, evaluation.cited_exposure_basis, evaluation.evaluated_at,
         coalesce(array_agg(link.evidence_id order by link.evidence_id)
           filter (where link.evidence_id is not null), '{}') as cited_evidence_ids
       from commitment_control_evaluations evaluation
       left join commitment_control_evaluation_evidence link
         on link.workspace_id = evaluation.workspace_id and link.evaluation_id = evaluation.id
       where evaluation.workspace_id = $1
       group by evaluation.workspace_id, evaluation.id
       order by evaluation.evaluated_at desc, evaluation.id`,
      [input.workspaceId],
    );
    const decisions = await client.query<DecisionRow & { policy_version: number }>(
      `select decision.id, decision.proposal_id, decision.evaluation_id, decision.action,
         decision.expected_amount_minor::text, decision.approved_cap_minor::text,
         decision.currency, decision.decided_by_user_id, decision.decided_by_display_name,
         decision.override_reason, decision.authorization_expires_on, decision.decided_at,
         evaluation.policy_version
       from commitment_control_decisions decision
       join commitment_control_evaluations evaluation
         on evaluation.workspace_id = decision.workspace_id and evaluation.id = decision.evaluation_id
       where decision.workspace_id = $1`,
      [input.workspaceId],
    );
    const reconciliations = await client.query<ReconciliationRow>(
      `select id, proposal_id, decision_id, evidence_id, verdict, expected_amount_minor::text,
         approved_cap_minor::text, authorization_currency, observed_amount_minor::text,
         observed_currency, observed_evidence_date, observed_outcome_value, observed_outcome_on,
        outcome_observation_basis, outcome_verdict, reconciled_by_user_id, reconciled_at
       from commitment_control_reconciliations where workspace_id = $1
       order by reconciled_at desc, id`,
      [input.workspaceId],
    );
    const proposalsById = new Map(proposals.rows.map((row) => [row.id, mapProposal(row)]));
    const observations = await client.query<OutcomeObservationRow>(
      `select id, proposal_id, decision_id, observed_value, observed_on, target_metric,
         target_direction, target_value, target_unit, target_review_on, verdict,
         observation_basis, observed_by_user_id, observed_at
       from commitment_control_outcome_observations where workspace_id = $1
       order by observed_at desc, id`,
      [input.workspaceId],
    );
    const reviews = await client.query<ExceptionReviewRow>(
      `select id, proposal_id, decision_id, reconciliation_id, outcome_observation_id,
         disposition, note, reviewed_by_user_id, reviewed_at
       from commitment_control_exception_reviews where workspace_id = $1
       order by reviewed_at desc, id`,
      [input.workspaceId],
    );
    const evaluationsByProposal = new Map(evaluations.rows.map((row) => [row.proposal_id, mapEvaluation(row, row.cited_evidence_ids)]));
    const decisionsByProposal = new Map(decisions.rows.map((row) => [row.proposal_id, mapDecision(row, row.policy_version)]));
    const reconciliationsByProposal = new Map<string, ControlReconciliationDto[]>();
    for (const row of reconciliations.rows) {
      const current = reconciliationsByProposal.get(row.proposal_id) ?? [];
      current.push(mapReconciliation(row, proposalsById.get(row.proposal_id)?.intendedOutcome ?? null));
      reconciliationsByProposal.set(row.proposal_id, current);
    }
    const observationsByProposal = new Map<string, ControlOutcomeObservationDto[]>();
    for (const row of observations.rows) {
      const current = observationsByProposal.get(row.proposal_id) ?? [];
      current.push(mapOutcomeObservation(row));
      observationsByProposal.set(row.proposal_id, current);
    }
    const reviewsByProposal = new Map<string, ControlExceptionReviewDto[]>();
    for (const row of reviews.rows) {
      const current = reviewsByProposal.get(row.proposal_id) ?? [];
      current.push(mapExceptionReview(row));
      reviewsByProposal.set(row.proposal_id, current);
    }
    const data: CommitmentControlBriefDto = {
      policy: policy ? mapPolicy(policy) : null,
      proposals: proposals.rows.map((row) => ({
        proposal: proposalsById.get(row.id) ?? mapProposal(row),
        evaluation: evaluationsByProposal.get(row.id) ?? null,
        decision: decisionsByProposal.get(row.id) ?? null,
        reconciliations: reconciliationsByProposal.get(row.id) ?? [],
        outcomeObservations: observationsByProposal.get(row.id) ?? [],
        exceptionReviews: reviewsByProposal.get(row.id) ?? [],
      })),
      capabilities: {
        canSubmitProposal: true,
        canDecide: false,
        canConfigurePolicy: false,
      },
    };
    const membership = await assertRole(client, input.actorUserId, input.workspaceId, "viewer");
    data.capabilities.canSubmitProposal = roleRank[membership.role] >= roleRank.member;
    data.capabilities.canDecide = roleRank[membership.role] >= roleRank.admin;
    data.capabilities.canConfigurePolicy = roleRank[membership.role] >= roleRank.admin;
    await client.query("commit");
    return { data, workspaceVersion: Number(state.rows[0]?.version ?? 0) };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw normalizeStoreError(error);
  } finally {
    client.release();
  }
}

export async function getControlReconciliationCandidates(input: {
  workspaceId: string;
  actorUserId: string;
  proposalId: string;
  now?: Date;
}): Promise<{ data: ControlReconciliationCandidatesDto; workspaceVersion: number }> {
  assertControlEnrollment(input.workspaceId);
  const proposalId = requireUuid(input.proposalId, "Proposal id");
  const client = await getDatabasePool().connect();
  try {
    await client.query("begin isolation level repeatable read read only");
    await assertRole(client, input.actorUserId, input.workspaceId, "viewer");
    const state = await client.query<{ version: string }>(
      `select version::text from recovery_workspace_states where workspace_id = $1`,
      [input.workspaceId],
    );
    const loaded = await loadProposalEvaluation(client, input.workspaceId, proposalId);
    if (!loaded?.decision) throw new RecoveryServiceError("NOT_FOUND", "An authorized proposal decision is required before reviewing evidence.");
    const evidence = await client.query<{
      evidence_id: string;
      commitment_id: string;
      commitment_merchant: string;
      amount_minor: string | null;
      currency: string | null;
      evidence_date: Date | string | null;
      already_reconciled: boolean;
    }>(
      `select distinct on (evidence.id)
         evidence.id as evidence_id,
         link.commitment_id,
         commitment.effective_merchant as commitment_merchant,
         evidence.amount_minor::text,
         evidence.currency,
         evidence.evidence_date,
         exists (
           select 1 from commitment_control_reconciliations reconciliation
           where reconciliation.workspace_id = evidence.workspace_id
             and reconciliation.proposal_id = $2
             and reconciliation.evidence_id = evidence.id
         ) as already_reconciled
       from recovery_evidence evidence
       join recovery_commitment_evidence link
         on link.workspace_id = evidence.workspace_id and link.evidence_id = evidence.id
       join recovery_commitments commitment
         on commitment.workspace_id = link.workspace_id and commitment.id = link.commitment_id
       where evidence.workspace_id = $1
         and evidence.amount_minor is not null
         and evidence.observed_at is not null
         and evidence.currency = $3
         and evidence.evidence_date >= $4::date
         and evidence.evidence_date <= $5::date
         and evidence.evidence_date <= $6::date
         and not exists (
           select 1 from commitment_control_reconciliations reconciliation
           where reconciliation.workspace_id = evidence.workspace_id
             and reconciliation.proposal_id = $2
             and reconciliation.evidence_id = evidence.id
         )
       order by evidence.id, link.commitment_id
       limit 100`,
      [
        input.workspaceId,
        proposalId,
        loaded.decision.currency,
        calendarDateInTimeZone(new Date(loaded.decision.decidedAt), "Asia/Kolkata"),
        loaded.decision.authorizationExpiresOn,
        calendarDateInTimeZone(input.now ?? new Date(), "Asia/Kolkata"),
      ],
    );
    const candidates = selectControlReconciliationCandidates({
      decision: loaded.decision,
      evidence: evidence.rows.map((row): ControlReconciliationEvidenceInput => ({
        evidenceId: row.evidence_id,
        commitmentId: row.commitment_id,
        commitmentMerchant: row.commitment_merchant,
        amountMinor: row.amount_minor,
        currency: row.currency,
        evidenceDate: row.evidence_date === null ? null : toDateOnly(row.evidence_date),
        alreadyReconciled: row.already_reconciled,
      })),
    });
    await client.query("commit");
    return {
      data: { proposalId, matchingPerformed: false, candidates: [...candidates] },
      workspaceVersion: Number(state.rows[0]?.version ?? 0),
    };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw normalizeStoreError(error);
  } finally {
    client.release();
  }
}

async function runControlMutation<T>(input: {
  workspaceId: string;
  actorUserId: string;
  expectedVersion: number;
  idempotencyKey: string;
  minimumRole: WorkspaceRole;
  operation: string;
  mutationKind: ControlMutationKind;
  requestForHash: unknown;
  now?: Date;
  write: (client: PoolClient, now: Date, membership: { role: WorkspaceRole }) => Promise<{ data: T; entityId: string; auditMetadata?: Record<string, unknown> }>;
}): Promise<{ data: T; workspaceVersion: number; replayed: boolean }> {
  assertControlEnrollment(input.workspaceId);
  const requestHash = hashRecoveryRequest({ operation: input.operation, request: input.requestForHash });
  const client = await getDatabasePool().connect();
  let committed: { data: T; workspaceVersion: number; replayed: boolean } | null = null;
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`recovery:${input.workspaceId}`]);
    const membership = await assertRole(client, input.actorUserId, input.workspaceId, input.minimumRole, true);
    const replay = await readIdempotent<T>(client, input.workspaceId, input.idempotencyKey, input.operation, requestHash);
    if (replay) {
      await client.query("commit");
      return { data: replay.response, workspaceVersion: replay.workspaceVersion, replayed: true };
    }
    const state = await ensureWorkspaceState(client, input.workspaceId);
    assertWorkspaceVersion(state, input.expectedVersion);
    const written = await input.write(client, input.now ?? new Date(), membership);
    const workspaceVersion = await advanceControlVersion(client, {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      currentState: state,
      mutationKind: input.mutationKind,
      entityId: written.entityId,
    });
    await writeIdempotent(client, input.workspaceId, input.idempotencyKey, input.operation, requestHash, written.data, workspaceVersion);
    await client.query(
      `insert into audit_log (workspace_id, user_id, action, entity_type, entity_id, metadata)
       values ($1, $2, $3, 'commitment-control', $4, $5::jsonb)`,
      [input.workspaceId, input.actorUserId, input.operation, written.entityId, JSON.stringify({
        workspaceVersion,
        ...(written.auditMetadata ?? {}),
      })],
    );
    await client.query("commit");
    committed = { data: written.data, workspaceVersion, replayed: false };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw normalizeStoreError(error);
  } finally {
    client.release();
  }
  if (!committed) throw new RecoveryServiceError("SAVE_FAILED");
  await recordConsentedProductEvent({
    workspaceId: input.workspaceId,
    userId: input.actorUserId,
    eventName: eventByMutation[input.mutationKind],
    source: "workspace-api",
    status: "succeeded",
  }).catch(() => undefined);
  return committed;
}

async function loadExistingExposure(
  client: PoolClient,
  workspaceId: string,
  commitmentIds: readonly string[],
  asOfDate: string,
): Promise<ExistingExposure[]> {
  const uniqueIds = [...new Set(commitmentIds.map((id) => requireUuid(id, "Existing commitment id")))];
  if (!uniqueIds.length) return [];
  if (uniqueIds.length > 50) throw new RecoveryServiceError("INVALID_EVIDENCE", "At most 50 existing commitments may inform one proposal.");
  const result = await client.query<{
    id: string;
    amount_minor: string;
    currency: string;
    cadence: ProposalCadence | "IRREGULAR";
    next_expected_date: Date | string | null;
    evidence_ids: string[];
  }>(
    `select commitment.id, commitment.effective_amount_minor::text as amount_minor,
       commitment.base_currency as currency, commitment.effective_cadence as cadence,
       commitment.effective_next_expected_date as next_expected_date,
       coalesce(array_agg(link.evidence_id order by link.evidence_id)
         filter (where link.evidence_id is not null), '{}') as evidence_ids
     from recovery_commitments commitment
     left join recovery_commitment_evidence link
       on link.workspace_id = commitment.workspace_id and link.commitment_id = commitment.id
     where commitment.workspace_id = $1 and commitment.id = any($2::uuid[])
       and commitment.effective_status = 'ACTIVE'
     group by commitment.workspace_id, commitment.id`,
    [workspaceId, uniqueIds],
  );
  if (result.rows.length !== uniqueIds.length) throw new RecoveryServiceError("NOT_FOUND", "An existing commitment was not found in this workspace.");
  const totals = new Map<string, {
    thirteenWeekMinor: bigint;
    annualMinor: bigint;
    evidenceIds: Set<string>;
    basis: "PROJECTED" | "OBSERVATION_ONLY";
  }>();
  for (const row of result.rows) {
    if (!row.evidence_ids.length) {
      throw new RecoveryServiceError("INVALID_EVIDENCE", "Existing exposure needs persisted evidence.");
    }
    const observationOnly = !row.next_expected_date || row.cadence === "IRREGULAR";
    if (observationOnly) {
      const amount = BigInt(row.amount_minor);
      const current = totals.get(row.currency) ?? {
        thirteenWeekMinor: BigInt(0),
        annualMinor: BigInt(0),
        evidenceIds: new Set<string>(),
        basis: "OBSERVATION_ONLY" as const,
      };
      current.thirteenWeekMinor = addMinorUnits(current.thirteenWeekMinor, amount, "Existing observation exposure");
      current.annualMinor = addMinorUnits(current.annualMinor, amount, "Existing observation exposure");
      current.basis = "OBSERVATION_ONLY";
      row.evidence_ids.forEach((id) => current.evidenceIds.add(id));
      totals.set(row.currency, current);
      continue;
    }
    const nextDate = row.next_expected_date;
    if (!nextDate) throw new RecoveryServiceError("SAVE_FAILED", "Projected exposure is missing a next charge date.");
    const firstChargeDate = rollForwardDate(toDateOnly(nextDate), row.cadence as ProposalCadence, asOfDate);
    const projection = projectProposalExposure([{
      proposalId: row.id,
      amountMinor: row.amount_minor,
      currency: row.currency,
      firstChargeDate,
      cadence: row.cadence as ProposalCadence,
    }], { asOfDate });
    const projected = projection.proposals[0];
    if (!projected) throw new RecoveryServiceError("INVALID_EVIDENCE", "Existing exposure projection is empty.");
    const current = totals.get(projected.currency) ?? {
      thirteenWeekMinor: BigInt(0),
      annualMinor: BigInt(0),
      evidenceIds: new Set<string>(),
      basis: "PROJECTED" as const,
    };
    current.thirteenWeekMinor = addMinorUnits(current.thirteenWeekMinor, BigInt(projected.thirteenWeekMinor), "Existing 13-week exposure");
    current.annualMinor = addMinorUnits(current.annualMinor, BigInt(projected.annualMinor), "Existing annual exposure");
    row.evidence_ids.forEach((id) => current.evidenceIds.add(id));
    totals.set(projected.currency, current);
  }
  return [...totals.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([currency, total]) => ({
    currency,
    thirteenWeekMinor: total.thirteenWeekMinor.toString(),
    annualMinor: total.annualMinor.toString(),
    evidenceIds: [...total.evidenceIds].sort(),
    basis: total.basis,
  }));
}

async function loadProposalEvaluation(client: PoolClient, workspaceId: string, proposalId: string) {
  const proposalResult = await client.query<ProposalRow>(
    `select id, submitted_by_user_id, submitted_by_display_name, merchant, purpose, category, amount_minor::text,
       currency, first_charge_date, cadence, as_of_date, projected_13_week_minor::text,
       projected_annual_minor::text, intended_outcome_metric, intended_outcome_direction,
       intended_outcome_target_value, intended_outcome_unit, intended_outcome_review_on,
       assumption_basis, created_at
     from commitment_control_proposals where workspace_id = $1 and id = $2`,
    [workspaceId, proposalId],
  );
  const evaluationResult = await client.query<EvaluationRow & { cited_evidence_ids: string[] }>(
    `select evaluation.id, evaluation.proposal_id, evaluation.policy_version, evaluation.status,
       evaluation.human_decision_required, evaluation.assumption_fields, evaluation.reason_codes,
       evaluation.currency_results, evaluation.cited_exposure_basis, evaluation.evaluated_at,
       coalesce(array_agg(link.evidence_id order by link.evidence_id)
         filter (where link.evidence_id is not null), '{}') as cited_evidence_ids
     from commitment_control_evaluations evaluation
     left join commitment_control_evaluation_evidence link
       on link.workspace_id = evaluation.workspace_id and link.evaluation_id = evaluation.id
     where evaluation.workspace_id = $1 and evaluation.proposal_id = $2
     group by evaluation.workspace_id, evaluation.id`,
    [workspaceId, proposalId],
  );
  const proposal = proposalResult.rows[0];
  const evaluationRow = evaluationResult.rows[0];
  if (!proposal || !evaluationRow) return null;
  const evaluationDto = mapEvaluation(evaluationRow, evaluationRow.cited_evidence_ids);
  const evaluation: ProposalPolicyEvaluation & { id: string } = {
    ...evaluationDto,
    proposal: {
      proposalId: proposal.id,
      amountMinor: proposal.amount_minor,
      currency: proposal.currency,
      category: proposal.category,
      thirteenWeekMinor: proposal.projected_13_week_minor,
      annualMinor: proposal.projected_annual_minor,
    },
  };
  const decisionResult = await client.query<DecisionRow>(
    `select id, proposal_id, evaluation_id, action, expected_amount_minor::text,
       approved_cap_minor::text, currency, decided_by_user_id, decided_by_display_name,
       override_reason, authorization_expires_on, decided_at
     from commitment_control_decisions where workspace_id = $1 and proposal_id = $2`,
    [workspaceId, proposalId],
  );
  return {
    proposal: mapProposal(proposal),
    evaluation,
    decision: decisionResult.rows[0] ? mapDecision(decisionResult.rows[0], evaluation.policyVersion) : null,
  };
}

async function assertAdverseExceptionTarget(client: PoolClient, input: {
  workspaceId: string;
  proposalId: string;
  decisionId: string;
  targetKind: RecordControlExceptionReviewRequest["targetKind"];
  targetId: string;
}) {
  if (input.targetKind === "RECONCILIATION") {
    const result = await client.query<{ verdict: ControlReconciliationDto["verdict"]; outcome_verdict: string | null }>(
      `select verdict, outcome_verdict from commitment_control_reconciliations
       where workspace_id = $1 and id = $2 and proposal_id = $3 and decision_id = $4`,
      [input.workspaceId, input.targetId, input.proposalId, input.decisionId],
    );
    const row = result.rows[0];
    if (!row) throw new RecoveryServiceError("NOT_FOUND", "That reconciliation is not on this authorized proposal decision.");
    if (!adverseReconciliationVerdicts.has(row.verdict) && row.outcome_verdict !== "MISSED") {
      throw new RecoveryServiceError("CONFLICT", "Only an adverse Commitment Control record can be reviewed.");
    }
    return;
  }
  const result = await client.query<{ verdict: string }>(
    `select verdict from commitment_control_outcome_observations
     where workspace_id = $1 and id = $2 and proposal_id = $3 and decision_id = $4`,
    [input.workspaceId, input.targetId, input.proposalId, input.decisionId],
  );
  const row = result.rows[0];
  if (!row) throw new RecoveryServiceError("NOT_FOUND", "That outcome observation is not on this authorized proposal decision.");
  if (row.verdict !== "MISSED") {
    throw new RecoveryServiceError("CONFLICT", "Only an adverse Commitment Control record can be reviewed.");
  }
}

async function ensureWorkspaceState(client: PoolClient, workspaceId: string) {
  await client.query(`insert into recovery_workspace_states (workspace_id) values ($1) on conflict (workspace_id) do nothing`, [workspaceId]);
  const result = await client.query<WorkspaceStateRow>(
    `select version::text, baseline_version::text, latest_changed_state,
       latest_from_version::text, latest_changed_version::text
     from recovery_workspace_states where workspace_id = $1 for update`,
    [workspaceId],
  );
  const row = result.rows[0];
  if (!row) throw new RecoveryServiceError("SAVE_FAILED");
  return row;
}

function assertWorkspaceVersion(state: WorkspaceStateRow, expectedVersion: number) {
  const currentVersion = Number(state.version);
  if (!Number.isSafeInteger(expectedVersion) || currentVersion !== expectedVersion) {
    throw new RecoveryServiceError("STALE_STATE", undefined, { currentVersion });
  }
}

async function advanceControlVersion(client: PoolClient, input: {
  workspaceId: string;
  actorUserId: string;
  currentState: WorkspaceStateRow;
  mutationKind: ControlMutationKind;
  entityId: string;
}) {
  const nextVersion = Number(input.currentState.version) + 1;
  await client.query(
    `update recovery_workspace_states set version = $2, updated_at = now() where workspace_id = $1`,
    [input.workspaceId, nextVersion],
  );
  await client.query(
    `insert into recovery_workspace_versions (
       workspace_id, version, actor_user_id, mutation_kind, changed_state, from_version, snapshot
     ) values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      input.workspaceId,
      nextVersion,
      input.actorUserId,
      input.mutationKind,
      input.currentState.latest_changed_state,
      input.currentState.latest_changed_state === "COMPARED" ? input.currentState.latest_from_version : null,
      JSON.stringify({ version: nextVersion, commitmentControl: { mutationKind: input.mutationKind, entityId: input.entityId } }),
    ],
  );
  return nextVersion;
}

async function assertRole(client: PoolClient, userId: string, workspaceId: string, minimumRole: WorkspaceRole, lock = false) {
  const result = await client.query<{ role: WorkspaceRole }>(
    `select role from workspace_members where workspace_id = $1 and user_id = $2${lock ? " for share" : ""}`,
    [workspaceId, userId],
  );
  const row = result.rows[0];
  if (!row || roleRank[row.role] < roleRank[minimumRole]) throw new RecoveryServiceError("FORBIDDEN");
  return row;
}

async function readIdempotent<T>(client: PoolClient, workspaceId: string, idempotencyKey: string, operation: string, requestHash: string) {
  const result = await client.query<{ operation: string; request_hash: string; response_payload: T; workspace_version: string }>(
    `select operation, request_hash, response_payload, workspace_version::text
     from recovery_idempotency_keys where workspace_id = $1 and idempotency_key = $2`,
    [workspaceId, idempotencyKey],
  );
  const row = result.rows[0];
  if (!row) return null;
  if (row.operation !== operation || row.request_hash !== requestHash) {
    throw new RecoveryServiceError("CONFLICT", "Idempotency-Key was already used for a different Commitment Control request.");
  }
  return { response: row.response_payload, workspaceVersion: Number(row.workspace_version) };
}

async function writeIdempotent(client: PoolClient, workspaceId: string, idempotencyKey: string, operation: string, requestHash: string, response: unknown, workspaceVersion: number) {
  await client.query(
    `insert into recovery_idempotency_keys (
       workspace_id, idempotency_key, operation, request_hash, response_payload, workspace_version
     ) values ($1, $2, $3, $4, $5::jsonb, $6)`,
    [workspaceId, idempotencyKey, operation, requestHash, JSON.stringify(response), workspaceVersion],
  );
}

async function loadLatestPolicy(client: PoolClient, workspaceId: string): Promise<ProposalPolicy | null> {
  const row = await loadLatestPolicyRow(client, workspaceId);
  return row ? mapPolicy(row) : null;
}

async function loadLatestPolicyRow(client: PoolClient, workspaceId: string) {
  const result = await client.query<PolicyRow>(
    `select workspace_id, version, category_rules, currency_limits, created_by_user_id, created_at
     from commitment_control_policies where workspace_id = $1 order by version desc limit 1`,
    [workspaceId],
  );
  return result.rows[0] ?? null;
}

function mapPolicy(row: PolicyRow): ControlPolicyDto {
  return {
    policyVersion: row.version,
    categoryRules: row.category_rules,
    currencyLimits: row.currency_limits,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at.toISOString(),
  };
}

function mapProposal(row: ProposalRow): ControlProposalDto {
  return {
    id: row.id,
    submittedByUserId: row.submitted_by_user_id,
    submittedByDisplayName: row.submitted_by_display_name ?? null,
    merchant: row.merchant,
    purpose: row.purpose,
    category: row.category,
    amountMinor: row.amount_minor,
    currency: row.currency,
    firstChargeDate: toDateOnly(row.first_charge_date),
    cadence: row.cadence,
    asOfDate: toDateOnly(row.as_of_date),
    projectedThirteenWeekMinor: row.projected_13_week_minor,
    projectedAnnualMinor: row.projected_annual_minor,
    intendedOutcome: row.intended_outcome_metric === null
      ? null
      : {
          metric: row.intended_outcome_metric,
          targetDirection: row.intended_outcome_direction ?? invalidDatabaseOutcome(),
          targetValue: row.intended_outcome_target_value ?? invalidDatabaseOutcome(),
          unit: row.intended_outcome_unit ?? invalidDatabaseOutcome(),
          reviewOn: row.intended_outcome_review_on ? toDateOnly(row.intended_outcome_review_on) : invalidDatabaseOutcome(),
        },
    assumptionBasis: row.assumption_basis,
    createdAt: row.created_at.toISOString(),
  };
}

function mapEvaluation(row: EvaluationRow, citedEvidenceIds: string[]): ControlEvaluationDto {
  return {
    id: row.id,
    proposalId: row.proposal_id,
    policyVersion: row.policy_version,
    status: row.status,
    humanDecisionRequired: true,
    assumptionFields: row.assumption_fields,
    reasonCodes: row.reason_codes,
    citedExposureBasis: row.cited_exposure_basis ?? (citedEvidenceIds.length ? "PROJECTED" : "NONE"),
    currencyResults: row.currency_results,
    citedEvidenceIds,
    evaluatedAt: row.evaluated_at.toISOString(),
  };
}

function mapDecision(row: DecisionRow, policyVersion: number): ControlDecisionDto {
  return {
    id: row.id,
    evaluationId: row.evaluation_id,
    proposalId: row.proposal_id,
    evaluationPolicyVersion: policyVersion,
    action: row.action,
    approvedCapMinor: row.approved_cap_minor,
    currency: row.currency,
    expectedAmountMinor: row.expected_amount_minor,
    decidedByUserId: row.decided_by_user_id,
    decidedByDisplayName: row.decided_by_display_name ?? null,
    overrideReason: row.override_reason ?? null,
    decidedAt: row.decided_at.toISOString(),
    authorizationExpiresOn: row.authorization_expires_on ? toDateOnly(row.authorization_expires_on) : null,
  };
}

function mapReconciliation(
  row: ReconciliationRow,
  intendedOutcome: ControlProposalDto["intendedOutcome"],
): ControlReconciliationDto {
  return {
    id: row.id,
    proposalId: row.proposal_id,
    decisionId: row.decision_id,
    evidenceId: row.evidence_id,
    verdict: row.verdict,
    expectedAmountMinor: row.expected_amount_minor,
    approvedCapMinor: row.approved_cap_minor,
    authorizationCurrency: row.authorization_currency,
    observedAmountMinor: row.observed_amount_minor,
    observedCurrency: row.observed_currency,
    observedEvidenceDate: row.observed_evidence_date ? toDateOnly(row.observed_evidence_date) : null,
    outcome: row.outcome_verdict === null
      ? null
      : intendedOutcome === null
        ? invalidDatabaseOutcome()
        : {
            ...intendedOutcome,
            observedValue: row.observed_outcome_value,
            observedOn: row.observed_outcome_on ? toDateOnly(row.observed_outcome_on) : null,
            observationBasis: row.outcome_observation_basis ?? invalidDatabaseOutcome(),
            verdict: row.outcome_verdict,
          },
    reconciledByUserId: row.reconciled_by_user_id,
    reconciledAt: row.reconciled_at.toISOString(),
  };
}

function mapOutcomeObservation(row: OutcomeObservationRow): ControlOutcomeObservationDto {
  return {
    id: row.id,
    proposalId: row.proposal_id,
    decisionId: row.decision_id,
    observedValue: row.observed_value,
    observedOn: toDateOnly(row.observed_on),
    target: {
      metric: row.target_metric,
      targetDirection: row.target_direction,
      targetValue: row.target_value,
      unit: row.target_unit,
      reviewOn: toDateOnly(row.target_review_on),
    },
    observationBasis: row.observation_basis,
    verdict: row.verdict,
    observedByUserId: row.observed_by_user_id,
    observedAt: row.observed_at.toISOString(),
  };
}

function mapExceptionReview(row: ExceptionReviewRow): ControlExceptionReviewDto {
  const targetId = row.reconciliation_id ?? row.outcome_observation_id;
  if (!targetId) throw new RecoveryServiceError("SAVE_FAILED", "Database returned an exception review without a target.");
  return {
    id: row.id,
    proposalId: row.proposal_id,
    decisionId: row.decision_id,
    targetKind: row.reconciliation_id ? "RECONCILIATION" : "OUTCOME_OBSERVATION",
    targetId,
    disposition: row.disposition,
    note: row.note,
    reviewedByUserId: row.reviewed_by_user_id,
    reviewedAt: row.reviewed_at.toISOString(),
  };
}

function invalidDatabaseOutcome(): never {
  throw new RecoveryServiceError("SAVE_FAILED", "Database returned an incomplete Commitment Control outcome.");
}

function rollForwardDate(firstDate: string, cadence: ProposalCadence, asOfDate: string) {
  let current = parseIsoDateOnly(firstDate);
  const asOf = parseIsoDateOnly(asOfDate);
  if (!current || !asOf) throw new RecoveryServiceError("INVALID_EVIDENCE", "Existing commitment dates are invalid.");
  const anchorDay = current.getDate();
  const frequency = frequencyByCadence[cadence];
  if (!frequency) throw new RecoveryServiceError("INVALID_EVIDENCE", "Existing commitment cadence is not projectable.");
  for (let count = 0; current < asOf && count < 200; count += 1) {
    current = advanceDateByFrequency(current, frequency, 30.44, anchorDay);
  }
  if (current < asOf) throw new RecoveryServiceError("INVALID_EVIDENCE", "Existing commitment cadence exceeds the projection bound.");
  return formatCalendarDate(current);
}

const frequencyByCadence: Partial<Record<ProposalCadence, Frequency>> = {
  WEEKLY: "weekly",
  BIWEEKLY: "biweekly",
  SEMIMONTHLY: "semimonthly",
  MONTHLY: "monthly",
  BIMONTHLY: "bimonthly",
  QUARTERLY: "quarterly",
  YEARLY: "yearly",
};

function boundedText(value: unknown, label: string, minimum: number, maximum: number) {
  if (typeof value !== "string") throw new RecoveryServiceError("INVALID_EVIDENCE", `${label} is required.`);
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum) throw new RecoveryServiceError("INVALID_EVIDENCE", `${label} length is invalid.`);
  return normalized;
}

function toDateOnly(value: Date | string) {
  if (value instanceof Date) return formatCalendarDate(value);
  const date = parseIsoDateOnly(value);
  if (!date) throw new RecoveryServiceError("SAVE_FAILED", "Database returned an invalid calendar date.");
  return formatCalendarDate(date);
}

function normalizeStoreError(error: unknown) {
  if (error instanceof RecoveryServiceError) return error;
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  if (code === "42P01" || code === "42703") {
    return new RecoveryServiceError("FEATURE_UNAVAILABLE", "Commitment Control is not fully installed for this deployment.");
  }
  if (code === "23503") return new RecoveryServiceError("NOT_FOUND");
  if (code === "23505" || code === "55000") return new RecoveryServiceError("CONFLICT");
  if (code === "23514" || error instanceof RangeError || error instanceof TypeError) return new RecoveryServiceError("INVALID_EVIDENCE");
  if (error instanceof Error && /must|invalid|unsupported|exceed|currency|amount|date|cadence|policy|proposal|evidence/i.test(error.message)) {
    return new RecoveryServiceError("INVALID_EVIDENCE", error.message);
  }
  return new RecoveryServiceError("SAVE_FAILED", error instanceof Error ? error.message : undefined, { retryable: true });
}

async function workspaceHasEligibleExposure(client: PoolClient, workspaceId: string) {
  const result = await client.query<{ exists: boolean }>(
    `select exists (
       select 1
       from recovery_commitments commitment
       where commitment.workspace_id = $1
         and commitment.effective_status = 'ACTIVE'
         and exists (
           select 1 from recovery_commitment_evidence link
           where link.workspace_id = commitment.workspace_id
             and link.commitment_id = commitment.id
         )
     ) as exists`,
    [workspaceId],
  );
  return result.rows[0]?.exists === true;
}

async function readActorDisplayName(client: PoolClient, userId: string) {
  const result = await client.query<{ name: string | null }>(
    `select left(coalesce(nullif(btrim(display_name), ''), split_part(email, '@', 1)), 120) as name
     from users where id = $1`,
    [userId],
  );
  const name = result.rows[0]?.name?.trim() ?? "";
  return name.length ? name : null;
}

function assertControlEnrollment(workspaceId: string) {
  if (!isCommitmentControlWorkspaceEnrolled(workspaceId)) {
    throw new RecoveryServiceError("FEATURE_UNAVAILABLE", "This workspace is not enrolled in the Commitment Control private pilot.");
  }
}

type PolicyRow = {
  workspace_id: string;
  version: number;
  category_rules: ProposalPolicy["categoryRules"];
  currency_limits: ProposalPolicy["currencyLimits"];
  created_by_user_id: string | null;
  created_at: Date;
};

type ProposalRow = {
  id: string;
  submitted_by_user_id: string | null;
  submitted_by_display_name: string | null;
  merchant: string;
  purpose: string;
  category: ProposalCategory;
  amount_minor: string;
  currency: string;
  first_charge_date: Date | string;
  cadence: ProposalCadence;
  as_of_date: Date | string;
  projected_13_week_minor: string;
  projected_annual_minor: string;
  intended_outcome_metric: string | null;
  intended_outcome_direction: NonNullable<ControlProposalDto["intendedOutcome"]>["targetDirection"] | null;
  intended_outcome_target_value: string | null;
  intended_outcome_unit: string | null;
  intended_outcome_review_on: Date | string | null;
  assumption_basis: "USER_ENTERED_ASSUMPTION";
  created_at: Date;
};

type EvaluationRow = {
  id: string;
  proposal_id: string;
  policy_version: number;
  status: ProposalPolicyEvaluation["status"];
  human_decision_required: true;
  assumption_fields: ControlEvaluationDto["assumptionFields"];
  reason_codes: ControlEvaluationDto["reasonCodes"];
  currency_results: ControlEvaluationDto["currencyResults"];
  cited_exposure_basis?: ControlEvaluationDto["citedExposureBasis"];
  evaluated_at: Date;
};

type DecisionRow = {
  id: string;
  proposal_id: string;
  evaluation_id: string;
  action: ProposalDecisionAction;
  expected_amount_minor: string;
  approved_cap_minor: string | null;
  currency: string;
  decided_by_user_id: string | null;
  decided_by_display_name?: string | null;
  override_reason?: string | null;
  authorization_expires_on: Date | string | null;
  decided_at: Date;
};

type ReconciliationRow = {
  id: string;
  proposal_id: string;
  decision_id: string;
  evidence_id: string;
  verdict: ControlReconciliationDto["verdict"];
  expected_amount_minor: string;
  approved_cap_minor: string | null;
  authorization_currency: string;
  observed_amount_minor: string | null;
  observed_currency: string | null;
  observed_evidence_date: Date | string | null;
  observed_outcome_value: string | null;
  observed_outcome_on: Date | string | null;
  outcome_observation_basis: NonNullable<ControlReconciliationDto["outcome"]>["observationBasis"] | null;
  outcome_verdict: NonNullable<ControlReconciliationDto["outcome"]>["verdict"] | null;
  reconciled_by_user_id: string | null;
  reconciled_at: Date;
};

type OutcomeObservationRow = {
  id: string;
  proposal_id: string;
  decision_id: string;
  observed_value: string;
  observed_on: Date | string;
  target_metric: string;
  target_direction: ControlOutcomeObservationDto["target"]["targetDirection"];
  target_value: string;
  target_unit: string;
  target_review_on: Date | string;
  verdict: ControlOutcomeObservationDto["verdict"];
  observation_basis: ControlOutcomeObservationDto["observationBasis"];
  observed_by_user_id: string | null;
  observed_at: Date;
};

type ExceptionReviewRow = {
  id: string;
  proposal_id: string;
  decision_id: string;
  reconciliation_id: string | null;
  outcome_observation_id: string | null;
  disposition: ControlExceptionReviewDto["disposition"];
  note: string;
  reviewed_by_user_id: string | null;
  reviewed_at: Date;
};