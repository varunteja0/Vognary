import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import { billingEntitlementForPlan, parseRazorpayBillingEvent, verifyRazorpayWebhookSignature } from "../src/lib/billing";

const checkoutId = "123e4567-e89b-42d3-a456-426614174001";

test("Razorpay webhook signatures validate the untouched raw body", () => {
  const raw = JSON.stringify({ event: "payment_link.paid" });
  const secret = "webhook-test-secret";
  const signature = createHmac("sha256", secret).update(raw).digest("hex");
  assert.equal(verifyRazorpayWebhookSignature(raw, signature, secret), true);
  assert.equal(verifyRazorpayWebhookSignature(`${raw} `, signature, secret), false);
});

test("paid Payment Link events expose only settlement identifiers", () => {
  const event = parseRazorpayBillingEvent({
    event: "payment_link.paid",
    payload: {
      payment_link: { entity: { id: "plink_12345678", reference_id: checkoutId, amount_paid: 499900, currency: "INR", status: "paid" } },
      payment: { entity: { id: "pay_12345678", amount: 499900, currency: "INR", captured: true } },
    },
  }, "event-payment-0001");
  assert.deepEqual(event, {
    kind: "paid",
    eventId: "event-payment-0001",
    eventType: "payment_link.paid",
    checkoutId,
    providerCheckoutId: "plink_12345678",
    providerPaymentId: "pay_12345678",
    amountMinor: 499900,
    currency: "INR",
  });
});

test("refund events and entitlement periods are deterministic", () => {
  const event = parseRazorpayBillingEvent({
    event: "refund.processed",
    payload: { refund: { entity: { id: "rfnd_12345678", payment_id: "pay_12345678", amount: 499900, currency: "INR", status: "processed" } } },
  }, "event-refund-0001");
  assert.equal(event.kind, "refund-processed");
  assert.deepEqual(billingEntitlementForPlan("founder"), { key: "monitoring", durationDays: 31 });
  assert.deepEqual(billingEntitlementForPlan("annual"), { key: "annual-audit", durationDays: 365 });
});