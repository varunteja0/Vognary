import assert from "node:assert/strict";
import { test } from "node:test";
import { redactText } from "../src/lib/redaction";

test("masks account numbers keeping the last four digits", () => {
  const result = redactText("NEFT 001234567890 OPENAI CHATGPT");
  assert.match(result.text, /ACCT-XX7890/);
  assert.ok(!result.text.includes("001234567890"));
});

test("masks PAN, IFSC, phone, and UPI handles", () => {
  const result = redactText("PAN ABCDE1234F IFSC HDFC0001234 call 9876543210 pay someone@okhdfcbank");
  assert.match(result.text, /PAN-REDACTED/);
  assert.match(result.text, /IFSC-REDACTED/);
  assert.match(result.text, /PHONE-REDACTED/);
  assert.match(result.text, /HANDLE-REDACTED/);
  assert.equal(result.redactedCount, 4);
});

test("masks card-style separated digits with last four preserved", () => {
  const result = redactText("Card 4111 1111 1111 1234 charged");
  assert.match(result.text, /CARD-XX1234/);
});

test("preserves amounts, dates, and merchant names", () => {
  const input = "2026-07-06 OPENAI CHATGPT PLUS INR 1,999.00 renews monthly";
  const result = redactText(input);
  assert.equal(result.text, input, "nothing to redact — audit signals stay intact");
  assert.equal(result.redactedCount, 0);
});

test("masks Aadhaar-style numbers", () => {
  const result = redactText("Aadhaar 1234 5678 9012 on file");
  assert.match(result.text, /AADHAAR-REDACTED/);
});
