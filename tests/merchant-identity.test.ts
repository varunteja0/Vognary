import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalGstin,
  canonicalDomain,
  merchantSignalWeights,
  normalizeMerchantAlias,
  resolveMerchantIdentity,
  type CanonicalMerchantRecord,
  type MerchantIdentityClaim,
  type ObservedMerchantSignal,
} from "../src/lib/recovery/merchant-identity";

function claim(signals: readonly ObservedMerchantSignal[], overrides: Partial<MerchantIdentityClaim> = {}): MerchantIdentityClaim {
  return { currency: "INR", displayName: "Netflix", signals, ...overrides };
}

function candidate(
  id: string,
  signals: readonly ObservedMerchantSignal[],
  overrides: Partial<CanonicalMerchantRecord> = {},
): CanonicalMerchantRecord {
  return { id, currency: "INR", displayName: "Netflix", signals, ...overrides };
}

const evidence = (kind: ObservedMerchantSignal["signal"]["kind"], extra: Record<string, unknown>, evidenceId: string): ObservedMerchantSignal =>
  ({ signal: { kind, ...extra } as ObservedMerchantSignal["signal"], evidenceId });

test("GSTIN is only usable when its statutory checksum verifies", () => {
  // 29AAACN1234A1Z3 carries the correct statutory check character; 9 and G do not.
  assert.equal(canonicalGstin("29AAACN1234A1Z9"), null);
  assert.equal(canonicalGstin("29AAACN1234A1ZG"), null);
  assert.equal(canonicalGstin("29aaacn1234a1z3"), "29AAACN1234A1Z3");
  assert.equal(canonicalGstin("27AAACN1234A1Z7"), "27AAACN1234A1Z7");
  assert.equal(canonicalGstin("29AAACN1234A1Z"), null);
  assert.equal(canonicalGstin(""), null);
});

test("domains normalize without public-suffix guessing", () => {
  assert.equal(canonicalDomain(" WWW.Netflix.com. "), "netflix.com");
  assert.equal(canonicalDomain("billing@netflix.com"), "netflix.com");
  assert.equal(canonicalDomain("netflix.com.evil.tld"), "netflix.com.evil.tld");
  assert.equal(canonicalDomain("not a domain"), null);
});

test("legal suffixes and punctuation are stripped from fuzzy aliases", () => {
  assert.equal(normalizeMerchantAlias("Netflix Entertainment Services Pvt. Ltd."), "netflix entertainment services");
  assert.equal(normalizeMerchantAlias("  ACME  Inc  "), "acme");
});

test("a matching GSTIN auto-merges and cites evidence from both sides", () => {
  const resolution = resolveMerchantIdentity({
    claim: claim([evidence("GSTIN", { value: "29AAACN1234A1Z3" }, "ev-new")]),
    candidates: [candidate("m-1", [evidence("GSTIN", { value: "29aaacn1234a1z3" }, "ev-old")])],
  });
  assert.equal(resolution.outcome, "AUTO_MERGE");
  assert.equal(resolution.match?.merchantId, "m-1");
  assert.equal(resolution.match?.score, 100);
  assert.equal(resolution.match?.strongestSignalKind, "GSTIN");
  assert.deepEqual([...(resolution.match?.evidenceIds ?? [])].sort(), ["ev-new", "ev-old"]);
  assert.ok(resolution.match?.reasons.some((reason) => reason.includes("GST")));
});

test("differing GSTINs are two different legal entities and never merge", () => {
  const resolution = resolveMerchantIdentity({
    claim: claim([
      evidence("GSTIN", { value: "29AAACN1234A1Z3" }, "ev-new"),
      evidence("BILLING_DOMAIN", { value: "netflix.com" }, "ev-new"),
    ]),
    candidates: [candidate("m-1", [
      evidence("GSTIN", { value: "27AAACN1234A1Z7" }, "ev-old"),
      evidence("BILLING_DOMAIN", { value: "netflix.com" }, "ev-old"),
    ])],
  });
  assert.equal(resolution.outcome, "NO_MATCH");
  assert.equal(resolution.match, null);
  assert.equal(resolution.blocked[0]?.reason, "CONFLICTING_LEGAL_IDENTITY");
});

