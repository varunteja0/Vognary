import assert from "node:assert/strict";
import test from "node:test";

import { selectControlReconciliationCandidates } from "../src/lib/commitment-control/reconciliation-candidates";
import type { ControlDecisionDto } from "../src/lib/commitment-control/contracts";

const decision: ControlDecisionDto = {
  id: "d1000000-0000-4000-8000-000000000001",
  evaluationId: "e1000000-0000-4000-8000-000000000001",
  proposalId: "a1000000-0000-4000-8000-000000000001",
  evaluationPolicyVersion: 1,
  action: "APPROVE_WITH_CAP",
  approvedCapMinor: "200000",
  currency: "INR",
  expectedAmountMinor: "250000",
  decidedByUserId: "b1000000-0000-4000-8000-000000000001",
  decidedByDisplayName: "Synthetic owner",
  overrideReason: null,
  decidedAt: "2026-09-01T10:00:00.000Z",
  authorizationExpiresOn: "2026-09-30",
};

test("offers only unreconciled same-currency evidence inside the frozen authorization window", () => {
  const candidates = selectControlReconciliationCandidates({
    decision,
    evidence: [
      evidence("01", { evidenceDate: "2026-09-05", currency: "INR", amountMinor: "199900" }),
      evidence("02", { evidenceDate: "2026-09-04", currency: "USD", amountMinor: "1999" }),
      evidence("03", { evidenceDate: "2026-08-31", currency: "INR", amountMinor: "199900" }),
      evidence("04", { evidenceDate: "2026-10-01", currency: "INR", amountMinor: "199900" }),
      evidence("05", { evidenceDate: "2026-09-06", currency: "INR", amountMinor: null }),
      evidence("06", { evidenceDate: "2026-09-07", currency: "INR", amountMinor: "199900", alreadyReconciled: true }),
    ],
  });

  assert.deepEqual(candidates, [{
    evidenceId: "f1000000-0000-4000-8000-000000000001",
    commitmentId: "c1000000-0000-4000-8000-000000000001",
    commitmentMerchant: "Unrelated synthetic vendor",
    observedAmountMinor: "199900",
    observedCurrency: "INR",
    observedEvidenceDate: "2026-09-05",
    basis: "SAME_CURRENCY_WITHIN_AUTHORIZATION_WINDOW",
    requiresHumanConfirmation: true,
  }]);
});

test("declined and legacy unbounded decisions never produce candidates", () => {
  const observed = [evidence("01", { evidenceDate: "2026-09-05", currency: "INR", amountMinor: "199900" })];
  assert.deepEqual(selectControlReconciliationCandidates({
    decision: { ...decision, action: "DECLINE", approvedCapMinor: null, authorizationExpiresOn: null },
    evidence: observed,
  }), []);
  assert.deepEqual(selectControlReconciliationCandidates({
    decision: { ...decision, authorizationExpiresOn: null },
    evidence: observed,
  }), []);
});

function evidence(
  suffix: string,
  patch: Partial<{
    evidenceDate: string | null;
    currency: string | null;
    amountMinor: string | null;
    alreadyReconciled: boolean;
  }>,
) {
  return {
    evidenceId: `f1000000-0000-4000-8000-0000000000${suffix}`,
    commitmentId: `c1000000-0000-4000-8000-0000000000${suffix}`,
    commitmentMerchant: "Unrelated synthetic vendor",
    evidenceDate: null,
    currency: null,
    amountMinor: null,
    alreadyReconciled: false,
    ...patch,
  };
}