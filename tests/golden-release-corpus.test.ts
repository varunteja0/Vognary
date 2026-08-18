import assert from "node:assert/strict";
import { test } from "node:test";
import { extractObservedReceipt, extractReceiptCandidates } from "../src/lib/receipt-parser";
import {
  buildHomeProjection,
  decimalToMinorUnits,
  toMoneyDto,
  type CanonicalCommitmentRecord,
} from "../src/lib/recovery/domain";

/**
 * Golden release corpus for Commitment Intelligence financial truth.
 *
 * Each case names the exact expected parser/projection outcome. Fail-closed
 * cases must stay null. This is not a live-mail corpus; MIME/PDF retrieval is
 * proven separately by inbound PostgreSQL tests. Inputs here are sanitized
 * representative texts of those formats.
 */

type ParsedTruth = {
  merchant: string;
  amountDecimal: string;
  currency: string;
  observedDate: string | null;
  cadence: string | null;
  nextExpectedDate: string | null;
};

function parse(text: string): ParsedTruth | null {
  const observed = extractObservedReceipt(text);
  const recurring = extractReceiptCandidates([text])[0] ?? null;
  const value = observed ?? recurring;
  if (!value || !value.currency) return null;
  return {
    merchant: value.merchant,
    amountDecimal: value.amountDecimal,
    currency: value.currency,
    observedDate: value.observedDate,
    cadence: recurring?.frequency ?? null,
    nextExpectedDate: recurring?.nextExpectedDate ?? null,
  };
}

test("golden corpus: INR monthly SaaS", () => {
  assert.deepEqual(parse("OpenAI invoice paid INR 1,999.00 on 2026-07-06. ChatGPT Plus renews monthly."), {
    merchant: "OpenAI",
    amountDecimal: "1999.00",
    currency: "INR",
    observedDate: "2026-07-06",
    cadence: "monthly",
    nextExpectedDate: "2026-08-06",
  });
});

test("golden corpus: USD monthly SaaS", () => {
  assert.deepEqual(parse("Anthropic invoice paid USD 20.00 on 2026-07-04. Claude Pro renews monthly."), {
    merchant: "Anthropic",
    amountDecimal: "20.00",
    currency: "USD",
    observedDate: "2026-07-04",
    cadence: "monthly",
    nextExpectedDate: "2026-08-04",
  });
});

test("golden corpus: USD 13.30 keeps cents and does not invent FX", () => {
  const parsed = parse("Cursor invoice paid USD 13.30 on 2026-08-01. Cursor Pro renews monthly.");
  assert.deepEqual(parsed, {
    merchant: "Cursor",
    amountDecimal: "13.30",
    currency: "USD",
    observedDate: "2026-08-01",
    cadence: "monthly",
    nextExpectedDate: "2026-09-01",
  });
  const money = toMoneyDto(decimalToMinorUnits(parsed!.amountDecimal, parsed!.currency), parsed!.currency);
  assert.equal(money.minor, "1330");
  assert.equal(money.exponent, 2);
  assert.equal(money.display, "$13.30");
  assert.doesNotMatch(money.display, /₹|INR/);
});

test("golden corpus: bare $13.30 stays fail-closed without a proven currency", () => {
  assert.equal(parse("Cursor invoice paid $13.30 on 2026-08-01. Cursor Pro renews monthly."), null);
});

test("golden corpus: annual SaaS keeps yearly semantics", () => {
  const parsed = parse("Cloudflare domain renewal paid INR 1,200 on 2024-02-29. Renews yearly.");
  assert.equal(parsed?.merchant, "Cloudflare");
  assert.equal(parsed?.amountDecimal, "1200");
  assert.equal(parsed?.currency, "INR");
  assert.equal(parsed?.cadence, "yearly");
  assert.equal(parsed?.nextExpectedDate, "2025-02-28");
});

