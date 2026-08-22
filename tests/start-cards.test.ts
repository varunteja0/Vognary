import assert from "node:assert/strict";
import test from "node:test";

import { spokenChargeWhenLine } from "../src/lib/recovery/decision-cycle";
import { startCardsFromRecurringItems } from "../src/lib/recovery/start-cards";
import { matchStartDecision, unmatchedStartDecisions } from "../src/lib/recovery/start-session";
import { keepIsPrimary } from "../src/lib/recovery/wow-first-session";

test("start cards use the same spoken sentence and overlap rule as Home", () => {
  const cards = startCardsFromRecurringItems([
    {
      id: "cursor",
      merchant: "Cursor",
      category: "AI tools",
      currency: "USD",
      averageAmount: 20,
      amountDecimal: "20.00",
      nextExpectedDate: "2026-08-25",
      evidence: [{ description: "Cursor Pro · $20.00 · Aug 28." }],
    },
    {
      id: "claude",
      merchant: "Claude Max",
      category: "AI tools",
      currency: "INR",
      averageAmount: 24000,
      amountDecimal: "24000.00",
      nextExpectedDate: "2026-09-19",
      provisional: true,
      evidence: [{ description: "Claude Max · Paid ₹24,000 · 19 Aug." }],
    },
  ], "2026-08-22");

  const cursor = cards.find((card) => card.id === "cursor");
  assert.ok(cursor);
  assert.match(cursor?.sentence ?? "", /Cursor charges/);
  assert.match(cursor?.sentence ?? "", /You also pay Claude Max/);
  assert.equal(cursor?.excerpt, "Cursor Pro · $20.00 · Aug 28.");
  assert.equal(keepIsPrimary(cursor?.reasonKeys ?? []), false);
  assert.equal(spokenChargeWhenLine("2026-08-22", "2026-08-25"), "Charges in 3 days");
});

test("start-session replay matches Cursor Pro to Cursor and reports unmatched merchants", () => {
  const matched = matchStartDecision("Cursor", [{ merchant: "Cursor Pro", action: "PLAN_TO_CANCEL" }]);
  assert.equal(matched?.action, "PLAN_TO_CANCEL");
  const leftover = unmatchedStartDecisions(["OpenAI"], [{ merchant: "Cursor", action: "KEEP" }]);
  assert.deepEqual(leftover.map((item) => item.merchant), ["Cursor"]);
});
