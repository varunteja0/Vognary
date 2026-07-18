import type { RecommendationType, RecurringItem } from "./recurring-audit";

export type SuggestedCut = {
  item: RecurringItem;
  action: RecommendationType;
  score: number;
};

const actionWeight: Record<RecommendationType, number> = {
  cancel: 1.7,
  downgrade: 1.45,
  investigate: 1.3,
  watch: 1.15,
  keep: 0.35,
};

/**
 * A deterministic review queue: expensive commitments rise, weak evidence
 * increases the need to inspect, explicit review actions matter, and a proven
 * price increase breaks close ties. This score never invents financial data.
 */
export function rankSuggestedCuts(
  items: RecurringItem[],
  userActions: Record<string, RecommendationType>,
  limit = 3,
): SuggestedCut[] {
  return items
    .map((item) => {
      const action = userActions[item.identityKey] ?? item.recommendationType;
      const weakProofWeight = 1 + Math.max(0, 100 - item.confidenceScore) / 100;
      const priceRiseWeight = item.priceChange?.direction === "increase" ? 1.25 : 1;
      return {
        item,
        action,
        score: item.monthlyCost * weakProofWeight * actionWeight[action] * priceRiseWeight,
      };
    })
    .filter(({ item }) => item.monthlyCost > 0)
    .sort((left, right) => right.score - left.score || right.item.monthlyCost - left.item.monthlyCost || left.item.identityKey.localeCompare(right.item.identityKey))
    .slice(0, Math.max(0, limit));
}
