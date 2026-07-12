import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import type { RazorpayBillingEvent } from "../../src/lib/billing";
import {
  applyRazorpayBillingEvent,
  attachBillingProviderCheckout,
  createBillingCheckout,
  listWorkspaceEntitlements,
} from "../../src/lib/server/billing-store";
import { getDatabasePool } from "../../src/lib/server/database";

const databaseConfigured = Boolean(process.env.DATABASE_URL);

test("billing settlement activates an entitlement and a full refund revokes it", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const pool = getDatabasePool();
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const idempotencyKey = `billing-test-${randomUUID()}`;

  try {
    await pool.query(`insert into users (id, email) values ($1, $2)`, [userId, `${userId}@billing.test`]);
    await pool.query(`insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Billing test')`, [workspaceId, userId]);
    await pool.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [workspaceId, userId]);

    const first = await createBillingCheckout({
      workspaceId,
      userId,
      customerEmail: `${userId}@billing.test`,
      plan: "founder",
      provider: "razorpay",
      amountMinor: 499900,
      currency: "INR",
      idempotencyKey,
    });
    const replay = await createBillingCheckout({
      workspaceId,
      userId,
      customerEmail: `${userId}@billing.test`,
      plan: "founder",
      provider: "razorpay",
      amountMinor: 499900,
      currency: "INR",
      idempotencyKey,
    });
    assert.equal(first.created, true);
    assert.equal(replay.created, false);
    assert.equal(replay.checkout.id, first.checkout.id);

    await attachBillingProviderCheckout({
      checkoutId: first.checkout.id,
      providerCheckoutId: "plink_billing1234",
      paymentUrl: "https://rzp.io/rzp/test1234",
    });
    const paid: RazorpayBillingEvent = {
      kind: "paid",
      eventId: "event-billing-paid-0001",
      eventType: "payment_link.paid",
      checkoutId: first.checkout.id,
      providerCheckoutId: "plink_billing1234",
      providerPaymentId: "pay_billing1234",
      amountMinor: 499900,
      currency: "INR",
    };
    assert.equal((await applyRazorpayBillingEvent(paid, "a".repeat(64))).status, "processed");
    assert.equal((await applyRazorpayBillingEvent(paid, "a".repeat(64))).status, "duplicate");
    assert.equal((await listWorkspaceEntitlements(workspaceId))[0]?.status, "active");

    const partialRefund: RazorpayBillingEvent = {
      kind: "refund-processed",
      eventId: "event-billing-refund-0001",
      eventType: "refund.processed",
      providerPaymentId: "pay_billing1234",
      providerRefundId: "rfnd_billing1234",
      amountMinor: 200000,
      currency: "INR",
    };
    await applyRazorpayBillingEvent(partialRefund, "b".repeat(64));
    assert.equal((await listWorkspaceEntitlements(workspaceId))[0]?.status, "active");

    const finalRefund: RazorpayBillingEvent = {
      ...partialRefund,
      eventId: "event-billing-refund-0002",
      providerRefundId: "rfnd_billing5678",
      amountMinor: 299900,
    };
    await applyRazorpayBillingEvent(finalRefund, "c".repeat(64));
    assert.equal((await listWorkspaceEntitlements(workspaceId))[0]?.status, "revoked");
    const checkout = await pool.query<{ status: string; refunded_amount_minor: string }>(
      `select status, refunded_amount_minor::text from billing_checkout_sessions where id = $1`,
      [first.checkout.id],
    );
    assert.deepEqual(checkout.rows[0], { status: "refunded", refunded_amount_minor: "499900" });
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [userId]);
  }
});