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
  const { texts: extracted, skippedAttachments } = await extractForwardedReceiptTexts(forwardedBatch);
  assert.equal(extracted.some((item) => /OpenAI charged INR 1,999/.test(item.text)), true);
  assert.equal(extracted.some((item) => /Attached billing receipt/.test(item.text)), true);
  assert.equal(extracted.some((item) => /UEsDB|ignored\.zip/.test(item.text)), false);
  assert.ok(extracted.every((item) => item.clientRef.startsWith("forwarded-")));
  assert.deepEqual(skippedAttachments, ["application/zip"]);
});

test("HTML-only messages produce bounded deterministic text without scripts, images, or link targets", async () => {
  const { texts: extracted } = await extractForwardedReceiptTexts([
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

test("a PDF invoice attachment becomes receipt evidence text", async () => {
  const { texts: extracted, skippedAttachments } = await extractForwardedReceiptTexts(
    emailWithAttachment("application/pdf", "invoice.pdf", buildTextLayerPdf("OpenAI charged INR 1,999.00 on 6 July 2026 renews monthly on 6 August 2026")),
  );
  assert.equal(extracted.some((item) => /OpenAI charged INR 1,999\.00/.test(item.text)), true);
  assert.deepEqual(skippedAttachments, []);
});

test("an unreadable image-only attachment is reported instead of silently discarded", async () => {
  const { texts: extracted, skippedAttachments } = await extractForwardedReceiptTexts(
    emailWithAttachment("image/png", "receipt.png", Buffer.from("89504e470d0a1a0a0000000d49484452", "hex")),
  );
  assert.deepEqual(extracted, []);
  assert.deepEqual(skippedAttachments, ["image/png"]);
});

test("a scanned PDF with no text layer is reported rather than accepted as evidence", async () => {
  const { texts: extracted, skippedAttachments } = await extractForwardedReceiptTexts(
    emailWithAttachment("application/pdf", "scan.pdf", Buffer.from("%PDF-1.4\nnot a real pdf body\n%%EOF\n", "latin1")),
  );
  assert.deepEqual(extracted, []);
  assert.deepEqual(skippedAttachments, ["application/pdf"]);
});

test("oversized raw MIME fails before parsing", async () => {
  await assert.rejects(
    extractForwardedReceiptTexts("x".repeat(forwardedEmailMaxMimeBytes + 1)),
    /too large/i,
  );
});

function emailWithAttachment(mimeType: string, filename: string, body: Buffer) {
  return [
    "From: billing@example.test",
    "To: rcpt_example@receipts.vognary.test",
    "Subject: invoice",
    "MIME-Version: 1.0",
    "Content-Type: multipart/mixed; boundary=outer",
    "",
    "--outer",
    `Content-Type: ${mimeType}`,
    `Content-Disposition: attachment; filename=${filename}`,
    "Content-Transfer-Encoding: base64",
    "",
    body.toString("base64").replace(/(.{76})/g, "$1\r\n"),
    "--outer--",
    "",
  ].join("\r\n");
}

function buildTextLayerPdf(text: string) {
  const objects = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>",
    "",
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
  ];
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  objects[3] = `<</Length ${stream.length}>>stream\n${stream}\nendstream`;

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets[index] = pdf.length;
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += "xref\n0 6\n0000000000 65535 f \n";
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<</Size 6/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}