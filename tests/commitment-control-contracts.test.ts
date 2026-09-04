import assert from "node:assert/strict";
import test from "node:test";
import {
  commitmentControlEndpoints,
  isCommitmentControlBriefDto,
  isControlDecisionWriteDto,
  isControlPolicyWriteDto,
  isControlProposalWriteDto,
  isControlReconciliationWriteDto,
  normalizeControlDecisionRequest,
  normalizeControlPolicyRequest,
  normalizeControlProposalRequest,
  normalizeControlReconciliationRequest,
} from "../src/lib/commitment-control/contracts";
import { completeControlPolicyRequest } from "./commitment-control-policy-fixture";

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
  intendedOutcome: {
    metric: "Resolved support cases",
    targetDirection: "AT_LEAST",
    targetValue: "1200",
    unit: "cases",
    reviewOn: "2026-10-15",
  },
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
  citedEvidenceIds: ["e1000000-0000-4000-8000-000000000001"],
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

const reconciliationDto = {
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
  outcome: {
    ...proposalDto.intendedOutcome,
    observedValue: "1250",
    observedOn: "2026-10-15",
    observationBasis: "USER_ENTERED_OBSERVATION",
    verdict: "MET",
  },
  reconciledByUserId: null,
  reconciledAt: "2026-09-01T09:00:00.000Z",
} as const;

test("normalizes the complete Commitment Control request boundary", () => {
  assert.deepEqual(normalizeControlPolicyRequest({
    ...completeControlPolicyRequest(),
    currencyLimits: [{
      currency: " inr ",
      maxPerChargeMinor: "500000",
      maxThirteenWeekMinor: "3000000",
      maxAnnualMinor: "12000000",
    }],
  }), completeControlPolicyRequest());

  assert.deepEqual(normalizeControlProposalRequest({
    merchant: "  OpenAI ",
    purpose: " Production model capacity ",
    category: "AI_MODEL",
    amountMinor: "199900",
    currency: "inr",
    firstChargeDate: "2026-09-01",
    cadence: "MONTHLY",
    existingCommitmentIds: ["A1000000-0000-4000-8000-000000000001"],
    intendedOutcome: {
      metric: " Resolved support cases ",
      targetDirection: "AT_LEAST",
      targetValue: "01200.5000",
      unit: " cases ",
      reviewOn: "2026-10-15",
    },
  }), {
    merchant: "OpenAI",
    purpose: "Production model capacity",
    category: "AI_MODEL",
    amountMinor: "199900",
    currency: "INR",
    firstChargeDate: "2026-09-01",
    cadence: "MONTHLY",
    existingCommitmentIds: ["a1000000-0000-4000-8000-000000000001"],
    intendedOutcome: {
      metric: "Resolved support cases",
      targetDirection: "AT_LEAST",
      targetValue: "1200.5",
      unit: "cases",
      reviewOn: "2026-10-15",
    },
  });

  assert.deepEqual(normalizeControlDecisionRequest({
    action: "APPROVE_WITH_CAP",
    approvedCapMinor: "180000",
    authorizationExpiresOn: "2026-09-30",
  }), {
    action: "APPROVE_WITH_CAP",
    approvedCapMinor: "180000",
    authorizationExpiresOn: "2026-09-30",
  });
  assert.deepEqual(normalizeControlReconciliationRequest({
    evidenceId: "E1000000-0000-4000-8000-000000000001",
    observedOutcome: { value: "001250.000", observedOn: "2026-10-15" },
  }), {
    evidenceId: "e1000000-0000-4000-8000-000000000001",
    observedOutcome: { value: "1250", observedOn: "2026-10-15" },
  });
});

