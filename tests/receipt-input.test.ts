import assert from "node:assert/strict";
import test from "node:test";

import { splitReceiptTexts } from "../src/lib/recovery/receipt-input";

test("two complete one-line receipts become two receipts", () => {
  const texts = splitReceiptTexts(
    "Cursor Pro paid INR 1350.00 on 28 July 2026.\nCursor Pro paid INR 1700.00 on 20 August 2026.",
  );
  assert.equal(texts.length, 2);
  assert.match(texts[0], /1350/);
  assert.match(texts[1], /1700/);
});

test("a single receipt spread over several lines is never torn apart", () => {
  const raw = [
    "Cursor",
    "Invoice paid USD 20.00",
    "Payment date: 28 August 2026",
    "Cursor Pro renews monthly on 28 September 2026.",
  ].join("\n");
  const texts = splitReceiptTexts(raw);
  assert.equal(texts.length, 1);
  assert.equal(texts[0], raw);
});

test("a blank line always separates bills", () => {
  const texts = splitReceiptTexts(
    "Cursor\nInvoice paid USD 20.00 on 28 August 2026\n\nNotion\nInvoice paid INR 830.00 on 1 August 2026",
  );
  assert.equal(texts.length, 2);
  assert.match(texts[0], /Cursor/);
  assert.match(texts[1], /Notion/);
});

test("blank input yields nothing and the request stays empty", () => {
  assert.deepEqual(splitReceiptTexts("   \n  \n"), []);
});

test("segmentation is capped so one paste cannot exceed the audit limit", () => {
  const line = "Acme paid INR 100.00 on 1 August 2026.";
  const texts = splitReceiptTexts(Array.from({ length: 40 }, () => line).join("\n"));
  assert.equal(texts.length, 20);
});
