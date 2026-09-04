import assert from "node:assert/strict";
import test from "node:test";

import {
  commitmentControlEndpoints,
  isCommitmentControlBriefDto,
  isControlExceptionReviewWriteDto,
  isControlOutcomeObservationWriteDto,
  normalizeControlExceptionReviewRequest,
  normalizeControlOutcomeObservationRequest,
} from "../src/lib/commitment-control/contracts";
import { completeControlPolicyRequest } from "./commitment-control-policy-fixture";

const intendedOutcome = {
  metric: "Resolved support cases",
  targetDirection: "AT_LEAST",
  targetValue: "1200",
  unit: "cases",
  reviewOn: "2026-10-15",
} as const;

const proposalDto = {
  id: "a1000000-0000-4000-8000-000000000001",
  submittedByUserId: "b1000000-0000-4000-8000-000000000001",
  submittedByDisplayName: "Control member",
  merchant: "OpenAI",
  purpose: "Production capacity",
  category: "AI_MODEL",
  amountMinor: "199900",
  currency: "INR",
  firstChargeDate: "2026-09-01",
  cadence: "MONTHLY",
  asOfDate: "2026-08-25",
  projectedThirteenWeekMinor: "599700",
  projectedAnnualMinor: "2398800",
  intendedOutcome,
  assumptionBasis: "USER_ENTERED_ASSUMPTION",
  createdAt: "2026-08-25T09:00:00.000Z",
} as const;

const evaluationDto = {
  id: "c1000000-0000-4000-8000-000000000001",
  proposalId: proposalDto.id,
  policyVersion: 1,
  status: "WITHIN_POLICY",
  humanDecisionRequired: true,
  assumptionFields: ["amountMinor", "currency", "category", "thirteenWeekMinor", "annualMinor"],
  citedEvidenceIds: [],
  citedExposureBasis: "NONE",
  reasonCodes: [],
  currencyResults: [{
    currency: "INR",
    existingThirteenWeekMinor: "0",
    proposedThirteenWeekMinor: "599700",
    combinedThirteenWeekMinor: "599700",
    thirteenWeekHeadroomMinor: "2400300",
    existingAnnualMinor: "0",
    proposedAnnualMinor: "2398800",
    combinedAnnualMinor: "2398800",
    annualHeadroomMinor: "9601200",
  }],
  evaluatedAt: "2026-08-25T09:00:00.000Z",
} as const;

const decisionDto = {
  id: "d1000000-0000-4000-8000-000000000001",
  evaluationId: evaluationDto.id,
  proposalId: proposalDto.id,
  evaluationPolicyVersion: 1,
  action: "APPROVE_WITH_CAP",
  approvedCapMinor: "180000",
  currency: "INR",
  expectedAmountMinor: "199900",
  decidedByUserId: null,
  decidedByDisplayName: null,
  overrideReason: null,
  decidedAt: "2026-08-25T09:05:00.000Z",
  authorizationExpiresOn: "2026-09-30",
} as const;

const notObservedOutcome = {
  ...intendedOutcome,
  observedValue: null,
  observedOn: null,
  observationBasis: "NOT_OBSERVED",
  verdict: "NOT_OBSERVED",
} as const;

const overCapReconciliationDto = {
  id: "f1000000-0000-4000-8000-000000000001",
  proposalId: proposalDto.id,
  decisionId: decisionDto.id,
  evidenceId: "e1000000-0000-4000-8000-000000000002",
  verdict: "OVER_CAP",
  expectedAmountMinor: "199900",
  approvedCapMinor: "180000",
  authorizationCurrency: "INR",
  observedAmountMinor: "199900",
  observedCurrency: "INR",
  observedEvidenceDate: "2026-09-01",
  outcome: notObservedOutcome,
  reconciledByUserId: null,
  reconciledAt: "2026-09-01T09:00:00.000Z",
} as const;

const withinCapReconciliationDto = {
  ...overCapReconciliationDto,
  id: "f1000000-0000-4000-8000-000000000002",
  evidenceId: "e1000000-0000-4000-8000-000000000003",
  verdict: "WITHIN_CAP",
  observedAmountMinor: "170000",
} as const;

const missedObservationDto = {
  id: "0a000000-0000-4000-8000-000000000001",
  proposalId: proposalDto.id,
  decisionId: decisionDto.id,
  observedValue: "900",
  observedOn: "2026-10-20",
  target: intendedOutcome,
  observationBasis: "USER_ENTERED_OBSERVATION",
  verdict: "MISSED",
  observedByUserId: null,
  observedAt: "2026-10-20T09:00:00.000Z",
} as const;

const metObservationDto = {
  ...missedObservationDto,
  observedValue: "1250",
  verdict: "MET",
} as const;

