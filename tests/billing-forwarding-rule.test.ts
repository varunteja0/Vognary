import assert from "node:assert/strict";
import { test } from "node:test";
import {
  billingFilterExcludePhrases,
  billingFilterLikelyFalsePositivesAvoided,
  billingFilterLikelyMatches,
  billingFilterLikelyMisses,
  billingSetupProgress,
  defaultGmailBillingFilterQuery,
  subjectMatchesDefaultBillingFilter,
} from "../src/lib/recovery/billing-forwarding-rule";

test("the default Gmail rule is subject-only and does not enable global forwarding", () => {
  const query = defaultGmailBillingFilterQuery();
  assert.match(query, /^subject:\(/);
  assert.match(query, / -subject:\(/);
  assert.doesNotMatch(query, /\bhas:attachment\b/);
  assert.doesNotMatch(query, /\bin:anywhere\b/);
  assert.doesNotMatch(query, /\bfrom:\*\b/);
  assert.ok(!query.includes("subscription") && !query.includes("billing address"));
  assert.equal((billingFilterExcludePhrases as readonly string[]).includes("your amazon"), false);
  for (const merchant of ["swiggy", "zomato", "uber", "blinkit", "amazon.in", "amazon order"]) {
    assert.equal((billingFilterExcludePhrases as readonly string[]).includes(merchant), false, merchant);
  }
});

test("the default rule matches typical software billing subjects", () => {
  for (const subject of billingFilterLikelyMatches) {
    assert.equal(subjectMatchesDefaultBillingFilter(subject), true, subject);
  }
});

test("the default rule misses software mail that does not look like a receipt", () => {
  for (const subject of billingFilterLikelyMisses) {
    assert.equal(subjectMatchesDefaultBillingFilter(subject), false, subject);
  }
});

test("the default rule refuses common confidential or personal false positives", () => {
  for (const subject of billingFilterLikelyFalsePositivesAvoided) {
    assert.equal(subjectMatchesDefaultBillingFilter(subject), false, subject);
  }
});

test("setup progress names alias, verification, first matching mail, and health without inventing completeness", () => {
  assert.deepEqual(billingSetupProgress({
    state: "WAITING",
    alias: { id: "alias" },
    forwardingVerifiedAt: null,
    setupCompletedAt: null,
    gmailVerification: { receivedAt: "2026-08-18T00:00:00.000Z" },
  }), {
    current: "VERIFICATION_WAITING",
    completed: ["ALIAS_CREATED"],
  });

  assert.deepEqual(billingSetupProgress({
    state: "WAITING",
    alias: { id: "alias" },
    forwardingVerifiedAt: "2026-08-18T00:01:00.000Z",
    setupCompletedAt: null,
  }), {
    current: "FIRST_AUTOMATIC_RECEIPT_WAITING",
    completed: ["ALIAS_CREATED", "VERIFICATION_WAITING", "VERIFICATION_PROVEN"],
  });

  assert.deepEqual(billingSetupProgress({
    state: "READY",
    alias: { id: "alias" },
    forwardingVerifiedAt: "2026-08-18T00:01:00.000Z",
    setupCompletedAt: "2026-08-18T00:02:00.000Z",
  }), {
    current: "SOURCE_HEALTHY",
    completed: [
      "ALIAS_CREATED",
      "VERIFICATION_WAITING",
      "VERIFICATION_PROVEN",
      "FIRST_AUTOMATIC_RECEIPT_WAITING",
      "FIRST_AUTOMATIC_RECEIPT_RECEIVED",
      "SOURCE_HEALTHY",
    ],
  });
});