test("golden corpus: Indian grouping ₹1,25,000", () => {
  const parsed = parse("Merchant: LIC of India; Payment date: 15 July 2026; Annual policy premium. Amount: INR 1,25,000.00");
  assert.equal(parsed?.merchant, "LIC of India");
  assert.equal(parsed?.amountDecimal, "125000.00");
  assert.equal(parsed?.currency, "INR");
  assert.equal(toMoneyDto(decimalToMinorUnits("125000.00", "INR"), "INR").display, "₹1,25,000.00");
});

test("golden corpus: HTML receipt text", () => {
  assert.deepEqual(
    parse("From: Notion Labs; Transaction date: August 1, 2026, payment received; Notion monthly subscription. Total: USD 10.00"),
    {
      merchant: "Notion Labs",
      amountDecimal: "10.00",
      currency: "USD",
      observedDate: "2026-08-01",
      cadence: "monthly",
      nextExpectedDate: "2026-09-01",
    },
  );
});

test("golden corpus: PDF-like extracted receipt text", () => {
  const parsed = parse("Netflix\nYour payment of ₹649.00 was successful.\nPayment date: 17 June 2026\nNext billing date: 17 July 2026");
  assert.equal(parsed?.merchant, "Netflix");
  assert.equal(parsed?.amountDecimal, "649.00");
  assert.equal(parsed?.currency, "INR");
  assert.equal(parsed?.observedDate, "2026-06-17");
});

test("golden corpus: forwarded .eml-like nested receipt text", () => {
  const parsed = parse([
    "From: billing@stripe.com",
    "Subject: Receipt from Figma",
    "Date: 3 August 2026",
    "",
    "Figma invoice paid USD 15.00 on 2026-08-03. Figma Professional renews monthly.",
  ].join("\n"));
  assert.equal(parsed?.merchant, "Figma");
  assert.equal(parsed?.amountDecimal, "15.00");
  assert.equal(parsed?.currency, "USD");
  assert.equal(parsed?.observedDate, "2026-08-03");
});

test("golden corpus: unknown cadence is kept as an observation, not invented as monthly", () => {
  const snippet = "OpenAI ChatGPT Plus subscription\nAmount: INR 1,999.00\nCharged on 6 July 2026";
  assert.deepEqual(extractReceiptCandidates([snippet]), []);
  const observed = extractObservedReceipt(snippet);
  assert.equal(observed?.merchant, "OpenAI");
  assert.equal(observed?.amountDecimal, "1999.00");
  assert.equal(observed?.observedDate, "2026-07-06");
});

test("golden corpus: missing date is refused", () => {
  assert.equal(parse("OpenAI ChatGPT Plus subscription. Amount: INR 1,999.00"), null);
});

test("golden corpus: ambiguous merchant is refused", () => {
  assert.equal(parse("Invoice paid INR 499 on 2026-07-01. Renews monthly."), null);
});

test("golden corpus: conflicting labelled charged amounts are refused", () => {
  assert.equal(
    parse("From: Adobe; Payment date: 2 August 2026; Creative Cloud payment received. Charged: INR 3,500.00; Total: INR 4,130.00"),
    null,
  );
});

test("golden corpus: cancellation copy is not a completed charge", () => {
  assert.equal(parse("Your Netflix subscription has been cancelled. No further charges. Previous amount INR 649."), null);
});

test("golden corpus: failed payment is not a completed charge", () => {
  assert.equal(parse("Your OpenAI payment of INR 1,999 failed on 2026-07-06. Please update your card."), null);
  assert.equal(parse("OpenAI invoice. Card was declined for USD 20.00 on 2026-07-04."), null);
  assert.equal(parse("We could not process your payment of INR 1,999 for OpenAI on 2026-07-06."), null);
});

test("golden corpus: malformed receipt is refused", () => {
  assert.equal(parse("asdf qwer zxcv 12. not a receipt"), null);
});