const reconciliationReviewDto = {
  id: "0b000000-0000-4000-8000-000000000001",
  proposalId: proposalDto.id,
  decisionId: decisionDto.id,
  targetKind: "RECONCILIATION",
  targetId: overCapReconciliationDto.id,
  disposition: "NEW_PROPOSAL_REQUIRED",
  note: "Overage was real. A fresh proposal will carry the higher cap.",
  reviewedByUserId: null,
  reviewedAt: "2026-09-02T09:00:00.000Z",
} as const;

const observationReviewDto = {
  ...reconciliationReviewDto,
  id: "0b000000-0000-4000-8000-000000000002",
  targetKind: "OUTCOME_OBSERVATION",
  targetId: missedObservationDto.id,
  disposition: "CORRECTED_OUTSIDE_VOGNARY",
  note: "The team renegotiated the plan directly with the vendor.",
} as const;

const policy = {
  policyVersion: 1,
  ...completeControlPolicyRequest(),
  createdByUserId: null,
  createdAt: "2026-08-25T08:00:00.000Z",
} as const;

function brief(entry: Record<string, unknown>) {
  return {
    policy,
    proposals: [{
      proposal: proposalDto,
      evaluation: evaluationDto,
      decision: decisionDto,
      reconciliations: [],
      outcomeObservations: [],
      exceptionReviews: [],
      ...entry,
    }],
    capabilities: { canSubmitProposal: true, canDecide: true, canConfigurePolicy: true },
  };
}

test("normalizes the evidence-independent outcome observation request", () => {
  assert.deepEqual(normalizeControlOutcomeObservationRequest({
    observedOutcome: { value: "001250.000", observedOn: "2026-10-15" },
  }), { observedOutcome: { value: "1250", observedOn: "2026-10-15" } });

  assert.throws(
    () => normalizeControlOutcomeObservationRequest({
      observedOutcome: { value: "1250", observedOn: "2026-10-15" },
      evidenceId: "e1000000-0000-4000-8000-000000000001",
    }),
    /unknown.*evidenceId/i,
  );
  assert.throws(() => normalizeControlOutcomeObservationRequest({}), /observed outcome/i);
  assert.throws(
    () => normalizeControlOutcomeObservationRequest({ observedOutcome: { value: "-1", observedOn: "2026-10-15" } }),
    /outcome value/i,
  );
  assert.throws(
    () => normalizeControlOutcomeObservationRequest({ observedOutcome: { value: "1", observedOn: "2026-02-30" } }),
    /calendar date|outcome date/i,
  );
});

test("normalizes the append-only exception review request", () => {
  assert.deepEqual(normalizeControlExceptionReviewRequest({
    targetKind: "RECONCILIATION",
    targetId: "F1000000-0000-4000-8000-000000000001",
    disposition: "NO_FURTHER_ACTION",
    note: "  The vendor credited the difference.  ",
  }), {
    targetKind: "RECONCILIATION",
    targetId: "f1000000-0000-4000-8000-000000000001",
    disposition: "NO_FURTHER_ACTION",
    note: "The vendor credited the difference.",
  });

  assert.throws(() => normalizeControlExceptionReviewRequest({
    targetKind: "EVIDENCE",
    targetId: overCapReconciliationDto.id,
    disposition: "NO_FURTHER_ACTION",
    note: "n",
  }), /target kind/i);
  assert.throws(() => normalizeControlExceptionReviewRequest({
    targetKind: "RECONCILIATION",
    targetId: overCapReconciliationDto.id,
    disposition: "AUTO_RESOLVE",
    note: "n",
  }), /disposition/i);
  assert.throws(() => normalizeControlExceptionReviewRequest({
    targetKind: "RECONCILIATION",
    targetId: overCapReconciliationDto.id,
    disposition: "NO_FURTHER_ACTION",
    note: "   ",
  }), /note/i);
  assert.throws(() => normalizeControlExceptionReviewRequest({
    targetKind: "RECONCILIATION",
    targetId: overCapReconciliationDto.id,
    disposition: "NO_FURTHER_ACTION",
    note: "x".repeat(501),
  }), /note/i);
  assert.throws(() => normalizeControlExceptionReviewRequest({
    targetKind: "RECONCILIATION",
    targetId: overCapReconciliationDto.id,
    disposition: "NO_FURTHER_ACTION",
    note: "n",
    resolved: true,
  }), /unknown.*resolved/i);
});

test("the brief guard accepts follow-through records bound to their own proposal decision", () => {
  assert.equal(isCommitmentControlBriefDto(brief({ outcomeObservations: [metObservationDto] })), true);
  assert.equal(isCommitmentControlBriefDto(brief({
    reconciliations: [overCapReconciliationDto],
    exceptionReviews: [reconciliationReviewDto],
  })), true);
  assert.equal(isCommitmentControlBriefDto(brief({
    outcomeObservations: [missedObservationDto],
    exceptionReviews: [observationReviewDto],
  })), true);
});