test("fails closed on unknown or structurally invalid request data", () => {
  assert.throws(() => normalizeControlPolicyRequest({ categoryRules: [], currencyLimits: [], extra: true }), /unknown.*extra/i);
  assert.throws(() => normalizeControlPolicyRequest({
    categoryRules: [{ category: "AI_MODEL", posture: "AUTO_APPROVE" }],
    currencyLimits: [],
  }), /posture/i);
  assert.throws(() => normalizeControlPolicyRequest({
    categoryRules: [{ category: "AI_MODEL", posture: "ALLOW" }],
    currencyLimits: [{
      currency: "INR",
      maxPerChargeMinor: "500000",
      maxThirteenWeekMinor: "3000000",
      maxAnnualMinor: "12000000",
    }],
  }), /every category/i);
  assert.throws(() => normalizeControlProposalRequest({
    merchant: "OpenAI",
    purpose: "Production",
    category: "AI_MODEL",
    amountMinor: "1999.00",
    currency: "INR",
    firstChargeDate: "2026-02-30",
    cadence: "MONTHLY",
    existingCommitmentIds: [],
    intendedOutcome: {
      metric: "Resolved fixture tasks",
      targetDirection: "AT_LEAST",
      targetValue: "10",
      unit: "tasks",
      reviewOn: "2026-09-30",
    },
  }), /minor units|calendar date/i);
  assert.throws(() => normalizeControlProposalRequest({
    merchant: "OpenAI",
    purpose: "Production",
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
      reviewOn: "2026-08-31",
    },
  }), /review date.*first charge/i);
  assert.throws(() => normalizeControlProposalRequest({
    merchant: "OpenAI",
    purpose: "Production",
    category: "AI_MODEL",
    amountMinor: "9".repeat(100_000),
    currency: "INR",
    firstChargeDate: "2026-09-01",
    cadence: "MONTHLY",
    existingCommitmentIds: [],
    intendedOutcome: {
      metric: "Resolved fixture tasks",
      targetDirection: "AT_LEAST",
      targetValue: "10",
      unit: "tasks",
      reviewOn: "2026-09-30",
    },
  }), /minor units|PostgreSQL bigint/i);
  assert.throws(() => normalizeControlDecisionRequest({ action: "APPROVE", approvedCapMinor: "1" }), /does not accept a cap/i);
  assert.throws(() => normalizeControlDecisionRequest({ action: "DECLINE", approvedCapMinor: "1" }), /cannot carry a cap/i);
  assert.throws(() => normalizeControlDecisionRequest({ action: "APPROVE" }), /authorization expiry/i);
  assert.throws(() => normalizeControlDecisionRequest({ action: "DECLINE", authorizationExpiresOn: "2026-09-30" }), /cannot carry an authorization expiry/i);
  assert.throws(() => normalizeControlReconciliationRequest({ evidenceId: "foreign" }), /UUID/i);
  assert.throws(() => normalizeControlReconciliationRequest({
    evidenceId: "e1000000-0000-4000-8000-000000000001",
    observedOutcome: { value: "1.0000001", observedOn: "2026-10-15" },
  }), /outcome value/i);
});

test("publishes one canonical endpoint contract for the Control transport", () => {
  assert.deepEqual(commitmentControlEndpoints, {
    brief: { method: "GET", path: "/api/workspaces/current/control/brief" },
    policy: { method: "GET", path: "/api/workspaces/current/control/policy" },
    putPolicy: { method: "PUT", path: "/api/workspaces/current/control/policy" },
    proposals: { method: "POST", path: "/api/workspaces/current/control/proposals" },
    decision: commitmentControlEndpoints.decision,
    reconciliationCandidates: commitmentControlEndpoints.reconciliationCandidates,
    reconciliations: commitmentControlEndpoints.reconciliations,
    outcome: commitmentControlEndpoints.outcome,
    exceptionReviews: commitmentControlEndpoints.exceptionReviews,
  });
  assert.deepEqual(commitmentControlEndpoints.decision(proposalDto.id), {
    method: "POST",
    path: `/api/workspaces/current/control/proposals/${proposalDto.id}/decision`,
  });
  assert.deepEqual(commitmentControlEndpoints.reconciliations(proposalDto.id), {
    method: "POST",
    path: `/api/workspaces/current/control/proposals/${proposalDto.id}/reconciliations`,
  });
  assert.deepEqual(commitmentControlEndpoints.reconciliationCandidates(proposalDto.id), {
    method: "GET",
    path: `/api/workspaces/current/control/proposals/${proposalDto.id}/reconciliation-candidates`,
  });
});

