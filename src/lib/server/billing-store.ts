import "server-only";

import type { AssistedAuditOrderAction, AssistedAuditOrderStatus, BillingEntitlementKey, BillingPlan, RazorpayBillingEvent } from "@/lib/billing";
import { isAssistedAuditPlan, transitionAssistedAuditOrder } from "@/lib/billing";
import { publicOffer } from "@/lib/public-offer";
import { getDatabasePool } from "@/lib/server/database";
import { recordProductEvent } from "@/lib/server/product-event-store";

type BillingCheckoutRecord = {
  id: string;
  workspaceId: string | null;
  userId: string | null;
  leadId: string | null;
  customerEmail: string;
  plan: BillingPlan;
  offerId: string;
  offerVersion: number;
  termsVersion: string;
  provider: "razorpay" | "payment-link";
  status: string;
  currency: string;
  amountMinor: number;
  providerCheckoutId: string | null;
  providerCheckoutUrl: string | null;
  providerCreationStartedAt: string | null;
};

type CheckoutRow = {
  id: string;
  workspace_id: string | null;
  user_id: string | null;
  lead_id: string | null;
  customer_email: string;
  plan: BillingPlan;
  offer_id: string;
  offer_version: number;
  terms_version: string;
  provider: "razorpay" | "payment-link";
  status: string;
  currency: string;
  amount_minor: string;
  provider_checkout_id: string | null;
  provider_checkout_url: string | null;
  provider_creation_started_at: Date | null;
};

export class BillingCheckoutIdempotencyConflictError extends Error {
  constructor() {
    super("Checkout idempotency key is already bound to another request.");
    this.name = "BillingCheckoutIdempotencyConflictError";
  }
}

export async function createBillingCheckout(input: {
  workspaceId: string | null;
  userId: string | null;
  leadId: string | null;
  customerEmail: string;
  plan: BillingPlan;
  offerId: string;
  offerVersion: number;
  termsVersion: string;
  provider: "razorpay";
  amountMinor: number;
  currency: "INR";
  idempotencyKey: string;
}) {
  const result = await getDatabasePool().query<CheckoutRow>(
    `insert into billing_checkout_sessions (
       workspace_id, user_id, lead_id, customer_email, plan, offer_id,
       offer_version, terms_version, provider, currency, amount_minor, idempotency_key
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    on conflict do nothing
     returning id, workspace_id, user_id, lead_id, customer_email, plan, offer_id,
               offer_version, terms_version, provider, status,
               currency, amount_minor::text, provider_checkout_id, provider_checkout_url,
               provider_creation_started_at`,
    [
      input.workspaceId,
      input.userId,
      input.leadId,
      input.customerEmail,
      input.plan,
      input.offerId,
      input.offerVersion,
      input.termsVersion,
      input.provider,
      input.currency,
      input.amountMinor,
      input.idempotencyKey,
    ],
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
    `select id, workspace_id, user_id, lead_id, customer_email, plan, offer_id,
            offer_version, terms_version, provider, status,
            currency, amount_minor::text, provider_checkout_id, provider_checkout_url,
            provider_creation_started_at
     from billing_checkout_sessions
     where idempotency_key = $1
        or ($2::uuid is not null
            and lead_id = $2
            and plan = $3
            and offer_id = $4
            and offer_version = $5)
     order by (idempotency_key = $1) desc
     limit 1`,
    [input.idempotencyKey, input.leadId, input.plan, input.offerId, input.offerVersion],
  );
  const checkout = existing.rows[0] ? mapCheckout(existing.rows[0]) : null;
  if (!checkout
    || checkout.workspaceId !== input.workspaceId
    || checkout.userId !== input.userId
    || checkout.leadId !== input.leadId
    || checkout.customerEmail.toLowerCase() !== input.customerEmail.toLowerCase()
    || checkout.plan !== input.plan
    || checkout.offerId !== input.offerId
    || checkout.offerVersion !== input.offerVersion
    || checkout.termsVersion !== input.termsVersion
    || checkout.provider !== input.provider
    || checkout.amountMinor !== input.amountMinor
    || checkout.currency !== input.currency) {
    throw new BillingCheckoutIdempotencyConflictError();
  }
  return { created: false, checkout };
}

