import assert from "node:assert/strict";
import test from "node:test";

import {
  extractForwardedReceiptTexts,
  forwardedEmailMaxMimeBytes,
} from "../src/lib/recovery/inbound-email";

const nestedReceipt = [
  "From: billing@example.test",
  "To: founder@example.test",
  "Subject: OpenAI invoice",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "OpenAI charged INR 1,999 on 6 July 2026. Renews monthly on 6 August 2026.",
].join("\r\n");

const forwardedBatch = [
  "From: founder@example.test",
  "To: rcpt_example@receipts.vognary.test",
  "Subject: receipts",
  "MIME-Version: 1.0",
  "Content-Type: multipart/mixed; boundary=outer",
  "",
  "--outer",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Attached billing receipt.",
  "--outer",
  "Content-Type: message/rfc822",
  "Content-Disposition: attachment; filename=openai.eml",
  "",
  nestedReceipt,
  "--outer",
  "Content-Type: application/zip",
  "Content-Disposition: attachment; filename=ignored.zip",
  "Content-Transfer-Encoding: base64",
  "",
  "UEsDBAoAAAAAA==",
  "--outer--",
  "",
].join("\r\n");

test("plain text and nested eml receipts are extracted without rendering other attachments", async () => {
  const extracted = await extractForwardedReceiptTexts(forwardedBatch);
  assert.equal(extracted.some((item) => /OpenAI charged INR 1,999/.test(item.text)), true);
  assert.equal(extracted.some((item) => /Attached billing receipt/.test(item.text)), true);
  assert.equal(extracted.some((item) => /UEsDB|ignored\.zip/.test(item.text)), false);
  assert.ok(extracted.every((item) => item.clientRef.startsWith("forwarded-")));
});

test("HTML-only messages produce bounded deterministic text without scripts, images, or link targets", async () => {
  const extracted = await extractForwardedReceiptTexts([
    "From: billing@example.test",
    "To: founder@example.test",
    "Content-Type: text/html; charset=utf-8",
    "",
    "<style>.hidden{display:none}</style><script>steal()</script><p>OpenAI charged <strong>INR 1,999</strong> on 6 July 2026. Renews monthly on 6 August 2026.</p><a href='https://tracker.example/secret'>Invoice</a><img src='https://tracker.example/pixel'>",
  ].join("\r\n"));
  assert.equal(extracted.length, 1);
  assert.match(extracted[0].text, /OpenAI charged INR 1,999/);
  assert.doesNotMatch(extracted[0].text, /steal|tracker\.example|pixel|display:none/);
});

test("oversized raw MIME fails before parsing", async () => {
  await assert.rejects(
    extractForwardedReceiptTexts("x".repeat(forwardedEmailMaxMimeBytes + 1)),
    /too large/i,
  );
});