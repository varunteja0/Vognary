import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeReceiptLineProposals,
  proposalFromVisionExtraction,
  proposeReceiptLineFromReadableText,
  proposeReceiptLineFromVisibleText,
  sanitizeReceiptLineProposal,
} from "../src/lib/recovery/image-receipt-proposal";
import { POST } from "../src/app/api/receipt-image/propose/route";

const chatgptBillingText = [
  "ChatGPT Plus",
  "Your plan is cancelled and won't renew.",
  "You'll continue to have access to ChatGPT Plus until Aug 24, 2026.",
  "Transaction history",
  "ChatGPT Plus  7/24/2026  Paid  ₹0.00",
].join("\n");

test("readable receipt text prefills confirm-the-line without inventing a cadence", () => {
  const proposal = proposeReceiptLineFromReadableText("OpenAI invoice paid INR 1,999.00 on 2026-07-06.");
  assert.deepEqual(proposal, {
    merchant: "OpenAI",
    amount: "1999.00",
    currency: "INR",
    date: "2026-07-06",
  });
  assert.equal(proposeReceiptLineFromReadableText("a blurry photo of something"), null);
  assert.deepEqual(proposeReceiptLineFromReadableText("OpenAI subscription"), {
    merchant: "OpenAI",
    amount: "",
    currency: "",
    date: "",
  });
});

test("receipt-image propose stays fail-closed on an unreadable raster", async () => {
  const png = Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082",
    "hex",
  );
  const body = new FormData();
  body.append("file", new File([png], "blur.png", { type: "image/png" }));
  const response = await POST(new Request("https://vognary.example/api/receipt-image/propose", {
    method: "POST",
    headers: { "x-forwarded-for": `receipt-image-${Date.now()}` },
    body,
  }) as never);
  assert.equal(response.status, 200);
  const payload = await response.json() as { proposal: null; reason: string };
  assert.equal(payload.proposal, null);
  assert.equal(payload.reason, "unreadable");
});

test("receipt-image propose reads a mislabeled text receipt", async () => {
  const body = new FormData();
  body.append("file", new File(
    ["Cursor invoice paid USD 20.00 on 2026-08-28.\n"],
    "cursor.png",
    { type: "image/png" },
  ));
  const response = await POST(new Request("https://vognary.example/api/receipt-image/propose", {
    method: "POST",
    headers: { "x-forwarded-for": `receipt-image-text-${Date.now()}` },
    body,
  }) as never);
  assert.equal(response.status, 200);
  const payload = await response.json() as { proposal: { merchant: string; amount: string; currency: string; date: string } };
  assert.deepEqual(payload.proposal, {
    merchant: "Cursor",
    amount: "20.00",
    currency: "USD",
    date: "2026-08-28",
  });
});

test("receipt-image propose prefills a ChatGPT billing screenshot without inventing ₹1999", async () => {
  const body = new FormData();
  body.append("file", new File([`${chatgptBillingText}\n`], "chatgpt.png", { type: "image/png" }));
  const response = await POST(new Request("https://vognary.example/api/receipt-image/propose", {
    method: "POST",
    headers: { "x-forwarded-for": `receipt-image-chatgpt-${Date.now()}` },
    body,
  }) as never);
  assert.equal(response.status, 200);
  const payload = await response.json() as { proposal: { merchant: string; amount: string; currency: string; date: string; zeroPaidVisible?: boolean } };
  assert.equal(payload.proposal.merchant, "ChatGPT Plus");
  assert.equal(payload.proposal.currency, "INR");
  assert.equal(payload.proposal.date, "2026-07-24");
  assert.equal(payload.proposal.amount, "");
  assert.equal(payload.proposal.zeroPaidVisible, true);
});

test("a ChatGPT billing screenshot prefills merchant, currency, and paid date without inventing a plan price", () => {
  const proposal = proposeReceiptLineFromVisibleText(chatgptBillingText);
  assert.equal(proposal?.merchant, "ChatGPT Plus");
  assert.equal(proposal?.currency, "INR");
  assert.equal(proposal?.date, "2026-07-24");
  assert.equal(proposal?.amount, "");
  assert.equal(proposal?.zeroPaidVisible, true);
});

test("a printed paid amount on a screenshot is used instead of a zero paid line", () => {
  const proposal = proposeReceiptLineFromVisibleText(
    "Cursor Pro\nTransaction history\nCursor Pro  6 Aug 2026  Paid  $20.00\n",
  );
  assert.deepEqual(proposal, {
    merchant: "Cursor Pro",
    amount: "20.00",
    currency: "USD",
    date: "2026-08-06",
  });
});

