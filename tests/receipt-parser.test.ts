import assert from "node:assert/strict";
import { test } from "node:test";
import { extractObservedReceipt, extractReceiptCandidates, inferReceiptCurrencyHint, receiptTextToManualInputs, splitReceiptSnippets } from "../src/lib/receipt-parser";

const sampleReceipts = [
  "OpenAI invoice paid INR 1,999 on 2026-07-06. ChatGPT Plus renews monthly.",
  "Cloudflare domain renewal notice INR 1,200 annual renewal due 2026-09-10. Auto-renew enabled.",
].join("\n\n");

test("a receipt that states no cadence is still kept as one observed charge", () => {
  const snippet = "OpenAI ChatGPT Plus subscription\nAmount: INR 1,999.00\nCharged on 6 July 2026";

  assert.deepEqual(extractReceiptCandidates([snippet]), []);

  const observed = extractObservedReceipt(snippet);
  assert.ok(observed, "a merchant, amount, and charge date is enough to record an observation");
  assert.equal(observed.merchant, "OpenAI");
  assert.equal(observed.amountDecimal, "1999.00");
  assert.equal(observed.currency, "INR");
  assert.equal(observed.observedDate, "2026-07-06");
});

test("keeps one visually spaced receipt together for bounded observation", () => {
  const receipt = [
    "OpenAI",
    "ChatGPT Plus subscription",
    "Amount: INR 1,999.00",
    "Charged on 6 July 2026",
  ].join("\n\n");

  const snippets = splitReceiptSnippets(receipt);
  assert.equal(snippets.length, 1);
  assert.equal(extractObservedReceipt(snippets[0])?.merchant, "OpenAI");
});

test("an observed receipt still needs a merchant, an amount, and a real charge date", () => {
  assert.equal(extractObservedReceipt("OpenAI ChatGPT Plus subscription. Amount: INR 1,999.00"), null);
  assert.equal(extractObservedReceipt("Amount: INR 1,999.00 charged on 6 July 2026"), null);
  assert.equal(extractObservedReceipt("OpenAI ChatGPT Plus renews on 6 August 2026"), null);
});

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
  assert.equal(openai?.observedDate, "2026-07-06");
  assert.equal(openai?.nextExpectedDate, "2026-08-06");

  const cloudflare = candidates.find((candidate) => /cloudflare/i.test(candidate.merchant));
  assert.ok(cloudflare);
  assert.equal(cloudflare?.observedDate, null);
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

test("does not silently guess an explicit ambiguous receipt date", () => {
  const notice = "Netflix subscription of Rs. 649 will be debited on 08/09/2026.";

  assert.deepEqual(extractReceiptCandidates([notice]), []);
});

test("rejects an impossible explicit receipt date instead of rolling it over", () => {
  const notice = "Netflix subscription of Rs. 649 will be debited on 31/02/2026.";

  assert.deepEqual(extractReceiptCandidates([notice]), []);
});

test("derives renewal from the explicit charge date with month-end clamping", () => {
  const candidates = extractReceiptCandidates([
    "Netflix subscription charged INR 649 on 2026-01-31. Renews monthly.",
    "Cloudflare domain renewal paid INR 1,200 on 2024-02-29. Renews yearly.",
  ]);

  assert.equal(candidates[0]?.nextExpectedDate, "2026-02-28");
  assert.equal(candidates[1]?.nextExpectedDate, "2025-02-28");
});

test("preserves explicit receipt cadence and future pre-debit dates", () => {
  const candidates = extractReceiptCandidates([
    "Acme Fitness membership charged INR 500 on 2026-07-06. Renews weekly.",
    "Netflix subscription will be debited for INR 649 on 2026-08-15.",
  ]);

  assert.equal(candidates[0]?.frequency, "weekly");
  assert.equal(candidates[0]?.nextExpectedDate, "2026-07-13");
  assert.equal(candidates[1]?.nextExpectedDate, "2026-08-15");
});

test("does not fabricate an exact renewal date when no usable date is present", () => {
  assert.deepEqual(extractReceiptCandidates(["Netflix subscription INR 649 renews monthly."]), []);
});

