import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  keepAddBillsOpenAfterPersist,
  knownMerchantsFromNames,
  MAX_KNOWN_MERCHANTS,
  MONTHLY_LOOP_STEPS,
  persistTextFromConfirmedLine,
  sanitizeKnownMerchants,
  workspaceMerchantCitedInText,
} from "../src/lib/recovery/monthly-loop";

test("monthly compounding is the Recovery loop, not a knowledge graph", () => {
  assert.deepEqual(MONTHLY_LOOP_STEPS, ["CONFIRM", "REMEMBER", "DECIDE", "WATCH", "VERIFY"]);
  const source = readFileSync(new URL("../src/lib/recovery/monthly-loop.ts", import.meta.url), "utf8");
  assert.match(source, /not a knowledge graph/);
  assert.doesNotMatch(source, /from ["']@\/lib\/.*(?:embed|vector|rag)/i);
});

test("workspace merchant names stay exact, bounded, and non-generic", () => {
  assert.deepEqual(
    knownMerchantsFromNames(["  Acme Cloud  ", "acme cloud", "Premium", "A", "OpenAI"]),
    ["Acme Cloud", "OpenAI"],
  );
  assert.deepEqual(sanitizeKnownMerchants("OpenAI"), []);
  assert.deepEqual(sanitizeKnownMerchants(["Plus", "Pro", "Active", "Manage Subscription"]), []);
  assert.equal(sanitizeKnownMerchants(Array.from({ length: 80 }, (_, index) => `Vendor ${index}`)).length, MAX_KNOWN_MERCHANTS);
});

test("a remembered merchant fills only when that exact name is printed", () => {
  const transcript = "Acme Cloud\nPlan Premium\nCost ₹427 / month";
  assert.equal(workspaceMerchantCitedInText(transcript, ["Acme Cloud", "OpenAI"]), "Acme Cloud");
  assert.equal(workspaceMerchantCitedInText(transcript, ["OpenAI"]), null);
  assert.equal(workspaceMerchantCitedInText(transcript, ["Premium"]), null);
  assert.equal(workspaceMerchantCitedInText("ChatGPT Plus by OpenAI", ["OpenAI"]), "OpenAI");
  assert.equal(workspaceMerchantCitedInText("OpenAI", ["AI"]), null, "short tokens must not match inside a longer name");
  assert.equal(workspaceMerchantCitedInText("cvt labs invoice paid INR 427", ["CVT Labs"]), "CVT Labs");
});

test("confirming a line concatenates receipt text and keeps leftover photos in the overlay", () => {
  assert.equal(
    persistTextFromConfirmedLine("OpenAI invoice paid INR 1999.00 on 2026-07-06.", "Acme Cloud invoice paid INR 427 on 2026-08-20."),
    "OpenAI invoice paid INR 1999.00 on 2026-07-06.\n\nAcme Cloud invoice paid INR 427 on 2026-08-20.",
  );
  assert.equal(persistTextFromConfirmedLine("  ", "Acme Cloud invoice paid INR 427 on 2026-08-20."), "Acme Cloud invoice paid INR 427 on 2026-08-20.");
  assert.equal(keepAddBillsOpenAfterPersist(0), false);
  assert.equal(keepAddBillsOpenAfterPersist(1), true);
});
