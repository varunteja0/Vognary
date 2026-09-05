import assert from "node:assert/strict";
import test from "node:test";
import { authorizeProposalDecision } from "../src/lib/commitment-control/decision";
import { evaluateProposalPolicy } from "../src/lib/commitment-control/policy";
import { projectProposalExposure } from "../src/lib/commitment-control/project";
import { reconcileAuthorizedProposal } from "../src/lib/commitment-control/reconcile";

const proposal = {
  proposalId: "a1000000-0000-4000-8000-000000000001",
  amountMinor: "250000",
  currency: "INR",
  category: "AI_MODEL" as const,
  thirteenWeekMinor: "750000",
  annualMinor: "3000000",
};

const intendedOutcome = {
  metric: "Resolved support cases",
  targetDirection: "AT_LEAST" as const,
  targetValue: "1200",
  unit: "cases",
  reviewOn: "2026-10-15",
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
  assert.equal(evaluation.citedExposureBasis, "PROJECTED");
  assert.equal("decision" in evaluation, false);
});

test("policy accepts zero exposure outside the 13-week and annual projection windows", () => {
  for (const [firstChargeDate, thirteenWeekMinor, annualMinor] of [
    ["2026-12-04", "250000", "250000"],
    ["2026-12-05", "0", "250000"],
    ["2026-12-20", "0", "250000"],
    ["2027-09-05", "0", "0"],
  ]) {
    const projection = projectProposalExposure([{ ...proposal, firstChargeDate, cadence: "ONE_TIME" }], { asOfDate: "2026-09-05" });
    const projected = projection.proposals[0];
    assert.equal(projected.thirteenWeekMinor, thirteenWeekMinor);
    assert.equal(projected.annualMinor, annualMinor);
    const evaluation = evaluateProposalPolicy({ proposal: { ...proposal, ...projected }, policy, existingExposure: [] });
    assert.equal(evaluation.status, "WITHIN_POLICY");
    assert.equal(evaluation.humanDecisionRequired, true);
    assert.equal(evaluation.currencyResults[0].combinedThirteenWeekMinor, thirteenWeekMinor);
    assert.equal(evaluation.currencyResults[0].combinedAnnualMinor, annualMinor);
    assert.equal(evaluation.currencyResults[0].thirteenWeekHeadroomMinor, (BigInt(3000000) - BigInt(thirteenWeekMinor)).toString());
    assert.equal(evaluation.currencyResults[0].annualHeadroomMinor, (BigInt(12000000) - BigInt(annualMinor)).toString());
  }
});

test("zero projected exposure retains per-charge and currency policy checks", () => {
  const outside = evaluateProposalPolicy({
    proposal: { ...proposal, amountMinor: "600000", thirteenWeekMinor: "0", annualMinor: "0" },
    policy,
    existingExposure: [],
  });
  assert.equal(outside.status, "OUTSIDE_POLICY");
  assert.deepEqual(outside.reasonCodes, ["PER_CHARGE_LIMIT_EXCEEDED"]);
  assert.equal(outside.humanDecisionRequired, true);
  const missingCurrency = evaluateProposalPolicy({
    proposal: { ...proposal, currency: "USD", thirteenWeekMinor: "0", annualMinor: "0" },
    policy,
    existingExposure: [],
  });
  assert.equal(missingCurrency.status, "REVIEW_REQUIRED");
  assert.deepEqual(missingCurrency.reasonCodes, ["CURRENCY_POLICY_MISSING"]);
});