test("detects explicit foreign currencies case-insensitively and rejects ambiguous dollar symbols", () => {
  const candidates = extractReceiptCandidates([
    "Netflix subscription paid usd 10 on 2026-07-01. Renews monthly.",
    "Adobe subscription paid EUR 12 on 2026-07-02. Renews monthly.",
    "Canva subscription paid GBP 9 on 2026-07-03. Renews monthly.",
    "Notion subscription paid CA$ 14 on 2026-07-04. Renews monthly.",
  ]);
  assert.deepEqual(candidates.map((candidate) => candidate.currency), ["USD", "EUR", "GBP", "CAD"]);
  assert.deepEqual(extractReceiptCandidates(["Netflix subscription paid $10 on 2026-07-01. Renews monthly."]), []);
});

test("resolves a bare dollar only from one currency and one merchant across the same MIME", () => {
  const receipt = "OpenAI invoice $20 charged on 2026-07-04.";
  const hint = inferReceiptCurrencyHint([
    receipt,
    "Invoice currency: USD. Tax reporting currency: INR.",
    receipt,
  ]);

  assert.equal(hint, "USD");
  assert.equal(extractObservedReceipt(receipt, hint)?.currency, "USD");
  assert.equal(extractObservedReceipt(receipt), null);
});

test("does not infer a MIME currency across conflicting currencies or merchants", () => {
  assert.equal(inferReceiptCurrencyHint([
    "OpenAI invoice $20 charged on 2026-07-04.",
    "Invoice currency: USD and settlement currency: CAD",
  ]), null);
  assert.equal(inferReceiptCurrencyHint([
    "OpenAI invoice $20 charged on 2026-07-04.",
    "Netflix receipt $10 charged on 2026-07-05.",
    "Invoice currency: USD",
  ]), null);
  assert.equal(inferReceiptCurrencyHint([
    "OpenAI invoice $20 charged on 2026-07-04.",
    "Regional office: USD Services",
  ]), null);
});

test("receipt identity is stable when snippets reorder and price or date changes", () => {
  const before = extractReceiptCandidates([
    "OpenAI invoice paid INR 1,999 on 2026-07-06. ChatGPT Plus renews monthly.",
    "Notion invoice paid INR 830 on 2026-07-01. Notion Plus renews monthly.",
  ]);
  const after = extractReceiptCandidates([
    "Notion invoice paid INR 830 on 2026-07-01. Notion Plus renews monthly.",
    "OpenAI invoice paid INR 2,099 on 2026-08-06. ChatGPT Plus renews monthly.",
  ]);
  assert.equal(before.find((item) => item.merchant === "OpenAI")?.id, after.find((item) => item.merchant === "OpenAI")?.id);
});

test("parses real-world receipts that write dates with month names", () => {
  const pasted = [
    "Netflix\nYour payment of ₹649.00 was successful.\nPayment date: 17 June 2026\nNext billing date: 17 July 2026",
    "Spotify Premium\nReceipt: ₹119.00 charged to your card\nDate: 05 July 2026\nYour subscription renews monthly.",
    "Google One\n₹130.00 payment received\nDate: 01 July 2026\nRenews: 01 August 2026",
  ].join("\n\n");
  const items = receiptTextToManualInputs(pasted);
  assert.deepEqual(items.map((item) => [item.merchant, item.amount, item.nextExpectedDate]), [
    ["Netflix", 649, "2026-07-17"],
    ["Spotify", 119, "2026-08-05"],
    ["Google One", 130, "2026-08-01"],
  ]);
});

