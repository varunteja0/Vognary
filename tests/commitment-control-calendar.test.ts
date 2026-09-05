import assert from "node:assert/strict";
import test from "node:test";
import type { ControlDecisionDto } from "../src/lib/commitment-control/contracts";
import { authorizeProposalDecision } from "../src/lib/commitment-control/decision";
import { evaluateProposalPolicy } from "../src/lib/commitment-control/policy";
import { reconcileAuthorizedProposal } from "../src/lib/commitment-control/reconcile";
import { selectControlReconciliationCandidates } from "../src/lib/commitment-control/reconciliation-candidates";

const decision: ControlDecisionDto = {
  id: "d1000000-0000-4000-8000-000000000001",
  evaluationId: "e1000000-0000-4000-8000-000000000001",
  proposalId: "a1000000-0000-4000-8000-000000000001",
  evaluationPolicyVersion: 1,
  action: "APPROVE",
  approvedCapMinor: "10000",
  expectedAmountMinor: "10000",
  currency: "INR",
  decidedByUserId: "b1000000-0000-4000-8000-000000000001",
  decidedByDisplayName: "Synthetic calendar owner",
  decidedAt: "2026-09-05T18:30:00.000Z",
  authorizationExpiresOn: "2026-09-06",
  overrideReason: null,
};

test("authorization expiry uses the India calendar at midnight, not the preceding UTC date", () => {
  const evaluation = evaluateProposalPolicy({
    proposal: { proposalId: decision.proposalId, amountMinor: "10000", currency: "INR", category: "AI_MODEL", thirteenWeekMinor: "10000", annualMinor: "10000" },
    policy: { policyVersion: 1, categoryRules: [{ category: "AI_MODEL", posture: "ALLOW" }], currencyLimits: [{ currency: "INR", maxPerChargeMinor: "10000", maxThirteenWeekMinor: "10000", maxAnnualMinor: "10000" }] },
    existingExposure: [],
  });
  const input = { actorRole: "owner" as const, actorUserId: decision.decidedByUserId!, action: "APPROVE" as const, evaluation, authorizationExpiresOn: "2026-09-05" };
  assert.equal(authorizeProposalDecision({ ...input, decidedAt: "2026-09-05T18:29:59.999Z" }).authorizationExpiresOn, "2026-09-05");
  assert.throws(() => authorizeProposalDecision({ ...input, decidedAt: decision.decidedAt }), /expiry cannot be before the decision/i);
});

test("reconciliation cannot use the previous India day even when it shares the UTC decision date", () => {
  const evidence = { evidenceId: "f1000000-0000-4000-8000-000000000001", amountMinor: "10000", currency: "INR", evidenceDate: "2026-09-05" };
  assert.throws(() => reconcileAuthorizedProposal({ decision, evidence, observedThrough: "2026-09-06" }), /cannot predate the authorization decision/i);
  assert.equal(reconcileAuthorizedProposal({ decision, evidence: { ...evidence, evidenceDate: "2026-09-06" }, observedThrough: "2026-09-06" }).verdict, "MATCHED");
});

test("receipt candidates use the same India decision-date boundary as reconciliation", () => {
  const evidence = { evidenceId: "f1000000-0000-4000-8000-000000000001", commitmentId: "c1000000-0000-4000-8000-000000000001", commitmentMerchant: "Synthetic calendar vendor", amountMinor: "10000", currency: "INR", evidenceDate: "2026-09-05", alreadyReconciled: false };
  assert.deepEqual(selectControlReconciliationCandidates({ decision, evidence: [evidence] }), []);
  assert.equal(selectControlReconciliationCandidates({ decision, evidence: [{ ...evidence, evidenceDate: "2026-09-06" }] }).length, 1);
});
