import type { AuthorizedProposalDecision } from "./decision";
import { normalizeCurrency, parsePositiveMinorUnits, requireUuid } from "./money";
import { normalizeControlDateOnly } from "./outcome";
import { calendarDateInTimeZone } from "./project";

export type ProviderBillForComparison = {
  evidenceId: string;
  evidenceBasis: "PROVIDER_BILL_TOTAL";
  totalMinor: string;
  currency: string;
  billDate: string;
  sourceObservedAt: string;
  status: string;
  changeKind: string;
};

export function compareAuthorizedProviderBill(input: {
  decision: AuthorizedProposalDecision;
  evidence: ProviderBillForComparison;
  wholeCharge: "USER_CONFIRMED_SAME_CHARGE";
  comparedOn: string;
}) {
  const { decision, evidence } = input;
  if (decision.amountBasis !== "GROSS_BILLED_TOTAL_PER_CHARGE") {
    throw new Error("The frozen decision requires explicit gross billed total per-charge basis.");
  }
  if (evidence.evidenceBasis !== "PROVIDER_BILL_TOTAL") throw new Error("Evidence basis must be the whole provider bill total.");
  if (input.wholeCharge !== "USER_CONFIRMED_SAME_CHARGE") throw new Error("Confirm the whole bill is the same authorized charge; allocation is not supported.");
  if (decision.action === "DECLINE") throw new Error("A declined proposal has no authorization to compare.");
  if (!decision.authorizationExpiresOn) throw new Error("The original authorization requires an explicit expiry.");
  if (!["open", "approved", "overdue", "partially_paid", "paid"].includes(evidence.status)) {
    throw new Error("This provider bill status is not eligible for comparison.");
  }
  if (!["BASELINE", "NEW", "AMENDED"].includes(evidence.changeKind)) {
    throw new Error("Removed, void or uncertain-absence source changes cannot be compared.");
  }
  const evidenceId = requireUuid(evidence.evidenceId, "Provider bill evidence id");
  const amount = parsePositiveMinorUnits(evidence.totalMinor, "Gross billed amount");
  const cap = parsePositiveMinorUnits(decision.approvedCapMinor, "Frozen approved cap");
  const expected = parsePositiveMinorUnits(decision.expectedAmountMinor, "Frozen expected amount");
  const currency = normalizeCurrency(evidence.currency, "Provider bill currency");
  const authorizationCurrency = normalizeCurrency(decision.currency, "Authorization currency");
  const billDate = normalizeControlDateOnly(evidence.billDate, "Provider bill date");
  const comparedOn = normalizeControlDateOnly(input.comparedOn, "Comparison date");
  const expiry = normalizeControlDateOnly(decision.authorizationExpiresOn, "Authorization expiry");
  const decidedAt = new Date(decision.decidedAt);
  const sourceObservedAt = typeof evidence.sourceObservedAt === "string" ? Date.parse(evidence.sourceObservedAt) : NaN;
  if (!Number.isFinite(sourceObservedAt)) throw new Error("Provider bill source observation requires a valid timestamp.");
  if (!Number.isFinite(decidedAt.getTime()) || sourceObservedAt < decidedAt.getTime()) {
    throw new Error("Provider bill source observation cannot predate the frozen authorization decision.");
  }
  const authorizedOn = calendarDateInTimeZone(decidedAt, "Asia/Kolkata");
  if (billDate < authorizedOn) throw new Error("Provider bill date cannot predate the India-calendar authorization decision.");
  if (billDate > comparedOn) throw new Error("Provider bill date cannot be in the future.");
  const verdict = billDate > expiry ? "AUTHORIZATION_EXPIRED" as const
    : currency !== authorizationCurrency ? "CURRENCY_MISMATCH" as const
      : amount > cap ? "OVER_CAP" as const
        : amount === expected ? "MATCHED" as const : "WITHIN_CAP" as const;
  return {
    comparisonKind: "BILLED_AMOUNT_COMPARISON" as const,
    decisionAmountBasis: "GROSS_BILLED_TOTAL_PER_CHARGE" as const,
    observedEvidenceBasis: "PROVIDER_BILL_TOTAL" as const,
    proposalId: decision.proposalId,
    evidenceId,
    verdict,
    expectedAmountMinor: expected.toString(),
    approvedCapMinor: cap.toString(),
    authorizationCurrency,
    observedAmountMinor: amount.toString(),
    observedCurrency: currency,
    observedEvidenceDate: billDate,
    outcome: null,
  };
}