test("categorizes real-world Indian streaming receipts without the Jio telecom collision", () => {
  const candidates = extractReceiptCandidates([
    "JioHotstar subscription of Rs. 299 charged on 2026-07-10. Renews monthly.",
    "Hotstar Super plan ₹499 charged on 2026-07-05. Renews yearly.",
    "Amazon Prime Membership ₹1,499 paid on 2026-07-01. Renews yearly.",
    "Prime Video Channel ₹299 charged on 2026-07-02. Renews monthly.",
    "Jio postpaid recharge ₹399 charged on 2026-07-03. Renews monthly.",
  ]);
  // JioHotstar contains the "Jio" telecom substring; it must still land in
  // Streaming, while bare Jio stays a telecom Utility.
    assert.deepEqual(candidates.map((candidate) => [candidate.merchant, candidate.category]), [
      ["JioHotstar", "Streaming"],
      ["Hotstar", "Streaming"],
      ["Amazon Prime", "Streaming"],
      ["Prime Video", "Streaming"],
      ["Jio", "Utilities"],
    ]);
});

test("parses a spread of real subscription, telecom, and insurance formats", () => {
  const candidates = extractReceiptCandidates([
    "LIC premium of Rs. 12,000 paid on 2026-07-01. Policy renews yearly.",
    "Apple\nReceipt\niCloud+ 50GB subscription ₹75.00\nRenews monthly on 15 Aug 2026",
    "Anthropic invoice paid USD 20 on 2026-07-04. Claude Pro renews monthly.",
    "GitHub receipt: USD 4 charged on 2026-07-05. Copilot renews monthly.",
    "Adobe Creative Cloud subscription ₹1,675 charged on 2026-07-06. Renews monthly.",
    "Airtel postpaid bill ₹499 charged on 2026-07-07. Renews monthly.",
  ]);
  assert.deepEqual(
    candidates.map((candidate) => [
      candidate.merchant,
      candidate.currency,
      candidate.amount,
      candidate.frequency,
      candidate.category,
      candidate.nextExpectedDate,
    ]),
    [
      ["LIC", "INR", 12000, "yearly", "Insurance", "2027-07-01"],
      ["Apple", "INR", 75, "monthly", "App store", "2026-08-15"],
      ["Anthropic", "USD", 20, "monthly", "AI tools", "2026-08-04"],
      ["GitHub", "USD", 4, "monthly", "Developer tools", "2026-08-05"],
      ["Adobe", "INR", 1675, "monthly", "Creative tools", "2026-08-06"],
      ["Airtel", "INR", 499, "monthly", "Utilities", "2026-08-07"],
    ],
  );
});

test("treats a dated annual premium as a declared LIC commitment instead of a generic transaction", () => {
  const candidates = extractReceiptCandidates([
    "Merchant: LIC of India; Payment date: 15 July 2026; Annual policy premium. Amount: INR 1,25,000.00",
  ]);

  assert.equal(candidates.length, 1);
    assert.equal(candidates[0].merchant, "LIC of India");
  assert.equal(candidates[0].category, "Insurance");
  assert.equal(candidates[0].frequency, "yearly");
  assert.equal(candidates[0].observedDate, "2026-07-15");
});

test("conservatively rejects receipts without provable recurrence", () => {
  // A bare telecom bill with no cadence and no recurring semantics is not proof
  // of a subscription; importing it would fabricate a recurring commitment.
  assert.deepEqual(extractReceiptCandidates(["Airtel bill ₹499 due on 2026-08-05."]), []);
  // Loan EMIs are protected commitments; the parser does not mint them from
  // pre-debit text — no merchant pattern matches a bank-loan descriptor.
  assert.deepEqual(
    extractReceiptCandidates(["Your EMI of Rs. 4,500 for HDFC personal loan will be debited on 2026-08-05."]),
    [],
  );
});

