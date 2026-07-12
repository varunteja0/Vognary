import assert from "node:assert/strict";
import test from "node:test";

import {
  isCommitmentDecisionAllowed,
  normalizeCommitmentDecisionAction,
  resolveCommitmentDecisionIdentityKey,
} from "../src/lib/commitment-decisions";
import { analyzeStatements } from "../src/lib/recurring-audit";

test("commitment decisions accept only the five review actions", () => {
  assert.equal(normalizeCommitmentDecisionAction("watch"), "watch");
  assert.throws(() => normalizeCommitmentDecisionAction("delete-resource"), /not allowlisted/);
});

test("server decision policy refuses cancellation of protected commitments", () => {
  assert.equal(isCommitmentDecisionAllowed("Streaming", "cancel"), true);
  assert.equal(isCommitmentDecisionAllowed("Insurance", "cancel"), false);
  assert.equal(isCommitmentDecisionAllowed("Investments", "downgrade"), false);
  assert.equal(isCommitmentDecisionAllowed("Debt", "watch"), true);
});

test("persisted decisions remain bound to canonical UUIDs when same-merchant items reorder", () => {
  const monthlyId = "123e4567-e89b-42d3-a456-426614174010";
  const yearlyId = "123e4567-e89b-42d3-a456-426614174011";
  const items = analyzeStatements([], [
    {
      id: `synced-${monthlyId}`,
      canonicalRecurringItemId: monthlyId,
      merchant: "OpenAI",
      amount: 2000,
      currency: "INR",
      frequency: "monthly",
      nextExpectedDate: "2026-08-11",
      category: "AI tools",
    },
    {
      id: `synced-${yearlyId}`,
      canonicalRecurringItemId: yearlyId,
      merchant: "OpenAI",
      amount: 24000,
      currency: "INR",
      frequency: "yearly",
      nextExpectedDate: "2027-07-11",
      category: "AI tools",
    },
  ], { today: new Date("2026-07-11T00:00:00.000Z") }).recurringItems.reverse();

  const monthlyKey = resolveCommitmentDecisionIdentityKey(items, {
    recurringItemId: monthlyId,
    normalizedMerchant: "OpenAI",
    currency: "INR",
  });
  const yearlyKey = resolveCommitmentDecisionIdentityKey(items, {
    recurringItemId: yearlyId,
    normalizedMerchant: "OpenAI",
    currency: "INR",
  });

  assert.ok(monthlyKey);
  assert.ok(yearlyKey);
  assert.notEqual(monthlyKey, yearlyKey);
  assert.equal(items.find((item) => item.identityKey === monthlyKey)?.canonicalRecurringItemId, monthlyId);
  assert.equal(items.find((item) => item.identityKey === yearlyKey)?.canonicalRecurringItemId, yearlyId);
  assert.equal(resolveCommitmentDecisionIdentityKey(items, {
    recurringItemId: "123e4567-e89b-42d3-a456-426614174099",
    normalizedMerchant: "OpenAI",
    currency: "INR",
  }), null, "ambiguous legacy matches must fail closed");
});
