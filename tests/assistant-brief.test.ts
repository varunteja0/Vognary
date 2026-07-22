import assert from "node:assert/strict";
import test from "node:test";
import { buildAssistantBrief, selectHeadline, type BriefAnomaly, type BriefRenewal } from "../src/lib/assistant-brief";
import type { RecurringItem } from "../src/lib/recurring-audit";

const today = new Date(2026, 6, 21); // 2026-07-21

test("savings sum cancel/downgrade items in ₹, biggest first, and lead the headline", () => {
  const brief = buildAssistantBrief({
    today,
    recurringItems: [
      item({ identityKey: "netflix", merchant: "Netflix", monthlyCost: 649, recommendationType: "cancel", nextExpectedDate: "2026-08-15" }),
      item({ identityKey: "notion", merchant: "Notion", monthlyCost: 800, recommendationType: "downgrade", nextExpectedDate: "2026-08-20" }),
      item({ identityKey: "keep", merchant: "Electricity", monthlyCost: 2_000, recommendationType: "keep", nextExpectedDate: "2026-08-05" }),
    ],
  });

  assert.equal(brief.monthlySavings, 1_449, "only cancel + downgrade count as freeable money");
  assert.equal(brief.annualSavings, 1_449 * 12);
  assert.deepEqual(brief.savings.map((saving) => saving.merchant), ["Notion", "Netflix"], "biggest saving first, keep excluded");
  assert.equal(brief.headline.kind, "savings");
  assert.match(brief.headline.text, /₹1,449\/mo across 2 subscriptions/);
});

test("an imminent money-saving renewal outranks a larger passive saving", () => {
  const brief = buildAssistantBrief({
    today,
    recurringItems: [
      // Bigger monthly saving, but not due soon.
      item({ identityKey: "notion", merchant: "Notion", monthlyCost: 800, recommendationType: "downgrade", nextExpectedDate: "2026-09-01" }),
      // Smaller, but renews in two days and is flagged to cancel — this must lead.
      item({ identityKey: "netflix", merchant: "Netflix", monthlyCost: 649, averageAmount: 649, recommendationType: "cancel", nextExpectedDate: "2026-07-23" }),
    ],
  });

  assert.equal(brief.headline.kind, "renewal-soon");
  assert.match(brief.headline.text, /Netflix renews in 2 days/);
  assert.match(brief.headline.text, /cancel/);
  assert.match(brief.headline.text, /₹649/);
});

test("price increases surface as anomalies and lead when no money is on the table", () => {
  const brief = buildAssistantBrief({
    today,
    recurringItems: [
      item({
        identityKey: "spotify",
        merchant: "Spotify",
        monthlyCost: 149,
        recommendationType: "watch",
        nextExpectedDate: "2026-08-10",
        priceChange: { direction: "increase", previousAmount: 119, latestAmount: 149, changePercent: 25 },
      }),
    ],
  });

  assert.equal(brief.monthlySavings, 0);
  assert.equal(brief.anomalies.length, 1);
  assert.equal(brief.anomalies[0].kind, "price-increase");
  assert.match(brief.anomalies[0].detail, /₹119.*₹149.*\+25%/);
  assert.equal(brief.headline.kind, "anomaly");
});

test("foreign-currency commitments never add into a rupee total", () => {
  const brief = buildAssistantBrief({
    today,
    recurringItems: [
      item({ identityKey: "inr", merchant: "Notion", currency: "INR", monthlyCost: 800, recommendationType: "downgrade", nextExpectedDate: "2026-08-01" }),
      item({ identityKey: "usd", merchant: "GitHub", currency: "USD", monthlyCost: 21, averageAmount: 21, recommendationType: "cancel", nextExpectedDate: "2026-08-02" }),
    ],
  });

  assert.equal(brief.monthlySavings, 800, "USD $21 must not be summed into ₹");
  assert.equal(brief.savings.length, 2, "the USD opportunity is still listed, with its own currency");
  assert.ok(brief.savings.some((saving) => saving.currency === "USD"));
});