test("parses common labelled-date receipt layouts without guessing a missing currency", () => {
  const cases = [
    {
      name: "Netflix email header",
      text: "From: Netflix; Date: 10 June 2026, your Netflix Premium membership was charged. Amount: Rs. 649.00",
      expected: ["Netflix", "649.00", "INR", "2026-06-10"],
    },
    {
      name: "Spotify receipt date",
      text: "From: Spotify; Receipt date: 5 July 2026, payment received; Spotify Premium subscription. Total: ₹119.00",
      expected: ["Spotify", "119.00", "INR", "2026-07-05"],
    },
    {
      name: "Adobe invoice date",
      text: "From: Adobe; Invoice date: 2 August 2026; Creative Cloud annual plan billed monthly. Total: INR 4,229.00",
      expected: null,
    },
    {
      name: "Google One transaction date",
      text: "From: Google One; Transaction date: 1 July 2026, payment received; Google One subscription. Amount: ₹130.00",
      expected: ["Google One", "130.00", "INR", "2026-07-01"],
    },
    {
      name: "trailing INR",
      text: "Merchant: Acme Cloud; Payment date: 12 July 2026; Monthly subscription payment. Total: 1,499.00 INR",
      expected: ["Acme Cloud", "1499.00", "INR", "2026-07-12"],
    },
    {
      name: "Notion transaction date",
      text: "From: Notion Labs; Transaction date: August 1, 2026, payment received; Notion monthly subscription. Total: USD 10.00",
      expected: ["Notion Labs", "10.00", "USD", "2026-08-01"],
    },
    {
      name: "leading Your merchant",
      text: "From: Your Swiggy One; Payment date: 3 August 2026; Swiggy One membership payment received. Amount: INR 299.00",
      expected: ["Swiggy One", "299.00", "INR", "2026-08-03"],
    },
    {
      name: "Jio billing date",
      text: "Jio postpaid bill; Payment date: 4 August 2026; Recurring plan payment received. Amount: Rs. 399.00",
      expected: ["Jio", "399.00", "INR", "2026-08-04"],
    },
    {
      name: "society maintenance receipt",
      text: "Merchant: Green Meadows Society; Receipt date: 5 August 2026, payment received; Monthly maintenance. Amount: INR 3,500.00",
      expected: ["Green Meadows Society", "3500.00", "INR", "2026-08-05"],
    },
    {
      name: "LIC payment date",
      text: "LIC of India annual policy premium; Payment date: 15 July 2026; Amount: INR 1,25,000.00",
      expected: ["LIC", "125000.00", "INR", "2026-07-15"],
    },
    {
      name: "future mandate notice",
      text: "Pre-debit notification: mandate towards MAX BUPA HEALTH for INR 50,000 will be debited on 20 Aug 2026.",
      expected: ["MAX BUPA HEALTH", "50000", "INR", null],
    },
    {
      name: "Amazon Prime receipt date",
      text: "Amazon Prime membership; Receipt date: 6 August 2026, payment received; Total: ₹1,499.00; Renews yearly.",
      expected: ["Amazon Prime", "1499.00", "INR", "2026-08-06"],
    },
    {
      name: "Apple trailing currency",
      text: "Apple iCloud subscription receipt; Order date: 7 August 2026; Total: 75.00 INR; Renews monthly.",
      expected: null,
    },
    {
      name: "numeric Date header",
      text: "Netflix subscription; Date: 2026-08-08, payment received; Amount: INR 649.00; Renews monthly.",
      expected: ["Netflix", "649.00", "INR", "2026-08-08"],
    },
    {
      name: "missing currency",
      text: "Merchant: Acme Fitness; Invoice date: 9 August 2026; Monthly membership total: 210.00",
      expected: null,
    },
  ] as const;

  const parsed = cases.map(({ text }) => {
    const observed = extractObservedReceipt(text);
    const recurring = extractReceiptCandidates([text])[0] ?? null;
    const value = observed ?? recurring;
    return value
      ? [value.merchant, value.amountDecimal, value.currency, value.observedDate]
      : null;
  });

  assert.ok(parsed.filter(Boolean).length >= 12, "at least 12 of 15 representative receipt layouts must be bounded");
  cases.forEach((fixture, index) => {
    assert.deepEqual(parsed[index], fixture.expected, fixture.name);
  });
});

