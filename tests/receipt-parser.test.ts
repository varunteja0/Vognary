import assert from "node:assert/strict";
import { test } from "node:test";
import { extractReceiptCandidates, receiptTextToManualInputs, splitReceiptSnippets } from "../src/lib/receipt-parser";

const sampleReceipts = [
  "OpenAI invoice paid INR 1,999 on 2026-07-06. ChatGPT Plus renews monthly.",
  "Cloudflare domain renewal notice INR 1,200 annual renewal due 2026-09-10. Auto-renew enabled.",
].join("\n\n");

test("splits pasted text into separate receipt snippets", () => {
  const snippets = splitReceiptSnippets(sampleReceipts);
  assert.equal(snippets.length, 2);
  assert.match(snippets[0], /OpenAI/);
  assert.match(snippets[1], /Cloudflare/);
});

test("extracts merchant, amount, and cadence from receipt snippets", () => {
  const candidates = extractReceiptCandidates(splitReceiptSnippets(sampleReceipts));
  assert.equal(candidates.length, 2);

  const openai = candidates.find((candidate) => candidate.merchant === "OpenAI");
  assert.ok(openai);
  assert.equal(openai?.amount, 1999);
  assert.equal(openai?.frequency, "monthly");

  const cloudflare = candidates.find((candidate) => /cloudflare/i.test(candidate.merchant));
  assert.ok(cloudflare);
  assert.equal(cloudflare?.frequency, "yearly");
  assert.equal(cloudflare?.nextExpectedDate, "2026-09-10");
});

test("converts pasted receipt text into ledger-ready manual inputs", () => {
  const inputs = receiptTextToManualInputs(sampleReceipts);
  assert.equal(inputs.length, 2);
  for (const input of inputs) {
    assert.ok(input.id.startsWith("receipt-paste-"));
    assert.equal(input.sourceName, "Pasted receipt snippet");
    assert.ok(input.amount > 0);
  }
});

test("returns nothing for text without receipt semantics", () => {
  assert.equal(receiptTextToManualInputs("hello world, no receipts here").length, 0);
  assert.equal(receiptTextToManualInputs("   ").length, 0);
});

test("parses RBI pre-debit notifications with mandate merchant and debit date", () => {
  const notice = "Pre-debit notification: your UPI AutoPay mandate towards GYM FITNESS PRO for INR 999 will be debited on 2026-08-01.";
  const candidates = extractReceiptCandidates([notice]);

  assert.equal(candidates.length, 1);
  const candidate = candidates[0];
  assert.match(candidate.merchant, /GYM FITNESS PRO/);
  assert.equal(candidate.amount, 999);
  assert.equal(candidate.nextExpectedDate, "2026-08-01");
  assert.equal(candidate.category, "Mandates");
  assert.ok(candidate.confidenceScore >= 78, "mandate notices are strong evidence");
});

test("pre-debit notices for known merchants keep their brand category", () => {
  const notice = "E-mandate alert: Netflix subscription of Rs. 649 will be debited on 15/08/2026 from your account.";
  const candidates = extractReceiptCandidates([notice]);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].merchant, "Netflix");
  assert.equal(candidates[0].category, "Streaming");
  assert.equal(candidates[0].nextExpectedDate, "2026-08-15");
});