const publicCheckoutStatuses = ["created", "pending", "paid", "partially_refunded", "failed", "reconciliation_required", "cancelled", "expired", "refunded"] as const;
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
         provider_creation_started_at = null,
         failed_at = null,
         updated_at = now()
     where id = $1 and provider = 'razorpay' and status in ('created', 'failed', 'reconciliation_required')
     returning id, workspace_id, user_id, lead_id, customer_email, plan, offer_id,
               offer_version, terms_version, provider, status,
               currency, amount_minor::text, provider_checkout_id, provider_checkout_url,
               provider_creation_started_at`,
    [input.checkoutId, input.providerCheckoutId, input.paymentUrl],
  );
  if (!result.rows[0]) throw new Error("Billing checkout could not be attached to Razorpay.");
  return mapCheckout(result.rows[0]);
}

export async function claimBillingProviderCreation(checkoutId: string) {
  const result = await getDatabasePool().query<{ id: string }>(
    `update billing_checkout_sessions
     set provider_creation_started_at = now(), updated_at = now()
     where id = $1
       and provider = 'razorpay'
       and provider_checkout_url is null
       and provider_creation_started_at is null
       and status in ('created', 'failed')
     returning id`,
    [checkoutId],
  );
  return Boolean(result.rows[0]);
}

export async function releaseRejectedBillingProviderCreation(checkoutId: string) {
  await getDatabasePool().query(
    `update billing_checkout_sessions
     set status = 'failed', failed_at = now(), provider_creation_started_at = null, updated_at = now()
     where id = $1 and provider_checkout_url is null and status in ('created', 'failed')`,
    [checkoutId],
  );
}

export async function markBillingProviderCreationUncertain(checkoutId: string) {
  await getDatabasePool().query(
    `update billing_checkout_sessions
     set status = 'reconciliation_required', failed_at = now(), updated_at = now()
     where id = $1 and provider_checkout_url is null and status in ('created', 'failed')`,
    [checkoutId],
  );
}

export async function getBillingCheckoutForRecovery(checkoutId: string) {
  const result = await getDatabasePool().query<CheckoutRow>(
    `select id, workspace_id, user_id, lead_id, customer_email, plan, offer_id,
            offer_version, terms_version, provider, status, currency,
          amount_minor::text, provider_checkout_id, provider_checkout_url,
          provider_creation_started_at
     from billing_checkout_sessions
     where id = $1 and provider = 'razorpay'`,
    [checkoutId],
  );
  return result.rows[0] ? mapCheckout(result.rows[0]) : null;
}

export async function releaseBillingProviderCreationAfterVerifiedAbsence(checkoutId: string) {
  const result = await getDatabasePool().query<{ id: string }>(
    `update billing_checkout_sessions
     set status = 'failed', failed_at = now(), provider_creation_started_at = null, updated_at = now()
     where id = $1
       and provider = 'razorpay'
      and status in ('created', 'failed', 'reconciliation_required')
       and provider_checkout_id is null
       and provider_checkout_url is null
      and provider_creation_started_at < now() - interval '15 minutes'
     returning id`,
    [checkoutId],
  );
  return Boolean(result.rows[0]);
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

    let checkout: BillingEventCheckout | undefined;
    if (event.kind === "paid") {
      const result = await client.query<BillingEventCheckout>(
        `select id, workspace_id, user_id, lead_id, plan, offer_id, offer_version,
                terms_version, currency, status, provider_payment_id,
                amount_minor::text, refunded_amount_minor::text
         from billing_checkout_sessions
         where id = $1 and provider = 'razorpay' and provider_checkout_id = $2
         for update`,
        [event.checkoutId, event.providerCheckoutId],
      );
      checkout = result.rows[0];
      if (!checkout || Number(checkout.amount_minor) !== event.amountMinor || event.currency !== checkout.currency) {
        await finishWebhook(client, event.eventId, "failed", "checkout_mismatch");
        await client.query("commit");
        return { status: "rejected" as const };
      }
      if (checkout.provider_payment_id && checkout.provider_payment_id !== event.providerPaymentId) {
        await finishWebhook(client, event.eventId, "failed", "payment_id_conflict");
        await client.query("commit");
        return { status: "rejected" as const };
      }
      if (["paid", "partially_refunded", "refunded"].includes(checkout.status)) {
        await finishWebhook(client, event.eventId, "ignored", "payment_already_applied");
        await client.query("commit");
        return { status: "duplicate" as const };
      }
      const transitioned = await client.query<{ id: string }>(
        `update billing_checkout_sessions
         set status = 'paid', provider_payment_id = $2, paid_at = coalesce(paid_at, now()), failed_at = null, updated_at = now()
         where id = $1 and status in ('created', 'pending', 'failed', 'reconciliation_required', 'cancelled', 'expired')
         returning id`,
        [checkout.id, event.providerPaymentId],
      );
      if (!transitioned.rows[0]) {
        await finishWebhook(client, event.eventId, "ignored", "payment_transition_rejected");
        await client.query("commit");
        return { status: "duplicate" as const };
      }
      await recordProductEvent({
        workspaceId: checkout.workspace_id,
        userId: checkout.user_id,
        eventName: "billing.payment_settled",
        source: "workspace-api",
        status: "succeeded",
      }, client);
      if (isCurrentAssistedAuditCheckout(checkout)) {
        await createAssistedAuditOrder(client, checkout, "pending");
      } else if (checkout.plan === publicOffer.legacyPlan) {
        await createAssistedAuditOrder(client, checkout, "review_required");
      }
      await applyPendingRefunds(client, checkout, event.providerPaymentId);
    } else if (event.kind === "cancelled" || event.kind === "expired") {
      const result = await client.query<BillingEventCheckout>(
        `update billing_checkout_sessions
         set status = $3, updated_at = now()
         where id = $1 and provider_checkout_id = $2 and status in ('created', 'pending', 'failed', 'reconciliation_required')
         returning id, workspace_id, user_id, lead_id, plan, offer_id, offer_version,
                   terms_version, currency, status, provider_payment_id,
                   amount_minor::text, refunded_amount_minor::text`,
        [event.checkoutId, event.providerCheckoutId, event.kind],
      );
      checkout = result.rows[0];
    } else if (event.kind === "refund-processed") {
      const refundInsert = await client.query<{ id: string }>(
        `insert into billing_refunds (
           provider, provider_refund_id, provider_payment_id, amount_minor, currency, status
         ) values ('razorpay', $1, $2, $3, $4, 'pending_payment')
         on conflict (provider, provider_refund_id) do nothing
         returning id`,
        [event.providerRefundId, event.providerPaymentId, event.amountMinor, event.currency],
      );
      if (!refundInsert.rows[0]) {
        await finishWebhook(client, event.eventId, "ignored", "refund_already_applied");
        await client.query("commit");
        return { status: "duplicate" as const };
      }
      const result = await client.query<BillingEventCheckout>(
        `select id, workspace_id, user_id, lead_id, plan, offer_id, offer_version,
                terms_version, currency, status, provider_payment_id,
                amount_minor::text, refunded_amount_minor::text
         from billing_checkout_sessions
         where provider = 'razorpay' and provider_payment_id = $1
         for update`,
        [event.providerPaymentId],
      );
      checkout = result.rows[0];
      if (!checkout) {
        await finishWebhook(client, event.eventId, "processed", "refund_pending_payment");
        await client.query("commit");
        return { status: "pending" as const };
      }
      const applied = await applyRefund(client, checkout, {
        providerRefundId: event.providerRefundId,
        amountMinor: event.amountMinor,
        currency: event.currency,
      });
      if (!applied) {
        await finishWebhook(client, event.eventId, "failed", "refund_mismatch");
        await client.query("commit");
        return { status: "rejected" as const };
      }
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

export async function transitionAssistedAuditOrderByCheckout(input: {
  checkoutId: string;
  action: AssistedAuditOrderAction;
}) {
  const client = await getDatabasePool().connect();
  try {
    await client.query("begin");
    const current = await client.query<{
      id: string;
      status: AssistedAuditOrderStatus;
      workspace_id: string | null;
      user_id: string | null;
    }>(
      `select id, status, workspace_id, user_id
       from assisted_audit_orders
       where checkout_session_id = $1
       for update`,
      [input.checkoutId],
    );
    const order = current.rows[0];
    if (!order) {
      await client.query("rollback");
      return { status: "not-found" as const };
    }
    if (input.action === "cancel") {
      await client.query("rollback");
      return {
        status: "refund-required" as const,
        currentStatus: order.status,
        message: "A settled assisted audit becomes terminal only after Razorpay's signed full-refund webhook is applied.",
      };
    }
    const nextStatus = transitionAssistedAuditOrder(order.status, input.action);
    if (!nextStatus) {
      await client.query("rollback");
      return { status: "invalid-transition" as const, currentStatus: order.status };
    }

    const updated = await client.query<{
      id: string;
      status: AssistedAuditOrderStatus;
      started_at: Date | null;
      delivered_at: Date | null;
      updated_at: Date;
    }>(
      `update assisted_audit_orders
       set status = $2,
           started_at = case when $2 = 'in_progress' then coalesce(started_at, now()) else started_at end,
           delivered_at = case when $2 = 'delivered' then coalesce(delivered_at, now()) else delivered_at end,
           updated_at = now()
       where id = $1
       returning id, status, started_at, delivered_at, updated_at`,
      [order.id, nextStatus],
    );
    if (order.workspace_id) {
      await client.query(
        `insert into audit_log (workspace_id, user_id, action, entity_type, entity_id, metadata)
         values ($1, $2, $3, 'assisted_audit_order', $4, jsonb_build_object('checkoutId', $5::text, 'status', $6::text))`,
        [order.workspace_id, order.user_id, `billing.assisted_audit.${input.action}`, order.id, input.checkoutId, nextStatus],
      );
    }
    await client.query("commit");
    const result = updated.rows[0];
    return {
      status: "updated" as const,
      order: {
        id: result.id,
        status: result.status,
        startedAt: result.started_at?.toISOString() ?? null,
        deliveredAt: result.delivered_at?.toISOString() ?? null,
        updatedAt: result.updated_at.toISOString(),
      },
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

type BillingEventCheckout = {
  id: string;
  workspace_id: string | null;
  user_id: string | null;
  lead_id: string | null;
  plan: BillingPlan;
  offer_id: string;
  offer_version: number;
  terms_version: string;
  currency: string;
  status: string;
  provider_payment_id: string | null;
  amount_minor: string;
  refunded_amount_minor: string;
};

async function createAssistedAuditOrder(
  client: import("pg").PoolClient,
  checkout: BillingEventCheckout,
  status: Extract<AssistedAuditOrderStatus, "pending" | "review_required">,
) {
  await client.query(
    `insert into assisted_audit_orders (
       checkout_session_id, workspace_id, user_id, lead_id,
       offer_id, offer_version, terms_version, status
     ) values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (checkout_session_id) do nothing`,
    [checkout.id, checkout.workspace_id, checkout.user_id, checkout.lead_id, checkout.offer_id, checkout.offer_version, checkout.terms_version, status],
  );
}

function isCurrentAssistedAuditCheckout(checkout: BillingEventCheckout) {
  return checkout.plan === publicOffer.plan
    && checkout.offer_id === publicOffer.id
    && checkout.offer_version === publicOffer.version
    && checkout.terms_version === publicOffer.termsVersion
    && checkout.currency === publicOffer.currency
    && Number(checkout.amount_minor) === publicOffer.amountMinor;
}

async function applyPendingRefunds(client: import("pg").PoolClient, checkout: BillingEventCheckout, providerPaymentId: string) {
  const pending = await client.query<{ provider_refund_id: string; amount_minor: string; currency: string }>(
    `select provider_refund_id, amount_minor::text, currency
     from billing_refunds
     where provider = 'razorpay' and provider_payment_id = $1 and status = 'pending_payment'
     order by created_at, id
     for update`,
    [providerPaymentId],
  );
  for (const refund of pending.rows) {
    const current = await loadBillingEventCheckout(client, checkout.id);
    if (!current) throw new Error("Billing checkout disappeared while applying refunds.");
    await applyRefund(client, current, {
      providerRefundId: refund.provider_refund_id,
      amountMinor: Number(refund.amount_minor),
      currency: refund.currency,
    });
  }
}

async function applyRefund(
  client: import("pg").PoolClient,
  checkout: BillingEventCheckout,
  refund: { providerRefundId: string; amountMinor: number; currency: string },
) {
  const nextRefunded = Number(checkout.refunded_amount_minor) + refund.amountMinor;
  const total = Number(checkout.amount_minor);
  if (refund.currency !== checkout.currency || !Number.isSafeInteger(nextRefunded) || nextRefunded > total) {
    await client.query(
      `update billing_refunds
       set checkout_session_id = $2,
           status = 'rejected',
           rejection_code = 'amount_or_currency_mismatch'
       where provider = 'razorpay' and provider_refund_id = $1 and status = 'pending_payment'`,
      [refund.providerRefundId, checkout.id],
    );
    return false;
  }

  const fullyRefunded = nextRefunded === total;
  await client.query(
    `update billing_checkout_sessions
     set refunded_amount_minor = $2,
         status = case when $3 then 'refunded' else 'partially_refunded' end,
         refunded_at = case when $3 then now() else refunded_at end,
         updated_at = now()
     where id = $1`,
    [checkout.id, nextRefunded, fullyRefunded],
  );
  await client.query(
    `update billing_refunds
     set checkout_session_id = $2, status = 'applied', applied_at = now()
     where provider = 'razorpay' and provider_refund_id = $1 and status = 'pending_payment'`,
    [refund.providerRefundId, checkout.id],
  );

  if (fullyRefunded && isAssistedAuditPlan(checkout.plan)) {
    await client.query(
      `update assisted_audit_orders
       set status = 'refunded', refunded_at = now(), updated_at = now()
       where checkout_session_id = $1 and status <> 'refunded'`,
      [checkout.id],
    );
  }
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
  return true;
}

async function loadBillingEventCheckout(client: import("pg").PoolClient, checkoutId: string) {
  const result = await client.query<BillingEventCheckout>(
    `select id, workspace_id, user_id, lead_id, plan, offer_id, offer_version,
            terms_version, currency, status, provider_payment_id,
            amount_minor::text, refunded_amount_minor::text
     from billing_checkout_sessions where id = $1 for update`,
    [checkoutId],
  );
  return result.rows[0];
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
    offerId: row.offer_id,
    offerVersion: row.offer_version,
    termsVersion: row.terms_version,
    provider: row.provider,
    status: row.status,
    currency: row.currency,
    amountMinor: Number(row.amount_minor),
    providerCheckoutId: row.provider_checkout_id,
    providerCheckoutUrl: row.provider_checkout_url,
    providerCreationStartedAt: row.provider_creation_started_at?.toISOString() ?? null,
  };
}