test("a fuzzy alias alone can never auto-merge, only ask", () => {
  const resolution = resolveMerchantIdentity({
    claim: claim([evidence("FUZZY_ALIAS", { value: "Netflix" }, "ev-new")]),
    candidates: [candidate("m-1", [evidence("FUZZY_ALIAS", { value: "netflix" }, "ev-old")])],
  });
  assert.equal(resolution.outcome, "REVIEW_SUGGESTED");
  assert.ok(resolution.match!.score < merchantSignalWeights.BILLING_DOMAIN);
  assert.ok(resolution.reasons.some((reason) => reason.toLowerCase().includes("name similarity")));
});

test("a billing domain alone is strong enough to merge automatically", () => {
  const resolution = resolveMerchantIdentity({
    claim: claim([evidence("BILLING_DOMAIN", { value: "netflix.com" }, "ev-new")]),
    candidates: [candidate("m-1", [evidence("BILLING_DOMAIN", { value: "WWW.Netflix.com" }, "ev-old")])],
  });
  assert.equal(resolution.outcome, "AUTO_MERGE");
  assert.equal(resolution.match?.score, merchantSignalWeights.BILLING_DOMAIN);
});

test("an unverified sender domain is too weak on its own", () => {
  const resolution = resolveMerchantIdentity({
    claim: claim([evidence("SENDER_DOMAIN", { value: "netflix.com", tier: "UNVERIFIED_SENDER" }, "ev-new")]),
    candidates: [candidate("m-1", [evidence("SENDER_DOMAIN", { value: "netflix.com", tier: "UNVERIFIED_SENDER" }, "ev-old")])],
  });
  assert.equal(resolution.outcome, "REVIEW_SUGGESTED");
});

test("a suspicious sender domain contributes nothing", () => {
  const resolution = resolveMerchantIdentity({
    claim: claim([evidence("SENDER_DOMAIN", { value: "netflix.com", tier: "SUSPICIOUS_SENDER" }, "ev-new")]),
    candidates: [candidate("m-1", [evidence("SENDER_DOMAIN", { value: "netflix.com", tier: "SUSPICIOUS_SENDER" }, "ev-old")])],
  });
  assert.equal(resolution.outcome, "NO_MATCH");
});

test("a verified sender domain plus the same account identifier merges", () => {
  const resolution = resolveMerchantIdentity({
    claim: claim([
      evidence("SENDER_DOMAIN", { value: "netflix.com", tier: "VERIFIED_SENDER" }, "ev-new"),
      evidence("ACCOUNT_IDENTIFIER", { value: "AC-4471" }, "ev-new"),
    ]),
    candidates: [candidate("m-1", [
      evidence("SENDER_DOMAIN", { value: "netflix.com", tier: "VERIFIED_SENDER" }, "ev-old"),
      evidence("ACCOUNT_IDENTIFIER", { value: "ac-4471" }, "ev-old"),
    ])],
  });
  assert.equal(resolution.outcome, "AUTO_MERGE");
  assert.ok(resolution.match!.matchedSignals.length === 2);
});

test("currency is never crossed, whatever the signal strength", () => {
  const resolution = resolveMerchantIdentity({
    claim: claim([evidence("GSTIN", { value: "29AAACN1234A1Z3" }, "ev-new")]),
    candidates: [candidate("m-usd", [evidence("GSTIN", { value: "29AAACN1234A1Z3" }, "ev-old")], { currency: "USD" })],
  });
  assert.equal(resolution.outcome, "NO_MATCH");
  assert.equal(resolution.match, null);
  assert.deepEqual(resolution.blocked.map((entry) => entry.reason), ["CURRENCY_MISMATCH"]);
});

test("a merge the user reversed is never proposed automatically again", () => {
  const input = {
    claim: claim([evidence("GSTIN", { value: "29AAACN1234A1Z3" }, "ev-new")]),
    candidates: [candidate("m-1", [evidence("GSTIN", { value: "29AAACN1234A1Z3" }, "ev-old")])],
  };
  assert.equal(resolveMerchantIdentity(input).outcome, "AUTO_MERGE");
  const rejected = resolveMerchantIdentity({ ...input, rejectedMerchantIds: ["m-1"] });
  assert.equal(rejected.outcome, "NO_MATCH");
  assert.equal(rejected.blocked[0]?.reason, "USER_REJECTED");
});