test("rejects document and due dates as observed charges", () => {
  for (const receipt of [
    "From: Adobe; Invoice date: 2 August 2026; Monthly subscription invoice. Total: INR 4,229.00",
    "From: Apple; Order date: 7 August 2026; iCloud subscription receipt. Total: INR 75.00",
    "Merchant: Acme Fitness; Due date: 9 August 2026; Monthly membership amount: INR 210.00",
    "From: Spotify; Receipt date: 5 July 2026; Premium subscription receipt. Total: INR 119.00",
    "From: Notion Labs; Transaction date: 1 August 2026; Monthly subscription invoice. Total: USD 10.00",
    "Merchant: Acme Cloud; Invoice billed monthly. Due date: 12 August 2026; Total: INR 1,499.00",
  ]) {
    assert.equal(extractObservedReceipt(receipt), null);
    assert.ok(extractReceiptCandidates([receipt]).every((candidate) => candidate.observedDate === null));
  }
});

test("binds completed-payment context to the observed date instead of the whole receipt", () => {
  assert.equal(extractObservedReceipt(
    "From: Spotify; Payment received for the June invoice. Receipt date: 5 July 2026; Premium subscription receipt. Total: INR 119.00",
  ), null);
  assert.equal(extractObservedReceipt(
    "From: Notion Labs; Payment completed for an earlier invoice. Transaction date: 1 August 2026; Monthly subscription invoice. Total: USD 10.00",
  ), null);

  const bounded = extractObservedReceipt(
    "From: Spotify; Receipt date: 5 July 2026, payment received; Premium subscription. Total: INR 119.00",
  );
  assert.equal(bounded?.observedDate, "2026-07-05");
});

test("preserves newline boundaries for date and explicit merchant inference", () => {
  assert.equal(extractObservedReceipt([
    "From: Spotify",
    "Payment received for the June invoice",
    "Receipt date: 5 July 2026",
    "Premium subscription receipt",
    "Total: INR 119.00",
  ].join("\n")), null);

  const paid = extractObservedReceipt([
    "MERCHANT: Acme Cloud",
    "Payment date: 1 August 2026",
    "Razorpay payment gateway reference",
    "Monthly subscription",
    "Total: INR 1,499.00",
    "Next billing date: 1 September 2026",
  ].join("\n"));
  assert.equal(paid?.merchant, "Acme Cloud");
  assert.equal(paid?.observedDate, "2026-08-01");
});

test("keeps scheduled-to-be-charged dates upcoming-only", () => {
  const [candidate] = extractReceiptCandidates([
    "Merchant: Acme Cloud; Monthly subscription total: INR 1,499.00; Scheduled to be charged on 20 August 2026.",
  ]);
  assert.ok(candidate);
  assert.equal(candidate.observedDate, null);
  assert.equal(candidate.nextExpectedDate, "2026-08-20");
});

test("selects one labelled charged total and rejects unresolved multi-amount receipts", () => {
  const bounded = extractObservedReceipt(
    "From: Adobe; Payment date: 2 August 2026; Creative Cloud was charged. Subtotal: INR 3,500.00; Tax: INR 630.00; Total: INR 4,130.00",
  );
  assert.equal(bounded?.amountDecimal, "4130.00");

  const amountAndTotal = extractObservedReceipt(
    "From: Adobe; Payment date: 2 August 2026; Creative Cloud payment received. Amount: INR 3,500.00; Total: INR 4,130.00",
  );
  assert.equal(amountAndTotal?.amountDecimal, "4130.00");

  assert.equal(extractObservedReceipt(
    "From: Adobe; Payment date: 2 August 2026; Creative Cloud payment received. Charged: INR 3,500.00; Total: INR 4,130.00",
  ), null);

  assert.equal(extractObservedReceipt(
    "From: Adobe; Payment date: 2 August 2026; Creative Cloud payment. INR 3,500.00 plus INR 630.00",
  ), null);
});

test("maps every accepted explicit currency instead of falling back to INR", () => {
  const candidates = extractReceiptCandidates([
    "Merchant: Kuwait Cloud; Payment date: 1 August 2026; Monthly subscription paid KWD 1.250.",
    "Merchant: Japan Cloud; Payment date: 2 August 2026; Monthly subscription paid JPY 1500.",
  ]);
  assert.deepEqual(candidates.map((candidate) => candidate.currency), ["KWD", "JPY"]);
});
