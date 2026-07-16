import assert from "node:assert/strict";
import test from "node:test";

import { getBillingCheckoutConfiguration } from "../src/lib/server/billing-provider";
import { publicOffer } from "../src/lib/public-offer";

const names = [
  "NODE_ENV",
  "ASSISTED_AUDIT_CHECKOUT_MODE",
  "NEXT_PUBLIC_APP_URL",
  "RAZORPAY_KEY_ID",
  "RAZORPAY_KEY_SECRET",
  "RAZORPAY_WEBHOOK_SECRET",
  "ASSISTED_AUDIT_LEGAL_TERMS_STATUS",
  "RAZORPAY_ACCOUNT_STATUS",
  "RAZORPAY_WEBHOOK_PROOF_STATUS",
  "RAZORPAY_REPLAY_PROOF_STATUS",
  "RAZORPAY_REFUND_PROOF_STATUS",
  "RAZORPAY_RECONCILIATION_STATUS",
] as const;

test("non-production test mode enables provider proof without live attestations", () => {
  withEnvironment({
    NODE_ENV: "test",
    ASSISTED_AUDIT_CHECKOUT_MODE: "test",
    NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3000",
    RAZORPAY_KEY_ID: "rzp_test_checkoutproof",
    RAZORPAY_KEY_SECRET: "test-secret",
    RAZORPAY_WEBHOOK_SECRET: "test-webhook-secret",
  }, () => {
    assert.deepEqual(getBillingCheckoutConfiguration(publicOffer.plan), {
      status: "ready",
      provider: "razorpay",
      amountMinor: publicOffer.amountMinor,
      currency: "INR",
      missing: [],
    });
  });
});

test("production rejects test mode and still requires every live proof gate", () => {
  withEnvironment({
    NODE_ENV: "production",
    ASSISTED_AUDIT_CHECKOUT_MODE: "test",
    NEXT_PUBLIC_APP_URL: "https://www.vognary.com",
    RAZORPAY_KEY_ID: "rzp_test_checkoutproof",
    RAZORPAY_KEY_SECRET: "test-secret",
    RAZORPAY_WEBHOOK_SECRET: "test-webhook-secret",
  }, () => {
    const configuration = getBillingCheckoutConfiguration(publicOffer.plan);
    assert.equal(configuration.status, "not-configured");
    assert.ok(configuration.missing.includes("ASSISTED_AUDIT_CHECKOUT_MODE=test is forbidden in production"));
    assert.ok(configuration.missing.includes("RAZORPAY_KEY_ID (live-mode key)"));
    assert.ok(configuration.missing.includes("RAZORPAY_RECONCILIATION_STATUS=passed"));
  });
});

function withEnvironment(values: Partial<Record<(typeof names)[number], string | undefined>>, run: () => void) {
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) {
      const value = values[name];
      if (value === undefined) delete process.env[name];
      else Reflect.set(process.env, name, value);
    }
    run();
  } finally {
    for (const name of names) {
      const value = previous.get(name);
      if (value === undefined) delete process.env[name];
      else Reflect.set(process.env, name, value);
    }
  }
}
