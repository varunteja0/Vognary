import assert from "node:assert/strict";
import { test } from "node:test";
import {
  analyzeStatements,
  getFrequencyGapDays,
  getFrequencyMonthlyMultiplier,
  primaryCurrency,
  type EvidenceLink,
  type Frequency,
  type RecurringItem,
} from "../src/lib/recurring-audit";
import { projectCashflow } from "../src/lib/twin/project";
import { computeRunway } from "../src/lib/twin/runway";
import { simulateScenario } from "../src/lib/twin/whatif";

const today = new Date(2026, 6, 21); // 2026-07-21

// A minimal, type-complete RecurringItem so the Twin can be unit-tested in
// isolation from the parser. The Twin only reads identityKey, merchant,
// category, currency, frequency, averageGapDays, averageAmount, monthlyCost,
// annualCost, and nextExpectedDate — but we fill every field so the fixture is
// a real RecurringItem, not a lie the compiler would catch.
function makeItem(
  overrides: Partial<RecurringItem> & {
    merchant: string;
    averageAmount: number;
    frequency: Frequency;
    nextExpectedDate: string;
  },
): RecurringItem {
  const { merchant, averageAmount, frequency, nextExpectedDate } = overrides;
  const currency = overrides.currency ?? primaryCurrency;
  const identityKey = overrides.identityKey ?? `${merchant.toLowerCase()}|${currency}`;
  const monthlyCost = averageAmount * getFrequencyMonthlyMultiplier(frequency);
  const evidence: EvidenceLink[] = overrides.evidence ?? [
    { date: "2026-06-21", amount: averageAmount, description: merchant, source: "test.csv", rowNumber: 1, kind: "observed-charge" },
  ];
  return {
    id: identityKey,
    identityKey,
    merchant,
    normalizedMerchant: merchant.toLowerCase(),
    category: overrides.category ?? "Software",
    currency,
    frequency,
    averageGapDays: overrides.averageGapDays ?? getFrequencyGapDays(frequency),
    amountMin: averageAmount,
    amountMax: averageAmount,
    averageAmount,
    monthlyCost,
    annualCost: monthlyCost * 12,
    lastChargeDate: "2026-06-21",
    nextExpectedDate,
    confidenceScore: overrides.confidenceScore ?? 95,
    recommendationType: overrides.recommendationType ?? "keep",
    recommendationReason: "",
    riskTags: [],
    evidence,
    sourceNames: ["test.csv"],
    missedCycles: 0,
    priceChange: null,
  };
}

function dayOfMonth(iso: string): number {
  return new Date(`${iso}T00:00:00`).getDate();
}

test("projects each commitment forward across a 12-month horizon, anchored to its charge day", () => {
  const items = [
    makeItem({ merchant: "Netflix", averageAmount: 649, frequency: "monthly", nextExpectedDate: "2026-08-06" }),
    makeItem({ merchant: "Gym", averageAmount: 500, frequency: "weekly", nextExpectedDate: "2026-07-27" }),
  ];
  const projection = projectCashflow(items, { today, horizonDays: 365 });

  const netflix = projection.debits.filter((d) => d.merchant === "Netflix");
  const gym = projection.debits.filter((d) => d.merchant === "Gym");
  assert.ok(netflix.length >= 11 && netflix.length <= 13, `monthly ≈ 12 occurrences, got ${netflix.length}`);
  assert.ok(gym.length >= 48, `weekly ≈ 52 occurrences, got ${gym.length}`);

  for (const debit of netflix) assert.equal(dayOfMonth(debit.date), 6, "monthly cadence stays on the charge day");

  const inputIds = new Set(items.map((item) => item.identityKey));
  let previousDaysAway = -1;
  for (const debit of projection.debits) {
    assert.ok(debit.daysAway >= 0 && debit.daysAway <= 365, "no past debits; nothing beyond the horizon");
    assert.ok(debit.daysAway >= previousDaysAway, "debits are sorted by daysAway");
    previousDaysAway = debit.daysAway;
    assert.ok(inputIds.has(debit.itemId), "every projected debit cites a real commitment (citation propagation)");
  }
});

test("lists foreign debits but never sums them into the rupee total", () => {
  const items = [
    makeItem({ merchant: "Netflix", averageAmount: 649, frequency: "monthly", nextExpectedDate: "2026-08-06" }),
    makeItem({ merchant: "AWS", averageAmount: 20, frequency: "monthly", nextExpectedDate: "2026-08-01", currency: "USD" }),
  ];
  const projection = projectCashflow(items, { today, horizonDays: 90 });

  const rupeeOnly = projection.debits
    .filter((debit) => debit.currency === primaryCurrency)
    .reduce((sum, debit) => sum + debit.amount, 0);
  assert.ok(Math.abs(projection.totalProjectedOutflow - rupeeOnly) < 0.01, "rupee total excludes foreign debits");
  assert.ok(projection.foreignTotals.USD > 0, "foreign debits are listed under their own currency");
  assert.ok(Math.abs(projection.monthlyOutflow - 649) < 1, "monthly burn is primary-currency only");
});