test("with nothing to save or investigate but renewals on the horizon, the headline names the next one", () => {
  const brief = buildAssistantBrief({
    today,
    recurringItems: [
      // ~12 days out — past the 7-day window, but still upcoming, so "nothing" would lie.
      item({ identityKey: "keep", merchant: "Rent", monthlyCost: 25_000, averageAmount: 25_000, recommendationType: "keep", nextExpectedDate: "2026-08-02" }),
    ],
  });

  assert.equal(brief.headline.kind, "renewals");
  assert.match(brief.headline.text, /You're on track/);
  assert.match(brief.headline.text, /Rent renews next/);
  assert.equal(brief.monthlySavings, 0);
});

test("all-clear only when there is genuinely nothing on the horizon", () => {
  const brief = buildAssistantBrief({
    today,
    recurringItems: [
      // Beyond the 45-day horizon → no renewal event at all.
      item({ identityKey: "keep", merchant: "Rent", monthlyCost: 25_000, recommendationType: "keep", nextExpectedDate: "2026-09-30" }),
    ],
  });

  assert.equal(brief.headline.kind, "all-clear");
  assert.equal(brief.renewals.next.length, 0);
  assert.equal(brief.monthlySavings, 0);
  assert.equal(brief.anomalies.length, 0);
});

test("a user action override reclassifies an item as savings", () => {
  const items = [
    item({ identityKey: "prime", merchant: "Amazon Prime", monthlyCost: 300, recommendationType: "watch", nextExpectedDate: "2026-08-01" }),
  ];

  const withoutOverride = buildAssistantBrief({ today, recurringItems: items });
  assert.equal(withoutOverride.monthlySavings, 0, "engine only said 'watch' — nothing to save yet");

  const withOverride = buildAssistantBrief({ today, recurringItems: items, actions: { prime: "cancel" } });
  assert.equal(withOverride.monthlySavings, 300, "the user's decision to cancel counts as freeable money");
  assert.equal(withOverride.savings[0]?.action, "cancel");
});

test("selectHeadline priority is stable and independently testable", () => {
  const renewalSoon: BriefRenewal = { itemId: "x", merchant: "Prime", amount: 1499, currency: "INR", date: "2026-07-22", daysAway: 1, action: "cancel", confidenceScore: 80 };
  const anomaly: BriefAnomaly = { itemId: "y", merchant: "Spotify", kind: "price-increase", currency: "INR", detail: "up", previousAmount: 119, latestAmount: 149, changePercent: 25, confidenceScore: 70 };

  // Imminent saving renewal beats savings, anomaly, and weekly renewals.
  assert.equal(selectHeadline({ monthlySavings: 5000, savingsCount: 3, anomalies: [anomaly], renewals: [renewalSoon], dueNext7Days: 9000 }).kind, "renewal-soon");
  // With no imminent saving renewal, money on the table wins.
  assert.equal(selectHeadline({ monthlySavings: 5000, savingsCount: 3, anomalies: [anomaly], renewals: [], dueNext7Days: 9000 }).kind, "savings");
  // Then anomalies.
  assert.equal(selectHeadline({ monthlySavings: 0, savingsCount: 0, anomalies: [anomaly], renewals: [], dueNext7Days: 9000 }).kind, "anomaly");
  // Then the week's renewals.
  assert.equal(selectHeadline({ monthlySavings: 0, savingsCount: 0, anomalies: [], renewals: [], dueNext7Days: 9000 }).kind, "renewals");
  // A renewal on the horizon (past 7 days) still beats "all-clear" — name the next one.
  const later: BriefRenewal = { ...renewalSoon, daysAway: 12, date: "2026-08-02" };
  const onTrack = selectHeadline({ monthlySavings: 0, savingsCount: 0, anomalies: [], renewals: [later], dueNext7Days: 0 });
  assert.equal(onTrack.kind, "renewals");
  assert.match(onTrack.text, /on track/);
  // Then all-clear, only when there is genuinely nothing upcoming.
  assert.equal(selectHeadline({ monthlySavings: 0, savingsCount: 0, anomalies: [], renewals: [], dueNext7Days: 0 }).kind, "all-clear");
});

function item({ identityKey, ...rest }: Partial<RecurringItem> & Pick<RecurringItem, "identityKey">): RecurringItem {
  const monthlyCost = rest.monthlyCost ?? 500;
  return {
    id: identityKey,
    identityKey,
    merchant: identityKey,
    normalizedMerchant: identityKey,
    category: "Software",
    currency: "INR",
    frequency: "monthly",
    averageGapDays: 30,
    amountMin: monthlyCost,
    amountMax: monthlyCost,
    averageAmount: monthlyCost,
    monthlyCost,
    annualCost: monthlyCost * 12,
    lastChargeDate: "2026-07-01",
    nextExpectedDate: "2026-08-01",
    confidenceScore: 75,
    recommendationType: "watch",
    recommendationReason: "Charged once in the evidence window; confirm it with one more proof source.",
    riskTags: [],
    evidence: [],
    sourceNames: ["Test"],
    missedCycles: 0,
    priceChange: null,
    ...rest,
  };
}