test("zero projected exposure does not admit nonpositive charge amounts or invalid totals", () => {
  const emptyProjection = { ...proposal, thirteenWeekMinor: "0", annualMinor: "0" };
  for (const amountMinor of ["0", "-1", "1.5", "9223372036854775808"]) {
    assert.throws(() => evaluateProposalPolicy({ proposal: { ...emptyProjection, amountMinor }, policy, existingExposure: [] }));
  }
  for (const field of ["thirteenWeekMinor", "annualMinor"]) {
    for (const invalid of ["-1", "1.5", "9223372036854775808"]) {
      assert.throws(() => evaluateProposalPolicy({ proposal: { ...emptyProjection, [field]: invalid }, policy, existingExposure: [] }));
    }
  }
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
    authorizationExpiresOn: "2026-09-30",
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
    authorizationExpiresOn: "2026-09-30",
    overrideReason: null,
  });

  assert.throws(
    () => authorizeProposalDecision({
      actorRole: "owner",
      actorUserId: "b1000000-0000-4000-8000-000000000001",
      evaluation,
      action: "APPROVE",
      decidedAt: "2026-08-25T10:00:00.000Z",
    }),
    /authorization expiry/i,
  );
  assert.throws(
    () => authorizeProposalDecision({
      actorRole: "owner",
      actorUserId: "b1000000-0000-4000-8000-000000000001",
      evaluation,
      action: "APPROVE",
      authorizationExpiresOn: "2026-08-24",
      decidedAt: "2026-08-25T10:00:00.000Z",
    }),
    /before the decision/i,
  );
  assert.throws(
    () => authorizeProposalDecision({
      actorRole: "owner",
      actorUserId: "b1000000-0000-4000-8000-000000000001",
      evaluation,
      action: "APPROVE",
      authorizationExpiresOn: "2026-10-16",
      outcomeReviewOn: "2026-10-15",
      decidedAt: "2026-08-25T10:00:00.000Z",
    }),
    /after the outcome review date/i,
  );

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
    authorizationExpiresOn: "2026-09-30",
    decidedAt: "2026-08-25T10:00:00.000Z",
  });
  const frozen = structuredClone(approved);
  const evidenceId = "e1000000-0000-4000-8000-000000000001";

  assert.equal(reconcileAuthorizedProposal({ decision: approved, evidence: { evidenceId, amountMinor: "250000", currency: "INR", evidenceDate: "2026-09-01" } }).verdict, "MATCHED");
  assert.equal(reconcileAuthorizedProposal({ decision: approved, evidence: { evidenceId, amountMinor: "200000", currency: "INR", evidenceDate: "2026-09-01" } }).verdict, "WITHIN_CAP");
  assert.equal(reconcileAuthorizedProposal({ decision: approved, evidence: { evidenceId, amountMinor: "250001", currency: "INR", evidenceDate: "2026-09-01" } }).verdict, "OVER_CAP");
  assert.equal(reconcileAuthorizedProposal({ decision: approved, evidence: { evidenceId, amountMinor: "250000", currency: "USD", evidenceDate: "2026-09-01" } }).verdict, "CURRENCY_MISMATCH");
  assert.equal(reconcileAuthorizedProposal({ decision: approved, evidence: { evidenceId, amountMinor: null, currency: null, evidenceDate: "2026-09-01" } }).verdict, "CANNOT_EVALUATE");
  assert.deepEqual(approved, frozen, "reconciliation cannot rewrite the frozen authorization");
});

test("reconciles the intended measurable outcome without inferring it from spend", () => {
  const evaluation = evaluateProposalPolicy({ proposal, policy, existingExposure: [] });
  const decision = authorizeProposalDecision({
    actorRole: "owner",
    actorUserId: "b1000000-0000-4000-8000-000000000001",
    evaluation,
    action: "APPROVE",
    authorizationExpiresOn: "2026-09-30",
    decidedAt: "2026-08-25T10:00:00.000Z",
  });
  const evidence = {
    evidenceId: "e1000000-0000-4000-8000-000000000001",
    amountMinor: "250000",
    currency: "INR",
    evidenceDate: "2026-09-15",
  };

  const met = reconcileAuthorizedProposal({
    decision,
    evidence,
    intendedOutcome,
    observedOutcome: { value: "1250", observedOn: "2026-10-15" },
    observedThrough: "2026-10-15",
  });
  assert.deepEqual(met.outcome, {
    ...intendedOutcome,
    observedValue: "1250",
    observedOn: "2026-10-15",
    observationBasis: "USER_ENTERED_OBSERVATION",
    verdict: "MET",
  });

  const missed = reconcileAuthorizedProposal({
    decision,
    evidence,
    intendedOutcome: { ...intendedOutcome, targetDirection: "AT_MOST", targetValue: "1000" },
    observedOutcome: { value: "1000.01", observedOn: "2026-10-15" },
    observedThrough: "2026-10-15",
  });
  assert.equal(missed.outcome?.verdict, "MISSED");

  const notObserved = reconcileAuthorizedProposal({ decision, evidence, intendedOutcome });
  assert.deepEqual(notObserved.outcome, {
    ...intendedOutcome,
    observedValue: null,
    observedOn: null,
    observationBasis: "NOT_OBSERVED",
    verdict: "NOT_OBSERVED",
  });

  assert.throws(() => reconcileAuthorizedProposal({
    decision,
    evidence,
    intendedOutcome,
    observedOutcome: { value: "1250", observedOn: "2026-10-16" },
    observedThrough: "2026-10-15",
  }), /future/i);
});

test("evidence after the authorization window is never treated as authorized spend", () => {
  const evaluation = evaluateProposalPolicy({ proposal, policy, existingExposure: [] });
  const decision = authorizeProposalDecision({
    actorRole: "owner",
    actorUserId: "b1000000-0000-4000-8000-000000000001",
    evaluation,
    action: "APPROVE",
    authorizationExpiresOn: "2026-09-30",
    decidedAt: "2026-08-25T10:00:00.000Z",
  });

  const expired = reconcileAuthorizedProposal({
    decision,
    evidence: {
      evidenceId: "e1000000-0000-4000-8000-000000000001",
      amountMinor: "250000",
      currency: "INR",
      evidenceDate: "2026-10-01",
    },
  });
  assert.equal(expired.verdict, "AUTHORIZATION_EXPIRED");
  assert.equal(expired.observedEvidenceDate, "2026-10-01");
});