test("an invalid GSTIN is discarded rather than trusted as an identifier", () => {
  const resolution = resolveMerchantIdentity({
    claim: claim([evidence("GSTIN", { value: "29AAACN1234A1Z9" }, "ev-new")]),
    candidates: [candidate("m-1", [evidence("GSTIN", { value: "29AAACN1234A1Z9" }, "ev-old")])],
  });
  assert.equal(resolution.outcome, "NO_MATCH");
});

test("invoice identifiers are too collision-prone to merge on their own", () => {
  const resolution = resolveMerchantIdentity({
    claim: claim([evidence("INVOICE_IDENTIFIER", { value: "INV-001" }, "ev-new")]),
    candidates: [candidate("m-1", [evidence("INVOICE_IDENTIFIER", { value: "INV-001" }, "ev-old")])],
  });
  assert.notEqual(resolution.outcome, "AUTO_MERGE");
});

test("processor descriptors match after the processor prefix is removed", () => {
  const resolution = resolveMerchantIdentity({
    claim: claim([evidence("PROCESSOR_DESCRIPTOR", { processor: "RAZORPAY", value: "RAZ*NETFLIX INDIA" }, "ev-new")]),
    candidates: [candidate("m-1", [evidence("PROCESSOR_DESCRIPTOR", { processor: "RAZORPAY", value: "razorpay*netflix india" }, "ev-old")])],
  });
  assert.equal(resolution.outcome, "REVIEW_SUGGESTED");
  assert.equal(resolution.match?.strongestSignalKind, "PROCESSOR_DESCRIPTOR");
});

test("explicit merchant identity only matches inside its own namespace", () => {
  const same = resolveMerchantIdentity({
    claim: claim([evidence("EXPLICIT_MERCHANT_ID", { namespace: "razorpay", value: "acct_9" }, "ev-new")]),
    candidates: [candidate("m-1", [evidence("EXPLICIT_MERCHANT_ID", { namespace: "razorpay", value: "acct_9" }, "ev-old")])],
  });
  assert.equal(same.outcome, "AUTO_MERGE");
  const crossNamespace = resolveMerchantIdentity({
    claim: claim([evidence("EXPLICIT_MERCHANT_ID", { namespace: "razorpay", value: "acct_9" }, "ev-new")]),
    candidates: [candidate("m-1", [evidence("EXPLICIT_MERCHANT_ID", { namespace: "stripe", value: "acct_9" }, "ev-old")])],
  });
  assert.equal(crossNamespace.outcome, "NO_MATCH");
});

test("the resolution is deterministic and ranks every allowed candidate", () => {
  const input = {
    claim: claim([
      evidence("BILLING_DOMAIN", { value: "netflix.com" }, "ev-new"),
      evidence("FUZZY_ALIAS", { value: "Netflix" }, "ev-new"),
    ]),
    candidates: [
      candidate("m-weak", [evidence("FUZZY_ALIAS", { value: "Netflix" }, "ev-a")]),
      candidate("m-strong", [evidence("BILLING_DOMAIN", { value: "netflix.com" }, "ev-b")]),
    ],
  };
  const first = resolveMerchantIdentity(input);
  const second = resolveMerchantIdentity(input);
  assert.deepEqual(first, second);
  assert.equal(first.match?.merchantId, "m-strong");
  assert.deepEqual(first.alternatives.map((entry) => entry.merchantId), ["m-weak"]);
});

test("every merge decision is explainable in plain language", () => {
  const resolution = resolveMerchantIdentity({
    claim: claim([evidence("BILLING_DOMAIN", { value: "netflix.com" }, "ev-new")]),
    candidates: [candidate("m-1", [evidence("BILLING_DOMAIN", { value: "netflix.com" }, "ev-old")])],
  });
  assert.ok(resolution.reasons.length > 0);
  for (const reason of resolution.reasons) {
    assert.doesNotMatch(reason, /BILLING_DOMAIN|AUTO_MERGE|_/, `reason leaked an enum name: ${reason}`);
  }
});
