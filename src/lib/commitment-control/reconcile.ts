import type { AuthorizedProposalDecision } from "./decision";
import { normalizeCurrency, parseMinorUnits, parsePositiveMinorUnits, requireUuid } from "./money";

type ReconciliationVerdict = "MATCHED" | "WITHIN_CAP" | "OVER_CAP" | "CURRENCY_MISMATCH" | "CANNOT_EVALUATE";

export function reconcileAuthorizedProposal(input: {
  decision: AuthorizedProposalDecision;
  evidence: {
    evidenceId: string;
    amountMinor: string | null;
    currency: string | null;
  };
}) {
  const evidenceId = requireUuid(input.evidence.evidenceId, "Evidence id");
  if (input.decision.action === "DECLINE" || input.evidence.amountMinor === null || input.evidence.currency === null) {
    return result(input.decision, evidenceId, null, input.evidence.currency, "CANNOT_EVALUATE");
  }
  const observedCurrency = normalizeCurrency(input.evidence.currency, "Observed currency");
  if (observedCurrency !== input.decision.currency) {
    return result(input.decision, evidenceId, input.evidence.amountMinor, observedCurrency, "CURRENCY_MISMATCH");
  }
  const observedAmount = parseMinorUnits(input.evidence.amountMinor, "Observed amount");
  const cap = parsePositiveMinorUnits(input.decision.approvedCapMinor, "Frozen approved cap");
  const expected = parsePositiveMinorUnits(input.decision.expectedAmountMinor, "Frozen expected amount");
  const verdict: ReconciliationVerdict = observedAmount > cap
    ? "OVER_CAP"
    : observedAmount === expected
      ? "MATCHED"
      : "WITHIN_CAP";
  return result(input.decision, evidenceId, observedAmount.toString(), observedCurrency, verdict);
}

function result(
  decision: AuthorizedProposalDecision,
  evidenceId: string,
  observedAmountMinor: string | null,
  observedCurrency: string | null,
  verdict: ReconciliationVerdict,
) {
  return {
    proposalId: decision.proposalId,
    evidenceId,
    verdict,
    expectedAmountMinor: decision.expectedAmountMinor,
    approvedCapMinor: decision.approvedCapMinor,
    authorizationCurrency: decision.currency,
    observedAmountMinor,
    observedCurrency,
  };
}