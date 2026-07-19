import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import type { RazorpayBillingEvent } from "../../src/lib/billing";
import {
  applyRazorpayBillingEvent,
  attachBillingProviderCheckout,
  createBillingCheckout,
  releaseBillingProviderCreationAfterVerifiedAbsence,
  transitionAssistedAuditOrderByCheckout,
} from "../../src/lib/server/billing-store";
import { getDatabasePool } from "../../src/lib/server/database";
import { publicOffer } from "../../src/lib/public-offer";

const databaseConfigured = Boolean(process.env.DATABASE_URL);

test("assisted-audit settlement is semantic-idempotent and creates one order without an entitlement", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const pool = getDatabasePool();
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const leadId = randomUUID();
  const idempotencyKey = `billing-test-${randomUUID()}`;
  const providerSuffix = randomUUID().replaceAll("-", "");
  const providerCheckoutId = `plink_${providerSuffix}`;
  const providerPaymentId = `pay_${providerSuffix}`;
  const eventPrefix = `event-${providerSuffix}`;

  try {
    await pool.query(`insert into users (id, email) values ($1, $2)`, [userId, `${userId}@billing.test`]);
    await pool.query(`insert into workspaces (id, owner_user_id, name) values ($1, $2, 'Billing test')`, [workspaceId, userId]);
    await pool.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [workspaceId, userId]);
    await pool.query(
      `insert into private_audit_leads (id, source, name, email, persona)
       values ($1, 'billing-test', 'Billing test', $2, 'individual')`,
      [leadId, `${userId}@billing.test`],
    );

    const first = await createBillingCheckout({
      workspaceId,
      userId,
      leadId,
      customerEmail: `${userId}@billing.test`,
      plan: publicOffer.plan,
      offerId: publicOffer.id,
      offerVersion: publicOffer.version,
      termsVersion: publicOffer.termsVersion,
      provider: "razorpay",
      amountMinor: publicOffer.amountMinor,
      currency: "INR",
      idempotencyKey,
    });
    const replay = await createBillingCheckout({
      workspaceId,
      userId,
      leadId,
      customerEmail: `${userId}@billing.test`,
      plan: publicOffer.plan,
      offerId: publicOffer.id,
      offerVersion: publicOffer.version,
      termsVersion: publicOffer.termsVersion,
      provider: "razorpay",
      amountMinor: publicOffer.amountMinor,
      currency: "INR",
      idempotencyKey,
    });
    assert.equal(first.created, true);
    assert.equal(replay.created, false);
    assert.equal(replay.checkout.id, first.checkout.id);

    await attachBillingProviderCheckout({
      checkoutId: first.checkout.id,
      providerCheckoutId,
      paymentUrl: "https://rzp.io/rzp/test1234",
    });
    const paid: RazorpayBillingEvent = {
      kind: "paid",
      eventId: `${eventPrefix}-paid-1`,
      eventType: "payment_link.paid",
      checkoutId: first.checkout.id,
      providerCheckoutId,
      providerPaymentId,
      amountMinor: publicOffer.amountMinor,
      currency: "INR",
    };
    assert.equal((await applyRazorpayBillingEvent(paid, "a".repeat(64))).status, "processed");
    assert.equal((await applyRazorpayBillingEvent(paid, "a".repeat(64))).status, "duplicate");
    assert.equal((await applyRazorpayBillingEvent({ ...paid, eventId: `${eventPrefix}-paid-2` }, "d".repeat(64))).status, "duplicate");
    assert.equal((await pool.query(`select count(*)::int as count from assisted_audit_orders where checkout_session_id = $1`, [first.checkout.id])).rows[0].count, 1);
    assert.equal((await pool.query(`select count(*)::int as count from workspace_entitlements where source_checkout_session_id = $1`, [first.checkout.id])).rows[0].count, 0);

    const partialRefund: RazorpayBillingEvent = {
      kind: "refund-processed",
      eventId: `${eventPrefix}-refund-1`,
      eventType: "refund.processed",
      providerPaymentId,
      providerRefundId: `rfnd_${providerSuffix}_1`,
      amountMinor: 40_000,
      currency: "INR",
    };
    assert.equal((await applyRazorpayBillingEvent(partialRefund, "b".repeat(64))).status, "processed");
    assert.equal((await applyRazorpayBillingEvent({ ...partialRefund, eventId: `${eventPrefix}-refund-duplicate` }, "e".repeat(64))).status, "duplicate");
    assert.equal((await transitionAssistedAuditOrderByCheckout({ checkoutId: first.checkout.id, action: "start" })).status, "updated");
    assert.equal((await transitionAssistedAuditOrderByCheckout({ checkoutId: first.checkout.id, action: "deliver" })).status, "updated");

    const finalRefund: RazorpayBillingEvent = {
      ...partialRefund,
      eventId: `${eventPrefix}-refund-2`,
      providerRefundId: `rfnd_${providerSuffix}_2`,
      amountMinor: publicOffer.amountMinor - partialRefund.amountMinor,
    };
    assert.equal((await applyRazorpayBillingEvent(finalRefund, "c".repeat(64))).status, "processed");
    assert.equal((await applyRazorpayBillingEvent({ ...paid, eventId: `${eventPrefix}-paid-after-refund` }, "f".repeat(64))).status, "duplicate");
    const checkout = await pool.query<{ status: string; refunded_amount_minor: string }>(
      `select status, refunded_amount_minor::text from billing_checkout_sessions where id = $1`,
      [first.checkout.id],
    );
    assert.deepEqual(checkout.rows[0], { status: "refunded", refunded_amount_minor: String(publicOffer.amountMinor) });
    assert.equal((await pool.query(`select status from assisted_audit_orders where checkout_session_id = $1`, [first.checkout.id])).rows[0].status, "refunded");
  } finally {
    await pool.query(`delete from workspaces where id = $1`, [workspaceId]);
    await pool.query(`delete from users where id = $1`, [userId]);
  }
});