test("evidence before the decision cannot retroactively satisfy an authorization", () => {
  const evaluation = evaluateProposalPolicy({ proposal, policy, existingExposure: [] });
  const decision = authorizeProposalDecision({
    actorRole: "owner",
    actorUserId: "b1000000-0000-4000-8000-000000000001",
    evaluation,
    action: "APPROVE",
    authorizationExpiresOn: "2026-09-30",
    decidedAt: "2026-08-25T10:00:00.000Z",
  });
  const evidence = {
    evidenceId: "e1000000-0000-4000-8000-000000000001",
    amountMinor: "250000",
    currency: "INR",
    evidenceDate: "2026-08-24",
  };
  const frozen = structuredClone(decision);

  for (const authorizationExpiresOn of [decision.authorizationExpiresOn, null]) {
    assert.throws(() => reconcileAuthorizedProposal({
      decision: { ...decision, authorizationExpiresOn },
      evidence,
    }), /evidence cannot predate the authorization decision/i);
  }
  assert.equal(reconcileAuthorizedProposal({
    decision,
    evidence: { ...evidence, evidenceDate: "2026-08-25" },
  }).verdict, "MATCHED");
  assert.deepEqual(decision, frozen);
});

test("future-dated financial evidence cannot be treated as an observed charge", () => {
  const decision = authorizeProposalDecision({
    actorRole: "owner",
    actorUserId: "b1000000-0000-4000-8000-000000000001",
    evaluation: evaluateProposalPolicy({ proposal, policy, existingExposure: [] }),
    action: "APPROVE",
    authorizationExpiresOn: "2026-09-30",
    decidedAt: "2026-08-25T10:00:00.000Z",
  });
  const evidence = {
    evidenceId: "e1000000-0000-4000-8000-000000000001",
    amountMinor: "250000",
    currency: "INR",
    evidenceDate: "2026-09-15",
  };
  assert.throws(() => reconcileAuthorizedProposal({
    decision,
    evidence,
    observedThrough: "2026-09-05",
  }), /financial evidence cannot be in the future/i);
  assert.equal(reconcileAuthorizedProposal({
    decision,
    evidence,
    observedThrough: "2026-09-15",
  }).verdict, "MATCHED");
});

test("uncited eligible exposure cannot be within policy and outside-policy approve needs a written override", () => {
  const uncited = evaluateProposalPolicy({
    proposal,
    policy,
    existingExposure: [],
    eligibleUncited: true,
  });
  assert.equal(uncited.status, "REVIEW_REQUIRED");
  assert.ok(uncited.reasonCodes.includes("EXPOSURE_NOT_CITED"));
  assert.equal(uncited.citedExposureBasis, "NONE");

  const outside = evaluateProposalPolicy({
    proposal: { ...proposal, amountMinor: "600000", annualMinor: "13000000" },
    policy,
    existingExposure: [],
  });
  assert.throws(
    () => authorizeProposalDecision({
      actorRole: "owner",
      actorUserId: "b1000000-0000-4000-8000-000000000001",
      evaluation: outside,
      action: "APPROVE",
    }),
    /override reason/i,
  );
  const overridden = authorizeProposalDecision({
    actorRole: "owner",
    actorUserId: "b1000000-0000-4000-8000-000000000001",
    evaluation: outside,
    action: "APPROVE",
    authorizationExpiresOn: "2026-09-30",
    overrideReason: "Board-approved exception for this vendor.",
  });
  assert.equal(overridden.overrideReason, "Board-approved exception for this vendor.");
});

test("a second owner or admin must decide when the workspace is not a solo desk", () => {
  const evaluation = evaluateProposalPolicy({ proposal, policy, existingExposure: [] });
  assert.throws(
    () => authorizeProposalDecision({
      actorRole: "owner",
      actorUserId: "b1000000-0000-4000-8000-000000000001",
      submittedByUserId: "b1000000-0000-4000-8000-000000000001",
      authorizingAdminCount: 2,
      evaluation,
      action: "APPROVE",
    }),
    /second owner or admin/i,
  );
  const approved = authorizeProposalDecision({
    actorRole: "owner",
    actorUserId: "b1000000-0000-4000-8000-000000000002",
    submittedByUserId: "b1000000-0000-4000-8000-000000000001",
    authorizingAdminCount: 2,
    evaluation,
    action: "APPROVE",
    authorizationExpiresOn: "2026-09-30",
  });
  assert.equal(approved.decidedByUserId, "b1000000-0000-4000-8000-000000000002");
});
