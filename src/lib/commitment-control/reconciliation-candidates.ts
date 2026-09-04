import type { ControlDecisionDto } from "./contracts";

export type ControlReconciliationEvidenceInput = {
  evidenceId: string;
  commitmentId: string;
  commitmentMerchant: string;
  amountMinor: string | null;
  currency: string | null;
  evidenceDate: string | null;
  alreadyReconciled: boolean;
};

export type ControlReconciliationCandidate = {
  evidenceId: string;
  commitmentId: string;
  commitmentMerchant: string;
  observedAmountMinor: string;
  observedCurrency: string;
  observedEvidenceDate: string;
  basis: "SAME_CURRENCY_WITHIN_AUTHORIZATION_WINDOW";
  requiresHumanConfirmation: true;
};

export type ControlReconciliationCandidatesDto = {
  proposalId: string;
  matchingPerformed: false;
  candidates: ControlReconciliationCandidate[];
};

export function isControlReconciliationCandidatesDto(value: unknown): value is ControlReconciliationCandidatesDto {
  if (!isRecord(value)
    || typeof value.proposalId !== "string"
    || !uuidPattern.test(value.proposalId)
    || value.matchingPerformed !== false
    || !Array.isArray(value.candidates)) return false;
  return value.candidates.every((candidate) => isRecord(candidate)
    && typeof candidate.evidenceId === "string"
    && uuidPattern.test(candidate.evidenceId)
    && typeof candidate.commitmentId === "string"
    && uuidPattern.test(candidate.commitmentId)
    && typeof candidate.commitmentMerchant === "string"
    && candidate.commitmentMerchant.trim() === candidate.commitmentMerchant
    && candidate.commitmentMerchant.length >= 1
    && candidate.commitmentMerchant.length <= 240
    && typeof candidate.observedAmountMinor === "string"
    && /^(?:0|[1-9]\d*)$/.test(candidate.observedAmountMinor)
    && typeof candidate.observedCurrency === "string"
    && /^[A-Z]{3}$/.test(candidate.observedCurrency)
    && typeof candidate.observedEvidenceDate === "string"
    && /^\d{4}-\d{2}-\d{2}$/.test(candidate.observedEvidenceDate)
    && candidate.basis === "SAME_CURRENCY_WITHIN_AUTHORIZATION_WINDOW"
    && candidate.requiresHumanConfirmation === true);
}

export function selectControlReconciliationCandidates(input: {
  decision: ControlDecisionDto;
  evidence: readonly ControlReconciliationEvidenceInput[];
}): readonly ControlReconciliationCandidate[] {
  const { decision } = input;
  if (decision.action === "DECLINE" || decision.authorizationExpiresOn === null) return [];
  const decisionDate = decision.decidedAt.slice(0, 10);

  return input.evidence
    .flatMap((evidence): ControlReconciliationCandidate[] => {
      if (evidence.alreadyReconciled
        || evidence.amountMinor === null
        || evidence.currency !== decision.currency
        || evidence.evidenceDate === null
        || evidence.evidenceDate < decisionDate
        || evidence.evidenceDate > decision.authorizationExpiresOn!) return [];
      return [{
        evidenceId: evidence.evidenceId,
        commitmentId: evidence.commitmentId,
        commitmentMerchant: evidence.commitmentMerchant,
        observedAmountMinor: evidence.amountMinor,
        observedCurrency: evidence.currency,
        observedEvidenceDate: evidence.evidenceDate,
        basis: "SAME_CURRENCY_WITHIN_AUTHORIZATION_WINDOW",
        requiresHumanConfirmation: true,
      }];
    })
    .sort((left, right) => left.observedEvidenceDate.localeCompare(right.observedEvidenceDate)
      || left.evidenceId.localeCompare(right.evidenceId));
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}