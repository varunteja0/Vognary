import assert from "node:assert/strict";
import test from "node:test";
import { buildMandateKillList, detectMandateRail } from "../src/lib/mandate-killlist";
import type { EvidenceLink, RecurringItem } from "../src/lib/recurring-audit";

test("a UPI AutoPay charge is detected, routed to the UPI revoke guide, and proven", () => {
  const kills = buildMandateKillList([
    item({ identityKey: "netflix", merchant: "Netflix", category: "Entertainment", monthlyCost: 649,
      evidence: [charge("UPI AUTOPAY NETFLIX BILLDESK @ybl", 649, "2026-07-06")] }),
  ]);

  assert.equal(kills.length, 1);
  assert.equal(kills[0].rail, "upi-autopay");
  assert.equal(kills[0].pspHint, "PhonePe", "@ybl handles are PhonePe");
  assert.match(kills[0].matchedText, /UPI\s*AUTOPAY/i, "the exact matched token is carried through as proof");
  assert.match(kills[0].revoke.steps.join(" "), /Autopay|UPI app/i, "routed to the UPI AutoPay revoke steps");
  assert.match(kills[0].warning, /Cancelling at Netflix alone will not stop this/);
});

test("a non-mandate subscription is excluded — no invented rail", () => {
  const kills = buildMandateKillList([
    item({ identityKey: "spotify", merchant: "Spotify", monthlyCost: 119,
      evidence: [charge("SPOTIFY INDIA CARD PAYMENT", 119, "2026-07-05")] }),
  ]);
  assert.equal(kills.length, 0);
});

test("an EMI pulled over NACH routes to the loan guide, not a blunt kill", () => {
  const kills = buildMandateKillList([
    item({ identityKey: "hdfc-emi", merchant: "Loan or EMI", category: "Debt", monthlyCost: 12_500,
      evidence: [charge("NACH DR HDFC LOAN EMI", 12_500, "2026-07-05")] }),
  ]);

  assert.equal(kills[0].rail, "nach-ecs");
  assert.match(kills[0].revoke.steps.join(" "), /loan|foreclos/i, "EMI over NACH must warn, not just 'revoke'");
});

test("a SIP over NACH routes to the SIP pause guide", () => {
  const kills = buildMandateKillList([
    item({ identityKey: "groww-sip", merchant: "Investment SIP", category: "Investments", monthlyCost: 5_000,
      evidence: [charge("NACH SIP GROWW MUTUAL FUND", 5_000, "2026-07-02")] }),
  ]);
  assert.equal(kills[0].rail, "nach-ecs");
  assert.match(kills[0].revoke.steps.join(" "), /SIP|pause|instal/i);
});

test("a card e-mandate is detected as the card rail", () => {
  const kills = buildMandateKillList([
    item({ identityKey: "prime", merchant: "Amazon Prime", monthlyCost: 299,
      evidence: [charge("E-MANDATE CARD AMAZON PRIME", 299, "2026-07-10")] }),
  ]);
  assert.equal(kills[0].rail, "card-mandate");
  assert.match(kills[0].revoke.steps.join(" "), /Standing Instruction|e-Mandate|SI Hub/i);
});

test("the kill-list is ordered by soonest debit first", () => {
  const kills = buildMandateKillList([
    item({ identityKey: "later", merchant: "Later", monthlyCost: 500, nextExpectedDate: "2026-08-20", evidence: [charge("UPI AUTOPAY LATER", 500, "2026-07-20")] }),
    item({ identityKey: "sooner", merchant: "Sooner", monthlyCost: 500, nextExpectedDate: "2026-08-01", evidence: [charge("UPI AUTOPAY SOONER", 500, "2026-07-01")] }),
  ]);
  assert.deepEqual(kills.map((kill) => kill.merchant), ["Sooner", "Later"]);
});

test("detectMandateRail is conservative: bare AUTOPAY without a UPI marker is generic auto-debit", () => {
  assert.equal(detectMandateRail("MONTHLY AUTOPAY MERCHANT")?.rail, "auto-debit");
  assert.equal(detectMandateRail("UPI AUTOPAY MERCHANT")?.rail, "upi-autopay");
  assert.equal(detectMandateRail("NETFLIX CARD PAYMENT"), null, "no mandate token → no detection");
});

function charge(description: string, amount: number, date: string): EvidenceLink {
  return { date, amount, description, source: "statement.csv", rowNumber: 1, kind: "observed-charge" };
}

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
    confidenceScore: 80,
    recommendationType: "watch",
    recommendationReason: "Test",
    riskTags: [],
    evidence: [],
    sourceNames: ["statement.csv"],
    missedCycles: 0,
    priceChange: null,
    ...rest,
  };
}
