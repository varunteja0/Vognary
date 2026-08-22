import assert from "node:assert/strict";
import test from "node:test";

import {
  confirmedReceiptText,
  decisionArtefactText,
  decisionHookCopy,
  isReceiptImageFile,
  keepIsPrimary,
  paymentAskQuestion,
  receiptQuote,
  reminderOffer,
  shouldOfferPaymentAsk,
  spokenDecisionSentence,
} from "../src/lib/recovery/wow-first-session";
import { parseStartSessionRecord, matchStartDecision, buildStartSessionRecord } from "../src/lib/recovery/start-session";

test("spoken sentence quotes overlap and refuses to invent a date", () => {
  assert.equal(
    spokenDecisionSentence({
      merchant: "Cursor",
      amountDisplay: "$20.00",
      whenLine: "Charges Thursday",
      overlapMerchants: ["Claude Max"],
      provisional: false,
      undecided: true,
    }),
    "Cursor charges $20.00. Charges Thursday. You also pay Claude Max. You have not decided this cycle.",
  );
  assert.equal(receiptQuote("  Cursor Pro · $20.00 · Aug 28.  "), "Cursor Pro · $20.00 · Aug 28.");
});

test("Keep is not the gold action when the cited reason is overlap, price, or a single sighting", () => {
  assert.equal(keepIsPrimary(["RENEWS_SOON"]), true);
  assert.equal(keepIsPrimary(["OVERLAP_NO_PURPOSE"]), false);
  assert.equal(keepIsPrimary(["PRICE_INCREASE", "RENEWS_SOON"]), false);
  assert.equal(keepIsPrimary(["PROVISIONAL_SINGLE"]), false);
});

test("the post-decision hook names the next window without claiming cancellation", () => {
  const hook = decisionHookCopy({ merchant: "Cursor", action: "PLAN_TO_CANCEL", watchDate: "28 Sep 2026" });
  assert.match(hook.title, /plan to cancel is recorded/);
  assert.match(hook.body, /around 28 Sep 2026/);
  assert.match(hook.body, /We never cancel it for you/);
  assert.doesNotMatch(hook.body, /\bcancelled\b/i);
});

test("the artefact is a forwardable card, not a dashboard export", () => {
  const artefact = decisionArtefactText({
    merchant: "Cursor",
    amountDisplay: "$20.00",
    whenLine: "Charges Thursday",
    action: "PLAN_TO_CANCEL",
    excerpt: "Cursor Pro · $20.00 · Aug 28.",
  });
  assert.match(artefact, /Cursor · \$20\.00/);
  assert.match(artefact, /plan to cancel this cycle/);
  assert.match(artefact, /From the receipt: Cursor Pro/);
  assert.match(artefact, /vognary\.com/);
});

test("confirm-the-line never invents a cadence and rejects blank money", () => {
  assert.equal(
    confirmedReceiptText({ merchant: "Claude Max", amount: "24000", currency: "inr", date: "2026-08-19" }),
    "Claude Max invoice paid INR 24000 on 2026-08-19.",
  );
  assert.equal(confirmedReceiptText({ merchant: "Claude", amount: "", currency: "INR", date: "2026-08-19" }), null);
  assert.equal(isReceiptImageFile({ name: "gmail.jpeg", type: "image/jpeg" }), true);
  assert.equal(isReceiptImageFile({ name: "invoice.pdf", type: "application/pdf" }), false);
});

test("the pay ask waits for two remembered decisions or one verified outcome", () => {
  assert.equal(shouldOfferPaymentAsk(1, 0), false);
  assert.equal(shouldOfferPaymentAsk(2, 0), true);
  assert.equal(shouldOfferPaymentAsk(0, 1), true);
  assert.match(paymentAskQuestion, /would you pay/);
  assert.match(reminderOffer, /Email me before this charge/);
});

test("start-session records replay by merchant and refuse unknown actions", () => {
  const record = buildStartSessionRecord({
    decisions: [{ merchant: "Cursor", action: "PLAN_TO_CANCEL" }],
    reminderRequested: true,
  });
  const parsed = parseStartSessionRecord(JSON.stringify(record));
  assert.equal(parsed?.reminderRequested, true);
  assert.equal(matchStartDecision("cursor", parsed?.decisions ?? [])?.action, "PLAN_TO_CANCEL");
  assert.equal(parseStartSessionRecord(JSON.stringify({ ...record, decisions: [{ merchant: "Cursor", action: "CANCEL_NOW" }] })), null);
});
