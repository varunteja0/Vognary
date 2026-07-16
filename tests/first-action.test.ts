import assert from "node:assert/strict";
import { test } from "node:test";

import { rankFirstAction } from "../src/lib/first-action";
import type { RecurringItem } from "../src/lib/recurring-audit";

const today = new Date(2026, 6, 13);

function item(overrides: Partial<RecurringItem> & Pick<RecurringItem, "identityKey" | "merchant">): RecurringItem {
  return {
    id: overrides.identityKey,
    normalizedMerchant: overrides.merchant.toLowerCase(),
    category: "Streaming",
    currency: "INR",
    frequency: "monthly",
    averageGapDays: 30,
    amountMin: 500,
    amountMax: 500,
    averageAmount: 500,
    monthlyCost: 500,
    annualCost: 6_000,
    lastChargeDate: "2026-06-20",
    nextExpectedDate: "2026-07-20",
    confidenceScore: 90,
    recommendationType: "watch",
    recommendationReason: "Confirm it is still used before renewal.",
    riskTags: [],
    evidence: [{ date: "2026-06-20", amount: 500, description: "charge", source: "receipt", rowNumber: 1 }],
    sourceNames: ["receipt"],
    missedCycles: 0,
    priceChange: null,
    ...overrides,
  };
}

test("ranks an imminent unresolved safe action before a later larger action", () => {
  const imminent = item({ identityKey: "soon::INR", merchant: "Soon", monthlyCost: 500, nextExpectedDate: "2026-07-14" });
  const later = item({ identityKey: "later::INR", merchant: "Later", monthlyCost: 5_000, nextExpectedDate: "2026-08-01", recommendationType: "downgrade" });

  const result = rankFirstAction([later, imminent], {}, today);

  assert.equal(result?.item.identityKey, imminent.identityKey);
  assert.equal(result?.action, "watch");
  assert.match(result?.proof ?? "", /INR 500/);
  assert.match(result?.proof ?? "", /2026-07-14/);
});

test("excludes resolved user actions and policy-unsafe recommendations", () => {
  const resolved = item({ identityKey: "resolved::INR", merchant: "Resolved", nextExpectedDate: "2026-07-14" });
  const unsafe = item({
    identityKey: "loan::INR",
    merchant: "Loan",
    category: "Debt",
    nextExpectedDate: "2026-07-15",
    recommendationType: "cancel",
  });
  const safe = item({ identityKey: "safe::INR", merchant: "Safe", nextExpectedDate: "2026-07-16" });

  const result = rankFirstAction([resolved, unsafe, safe], { [resolved.identityKey]: "keep" }, today);

  assert.equal(result?.item.identityKey, safe.identityKey);
});

test("uses stronger proof, confidence, and same-currency materiality before stable ties", () => {
  const weak = item({ identityKey: "weak::INR", merchant: "Weak", confidenceScore: 70 });
  const proven = item({
    identityKey: "proven::INR",
    merchant: "Proven",
    confidenceScore: 95,
    monthlyCost: 900,
    evidence: [
      { date: "2026-05-20", amount: 900, description: "charge", source: "bank", rowNumber: 1 },
      { date: "2026-06-20", amount: 900, description: "charge", source: "bank", rowNumber: 2 },
    ],
  });

  assert.equal(rankFirstAction([weak, proven], {}, today)?.item.identityKey, proven.identityKey);

  const smaller = item({ identityKey: "small::INR", merchant: "Small", monthlyCost: 500 });
  const larger = item({ identityKey: "large::INR", merchant: "Large", monthlyCost: 1_500 });
  assert.equal(rankFirstAction([smaller, larger], {}, today)?.item.identityKey, larger.identityKey);
});

test("never compares raw materiality across currencies and breaks ties deterministically", () => {
  const inr = item({ identityKey: "zeta::INR", merchant: "Zeta", currency: "INR", monthlyCost: 10_000 });
  const usd = item({ identityKey: "alpha::USD", merchant: "Alpha", currency: "USD", monthlyCost: 10 });

  const forward = rankFirstAction([usd, inr], {}, today);
  const reverse = rankFirstAction([inr, usd], {}, today);

  assert.equal(forward?.item.identityKey, reverse?.item.identityKey);
  assert.equal(forward?.item.identityKey, inr.identityKey);
});