test("the brief guard rejects unbound, duplicated, non-adverse, or verdict-inconsistent follow-through", () => {
  assert.equal(isCommitmentControlBriefDto(brief({ outcomeObservations: [{ ...metObservationDto, verdict: "MISSED" }] })), false);
  assert.equal(isCommitmentControlBriefDto(brief({
    outcomeObservations: [{ ...metObservationDto, observedOn: "2026-10-01" }],
  })), false);
  assert.equal(isCommitmentControlBriefDto(brief({
    outcomeObservations: [{ ...metObservationDto, target: { ...intendedOutcome, targetValue: "1" } }],
  })), false);
  assert.equal(isCommitmentControlBriefDto(brief({
    outcomeObservations: [metObservationDto, { ...metObservationDto, id: "0a000000-0000-4000-8000-000000000002" }],
  })), false);
  assert.equal(isCommitmentControlBriefDto(brief({
    outcomeObservations: [{ ...metObservationDto, observationBasis: "USER_ENTERED_WITH_EVIDENCE_CITATION" }],
  })), false);
  assert.equal(isCommitmentControlBriefDto(brief({
    outcomeObservations: [{ ...metObservationDto, decisionId: "d1000000-0000-4000-8000-000000000099" }],
  })), false);
  assert.equal(isCommitmentControlBriefDto({
    ...brief({ outcomeObservations: [metObservationDto] }),
    proposals: [{
      ...brief({ outcomeObservations: [metObservationDto] }).proposals[0],
      decision: null,
      evaluation: evaluationDto,
    }],
  }), false);

  assert.equal(isCommitmentControlBriefDto(brief({
    reconciliations: [withinCapReconciliationDto],
    exceptionReviews: [{ ...reconciliationReviewDto, targetId: withinCapReconciliationDto.id }],
  })), false);
  assert.equal(isCommitmentControlBriefDto(brief({
    reconciliations: [overCapReconciliationDto],
    exceptionReviews: [
      reconciliationReviewDto,
      { ...reconciliationReviewDto, id: "0b000000-0000-4000-8000-000000000003" },
    ],
  })), false);
  assert.equal(isCommitmentControlBriefDto(brief({ exceptionReviews: [reconciliationReviewDto] })), false);
  assert.equal(isCommitmentControlBriefDto(brief({
    outcomeObservations: [metObservationDto],
    exceptionReviews: [{ ...observationReviewDto, targetId: metObservationDto.id }],
  })), false);
  assert.equal(isCommitmentControlBriefDto(brief({
    reconciliations: [overCapReconciliationDto],
    exceptionReviews: [{ ...reconciliationReviewDto, note: "" }],
  })), false);
});

test("the brief guard refuses two observed outcomes for one proposal", () => {
  const reconciledOutcome = {
    ...withinCapReconciliationDto,
    outcome: {
      ...intendedOutcome,
      observedValue: "1250",
      observedOn: "2026-10-15",
      observationBasis: "USER_ENTERED_OBSERVATION",
      verdict: "MET",
    },
  };
  assert.equal(isCommitmentControlBriefDto(brief({ reconciliations: [reconciledOutcome] })), true);
  assert.equal(isCommitmentControlBriefDto(brief({
    reconciliations: [reconciledOutcome],
    outcomeObservations: [metObservationDto],
  })), false);
});

test("follow-through write guards bind the record to the frozen authorization", () => {
  assert.equal(isControlOutcomeObservationWriteDto({
    proposal: proposalDto,
    decision: decisionDto,
    observation: metObservationDto,
  }), true);
  assert.equal(isControlOutcomeObservationWriteDto({
    proposal: proposalDto,
    decision: { ...decisionDto, action: "DECLINE", approvedCapMinor: null, authorizationExpiresOn: null },
    observation: metObservationDto,
  }), false);
  assert.equal(isControlOutcomeObservationWriteDto({
    proposal: { ...proposalDto, intendedOutcome: null },
    decision: decisionDto,
    observation: metObservationDto,
  }), false);

  assert.equal(isControlExceptionReviewWriteDto({ review: reconciliationReviewDto }), true);
  assert.equal(isControlExceptionReviewWriteDto({ review: observationReviewDto }), true);
  assert.equal(isControlExceptionReviewWriteDto({ review: { ...reconciliationReviewDto, targetKind: "EVIDENCE" } }), false);
  assert.equal(isControlExceptionReviewWriteDto({ review: { ...reconciliationReviewDto, targetId: "not-a-uuid" } }), false);
});

test("publishes the two follow-through endpoints", () => {
  assert.deepEqual(commitmentControlEndpoints.outcome(proposalDto.id), {
    method: "POST",
    path: `/api/workspaces/current/control/proposals/${proposalDto.id}/outcome`,
  });
  assert.deepEqual(commitmentControlEndpoints.exceptionReviews(proposalDto.id), {
    method: "POST",
    path: `/api/workspaces/current/control/proposals/${proposalDto.id}/exception-reviews`,
  });
});
