import { parseIsoDateOnly, startOfLocalDay } from "./date-only";
import { isCommitmentActionAllowed, type CommitmentAction } from "./commitment-policy";
import type { RecommendationType, RecurringItem } from "./recurring-audit";

export type FirstActionResult = {
  item: RecurringItem;
  action: RecommendationType;
  reason: string;
  proof: string;
};

type RankedCandidate = {
  item: RecurringItem;
  daysUntilRenewal: number;
  observedEvidenceCount: number;
  evidenceCount: number;
  sourceCount: number;
};

const dayInMs = 24 * 60 * 60 * 1_000;
const actionPriority: Record<RecommendationType, number> = {
  cancel: 5,
  downgrade: 4,
  investigate: 3,
  watch: 2,
  keep: 1,
};

/**
 * Return one unresolved, policy-safe action. Raw amounts are compared only
 * within the same currency; cross-currency ties use stable currency/identity
 * ordering instead of inventing an exchange rate.
 */
export function rankFirstAction(
  items: readonly RecurringItem[],
  userActions: Readonly<Record<string, RecommendationType>> = {},
  today: Date = new Date(),
): FirstActionResult | null {
  const start = startOfLocalDay(today);
  const candidates = items
    .filter((item) => !Object.prototype.hasOwnProperty.call(userActions, item.identityKey))
    .filter((item) => isSafeRecommendation(item.category, item.recommendationType))
    .map((item): RankedCandidate => ({
      item,
      daysUntilRenewal: daysUntil(item.nextExpectedDate, start),
      observedEvidenceCount: item.evidence.filter((evidence) => evidence.kind !== "scheduled").length,
      evidenceCount: item.evidence.length,
      sourceCount: new Set(item.sourceNames).size,
    }))
    .sort(compareCandidates);

  const selected = candidates[0];
  if (!selected) return null;

  return {
    item: selected.item,
    action: selected.item.recommendationType,
    reason: selected.item.recommendationReason,
    proof: buildProof(selected),
  };
}

function compareCandidates(left: RankedCandidate, right: RankedCandidate) {
  if (left.daysUntilRenewal !== right.daysUntilRenewal) return left.daysUntilRenewal - right.daysUntilRenewal;

  const actionDelta = actionPriority[right.item.recommendationType] - actionPriority[left.item.recommendationType];
  if (actionDelta) return actionDelta;
  if (left.observedEvidenceCount !== right.observedEvidenceCount) return right.observedEvidenceCount - left.observedEvidenceCount;
  if (left.evidenceCount !== right.evidenceCount) return right.evidenceCount - left.evidenceCount;
  if (left.sourceCount !== right.sourceCount) return right.sourceCount - left.sourceCount;
  if (left.item.confidenceScore !== right.item.confidenceScore) return right.item.confidenceScore - left.item.confidenceScore;

  const leftCurrency = left.item.currency.toUpperCase();
  const rightCurrency = right.item.currency.toUpperCase();
  if (leftCurrency === rightCurrency && left.item.monthlyCost !== right.item.monthlyCost) {
    return right.item.monthlyCost - left.item.monthlyCost;
  }
  if (leftCurrency !== rightCurrency) return leftCurrency.localeCompare(rightCurrency, "en");
  return left.item.identityKey.localeCompare(right.item.identityKey, "en");
}

function daysUntil(value: string, today: Date) {
  const date = parseIsoDateOnly(value);
  if (!date) return Number.MAX_SAFE_INTEGER;
  const delta = Math.round((date.getTime() - today.getTime()) / dayInMs);
  return delta >= 0 ? delta : Number.MAX_SAFE_INTEGER - Math.min(Math.abs(delta), 1_000_000);
}

function isSafeRecommendation(category: string, action: RecommendationType) {
  const policyAction: CommitmentAction = action === "watch" ? "monitor" : action;
  return isCommitmentActionAllowed(category, policyAction);
}

function buildProof(candidate: RankedCandidate) {
  const evidenceLabel = `${candidate.observedEvidenceCount} observed charge${candidate.observedEvidenceCount === 1 ? "" : "s"}`;
  const sourceLabel = `${candidate.sourceCount} source${candidate.sourceCount === 1 ? "" : "s"}`;
  const amount = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(candidate.item.monthlyCost);
  return `${evidenceLabel} across ${sourceLabel}; ${candidate.item.confidenceScore}% confidence; next renewal ${candidate.item.nextExpectedDate}; monthly impact ${candidate.item.currency.toUpperCase()} ${amount}.`;
}
