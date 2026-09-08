import assert from "node:assert/strict";
import test from "node:test";
import { compareAuthorizedProviderBill } from "../src/lib/commitment-control/billed-comparison";
import type { AuthorizedProposalDecision } from "../src/lib/commitment-control/decision";

const decision: AuthorizedProposalDecision = {
  proposalId: "a2000000-0000-4000-8000-000000000001",
  evaluationPolicyVersion: 1,
  action: "APPROVE",
  approvedCapMinor: "9007199254740993",
  expectedAmountMinor: "9007199254740993",
  amountBasis: "GROSS_BILLED_TOTAL_PER_CHARGE",
  currency: "INR",
  decidedByUserId: "b2000000-0000-4000-8000-000000000001",
  decidedAt: "2026-09-01T18:30:00.000Z",
  authorizationExpiresOn: "2026-09-06",
  overrideReason: null,
};
const evidence = {
  evidenceId: "e2000000-0000-4000-8000-000000000001",
  evidenceBasis: "PROVIDER_BILL_TOTAL" as const,
  totalMinor: "9007199254740993",
  currency: "INR",
  billDate: "2026-09-03",
  sourceObservedAt: "2026-09-03T08:18:00.000Z",
  status: "open",
  changeKind: "BASELINE",
};
const input = { decision, evidence, wholeCharge: "USER_CONFIRMED_SAME_CHARGE" as const, comparedOn: "2026-09-07" };

test("provider bills compare exact gross per-charge money without implying observed payment or outcome", () => {
  const result = compareAuthorizedProviderBill(input);
  assert.equal(result.comparisonKind, "BILLED_AMOUNT_COMPARISON");
  assert.equal(result.decisionAmountBasis, "GROSS_BILLED_TOTAL_PER_CHARGE");
  assert.equal(result.observedEvidenceBasis, "PROVIDER_BILL_TOTAL");
  assert.equal(result.verdict, "MATCHED");
  assert.equal(result.observedAmountMinor, "9007199254740993");
  assert.equal(result.observedEvidenceDate, "2026-09-03");
  assert.equal(result.outcome, null);
  assert.deepEqual(input, { decision, evidence, wholeCharge: "USER_CONFIRMED_SAME_CHARGE", comparedOn: "2026-09-07" });
  assert.equal(compareAuthorizedProviderBill({ ...input, evidence: { ...evidence, totalMinor: "9007199254740992" } }).verdict, "WITHIN_CAP");
  assert.equal(compareAuthorizedProviderBill({ ...input, evidence: { ...evidence, totalMinor: "9007199254740994" } }).verdict, "OVER_CAP");
});

test("a paid provider status remains a billed comparison and supported partial states never net the total", () => {
  for (const status of ["open", "approved", "overdue", "partially_paid", "paid"]) {
    const result = compareAuthorizedProviderBill({ ...input, evidence: { ...evidence, status } });
    assert.equal(result.verdict, "MATCHED", status);
    assert.equal(result.outcome, null);
    assert.equal(result.observedAmountMinor, evidence.totalMinor);
  }
});

test("provider comparison requires the explicit gross decision, bill basis and whole-charge confirmation", () => {
  for (const amountBasis of [undefined, null, "NET_TOTAL", "PROVIDER_BILL_TOTAL"]) {
    assert.throws(() => compareAuthorizedProviderBill({ ...input, decision: { ...decision, amountBasis } } as never), /basis/i);
  }
  for (const evidenceBasis of [undefined, "NET_TOTAL", "OBSERVED_PAYMENT"]) {
    assert.throws(() => compareAuthorizedProviderBill({ ...input, evidence: { ...evidence, evidenceBasis } } as never), /basis/i);
  }
  for (const wholeCharge of [undefined, false, "SPLIT", ["USER_CONFIRMED_SAME_CHARGE"]]) {
    assert.throws(() => compareAuthorizedProviderBill({ ...input, wholeCharge } as never), /whole.*charge|association/i);
  }
  assert.throws(() => compareAuthorizedProviderBill({ ...input, decision: { ...decision, action: "DECLINE", approvedCapMinor: null } }), /authoriz|declin/i);
});