test("golden corpus: headline totals isolate currencies and omit unresolved duplicates", () => {
  const now = new Date("2026-08-09T10:00:00.000Z");
  const inr: CanonicalCommitmentRecord = {
    id: "c-inr",
    version: 1,
    status: "ACTIVE",
    merchant: "OpenAI",
    category: "AI tools",
    cadence: "MONTHLY",
    currency: "INR",
    amountMinor: BigInt(199_900),
    monthlyEquivalentMinor: BigInt(199_900),
    nextExpectedDate: "2026-08-16",
    confidenceScore: 80,
    confidenceReasons: ["Two persisted observations support this commitment."],
    recommendedDecision: "MONITOR",
    recommendationReason: "Confirm the next renewal.",
    riskTags: [],
    decision: { value: "KEEP", decidedAt: now.toISOString(), updatedAt: now.toISOString() },
    evidenceIds: ["e-inr"],
    factCorrections: [],
    updatedAt: now.toISOString(),
  };
  const usd: CanonicalCommitmentRecord = {
    ...inr,
    id: "c-usd",
    merchant: "Cursor",
    currency: "USD",
    amountMinor: BigInt(1_330),
    monthlyEquivalentMinor: BigInt(1_330),
    evidenceIds: ["e-usd"],
  };
  const duplicate: CanonicalCommitmentRecord = {
    ...inr,
    id: "c-inr-copy",
    evidenceIds: ["e-inr-copy"],
  };

  const home = buildHomeProjection({
    workspace: { id: "workspace-1", name: "Founder workspace", role: "owner", version: 1 },
    generatedAt: now,
    commitments: [inr, usd, duplicate],
    sources: [],
    changed: { state: "NO_PRIOR_BASELINE", fromVersion: null, toVersion: 1, items: [] },
    duplicateState: { unresolvedCommitmentIds: [inr.id, duplicate.id] },
  });

  assert.deepEqual(home.monthlyTotals.map((total) => [total.amount.currency, total.amount.display, total.amount.minor]), [
    ["USD", "$13.30", "1330"],
  ]);
  assert.equal(home.monthlyTotals.length, 1);
  assert.doesNotMatch(home.monthlyTotals.map((total) => total.amount.display).join(" "), /₹|1,999/);
  assert.equal(home.uncertainDuplicateCommitmentCount, 2);
  assert.ok(home.coverage.limitations[0]?.includes("listed twice"));
});

test("golden corpus: a saved amount correction marks totals without rewriting source evidence", () => {
  const now = new Date("2026-08-09T10:00:00.000Z");
  const home = buildHomeProjection({
    workspace: { id: "workspace-1", name: "Founder workspace", role: "owner", version: 2 },
    generatedAt: now,
    commitments: [{
      id: "c-inr",
      version: 2,
      status: "ACTIVE",
      merchant: "OpenAI",
      category: "AI tools",
      cadence: "MONTHLY",
      currency: "INR",
      amountMinor: BigInt(209_900),
      monthlyEquivalentMinor: BigInt(209_900),
      nextExpectedDate: "2026-08-16",
      confidenceScore: 80,
      confidenceReasons: ["A saved correction is the current amount."],
      recommendedDecision: "MONITOR",
      recommendationReason: "Confirm the next renewal.",
      riskTags: [],
      decision: { value: "KEEP", decidedAt: now.toISOString(), updatedAt: now.toISOString() },
      evidenceIds: ["e-inr"],
      factCorrections: [{ id: "corr-1", field: "AMOUNT", status: "ACTIVE" }],
      updatedAt: now.toISOString(),
    }],
    sources: [],
    changed: { state: "NO_PRIOR_BASELINE", fromVersion: null, toVersion: 2, items: [] },
  });
  assert.equal(home.monthlyTotals[0]?.provenance, "USER_CORRECTED");
  assert.equal(home.monthlyTotals[0]?.amount.display, "₹2,099.00");
  assert.deepEqual(home.monthlyTotals[0]?.correctionIds, ["corr-1"]);
});
