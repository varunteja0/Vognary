import assert from "node:assert/strict";
import test from "node:test";
import { extractForwardedReceiptTexts } from "@/lib/recovery/inbound-email";

const verificationEmail = [
  "From: Gmail Team <forwarding-noreply@google.com>",
  "To: r.7f3a9c2e@inbox.vognary.com",
  "Subject: (#123456789) Gmail Forwarding Confirmation - Receive Mail from founder@example.com",
  "Content-Type: text/plain; charset=UTF-8",
  "",
  "founder@example.com has requested to automatically forward mail to your email address r.7f3a9c2e@inbox.vognary.com.",
  "",
  "Confirmation code: 123456789",
  "",
  "To allow founder@example.com to automatically forward mail to your address, please click the link below to confirm the request:",
  "",
  "https://mail-settings.google.com/mail/vf-%5BANGjdJ_example_token%5D-vSHnhaQxsA",
  "",
  "Thanks for using Gmail!",
].join("\r\n");

const realReceipt = [
  "From: OpenAI <billing@openai.com>",
  "To: r.7f3a9c2e@inbox.vognary.com",
  "Subject: Your receipt from OpenAI",
  "Content-Type: text/plain; charset=UTF-8",
  "",
  "Invoice paid INR 1,999.00",
  "Payment date: 6 July 2026",
  "ChatGPT Plus renews monthly on 6 August 2026.",
].join("\r\n");

test("a Gmail forwarding verification email is recognized and never treated as receipt evidence", async () => {
  const extraction = await extractForwardedReceiptTexts(verificationEmail);

  assert.ok(extraction.gmailVerification, "the verification challenge must be detected");
  assert.equal(extraction.gmailVerification?.code, "123456789");
  assert.match(
    extraction.gmailVerification?.verificationUrl ?? "",
    /^https:\/\/mail-settings\.google\.com\/mail\//,
  );
  assert.deepEqual(extraction.texts, [], "Google's challenge must not become receipt evidence");
});

test("a URL-only Google confirmation with wrapped lines is still a confirmation, not a receipt", async () => {
  const address = "rcpt_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@inbox.vognary.com";
  const mime = [
    "From: Gmail Team <forwarding-noreply@google.com>",
    `To: ${address}`,
    "Subject: (Gmail Forwarding Confirmation - Receive Mail from founder@example.com",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    "founder@example.com has requested to automatically forward mail",
    "to your email",
    `address ${address}.`,
    "",
    "To allow founder@example.com to automatically forward mail to",
    "your address,",
    "please click the link below to confirm the request:",
    "",
    "https://mail-settings.google.com/mail/vf-%5BANGjdJ_example_token%5D-vSHnhaQxsA",
    "",
    "If you click the link and it appears to be broken, please copy and paste it",
    "into a new browser window.",
    "",
    "Thanks for using Gmail!",
  ].join("\r\n");

  const extraction = await extractForwardedReceiptTexts(mime);

  assert.equal(extraction.gmailVerification?.code, null);
  assert.match(
    extraction.gmailVerification?.verificationUrl ?? "",
    /^https:\/\/mail-settings\.google\.com\/mail\/vf-/,
  );
  assert.deepEqual(extraction.texts, []);
});

test("an ordinary forwarded receipt is not mistaken for a verification challenge", async () => {
  const extraction = await extractForwardedReceiptTexts(realReceipt);

  assert.equal(extraction.gmailVerification, null);
  assert.equal(extraction.texts.length, 1);
  assert.match(extraction.texts[0]?.text ?? "", /1,999\.00/);
});

test("a lookalike sender cannot spoof the verification challenge", async () => {
  const spoofed = verificationEmail.replace(
    "forwarding-noreply@google.com",
    "forwarding-noreply@google.com.attacker.example",
  );

  const extraction = await extractForwardedReceiptTexts(spoofed);

  assert.equal(extraction.gmailVerification, null, "only google.com may raise a verification challenge");
});