test("draft, pending, void, removed and ambiguous-absence bills cannot be admitted for comparison", () => {
  for (const status of ["draft", "pending_approval", "void", "unknown", "", "partial"]) {
    assert.throws(() => compareAuthorizedProviderBill({ ...input, evidence: { ...evidence, status } }), /status/i);
  }
  for (const changeKind of ["REMOVED", "ABSENCE_UNCONFIRMED"]) {
    assert.throws(() => compareAuthorizedProviderBill({ ...input, evidence: { ...evidence, changeKind } }), /removed|absence|change/i);
  }
});

test("provider comparison rejects nonpositive, missing, fractional and overflowing gross totals", () => {
  for (const totalMinor of ["0", "-1", "1.25", "9223372036854775808", null, 123, "9".repeat(1000)]) {
    assert.throws(() => compareAuthorizedProviderBill({ ...input, evidence: { ...evidence, totalMinor } } as never), /amount|minor|bigint/i);
  }
  for (const currency of [null, "INVALID", "", "ZZZ"]) {
    assert.throws(() => compareAuthorizedProviderBill({ ...input, evidence: { ...evidence, currency } } as never), /currency/i);
  }
});

test("provider bill dates use the original India authorization day and reject old or future dates", () => {
  for (const billDate of ["2026-09-01", "2026-09-08", "2026-02-30", "", null]) {
    assert.throws(() => compareAuthorizedProviderBill({ ...input, evidence: { ...evidence, billDate } } as never), /date|future|predate/i);
  }
  assert.equal(compareAuthorizedProviderBill({ ...input, evidence: { ...evidence, billDate: "2026-09-02" } }).verdict, "MATCHED");
});

test("source observation cannot retroauthorize a bill captured before the frozen decision on the same India day", () => {
  const sameDayDecision = {
    ...decision,
    decidedAt: "2026-09-07T08:30:00.000Z",
    authorizationExpiresOn: "2026-09-07",
  };
  const sameDayEvidence = { ...evidence, billDate: "2026-09-07", sourceObservedAt: "2026-09-07T08:18:00.000Z" };
  assert.throws(() => compareAuthorizedProviderBill({ ...input, decision: sameDayDecision, evidence: sameDayEvidence }), /source.*observ|captur|predate/i);
  for (const sourceObservedAt of [undefined, null, "not-a-timestamp"]) {
    assert.throws(() => compareAuthorizedProviderBill({ ...input, decision: sameDayDecision, evidence: { ...sameDayEvidence, sourceObservedAt } } as never), /source.*observ|captur|timestamp/i);
  }
  for (const sourceObservedAt of [sameDayDecision.decidedAt, "2026-09-07T08:31:00.000Z"]) {
    assert.equal(compareAuthorizedProviderBill({
      ...input,
      decision: sameDayDecision,
      evidence: { ...sameDayEvidence, sourceObservedAt },
    }).verdict, "MATCHED");
  }
});

test("expiry remains explicit even with equal gross money and currency mismatch never performs FX", () => {
  assert.equal(compareAuthorizedProviderBill({ ...input, evidence: { ...evidence, billDate: "2026-09-07" } }).verdict, "AUTHORIZATION_EXPIRED");
  assert.equal(compareAuthorizedProviderBill({ ...input, evidence: { ...evidence, currency: "USD" } }).verdict, "CURRENCY_MISMATCH");
  assert.equal(compareAuthorizedProviderBill({ ...input, evidence: { ...evidence, currency: "USD", billDate: "2026-09-07" } }).verdict, "AUTHORIZATION_EXPIRED");
  assert.throws(() => compareAuthorizedProviderBill({ ...input, decision: { ...decision, authorizationExpiresOn: undefined } } as never), /expiry/i);
});
