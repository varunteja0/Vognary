import type { AuthorizedProposalDecision } from "./decision";
import { normalizeCurrency, parseMinorUnits, parsePositiveMinorUnits, requireUuid } from "./money";
import {
  normalizeControlDateOnly,
  reconcileControlOutcome,
  type ControlOutcomeObservation,
  type ControlOutcomeReconciliation,
  type IntendedControlOutcome,
} from "./outcome";

type ReconciliationVerdict = "MATCHED" | "WITHIN_CAP" | "OVER_CAP" | "CURRENCY_MISMATCH" | "CANNOT_EVALUATE" | "AUTHORIZATION_EXPIRED";

export function reconcileAuthorizedProposal(input: {
  decision: AuthorizedProposalDecision;
  evidence: {
    evidenceId: string;
    amountMinor: string | null;
    currency: string | null;
    evidenceDate: string | null;
  };
  intendedOutcome?: IntendedControlOutcome;
  observedOutcome?: ControlOutcomeObservation;
  observedThrough?: string;
}) {
  const evidenceId = requireUuid(input.evidence.evidenceId, "Evidence id");
  if (input.observedOutcome && !input.intendedOutcome) throw new Error("Observed outcome requires a frozen intended outcome on the proposal.");
  const outcome = input.intendedOutcome
    ? reconcileControlOutcome(input.intendedOutcome, input.observedOutcome, input.observedThrough)
    : null;
  const observedEvidenceDate = input.evidence.evidenceDate === null
    ? null
    : normalizeControlDateOnly(input.evidence.evidenceDate, "Observed evidence date");
  if (input.decision.action === "DECLINE" || input.evidence.amountMinor === null || input.evidence.currency === null) {
    return result(input.decision, evidenceId, null, input.evidence.currency, observedEvidenceDate, "CANNOT_EVALUATE", input.decision.action === "DECLINE" ? null : outcome);
  }
  if (input.decision.authorizationExpiresOn && observedEvidenceDate === null) {
    throw new Error("Observed financial evidence requires a date to evaluate the authorization window.");
  }
  if (observedEvidenceDate && input.decision.authorizationExpiresOn && observedEvidenceDate > input.decision.authorizationExpiresOn) {
    return result(input.decision, evidenceId, input.evidence.amountMinor, input.evidence.currency, observedEvidenceDate, "AUTHORIZATION_EXPIRED", outcome);
  }
  const observedCurrency = normalizeCurrency(input.evidence.currency, "Observed currency");
  if (observedCurrency !== input.decision.currency) {
    return result(input.decision, evidenceId, input.evidence.amountMinor, observedCurrency, observedEvidenceDate, "CURRENCY_MISMATCH", outcome);
  }
  const observedAmount = parseMinorUnits(input.evidence.amountMinor, "Observed amount");
  const cap = parsePositiveMinorUnits(input.decision.approvedCapMinor, "Frozen approved cap");
  const expected = parsePositiveMinorUnits(input.decision.expectedAmountMinor, "Frozen expected amount");
  const verdict: ReconciliationVerdict = observedAmount > cap
    ? "OVER_CAP"
    : observedAmount === expected
      ? "MATCHED"
      : "WITHIN_CAP";
  return result(input.decision, evidenceId, observedAmount.toString(), observedCurrency, observedEvidenceDate, verdict, outcome);
}

function result(
  decision: AuthorizedProposalDecision,
  evidenceId: string,
  observedAmountMinor: string | null,
  observedCurrency: string | null,
  observedEvidenceDate: string | null,
  verdict: ReconciliationVerdict,
  outcome: ControlOutcomeReconciliation | null,
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
    observedEvidenceDate,
    outcome,
  };
}