import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeStatements, type ManualRecurringInput, type RecurringItem } from "../src/lib/recurring-audit";
import { buildProofGraphSummary, explainProofConfidence } from "../src/lib/proof-graph";

const today = new Date(2026, 6, 10); // 2026-07-10

function recurringItem(overrides: Partial<RecurringItem> = {}): RecurringItem {
  return {
    id: "openai",
    identityKey: "openai::inr::monthly",
    merchant: "OpenAI",
    normalizedMerchant: "openai",
    category: "AI tools",
    currency: "INR",
    frequency: "monthly",
    averageGapDays: 30.44,
    amountMin: 1999,
    amountMax: 1999,
    averageAmount: 1999,
    monthlyCost: 1999,
    annualCost: 23988,
    lastChargeDate: "2026-06-06",
    nextExpectedDate: "2026-07-06",
    confidenceScore: 90,
    recommendationType: "keep",
    recommendationReason: "Stable recurring charge.",
    riskTags: [],
    evidence: [],
    sourceNames: [],
    missedCycles: 0,
    priceChange: null,
    ...overrides,
  };
}

function csv(rows: string[]): string {
  return ["Date,Description,Debit,Credit", ...rows].join("\n");
}

test("splits spend into single-source and multi-source proof", () => {
  const manualItems: ManualRecurringInput[] = [{
    id: "r1",
    merchant: "OpenAI",
    amount: 1999,
    frequency: "monthly",
    nextExpectedDate: "2026-08-06",
    category: "AI tools",
    sourceName: "Gmail receipt sync",
  }];

  const audit = analyzeStatements([{
    name: "statement.csv",
    text: csv([
      "2026-05-06,OPENAI CHATGPT PLUS,1999,",
      "2026-06-06,OPENAI CHATGPT PLUS,1999,",
      "2026-07-06,OPENAI CHATGPT PLUS,1999,",
      "2026-05-18,VERCEL PRO TEAM,1600,",
      "2026-06-18,VERCEL PRO TEAM,1600,",
    ]),
  }], manualItems, { today });

  const graph = buildProofGraphSummary(audit.recurringItems, { today });

  assert.equal(graph.itemCount, 2);
  assert.ok(Math.abs(graph.multiSourceMonthly - 1999) < 1, "merged OpenAI is multi-source spend");
  assert.ok(Math.abs(graph.singleSourceMonthly - 1600) < 1, "Vercel remains single-source spend");
  assert.ok(graph.singleSourceShare > 0 && graph.singleSourceShare < 1);
  assert.equal(graph.newestEvidenceDate, "2026-07-06");
});

test("recommends the connection with the most monthly spend at stake", () => {
  const audit = analyzeStatements([{
    name: "statement.csv",
    text: csv([
      "2026-05-18,VERCEL PRO TEAM,1600,",
      "2026-06-18,VERCEL PRO TEAM,1600,",
      "2026-05-02,GITHUB COPILOT BUSINESS,1520,",
      "2026-06-02,GITHUB COPILOT BUSINESS,1520,",
    ]),
  }], [], { today });

  const graph = buildProofGraphSummary(audit.recurringItems, { today });

  assert.ok(graph.nextBestSources.length >= 1);
  const top = graph.nextBestSources[0];
  assert.equal(top.suggestion, "Connect Gmail receipts", "statement-only spend should ask for receipt corroboration");
  assert.ok(Math.abs(top.monthlyAtStake - 3120) < 2);
  assert.ok(top.merchants.length >= 1);
});

test("suggests statement import for manual-only evidence and guided capture for mandates", () => {
  const manualItems: ManualRecurringInput[] = [
    {
      id: "m1",
      merchant: "Notion",
      amount: 800,
      frequency: "monthly",
      nextExpectedDate: "2026-08-01",
      category: "Productivity",
      sourceName: "Pasted receipt snippet",
    },
    {
      id: "m2",
      merchant: "UPI AutoPay gym mandate",
      amount: 999,
      frequency: "monthly",
      nextExpectedDate: "2026-08-03",
      category: "Mandates",
      sourceName: "Google Pay AutoPay screen (user-confirmed)",
    },
  ];

  const audit = analyzeStatements([], manualItems, { today });
  const graph = buildProofGraphSummary(audit.recurringItems, { today });
  const suggestions = graph.nextBestSources.map((entry) => entry.suggestion);

  assert.ok(suggestions.includes("Import a bank/card statement"));
  assert.ok(suggestions.includes("Run guided mandate capture"));
});

test("empty ledger produces an empty graph", () => {
  const graph = buildProofGraphSummary([], { today });
  assert.equal(graph.itemCount, 0);
  assert.equal(graph.totalMonthly, 0);
  assert.equal(graph.nextBestSources.length, 0);
});

test("never combines foreign commitments into primary-currency proof totals", () => {
  const audit = analyzeStatements([], [
    {
      id: "inr",
      merchant: "Indian plan",
      amount: 1000,
      currency: "INR",
      frequency: "monthly",
      nextExpectedDate: "2026-08-01",
      category: "Productivity",
      sourceName: "Manual INR evidence",
    },
    {
      id: "usd",
      merchant: "US plan",
      amount: 500,
      currency: "USD",
      frequency: "monthly",
      nextExpectedDate: "2026-08-01",
      category: "Productivity",
      sourceName: "Manual USD evidence",
    },
  ], { today });

  const graph = buildProofGraphSummary(audit.recurringItems, { today });
  assert.equal(graph.itemCount, 2, "coverage counts every commitment");
  assert.equal(graph.totalMonthly, 1000, "money totals remain INR-only");
  assert.equal(graph.singleSourceMonthly, 1000);
  assert.equal(graph.nextBestSources[0]?.monthlyAtStake, 1000);
});

test("confidence is derived from evidence structure and exposes every component", () => {
  const item = recurringItem({
    sourceNames: ["bank.csv", "Gmail receipts"],
    evidence: [
      { date: "2026-04-06", amount: 1999, description: "OPENAI", source: "bank.csv", rowNumber: 1 },
      { date: "2026-05-06", amount: 1999, description: "OPENAI", source: "bank.csv", rowNumber: 2 },
      { date: "2026-06-06", amount: 1999, description: "OPENAI", source: "Gmail receipts", rowNumber: 3 },
    ],
  });
  const explanation = explainProofConfidence(item, { today: new Date(2026, 5, 10) });
  assert.ok(explanation.score > 80 && explanation.score <= 99);
  assert.equal(explanation.proofDensity, 1);
  assert.equal(explanation.sourceDiversity, 0.82);
  assert.ok(explanation.freshness > 0.9);
  assert.ok(explanation.cadenceStability > 0.9);
  assert.equal(explanation.reasons.length, 4);
});

test("confidence fails honestly when no observed evidence exists", () => {
  const item = recurringItem({
    sourceNames: ["manual"],
    evidence: [{ date: "2026-07-06", amount: 1999, description: "expected", source: "manual", rowNumber: 1, kind: "scheduled" }],
  });
  const explanation = explainProofConfidence(item, { today: new Date(2026, 5, 10) });
  assert.equal(explanation.score, 0);
  assert.equal(explanation.proofDensity, 0);
  assert.equal(explanation.freshness, 0);
});