test("a refund delivered before payment is retained and applied after settlement", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const pool = getDatabasePool();
  const leadId = randomUUID();
  const email = `${leadId}@billing-order.test`;
  const providerSuffix = randomUUID().replaceAll("-", "");
  const providerCheckoutId = `plink_${providerSuffix}`;
  const providerPaymentId = `pay_${providerSuffix}`;
  const eventPrefix = `event-order-${providerSuffix}`;
  let checkoutId: string | null = null;

  try {
    await pool.query(
      `insert into private_audit_leads (id, source, name, email, persona)
       values ($1, 'billing-order-test', 'Billing order test', $2, 'individual')`,
      [leadId, email],
    );
    const checkout = await createBillingCheckout({
      workspaceId: null,
      userId: null,
      leadId,
      customerEmail: email,
      plan: publicOffer.plan,
      offerId: publicOffer.id,
      offerVersion: publicOffer.version,
      termsVersion: publicOffer.termsVersion,
      provider: "razorpay",
      amountMinor: publicOffer.amountMinor,
      currency: "INR",
      idempotencyKey: `billing-order-${randomUUID()}`,
    });
    checkoutId = checkout.checkout.id;
    await attachBillingProviderCheckout({ checkoutId, providerCheckoutId, paymentUrl: "https://rzp.io/rzp/order123" });

    const refund: RazorpayBillingEvent = {
      kind: "refund-processed",
      eventId: `${eventPrefix}-refund-1`,
      eventType: "refund.processed",
      providerPaymentId,
      providerRefundId: `rfnd_${providerSuffix}`,
      amountMinor: publicOffer.amountMinor,
      currency: "INR",
    };
    assert.equal((await applyRazorpayBillingEvent(refund, "1".repeat(64))).status, "pending");
    assert.equal((await pool.query(`select status from billing_refunds where provider_refund_id = $1`, [refund.providerRefundId])).rows[0].status, "pending_payment");

    const paid: RazorpayBillingEvent = {
      kind: "paid",
      eventId: `${eventPrefix}-paid-1`,
      eventType: "payment_link.paid",
      checkoutId,
      providerCheckoutId,
      providerPaymentId: refund.providerPaymentId,
      amountMinor: publicOffer.amountMinor,
      currency: "INR",
    };
    assert.equal((await applyRazorpayBillingEvent(paid, "2".repeat(64))).status, "processed");
    assert.deepEqual(
      (await pool.query(`select status, refunded_amount_minor::text from billing_checkout_sessions where id = $1`, [checkoutId])).rows[0],
      { status: "refunded", refunded_amount_minor: String(publicOffer.amountMinor) },
    );
    assert.equal((await pool.query(`select status from billing_refunds where provider_refund_id = $1`, [refund.providerRefundId])).rows[0].status, "applied");
    assert.equal((await pool.query(`select status from assisted_audit_orders where checkout_session_id = $1`, [checkoutId])).rows[0].status, "refunded");
  } finally {
    if (checkoutId) await pool.query(`delete from billing_webhook_events where external_event_id like $1`, [`${eventPrefix}%`]);
    await pool.query(`delete from private_audit_leads where id = $1`, [leadId]);
  }
});

