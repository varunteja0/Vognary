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

test("start cards quote the most recent bill, not an average no receipt contains", () => {
  const cards = startCardsFromRecurringItems([
    {
      id: "openai",
      merchant: "OpenAI",
      category: "AI tools",
      currency: "INR",
      averageAmount: 2049,
      nextExpectedDate: "2026-09-06",
      evidence: [
        { description: "Invoice paid INR 1,999.00", amountDecimal: "1999.00", amount: 1999, date: "2026-07-06" },
        { description: "Invoice paid INR 2,099.00", amountDecimal: "2099.00", amount: 2099, date: "2026-08-06" },
      ],
    },
  ], "2026-08-22");
  const openai = cards.find((card) => card.id === "openai");
  assert.ok(openai);
  assert.equal(openai?.amountDisplay, "₹2,099.00");
  assert.equal(openai?.excerpt, "Invoice paid INR 2,099.00");
  assert.match(openai?.sentence ?? "", /OpenAI charges ₹2,099\.00/);
});

test("start cards pick the newest bill by date even when evidence is listed newest-first", () => {
  const cards = startCardsFromRecurringItems([
    {
      id: "zoho",
      merchant: "Zoho",
      category: "Productivity",
      currency: "INR",
      averageAmount: 2049,
      nextExpectedDate: "2026-09-06",
      evidence: [
        { description: "Invoice paid INR 2,099.00", amountDecimal: "2099.00", amount: 2099, date: "2026-08-06" },
        { description: "Invoice paid INR 1,999.00", amountDecimal: "1999.00", amount: 1999, date: "2026-07-06" },
      ],
    },
  ], "2026-08-22");
  const zoho = cards.find((card) => card.id === "zoho");
  assert.ok(zoho);
  assert.equal(zoho?.amountDisplay, "₹2,099.00");
});

test("start cards keep the effective amount when evidence carries no amounts", () => {
  const cards = startCardsFromRecurringItems([
    {
      id: "github",
      merchant: "GitHub",
      category: "Developer tools",
      currency: "INR",
      averageAmount: 400,
      amountDecimal: "400.00",
      nextExpectedDate: "2026-09-01",
      evidence: [{ description: "GitHub Team renews monthly." }],
    },
  ], "2026-08-22");
  const github = cards.find((card) => card.id === "github");
  assert.ok(github);
  assert.equal(github?.amountDisplay, "₹400.00");
});

test("a future cited evidence date is the start-card due date, not stored next plus one month", () => {
  const cards = startCardsFromRecurringItems([
    {
      id: "x-com",
      merchant: "X.com",
      category: "AI tools",
      currency: "INR",
      averageAmount: 427,
      amountDecimal: "427.00",
      nextExpectedDate: "2026-10-20",
      evidence: [{ description: "X.com next billing INR 427 on 2026-09-20.", amountDecimal: "427.00", date: "2026-09-20" }],
    },
  ], "2026-08-27");
  const card = cards.find((item) => item.id === "x-com");
  assert.ok(card);
  assert.equal(card?.dueDate, "2026-09-20");
  assert.doesNotMatch(card?.excerpt ?? "", /invoice paid/);
});

test("start-session replay matches Cursor Pro to Cursor and reports unmatched merchants", () => {
  const matched = matchStartDecision("Cursor", [{ merchant: "Cursor Pro", action: "PLAN_TO_CANCEL" }]);
  assert.equal(matched?.action, "PLAN_TO_CANCEL");
  const leftover = unmatchedStartDecisions(["OpenAI"], [{ merchant: "Cursor", action: "KEEP" }]);
  assert.deepEqual(leftover.map((item) => item.merchant), ["Cursor"]);
});
