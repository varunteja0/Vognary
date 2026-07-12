import assert from "node:assert/strict";
import test from "node:test";

import { aggregateInsightMinimumWorkspaces, normalizeAggregateInsight } from "../src/lib/aggregate-insights";

test("aggregate insights fail closed below the k-anonymous workspace threshold", () => {
  assert.equal(normalizeAggregateInsight({
    category: "Developer tools",
    currency: "INR",
    frequency: "monthly",
    workspaceCount: aggregateInsightMinimumWorkspaces - 1,
    commitmentCount: 40,
    medianMonthlyCost: 1000,
    averageMonthlyCost: 1200,
    asOfDate: "2026-07-11",
  }), null);
});

test("aggregate insight contract exposes only bounded category dimensions", () => {
  assert.deepEqual(normalizeAggregateInsight({
    category: "Developer tools",
    currency: "inr",
    frequency: "monthly",
    workspaceCount: 25,
    commitmentCount: 50,
    medianMonthlyCost: 999.999,
    averageMonthlyCost: 1200.125,
    asOfDate: "2026-07-11",
  }), {
    category: "Developer tools",
    currency: "INR",
    frequency: "monthly",
    workspaceCount: 25,
    commitmentCount: 50,
    medianMonthlyCost: 1000,
    averageMonthlyCost: 1200,
    asOfDate: "2026-07-11",
  });
});

test("aggregate insight publication bands counts and rounds non-INR costs", () => {
  assert.deepEqual(normalizeAggregateInsight({
    category: "Developer tools",
    currency: "USD",
    frequency: "monthly",
    workspaceCount: 29,
    commitmentCount: 57,
    medianMonthlyCost: 22.4,
    averageMonthlyCost: 23.8,
    asOfDate: "2026-07-11",
  }), {
    category: "Developer tools",
    currency: "USD",
    frequency: "monthly",
    workspaceCount: 25,
    commitmentCount: 50,
    medianMonthlyCost: 20,
    averageMonthlyCost: 25,
    asOfDate: "2026-07-11",
  });
});

test("published commitment bands never fall below their workspace band", () => {
  const result = normalizeAggregateInsight({
    category: "Productivity",
    currency: "INR",
    frequency: "monthly",
    workspaceCount: 25,
    commitmentCount: 25,
    medianMonthlyCost: 1000,
    averageMonthlyCost: 1000,
    asOfDate: "2026-07-11",
  });
  assert.equal(result?.workspaceCount, 25);
  assert.equal(result?.commitmentCount, 25);
});
