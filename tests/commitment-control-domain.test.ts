import assert from "node:assert/strict";
import test from "node:test";
import { authorizeProposalDecision } from "../src/lib/commitment-control/decision";
import { evaluateProposalPolicy } from "../src/lib/commitment-control/policy";
import { reconcileAuthorizedProposal } from "../src/lib/commitment-control/reconcile";

const proposal = {
  proposalId: "a1000000-0000-4000-8000-000000000001",
  amountMinor: "250000",
  currency: "INR",
  category: "AI_MODEL" as const,
  thirteenWeekMinor: "750000",
  annualMinor: "3000000",
};

const policy = {
  policyVersion: 3,
  categoryRules: [
    { category: "AI_MODEL" as const, posture: "ALLOW" as const },
    { category: "CAMPAIGN" as const, posture: "REVIEW" as const },
  ],
  currencyLimits: [{
    currency: "INR",
    maxPerChargeMinor: "500000",
    maxThirteenWeekMinor: "3000000",
    maxAnnualMinor: "12000000",
  }],
};

test("evaluates cited exposure and proposal assumptions without making a decision", () => {
  const evaluation = evaluateProposalPolicy({
    proposal,
    policy,
    existingExposure: [{
      currency: "INR",
      thirteenWeekMinor: "1000000",
      annualMinor: "4000000",
      evidenceIds: ["e1000000-0000-4000-8000-000000000001"],
    }],
  });

  assert.equal(evaluation.status, "WITHIN_POLICY");
  assert.equal(evaluation.humanDecisionRequired, true);
  assert.equal(evaluation.policyVersion, 3);
  assert.deepEqual(evaluation.assumptionFields, [
    "amountMinor",
    "currency",
    "category",
    "thirteenWeekMinor",
    "annualMinor",
  ]);
  assert.deepEqual(evaluation.citedEvidenceIds, ["e1000000-0000-4000-8000-000000000001"]);
  assert.deepEqual(evaluation.currencyResults, [{
    currency: "INR",
    existingThirteenWeekMinor: "1000000",
    proposedThirteenWeekMinor: "750000",
    combinedThirteenWeekMinor: "1750000",
    thirteenWeekHeadroomMinor: "1250000",
    existingAnnualMinor: "4000000",
    proposedAnnualMinor: "3000000",
    combinedAnnualMinor: "7000000",
    annualHeadroomMinor: "5000000",
  }]);
  assert.deepEqual(evaluation.reasonCodes, []);
  assert.equal("decision" in evaluation, false);
});

test("returns review or outside-policy states deterministically and fails closed on uncited exposure", () => {
  const review = evaluateProposalPolicy({
    proposal: { ...proposal, category: "CAMPAIGN" },
    policy,
    existingExposure: [],
  });
  assert.equal(review.status, "REVIEW_REQUIRED");
  assert.deepEqual(review.reasonCodes, ["CATEGORY_REQUIRES_REVIEW"]);

  const outside = evaluateProposalPolicy({
    proposal: { ...proposal, amountMinor: "600000", annualMinor: "13000000" },
    policy,
    existingExposure: [],
  });
  assert.equal(outside.status, "OUTSIDE_POLICY");
  assert.deepEqual(outside.reasonCodes, ["PER_CHARGE_LIMIT_EXCEEDED", "ANNUAL_LIMIT_EXCEEDED"]);

  const unconfigured = evaluateProposalPolicy({
    proposal: { ...proposal, currency: "USD" },
    policy,
    existingExposure: [],
  });
  assert.equal(unconfigured.status, "REVIEW_REQUIRED");
  assert.deepEqual(unconfigured.reasonCodes, ["CURRENCY_POLICY_MISSING"]);

  assert.throws(
    () => evaluateProposalPolicy({
      proposal,
      policy,
      existingExposure: [{
        currency: "INR",
        thirteenWeekMinor: "1",
        annualMinor: "1",
        evidenceIds: [],
      }],
    }),
    /must cite persisted evidence/i,
  );
});