test("access-until dates are not treated as the charge date", () => {
  const proposal = proposeReceiptLineFromVisibleText(
    "Claude Pro invoice paid INR 1,999.00 on 6 July 2026. Access until 24 Aug 2026.",
  );
  assert.equal(proposal?.merchant, "Claude Pro");
  assert.equal(proposal?.amount, "1999.00");
  assert.equal(proposal?.date, "2026-07-06");
});

test("ChatGPT Plus wins over a generic OpenAI brand on the same screenshot", () => {
  const proposal = proposeReceiptLineFromVisibleText(
    "OpenAI\nChatGPT Plus\nPaid ₹20.00 on 6 July 2026.",
  );
  assert.equal(proposal?.merchant, "ChatGPT Plus");
  assert.equal(proposal?.amount, "20.00");
});

test("a labelled amount still prefills when the charge date is missing", () => {
  const proposal = proposeReceiptLineFromReadableText("OpenAI ChatGPT Plus subscription. Amount: INR 1,999.00");
  assert.equal(proposal?.merchant, "ChatGPT Plus");
  assert.equal(proposal?.amount, "1999.00");
  assert.equal(proposal?.currency, "INR");
  assert.equal(proposal?.date, "");
});

test("sanitize keeps a partial API proposal instead of discarding it", () => {
  assert.deepEqual(
    sanitizeReceiptLineProposal({ merchant: "ChatGPT Plus", amount: "", currency: "INR", date: "2026-07-24" }),
    { merchant: "ChatGPT Plus", amount: "", currency: "INR", date: "2026-07-24" },
  );
  assert.equal(sanitizeReceiptLineProposal({ merchant: "", amount: "0.00", currency: "INR", date: "" }), null);
  assert.equal(sanitizeReceiptLineProposal(null), null);
});

test("vision fields are kept only when the transcript already shows them", () => {
  const cited = proposalFromVisionExtraction({
    visible_text: "Cursor Pro\nTransaction history\nCursor Pro  6 Aug 2026  Paid  $20.00\n",
    merchant: "Cursor Pro",
    amount: "20.00",
    currency: "USD",
    charge_date: "2026-08-06",
    paid_amount_is_zero: false,
  });
  assert.deepEqual(cited, {
    merchant: "Cursor Pro",
    amount: "20.00",
    currency: "USD",
    date: "2026-08-06",
  });

  const invented = proposalFromVisionExtraction({
    visible_text: chatgptBillingText,
    merchant: "ChatGPT Plus",
    amount: "1999.00",
    currency: "INR",
    charge_date: "2026-07-24",
    paid_amount_is_zero: false,
  });
  assert.equal(invented?.merchant, "ChatGPT Plus");
  assert.equal(invented?.date, "2026-07-24");
  assert.equal(invented?.amount, "");
  assert.equal(invented?.zeroPaidVisible, true);

  assert.equal(proposalFromVisionExtraction({
    visible_text: "",
    merchant: "ChatGPT Plus",
    amount: "1999.00",
    currency: "INR",
    charge_date: "2026-07-24",
    paid_amount_is_zero: false,
  }), null);

  const fromJson = proposalFromVisionExtraction(JSON.stringify({
    visible_text: chatgptBillingText,
    merchant: "ChatGPT Plus",
    amount: "1999.00",
    currency: "INR",
    charge_date: "2026-07-24",
    paid_amount_is_zero: false,
  }));
  assert.equal(fromJson?.amount, "");
  assert.equal(fromJson?.merchant, "ChatGPT Plus");
  assert.equal(fromJson?.date, "2026-07-24");
});

test("a paid 0 beats an OCR guess of the plan price", () => {
  const merged = mergeReceiptLineProposals(
    { merchant: "ChatGPT", amount: "1999", currency: "INR", date: "" },
    {
      merchant: "ChatGPT Plus",
      amount: "",
      currency: "INR",
      date: "2026-07-24",
      zeroPaidVisible: true,
    },
  );
  assert.equal(merged?.merchant, "ChatGPT Plus");
  assert.equal(merged?.amount, "");
  assert.equal(merged?.date, "2026-07-24");
  assert.equal(merged?.zeroPaidVisible, true);
});
