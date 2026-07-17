import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSavingsCardSvg } from "../src/lib/savings-card";
import { buildSavingsReceipt, buildSavingsShareText } from "../src/lib/savings-receipt";
import type { VerifiedSavingsSummary } from "../src/lib/verified-savings";

const generatedAt = new Date("2026-07-17T09:30:00.000Z");

function summary(overrides: Partial<VerifiedSavingsSummary> = {}): VerifiedSavingsSummary {
  return {
    entries: [
      {
        itemId: "netflix",
        merchant: "Netflix",
        category: "Streaming",
        currency: "INR",
        action: "cancel",
        decidedAt: "2026-05-01",
        monthlySaving: 649,
        annualSaving: 7788,
        cleanCycles: 2,
        requiredCleanCycles: 2,
        status: "verified",
        detail: "2 expected debits passed clean.",
      },
      {
        itemId: "notion",
        merchant: "Notion",
        category: "SaaS",
        currency: "INR",
        action: "downgrade",
        decidedAt: "2026-06-01",
        monthlySaving: 400,
        annualSaving: 4800,
        cleanCycles: 1,
        requiredCleanCycles: 2,
        status: "verifying",
        detail: "1 of 2 clean cycles.",
      },
    ],
    verifiedMonthly: 649,
    verifiedAnnual: 7788,
    pendingMonthly: 400,
    ...overrides,
  };
}

test("receipt contains only verified entries and their totals", () => {
  const receipt = buildSavingsReceipt(summary(), { generatedAt });
  assert.ok(receipt);
  assert.equal(receipt.kind, "vognary-savings-receipt");
  assert.equal(receipt.verifiedCount, 1);
  assert.equal(receipt.entries.length, 1);
  assert.equal(receipt.entries[0].merchant, "Netflix");
  assert.equal(receipt.verifiedAnnual, 7788);
  assert.equal(receipt.verifiedMonthly, 649);
  assert.equal(receipt.currency, "INR");
  assert.equal(receipt.generatedAt, generatedAt.toISOString());
});

test("no verified entries means no receipt", () => {
  const pendingOnly = summary();
  pendingOnly.entries = pendingOnly.entries.filter((entry) => entry.status !== "verified");
  assert.equal(buildSavingsReceipt(pendingOnly, { generatedAt }), null);
});

test("mixed currencies restrict the receipt to the dominant one", () => {
  const mixed = summary();
  mixed.entries.push({
    itemId: "vercel",
    merchant: "Vercel",
    category: "Cloud",
    currency: "USD",
    action: "cancel",
    decidedAt: "2026-04-01",
    monthlySaving: 20,
    annualSaving: 240,
    cleanCycles: 2,
    requiredCleanCycles: 2,
    status: "verified",
    detail: "2 expected debits passed clean.",
  });
  const receipt = buildSavingsReceipt(mixed, { generatedAt });
  assert.ok(receipt);
  assert.equal(receipt.currency, "INR");
  assert.equal(receipt.verifiedCount, 1);
  assert.ok(receipt.entries.every((entry) => entry.merchant !== "Vercel"));
});

test("redacted receipts replace merchants with categories", () => {
  const receipt = buildSavingsReceipt(summary(), { generatedAt, redactMerchants: true });
  assert.ok(receipt);
  assert.equal(receipt.entries[0].merchant, "Streaming");
});

test("share text states the verified amount and the verify URL", () => {
  const receipt = buildSavingsReceipt(summary(), { generatedAt });
  assert.ok(receipt);
  const text = buildSavingsShareText(receipt);
  assert.match(text, /7,788/);
  assert.match(text, /evidence of absence/);
  assert.match(text, /vognary\.com\/verify/);
  assert.doesNotMatch(text, /guaranteed/i);
});

test("share card SVG embeds the amount and escapes markup", () => {
  const receipt = buildSavingsReceipt(summary(), { generatedAt });
  assert.ok(receipt);
  const svg = buildSavingsCardSvg({ ...receipt, entries: [{ ...receipt.entries[0], merchant: "A<B & C" }] });
  assert.match(svg, /VERIFIED SAVINGS RECEIPT/);
  assert.match(svg, /7,788/);
  assert.match(svg, /A&lt;B &amp; C/);
  assert.doesNotMatch(svg, /A<B & C/);
  assert.match(svg, /vognary\.com\/verify/);
});
