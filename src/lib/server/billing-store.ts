import "server-only";

import type { BillingEntitlementKey, BillingPlan, RazorpayBillingEvent } from "@/lib/billing";
import { billingEntitlementForPlan } from "@/lib/billing";
import { getDatabasePool } from "@/lib/server/database";
import { recordProductEvent } from "@/lib/server/product-event-store";

type BillingCheckoutRecord = {
  id: string;
  workspaceId: string | null;
  userId: string | null;
  leadId: string | null;
  customerEmail: string;
  plan: BillingPlan;
  provider: "razorpay" | "payment-link";
  status: string;
  currency: string;
  amountMinor: number;
  providerCheckoutId: string | null;
  providerCheckoutUrl: string | null;
};

type CheckoutRow = {
  id: string;
  workspace_id: string | null;
  user_id: string | null;
  lead_id: string | null;
  customer_email: string;
  plan: BillingPlan;
  provider: "razorpay" | "payment-link";
  status: string;
  currency: string;
  amount_minor: string;
  provider_checkout_id: string | null;
  provider_checkout_url: string | null;
};

export async function createBillingCheckout(input: {
  workspaceId: string | null;
  userId: string | null;
  leadId: string | null;
  customerEmail: string;
  plan: BillingPlan;
  provider: "razorpay";
  amountMinor: number;
  currency: "INR";
  idempotencyKey: string;
}) {
  const result = await getDatabasePool().query<CheckoutRow>(
    `insert into billing_checkout_sessions (
       workspace_id, user_id, lead_id, customer_email, plan, provider, currency,
       amount_minor, idempotency_key
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (idempotency_key) do nothing
     returning id, workspace_id, user_id, lead_id, customer_email, plan, provider, status,
               currency, amount_minor::text, provider_checkout_id, provider_checkout_url`,
    [input.workspaceId, input.userId, input.leadId, input.customerEmail, input.plan, input.provider, input.currency, input.amountMinor, input.idempotencyKey],
  );
  if (result.rows[0]) {
    await recordProductEvent({
      workspaceId: input.workspaceId,
      userId: input.userId,
      eventName: "billing.checkout_started",
      source: "workspace-api",
      status: "started",
    }).catch(() => undefined);
    return { created: true, checkout: mapCheckout(result.rows[0]) };
  }

  const existing = await getDatabasePool().query<CheckoutRow>(
    `select id, workspace_id, user_id, lead_id, customer_email, plan, provider, status,
            currency, amount_minor::text, provider_checkout_id, provider_checkout_url
     from billing_checkout_sessions where idempotency_key = $1`,
    [input.idempotencyKey],
  );
  const checkout = existing.rows[0] ? mapCheckout(existing.rows[0]) : null;
  if (!checkout
    || checkout.workspaceId !== input.workspaceId
    || checkout.userId !== input.userId
    || checkout.leadId !== input.leadId
    || checkout.customerEmail.toLowerCase() !== input.customerEmail.toLowerCase()
    || checkout.plan !== input.plan) {
    throw new Error("Checkout idempotency key is already bound to another request.");
  }
  return { created: false, checkout };
}

const publicCheckoutStatuses = ["created", "pending", "paid", "failed", "cancelled", "expired", "refunded"] as const;
export type PublicCheckoutStatus = {
  id: string;
  status: (typeof publicCheckoutStatuses)[number];
  plan: BillingPlan;
  currency: string;
  amountMinor: number;
  paidAt: string | null;
  refundedAt: string | null;
};

// Deliberately excludes customer_email, lead_id, and provider identifiers:
// the checkout UUID acts as an unguessable capability for status viewing only.
export async function getPublicCheckoutStatus(checkoutId: string): Promise<PublicCheckoutStatus | null> {
  const result = await getDatabasePool().query<{
    id: string;
    status: PublicCheckoutStatus["status"];
    plan: BillingPlan;
    currency: string;
    amount_minor: string;
    paid_at: Date | null;
    refunded_at: Date | null;
  }>(
    `select id, status, plan, currency, amount_minor::text, paid_at, refunded_at
     from billing_checkout_sessions where id = $1`,
    [checkoutId],
  );
  const row = result.rows[0];
  if (!row || !publicCheckoutStatuses.includes(row.status)) return null;
  return {
    id: row.id,
    status: row.status,
    plan: row.plan,
    currency: row.currency,
    amountMinor: Number(row.amount_minor),
    paidAt: row.paid_at ? row.paid_at.toISOString() : null,
    refundedAt: row.refunded_at ? row.refunded_at.toISOString() : null,
  };
}

