import assert from "node:assert/strict";
import test from "node:test";
import { rankSuggestedCuts } from "../src/lib/suggested-cuts";
import type { RecurringItem } from "../src/lib/recurring-audit";

test("suggested cuts combine cost, proof weakness, action, and price rises deterministically", () => {
  const expensiveKeep = item({ identityKey: "keep", monthlyCost: 2_000, confidenceScore: 95, recommendationType: "keep" });
  const review = item({ identityKey: "review", monthlyCost: 900, confidenceScore: 55, recommendationType: "investigate" });
  const increase = item({
    identityKey: "increase",
    monthlyCost: 850,
    confidenceScore: 70,
    recommendationType: "watch",
    priceChange: { direction: "increase", previousAmount: 700, latestAmount: 850, percentChange: 21 },
  });

  const ranked = rankSuggestedCuts([expensiveKeep, review, increase], { increase: "cancel" });
  assert.deepEqual(ranked.map(({ item: candidate }) => candidate.identityKey), ["increase", "review", "keep"]);
  assert.equal(ranked[0].action, "cancel");
});

test("suggested cuts respect the requested result limit", () => {
  const items = ["one", "two", "three"].map((identityKey, index) => item({ identityKey, monthlyCost: 300 - index }));
  assert.equal(rankSuggestedCuts(items, {}, 2).length, 2);
  assert.equal(rankSuggestedCuts(items, {}, 0).length, 0);
});

function item(overrides: Partial<RecurringItem> & Pick<RecurringItem, "identityKey" | "monthlyCost">): RecurringItem {
  return {
    identityKey: overrides.identityKey,
    merchant: overrides.identityKey,
    normalizedMerchant: overrides.identityKey,
    category: "Software",
    currency: "INR",
    frequency: "monthly",
    monthlyCost: overrides.monthlyCost,
    annualCost: overrides.monthlyCost * 12,
    amountMin: overrides.monthlyCost,
    amountMax: overrides.monthlyCost,
    averageAmount: overrides.monthlyCost,
    occurrenceCount: 2,
    lastChargeDate: "2026-07-01",
    nextExpectedDate: "2026-08-01",
    confidenceScore: overrides.confidenceScore ?? 75,
    recommendationType: overrides.recommendationType ?? "watch",
    recommendation: "Review",
    recommendationReason: "Test",
    riskTags: [],
    sourceNames: ["Test"],
    evidence: [],
    ...overrides,
  };
}