test("a matching signed payment overrides an earlier cancellation or expiry", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const pool = getDatabasePool();

  for (const lifecycleKind of ["cancelled", "expired"] as const) {
    const suffix = randomUUID().replaceAll("-", "");
    const leadId = randomUUID();
    const email = `${leadId}@billing-lifecycle.test`;
    try {
      await pool.query(
        `insert into private_audit_leads (id, source, name, email, persona)
         values ($1, 'billing-lifecycle-test', 'Billing lifecycle test', $2, 'individual')`,
        [leadId, email],
      );
      const checkout = await createBillingCheckout({
        workspaceId: null,
        userId: null,
        leadId,
        customerEmail: email,
        plan: publicOffer.plan,
        offerId: publicOffer.id,
        offerVersion: publicOffer.version,
        termsVersion: publicOffer.termsVersion,
        provider: "razorpay",
        amountMinor: publicOffer.amountMinor,
        currency: "INR",
        idempotencyKey: `lifecycle-${suffix}`,
      });
      const providerCheckoutId = `plink_${suffix.slice(0, 18)}`;
      const providerPaymentId = `pay_${suffix.slice(0, 18)}`;
      await attachBillingProviderCheckout({ checkoutId: checkout.checkout.id, providerCheckoutId, paymentUrl: `https://rzp.io/rzp/${suffix.slice(0, 12)}` });

      const lifecycleEvent: RazorpayBillingEvent = lifecycleKind === "cancelled"
        ? { kind: "cancelled", eventId: `event-cancel-${suffix}`, eventType: "payment_link.cancelled", checkoutId: checkout.checkout.id, providerCheckoutId }
        : { kind: "expired", eventId: `event-expire-${suffix}`, eventType: "payment_link.expired", checkoutId: checkout.checkout.id, providerCheckoutId };
      assert.equal((await applyRazorpayBillingEvent(lifecycleEvent, "3".repeat(64))).status, "processed");

      const paid: RazorpayBillingEvent = {
        kind: "paid",
        eventId: `event-paid-${suffix}`,
        eventType: "payment_link.paid",
        checkoutId: checkout.checkout.id,
        providerCheckoutId,
        providerPaymentId,
        amountMinor: publicOffer.amountMinor,
        currency: "INR",
      };
      assert.equal((await applyRazorpayBillingEvent(paid, "4".repeat(64))).status, "processed");
      assert.equal((await pool.query(`select status from billing_checkout_sessions where id = $1`, [checkout.checkout.id])).rows[0].status, "paid");
      assert.equal((await pool.query(`select count(*)::int as count from assisted_audit_orders where checkout_session_id = $1`, [checkout.checkout.id])).rows[0].count, 1);
    } finally {
      await pool.query(`delete from private_audit_leads where id = $1`, [leadId]);
    }
  }
});

test("one lead and offer replays the same checkout even when the caller changes its key", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const pool = getDatabasePool();
  const leadId = randomUUID();
  const email = `${leadId}@billing-identity.test`;
  try {
    await pool.query(
      `insert into private_audit_leads (id, source, name, email, persona)
       values ($1, 'billing-identity-test', 'Billing identity test', $2, 'individual')`,
      [leadId, email],
    );
    const base = {
      workspaceId: null,
      userId: null,
      leadId,
      customerEmail: email,
      plan: publicOffer.plan,
      offerId: publicOffer.id,
      offerVersion: publicOffer.version,
      termsVersion: publicOffer.termsVersion,
      provider: "razorpay" as const,
      amountMinor: publicOffer.amountMinor,
      currency: "INR" as const,
    };
    const first = await createBillingCheckout({ ...base, idempotencyKey: `lead-offer-a-${randomUUID()}` });
    const second = await createBillingCheckout({ ...base, idempotencyKey: `lead-offer-b-${randomUUID()}` });
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.checkout.id, first.checkout.id);
  } finally {
    await pool.query(`delete from private_audit_leads where id = $1`, [leadId]);
  }
});

test("verified provider absence releases only a stale unresolved creation claim", {
  skip: databaseConfigured ? false : "DATABASE_URL is required for PostgreSQL integration tests.",
}, async () => {
  const pool = getDatabasePool();
  const leadId = randomUUID();
  const email = `${leadId}@billing-recovery.test`;
  try {
    await pool.query(
      `insert into private_audit_leads (id, source, name, email, persona)
       values ($1, 'billing-recovery-test', 'Billing recovery test', $2, 'individual')`,
      [leadId, email],
    );
    const checkout = await createBillingCheckout({
      workspaceId: null,
      userId: null,
      leadId,
      customerEmail: email,
      plan: publicOffer.plan,
      offerId: publicOffer.id,
      offerVersion: publicOffer.version,
      termsVersion: publicOffer.termsVersion,
      provider: "razorpay",
      amountMinor: publicOffer.amountMinor,
      currency: "INR",
      idempotencyKey: `billing-recovery-${randomUUID()}`,
    });
    await pool.query(
      `update billing_checkout_sessions
       set provider_creation_started_at = now(), status = 'created'
       where id = $1`,
      [checkout.checkout.id],
    );
    assert.equal(await releaseBillingProviderCreationAfterVerifiedAbsence(checkout.checkout.id), false, "fresh claims stay locked");

    await pool.query(
      `update billing_checkout_sessions
       set provider_creation_started_at = now() - interval '16 minutes'
       where id = $1`,
      [checkout.checkout.id],
    );
    assert.equal(await releaseBillingProviderCreationAfterVerifiedAbsence(checkout.checkout.id), true);
    assert.deepEqual(
      (await pool.query(`select status, provider_creation_started_at from billing_checkout_sessions where id = $1`, [checkout.checkout.id])).rows[0],
      { status: "failed", provider_creation_started_at: null },
    );
  } finally {
    await pool.query(`delete from private_audit_leads where id = $1`, [leadId]);
  }
});