export async function attachBillingProviderCheckout(input: { checkoutId: string; providerCheckoutId: string; paymentUrl: string }) {
  const result = await getDatabasePool().query<CheckoutRow>(
    `update billing_checkout_sessions
     set provider_checkout_id = $2,
         provider_checkout_url = $3,
         status = 'pending',
       failed_at = null,
         updated_at = now()
     where id = $1 and provider = 'razorpay' and status in ('created', 'failed')
     returning id, workspace_id, user_id, lead_id, customer_email, plan, provider, status,
               currency, amount_minor::text, provider_checkout_id, provider_checkout_url`,
    [input.checkoutId, input.providerCheckoutId, input.paymentUrl],
  );
  if (!result.rows[0]) throw new Error("Billing checkout could not be attached to Razorpay.");
  return mapCheckout(result.rows[0]);
}

export async function markBillingCheckoutFailed(checkoutId: string) {
  await getDatabasePool().query(
    `update billing_checkout_sessions
     set status = 'failed', failed_at = now(), updated_at = now()
     where id = $1 and status = 'created'`,
    [checkoutId],
  );
}

export async function applyRazorpayBillingEvent(event: RazorpayBillingEvent, payloadHash: string) {
  const client = await getDatabasePool().connect();
  try {
    await client.query("begin");
    const inserted = await client.query<{ id: string }>(
      `insert into billing_webhook_events (provider, external_event_id, event_type, payload_hash)
       values ('razorpay', $1, $2, $3)
       on conflict (provider, external_event_id) do nothing
       returning id`,
      [event.eventId, event.eventType, payloadHash],
    );
    if (!inserted.rows[0]) {
      await client.query("commit");
      return { status: "duplicate" as const };
    }

    if (event.kind === "ignored") {
      await finishWebhook(client, event.eventId, "ignored", null);
      await client.query("commit");
      return { status: "ignored" as const };
    }

    let checkout: { id: string; workspace_id: string | null; user_id: string | null; plan: BillingPlan; amount_minor: string; refunded_amount_minor: string } | undefined;
    if (event.kind === "paid") {
      const result = await client.query<typeof checkout & object>(
        `select id, workspace_id, user_id, plan, amount_minor::text, refunded_amount_minor::text
         from billing_checkout_sessions
         where id = $1 and provider = 'razorpay' and provider_checkout_id = $2
         for update`,
        [event.checkoutId, event.providerCheckoutId],
      );
      checkout = result.rows[0];
      if (!checkout || Number(checkout.amount_minor) !== event.amountMinor || event.currency !== "INR") {
        await finishWebhook(client, event.eventId, "failed", "checkout_mismatch");
        await client.query("commit");
        return { status: "rejected" as const };
      }
      await client.query(
        `update billing_checkout_sessions
         set status = 'paid', provider_payment_id = $2, paid_at = coalesce(paid_at, now()), failed_at = null, updated_at = now()
         where id = $1 and status in ('created', 'pending', 'failed', 'paid')`,
        [checkout.id, event.providerPaymentId],
      );
      await recordProductEvent({
        workspaceId: checkout.workspace_id,
        userId: checkout.user_id,
        eventName: "billing.payment_settled",
        source: "workspace-api",
        status: "succeeded",
      }, client);
      if (checkout.workspace_id) await activateEntitlement(client, checkout.workspace_id, checkout.id, checkout.plan);
    } else if (event.kind === "cancelled" || event.kind === "expired") {
      const result = await client.query<typeof checkout & object>(
        `update billing_checkout_sessions
         set status = $3, updated_at = now()
         where id = $1 and provider_checkout_id = $2 and status in ('created', 'pending', 'failed')
         returning id, workspace_id, user_id, plan, amount_minor::text, refunded_amount_minor::text`,
        [event.checkoutId, event.providerCheckoutId, event.kind],
      );
      checkout = result.rows[0];
    } else if (event.kind === "refund-processed") {
      const result = await client.query<typeof checkout & object>(
        `select id, workspace_id, user_id, plan, amount_minor::text, refunded_amount_minor::text
         from billing_checkout_sessions
         where provider = 'razorpay' and provider_payment_id = $1
         for update`,
        [event.providerPaymentId],
      );
      checkout = result.rows[0];
      if (!checkout) {
        await finishWebhook(client, event.eventId, "ignored", "payment_not_found");
        await client.query("commit");
        return { status: "ignored" as const };
      }
      const refunded = Math.min(Number(checkout.amount_minor), Number(checkout.refunded_amount_minor) + event.amountMinor);
      const fullyRefunded = refunded >= Number(checkout.amount_minor);
      await client.query(
        `update billing_checkout_sessions
         set refunded_amount_minor = $2,
             status = case when $3 then 'refunded' else status end,
             refunded_at = case when $3 then now() else refunded_at end,
             updated_at = now()
         where id = $1`,
        [checkout.id, refunded, fullyRefunded],
      );
      if (fullyRefunded && checkout.workspace_id) {
        await client.query(
          `update workspace_entitlements
           set status = 'revoked', revoked_at = now(), updated_at = now()
           where workspace_id = $1 and source_checkout_session_id = $2 and status = 'active'`,
          [checkout.workspace_id, checkout.id],
        );
      }
      await recordProductEvent({
        workspaceId: checkout.workspace_id,
        userId: checkout.user_id,
        eventName: "billing.payment_refunded",
        source: "workspace-api",
        status: fullyRefunded ? "succeeded" : "partial",
      }, client);
    } else {
      throw new Error("Unsupported billing event state.");
    }

    if (checkout?.workspace_id) {
      await client.query(
        `insert into audit_log (workspace_id, user_id, action, entity_type, entity_id, metadata)
         values ($1, $2, $3, 'billing_checkout', $4, jsonb_build_object('eventType', $5::text))`,
        [checkout.workspace_id, checkout.user_id, `billing.${event.kind}`, checkout.id, event.eventType],
      );
    }
    await finishWebhook(client, event.eventId, "processed", null);
    await client.query("commit");
    return { status: "processed" as const, checkoutId: checkout?.id ?? null };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function listWorkspaceEntitlements(workspaceId: string) {
  const result = await getDatabasePool().query<{
    entitlement_key: BillingEntitlementKey;
    status: "active" | "revoked" | "expired";
    starts_at: Date;
    expires_at: Date;
    updated_at: Date;
  }>(
    `update workspace_entitlements
     set status = 'expired', updated_at = now()
     where workspace_id = $1 and status = 'active' and expires_at <= now()
     returning entitlement_key, status, starts_at, expires_at, updated_at`,
    [workspaceId],
  );
  const rows = await getDatabasePool().query<{
    entitlement_key: BillingEntitlementKey;
    status: "active" | "revoked" | "expired";
    starts_at: Date;
    expires_at: Date;
    updated_at: Date;
  }>(
    `select entitlement_key, status, starts_at, expires_at, updated_at
     from workspace_entitlements where workspace_id = $1 order by entitlement_key`,
    [workspaceId],
  );
  void result;
  return rows.rows.map((row) => ({
    key: row.entitlement_key,
    status: row.status,
    startsAt: row.starts_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }));
}

async function activateEntitlement(client: import("pg").PoolClient, workspaceId: string, checkoutId: string, plan: BillingPlan) {
  const entitlement = billingEntitlementForPlan(plan);
  await client.query(
    `insert into workspace_entitlements (
       workspace_id, entitlement_key, source_checkout_session_id, status, starts_at, expires_at
     ) values ($1, $2, $3, 'active', now(), now() + ($4 * interval '1 day'))
     on conflict (workspace_id, entitlement_key)
     do update set source_checkout_session_id = excluded.source_checkout_session_id,
                   status = 'active',
                   starts_at = least(workspace_entitlements.starts_at, now()),
                   expires_at = greatest(workspace_entitlements.expires_at, now()) + ($4 * interval '1 day'),
                   revoked_at = null,
                   updated_at = now()`,
    [workspaceId, entitlement.key, checkoutId, entitlement.durationDays],
  );
}

async function finishWebhook(client: import("pg").PoolClient, eventId: string, status: "processed" | "ignored" | "failed", errorCode: string | null) {
  await client.query(
    `update billing_webhook_events
     set status = $2, error_code = $3, processed_at = now()
     where provider = 'razorpay' and external_event_id = $1`,
    [eventId, status, errorCode],
  );
}

function mapCheckout(row: CheckoutRow): BillingCheckoutRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    leadId: row.lead_id,
    customerEmail: row.customer_email,
    plan: row.plan,
    provider: row.provider,
    status: row.status,
    currency: row.currency,
    amountMinor: Number(row.amount_minor),
    providerCheckoutId: row.provider_checkout_id,
    providerCheckoutUrl: row.provider_checkout_url,
  };
}