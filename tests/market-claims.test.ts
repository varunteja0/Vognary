import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { validateMarketCopy } from "../src/lib/market-claims";

test("market claims accepts the canonical one-time pilot contract", () => {
  const canonical = readFileSync("docs/templates/outreach-scripts.md", "utf8");
  assert.deepEqual(validateMarketCopy(canonical, { requireOfferContract: true }), []);
});

test("market claims rejects retired prices, autonomous action, and invented proof", () => {
  const result = validateMarketCopy(`
    Vognary automatically approves AI spend and blocks the card.
    Our 25 paid customers saved INR 40,000 with proven ROI.
    Start a free pilot after our independent security assessment passed.
  `, { requireOfferContract: false });

  assert.deepEqual(result.map((violation) => violation.code).sort(), [
    "AUTONOMOUS_ACTION",
    "FREE_OFFER",
    "INVENTED_CUSTOMER_PROOF",
    "INVENTED_OUTCOME_PROOF",
    "RETIRED_PRICE",
    "SECURITY_OVERCLAIM",
  ]);
});

test("market claims does not mistake explicit boundaries for positive claims", () => {
  const result = validateMarketCopy(`
    Vognary never auto-approves, auto-denies, purchases, provisions, cancels, or moves money.
    This synthetic demonstration does not prove customer use, savings, or production readiness.
    There is no automatic renewal. A second month requires a separate purchase.
  `, { requireOfferContract: false });

  assert.deepEqual(result, []);
});

test("market claims rejects paraphrased traction, outcome, security, and action claims", () => {
  const result = validateMarketCopy(`
    The pilot costs ₹0 and auto-renews.
    Vognary autonomously approves spend and prevents transactions.
    Twenty-five companies already pay us. Customers cut spend by 25%.
    We passed an independent security audit.
    The actual invoice total is ₹15,000.
  `, { requireOfferContract: false });

  assert.deepEqual(result.map((violation) => violation.code).sort(), [
    "AUTOMATIC_RENEWAL",
    "AUTONOMOUS_ACTION",
    "FREE_OFFER",
    "INVENTED_CUSTOMER_PROOF",
    "INVENTED_OUTCOME_PROOF",
    "SECURITY_OVERCLAIM",
    "UNAUTHORIZED_PRICE",
  ]);
});

test("market claims rejects unbounded care promises while allowing the honest boundary", () => {
  const unsafe = [
    "Vognary takes care of everything.",
    "You never need to worry again.",
    "We handle it all for your finance team.",
  ];

  for (const text of unsafe) {
    assert.deepEqual(
      validateMarketCopy(text, { requireOfferContract: false }).map((violation) => violation.code),
      ["UNBOUNDED_CARE_PROMISE"],
      text,
    );
  }

  assert.deepEqual(validateMarketCopy(`
    Vognary does not take care of everything.
    You still decide. Vognary keeps the evidence, cap, expiry, and later comparison from living only in your head.
  `, { requireOfferContract: false }), []);
});

test("market claims refuses a negated imitation of the canonical contract", () => {
  const result = validateMarketCopy(`
    The price is not ₹14,999, although this is called a one-time payment for one month.
    It does not include one policy setup, up to ten proposals, up to four weekly 30-minute reconciliation reviews, or up to two additional founder-support hours.
    There is no automatic renewal. A second month requires a separate purchase.
    Vognary never auto-approves, purchases, provisions, cancels, or moves money.
    Real customer data and activation are not blocked until the independent assessment/retest and legal/security gates clear.
  `, { requireOfferContract: true });

  assert.ok(result.some((violation) => violation.code === "OFFER_CONTRACT_MISSING"));
});

test("market claims permits honest negations and canonical currency spacing", () => {
  const result = validateMarketCopy(`
    There is no free pilot. The pilot never renews automatically.
    We have 0 paid customers. No independent security assessment has passed.
    Vognary has not saved ₹1 and does not include a response SLA.
    The one-time pilot price is ₹ 14,999.
  `, { requireOfferContract: false });

  assert.deepEqual(result, []);
});

test("market claims scopes negation to clauses and catches passive or generic proof claims", () => {
  const unsafe = [
    "Vognary never moves money, but Vognary automatically approves AI spend.",
    "Vognary never moves money, and Vognary automatically approves AI spend.",
    "We have no free trial, but 25 paid customers use Vognary.",
    "We have no free trial, and 25 paid customers use Vognary.",
    "We do not promise savings, but customers saved 25%.",
    "We do not promise savings, and customers saved 25%.",
    "No assessment was planned, but Vognary completed an independent security audit.",
    "No assessment was planned, and Vognary completed an independent security audit.",
    "The pilot is not free, but the total payment is INR 75,000.",
    "The pilot is not free, and the total payment is INR 75,000.",
    "AI spend is approved automatically by Vognary.",
    "Trusted by leading AI companies.",
    "Customers achieved 25% lower cloud spend.",
    "The independent security assessment is complete.",
    "The pilot renews monthly at ₹14,999.",
    "The pilot costs $199.",
  ];

  for (const text of unsafe) {
    assert.notDeepEqual(validateMarketCopy(text, { requireOfferContract: false }), [], text);
  }

  assert.deepEqual(
    validateMarketCopy("Avoid claiming Vognary automatically approves spend.", { requireOfferContract: false }),
    [],
  );
});

test("market claims CLI checks canonical copy and redacts a private draft", () => {
  const canonical = runClaims([]);
  assert.equal(canonical.status, 0, canonical.stderr);
  assert.match(canonical.stdout, /market claims check passed/i);

  const temporaryDirectory = mkdtempSync(join(tmpdir(), "vognary-market-claims-"));
  const privateName = "Private-Founder-Draft";
  const privateText = "Our 25 paid customers saved INR 40,000. Secret buyer message.";
  const privatePath = join(temporaryDirectory, `${privateName}.txt`);
  try {
    writeFileSync(privatePath, privateText, { mode: 0o600 });
    const rejected = runClaims(["--draft", privatePath]);
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /private-draft.*INVENTED_CUSTOMER_PROOF/i);
    assert.match(rejected.stderr, /private-draft.*INVENTED_OUTCOME_PROOF/i);
    assert.match(rejected.stderr, /private-draft.*RETIRED_PRICE/i);
    assert.doesNotMatch(`${rejected.stdout}\n${rejected.stderr}`, new RegExp(`${privateName}|Secret buyer message|25 paid customers`));
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

function runClaims(arguments_: string[]) {
  return spawnSync(process.execPath, [
    "--conditions=react-server",
    "--import=tsx",
    "scripts/check-market-claims.ts",
    ...arguments_,
  ], {
    cwd: new URL("../", import.meta.url),
    env: { PATH: process.env.PATH ?? "", NODE_ENV: "test" },
    encoding: "utf8",
  });
}