test("runtime guards accept exact Control DTOs and reject malformed financial facts", () => {
  const policy = {
    policyVersion: 1,
    ...completeControlPolicyRequest(),
    createdByUserId: null,
    createdAt: "2026-08-25T08:00:00.000Z",
  } as const;
  const brief = {
    policy,
    proposals: [{
      proposal: proposalDto,
      evaluation: evaluationDto,
      decision: decisionDto,
      reconciliations: [reconciliationDto],
      outcomeObservations: [],
      exceptionReviews: [],
    }],
    capabilities: { canSubmitProposal: true, canDecide: true, canConfigurePolicy: true },
  };

  assert.equal(isCommitmentControlBriefDto(brief), true);
  assert.equal(isControlPolicyWriteDto({ policy }), true);
  assert.equal(isControlProposalWriteDto({ proposal: proposalDto, evaluation: evaluationDto }), true);
  assert.equal(isControlDecisionWriteDto({ decision: decisionDto }), true);
  assert.equal(isControlReconciliationWriteDto({ proposal: proposalDto, decision: decisionDto, reconciliation: reconciliationDto }), true);

  assert.equal(isCommitmentControlBriefDto({ ...brief, proposals: [{ ...brief.proposals[0], proposal: { ...proposalDto, amountMinor: 199900 } }] }), false);
  assert.equal(isCommitmentControlBriefDto({ ...brief, proposals: [{ ...brief.proposals[0], evaluation: { ...evaluationDto, humanDecisionRequired: false } }] }), false);
  assert.equal(isControlProposalWriteDto({
    proposal: proposalDto,
    evaluation: {
      ...evaluationDto,
      currencyResults: [{ ...evaluationDto.currencyResults[0], proposedAnnualMinor: "1" }],
    },
  }), false);
  assert.equal(isCommitmentControlBriefDto({
    ...brief,
    proposals: [{ ...brief.proposals[0], decision: { ...decisionDto, currency: "USD" } }],
  }), false);
  assert.equal(isControlDecisionWriteDto({ decision: { ...decisionDto, approvedCapMinor: "200000" } }), false);
  assert.equal(isControlReconciliationWriteDto({ proposal: proposalDto, decision: decisionDto, reconciliation: { ...reconciliationDto, verdict: "SAVED" } }), false);
  assert.equal(isControlProposalWriteDto({
    proposal: { ...proposalDto, intendedOutcome: { ...proposalDto.intendedOutcome, targetValue: "1.0000000" } },
    evaluation: evaluationDto,
  }), false);
  assert.equal(isControlDecisionWriteDto({ decision: { ...decisionDto, authorizationExpiresOn: "not-a-date" } }), false);
  assert.equal(isControlReconciliationWriteDto({
    proposal: proposalDto,
    decision: decisionDto,
    reconciliation: { ...reconciliationDto, outcome: { ...reconciliationDto.outcome, verdict: "PROBABLY_MET" } },
  }), false);
  assert.equal(isControlReconciliationWriteDto({
    proposal: proposalDto,
    decision: decisionDto,
    reconciliation: {
      ...reconciliationDto,
      verdict: "AUTHORIZATION_EXPIRED",
      observedEvidenceDate: "2026-10-01",
    },
  }), true);
  assert.equal(isControlReconciliationWriteDto({
    proposal: proposalDto,
    decision: decisionDto,
    reconciliation: {
      ...reconciliationDto,
      verdict: "AUTHORIZATION_EXPIRED",
      observedEvidenceDate: "2026-09-30",
    },
  }), false);
});