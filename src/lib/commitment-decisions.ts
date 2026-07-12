import { isCommitmentActionAllowed, type CommitmentAction } from "./commitment-policy";
import type { RecommendationType, RecurringItem } from "./recurring-audit";

export const commitmentDecisionActions = ["keep", "watch", "downgrade", "cancel", "investigate"] as const;

export function normalizeCommitmentDecisionAction(value: unknown): RecommendationType {
  if (typeof value !== "string" || !commitmentDecisionActions.includes(value as RecommendationType)) {
    throw new Error("Commitment decision action is not allowlisted.");
  }
  return value as RecommendationType;
}

export function isCommitmentDecisionAllowed(category: string, action: RecommendationType) {
  return isCommitmentActionAllowed(category, toPolicyAction(action));
}

export function resolveCommitmentDecisionIdentityKey(
  items: Array<Pick<RecurringItem, "identityKey" | "canonicalRecurringItemId" | "normalizedMerchant" | "currency">>,
  decision: { recurringItemId: string; normalizedMerchant: string; currency: string },
) {
  const canonical = items.find((item) => item.canonicalRecurringItemId === decision.recurringItemId);
  if (canonical) return canonical.identityKey;

  const merchant = normalizeDecisionMerchant(decision.normalizedMerchant);
  const currency = decision.currency.toUpperCase();
  const legacyCandidates = items.filter((item) => item.currency.toUpperCase() === currency
    && normalizeDecisionMerchant(item.normalizedMerchant) === merchant);
  return legacyCandidates.length === 1 ? legacyCandidates[0].identityKey : null;
}

function toPolicyAction(action: RecommendationType): CommitmentAction {
  if (action === "watch") return "monitor";
  return action;
}

function normalizeDecisionMerchant(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, " ").trim();
}