test("runway ends when committed debits drain the opening balance", () => {
  const items = [makeItem({ merchant: "Rent", averageAmount: 10000, frequency: "monthly", nextExpectedDate: "2026-08-01", category: "Housing" })];
  const projection = projectCashflow(items, { today, horizonDays: 365 });
  const runway = computeRunway(projection, { openingBalance: 25000, monthlyIncome: 0, today });

  assert.notEqual(runway.runwayDays, null);
  assert.equal(runway.firstNegativeDate, "2026-10-01", "25000 covers Aug + Sep; Oct 1 goes negative");
  assert.ok(runway.runwayMonths !== null && runway.runwayMonths >= 2 && runway.runwayMonths <= 3);
  assert.ok(runway.lowestBalance < 0, "the lowest balance is the overshoot past zero");
});

test("sufficient income keeps the balance positive → runway is null (beyond horizon)", () => {
  const items = [makeItem({ merchant: "Rent", averageAmount: 10000, frequency: "monthly", nextExpectedDate: "2026-08-01", category: "Housing" })];
  const projection = projectCashflow(items, { today, horizonDays: 365 });
  const runway = computeRunway(projection, { openingBalance: 25000, monthlyIncome: 15000, incomeDayOfMonth: 1, today });

  assert.equal(runway.runwayDays, null);
  assert.equal(runway.firstNegativeDate, null);
  assert.ok(runway.endingBalance > 0);
});

test("a negative opening balance reports zero runway today", () => {
  const items = [makeItem({ merchant: "Rent", averageAmount: 10000, frequency: "monthly", nextExpectedDate: "2026-08-01" })];
  const projection = projectCashflow(items, { today, horizonDays: 365 });
  const runway = computeRunway(projection, { openingBalance: -100, today });

  assert.equal(runway.runwayDays, 0);
  assert.equal(runway.firstNegativeDate, projection.today);
});

test("cancelling a commitment lowers monthly outflow and extends runway", () => {
  const items = [
    makeItem({ merchant: "Rent", averageAmount: 7000, frequency: "monthly", nextExpectedDate: "2026-08-01", identityKey: "rent|INR" }),
    makeItem({ merchant: "Cursor", averageAmount: 5000, frequency: "monthly", nextExpectedDate: "2026-08-03", identityKey: "cursor|INR" }),
  ];
  const diff = simulateScenario(
    items,
    [{ type: "cancel", itemId: "cursor|INR" }],
    { openingBalance: 15000, monthlyIncome: 0, today },
    { today, horizonDays: 365 },
  );

  assert.ok(diff.monthlyOutflowChange < 0, "cancelling saves money");
  assert.ok(Math.abs(diff.monthlyOutflowChange + 5000) < 1, "saves ₹5000/mo");
  assert.deepEqual(diff.affectedItemIds, ["cursor|INR"]);
  assert.ok(diff.runwayDaysGained > 0, "runway extends when a commitment is cancelled");
});

test("downgrade, a one-time purchase, and an income change each move the runway correctly", () => {
  const items = [makeItem({ merchant: "Rent", averageAmount: 10000, frequency: "monthly", nextExpectedDate: "2026-08-01", identityKey: "rent|INR" })];

  const down = simulateScenario(items, [{ type: "downgrade", itemId: "rent|INR", newAmount: 6000 }], { openingBalance: 25000, today }, { today, horizonDays: 365 });
  assert.ok(Math.abs(down.monthlyOutflowChange + 4000) < 1, "10000→6000 saves ₹4000/mo");
  assert.deepEqual(down.affectedItemIds, ["rent|INR"]);

  const base = simulateScenario(items, [], { openingBalance: 250000, monthlyIncome: 0, today }, { today, horizonDays: 365 });
  const onetime = simulateScenario(items, [{ type: "add-onetime", at: "2026-08-15", amount: 200000, label: "MacBook" }], { openingBalance: 250000, monthlyIncome: 0, today }, { today, horizonDays: 365 });
  assert.ok((onetime.runwayDaysAfter ?? Number.POSITIVE_INFINITY) < (base.runwayDaysAfter ?? Number.POSITIVE_INFINITY), "a big one-time purchase shortens runway");

  const income = simulateScenario(items, [{ type: "adjust-income", monthlyIncome: 12000 }], { openingBalance: 25000, monthlyIncome: 0, today }, { today, horizonDays: 365 });
  assert.ok((income.runwayDaysGained ?? 0) > 0, "adding income extends runway");
});

test("composes with real analyzeStatements output and keeps citation anchors resolvable", () => {
  const audit = analyzeStatements(
    [{
      name: "statement.csv",
      text: [
        "Date,Description,Debit,Credit",
        "2026-05-06,OPENAI CHATGPT PLUS,1999,",
        "2026-06-06,OPENAI CHATGPT PLUS,1999,",
        "2026-07-06,OPENAI CHATGPT PLUS,1999,",
      ].join("\n"),
    }],
    [],
    { today },
  );
  const projection = projectCashflow(audit.recurringItems, { today, horizonDays: 365 });
  assert.ok(projection.debits.length >= 11, "a monthly item yields ~12 debits over a year");

  const ids = new Set(audit.recurringItems.map((item) => item.identityKey));
  for (const debit of projection.debits) assert.ok(ids.has(debit.itemId), "projected debits trace back to audited commitments");

  const runway = computeRunway(projection, { openingBalance: 5000, monthlyIncome: 0, today });
  assert.ok(runway.runwayDays !== null && runway.runwayDays > 0, "a small balance against a real commitment has a finite runway");
});