test("keeps selected existing exposure visible and policy-checked in every currency", () => {
  const evaluation = evaluateProposalPolicy({
    proposal,
    policy: {
      ...policy,
      currencyLimits: [
        ...policy.currencyLimits,
        {
          currency: "USD",
          maxPerChargeMinor: "100000",
          maxThirteenWeekMinor: "500000",
          maxAnnualMinor: "2000000",
        },
      ],
    },
    existingExposure: [
      {
        currency: "USD",
        thirteenWeekMinor: "125000",
        annualMinor: "500000",
        evidenceIds: ["e1000000-0000-4000-8000-000000000002"],
      },
      {
        currency: "INR",
        thirteenWeekMinor: "1000000",
        annualMinor: "4000000",
        evidenceIds: ["e1000000-0000-4000-8000-000000000001"],
      },
    ],
  });

  assert.equal(evaluation.status, "WITHIN_POLICY");
  assert.deepEqual(evaluation.currencyResults, [
    {
      currency: "INR",
      existingThirteenWeekMinor: "1000000",
      proposedThirteenWeekMinor: "750000",
      combinedThirteenWeekMinor: "1750000",
      thirteenWeekHeadroomMinor: "1250000",
      existingAnnualMinor: "4000000",
      proposedAnnualMinor: "3000000",
      combinedAnnualMinor: "7000000",
      annualHeadroomMinor: "5000000",
    },
    {
      currency: "USD",
      existingThirteenWeekMinor: "125000",
      proposedThirteenWeekMinor: "0",
      combinedThirteenWeekMinor: "125000",
      thirteenWeekHeadroomMinor: "375000",
      existingAnnualMinor: "500000",
      proposedAnnualMinor: "0",
      combinedAnnualMinor: "500000",
      annualHeadroomMinor: "1500000",
    },
  ]);
});

test("only owners and admins can append a human decision and the approved cap is frozen", () => {
  const evaluation = evaluateProposalPolicy({ proposal, policy, existingExposure: [] });

  assert.throws(
    () => authorizeProposalDecision({
      actorRole: "member",
      actorUserId: "b1000000-0000-4000-8000-000000000001",
      evaluation,
      action: "APPROVE",
      decidedAt: "2026-08-25T10:00:00.000Z",
    }),
    /owner or admin/i,
  );

  const approved = authorizeProposalDecision({
    actorRole: "admin",
    actorUserId: "b1000000-0000-4000-8000-000000000001",
    evaluation,
    action: "APPROVE_WITH_CAP",
    approvedCapMinor: "200000",
    decidedAt: "2026-08-25T10:00:00.000Z",
  });
  assert.deepEqual(approved, {
    proposalId: proposal.proposalId,
    evaluationPolicyVersion: 3,
    action: "APPROVE_WITH_CAP",
    approvedCapMinor: "200000",
    currency: "INR",
    expectedAmountMinor: "250000",
    decidedByUserId: "b1000000-0000-4000-8000-000000000001",
    decidedAt: "2026-08-25T10:00:00.000Z",
  });

  assert.throws(
    () => authorizeProposalDecision({
      actorRole: "owner",
      actorUserId: "b1000000-0000-4000-8000-000000000001",
      evaluation,
      action: "APPROVE_WITH_CAP",
      approvedCapMinor: "250001",
      decidedAt: "2026-08-25T10:00:00.000Z",
    }),
    /cannot exceed the proposed per-charge amount/i,
  );
});

test("reconciles cited observed evidence against the frozen authorization without mutation", () => {
  const evaluation = evaluateProposalPolicy({ proposal, policy, existingExposure: [] });
  const approved = authorizeProposalDecision({
    actorRole: "owner",
    actorUserId: "b1000000-0000-4000-8000-000000000001",
    evaluation,
    action: "APPROVE",
    decidedAt: "2026-08-25T10:00:00.000Z",
  });
  const frozen = structuredClone(approved);
  const evidenceId = "e1000000-0000-4000-8000-000000000001";

  assert.equal(reconcileAuthorizedProposal({ decision: approved, evidence: { evidenceId, amountMinor: "250000", currency: "INR" } }).verdict, "MATCHED");
  assert.equal(reconcileAuthorizedProposal({ decision: approved, evidence: { evidenceId, amountMinor: "200000", currency: "INR" } }).verdict, "WITHIN_CAP");
  assert.equal(reconcileAuthorizedProposal({ decision: approved, evidence: { evidenceId, amountMinor: "250001", currency: "INR" } }).verdict, "OVER_CAP");
  assert.equal(reconcileAuthorizedProposal({ decision: approved, evidence: { evidenceId, amountMinor: "250000", currency: "USD" } }).verdict, "CURRENCY_MISMATCH");
  assert.equal(reconcileAuthorizedProposal({ decision: approved, evidence: { evidenceId, amountMinor: null, currency: null } }).verdict, "CANNOT_EVALUATE");
  assert.deepEqual(approved, frozen, "reconciliation cannot rewrite the frozen authorization");
});