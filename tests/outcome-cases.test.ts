import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAuthorizationText,
  calculateOutcomeFeeMinor,
  canTransitionActionCase,
  getConciergeConfiguration,
  getConciergeEligibility,
  hashAuthorizationText,
  outcomeOffer,
} from "../src/lib/outcome-cases";

test("concierge execution is limited to safe commitment classes", () => {
  assert.equal(getConciergeEligibility("SaaS subscription", "cancel").eligible, true);
  assert.equal(getConciergeEligibility("SaaS subscription", "downgrade").eligible, true);
  assert.equal(getConciergeEligibility("Contractual services", "renegotiate").eligible, true);
  for (const category of ["Loan EMI", "Life insurance", "Investment SIP", "Electricity utility", "Cloud infrastructure"]) {
    const result = getConciergeEligibility(category, "cancel");
    assert.equal(result.eligible, false);
    assert.equal(result.reasonCode, "guidance-only-class");
  }
});

test("action case transitions separate customer, operator, and proof-system authority", () => {
  assert.equal(canTransitionActionCase("awaiting-authorization", "authorized", "customer"), false);
  assert.equal(canTransitionActionCase("awaiting-authorization", "withdrawn", "customer"), true);
  assert.equal(canTransitionActionCase("authorized", "in-progress", "operator"), true);
  assert.equal(canTransitionActionCase("verifying", "verified", "operator"), false);
  assert.equal(canTransitionActionCase("verifying", "verified", "system"), true);
  assert.equal(canTransitionActionCase("verifying", "failed", "system"), true);
  assert.equal(canTransitionActionCase("verified", "disputed", "customer"), true);
});

test("authorization is versioned, bounded, and checksummed", () => {
  const text = buildAuthorizationText({
    merchant: "Figma",
    action: "cancel",
    currency: "INR",
    maximumSuccessFeeMinor: 25_000,
  });
  assert.match(text, /one cancel action for Figma/);
  assert.match(text, new RegExp(outcomeOffer.termsVersion));
  assert.match(hashAuthorizationText(text), /^[0-9a-f]{64}$/);
});

test("outcome fee is charged only from a positive verified annual saving", () => {
  assert.equal(calculateOutcomeFeeMinor(12_000), 180_000);
  assert.equal(calculateOutcomeFeeMinor(100), outcomeOffer.minimumFeeMinor);
  assert.equal(calculateOutcomeFeeMinor(12_000, {
    successFeeBasisPoints: 1_000,
    minimumFeeMinor: 0,
    maximumFeeMinor: 50_000,
  }), 50_000);
  assert.throws(() => calculateOutcomeFeeMinor(0), /invalid/);
});

test("production concierge stays closed until legal, privacy, and operations gates pass", () => {
  const blocked = getConciergeConfiguration({ NODE_ENV: "production" });
  assert.equal(blocked.status, "not-configured");
  const ready = getConciergeConfiguration({
    NODE_ENV: "production",
    CONCIERGE_LEGAL_TERMS_STATUS: "approved",
    CONCIERGE_OPERATIONS_STATUS: "production-ready",
    CONCIERGE_PRIVACY_REVIEW_STATUS: "approved",
  });
  assert.equal(ready.status, "ready");
  assert.deepEqual(ready.missing, []);
});
