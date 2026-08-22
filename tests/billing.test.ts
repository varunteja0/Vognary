import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

import { billingEntitlementForPlan, parseRazorpayBillingEvent, publicOffer, verifyRazorpayWebhookSignature } from "../src/lib/billing";
import { productEventNames } from "../src/lib/product-events";

const root = fileURLToPath(new URL("../", import.meta.url));
const checkoutId = "123e4567-e89b-42d3-a456-426614174001";

function source(relativePath: string) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

test("Razorpay webhook signatures validate the untouched raw body", () => {
  const raw = JSON.stringify({ event: "payment_link.paid" });
  const secret = "webhook-test-secret";
  const signature = createHmac("sha256", secret).update(raw).digest("hex");
  assert.equal(verifyRazorpayWebhookSignature(raw, signature, secret), true);
  assert.equal(verifyRazorpayWebhookSignature(`${raw} `, signature, secret), false);
});

test("Razorpay webhook replay identity comes from the signed raw body", () => {
  const route = source("src/app/api/billing/webhooks/razorpay/route.ts");
  assert.doesNotMatch(route, /x-razorpay-event-id/i);
  assert.match(route, /const payloadHash = hashBillingPayload\(rawBody\)/);
  assert.match(route, /parseRazorpayBillingEvent\(JSON\.parse\(rawBody\), `razorpay:\$\{payloadHash\}`\)/);
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
  assert.equal(billingEntitlementForPlan("annual"), null);
  assert.equal(billingEntitlementForPlan("assisted-audit"), null);
});

test("the public offer has one canonical amount and entitlement promise", () => {
  assert.deepEqual(publicOffer, {
    id: "assisted-private-audit",
    version: 1,
    plan: "assisted-audit",
    legacyPlan: "annual",
    termsVersion: "terms-2026-07-13",
    title: "Assisted private audit",
    entitlementLabel: "One assisted private audit",
    amountMinor: 99_900,
    currency: "INR",
    autoRenews: false,
    refundSummary: "Request before evidence review begins for a full refund. After review begins, eligibility depends on work completed and applicable law. Vognary issues a full refund if it cancels the audit.",
  });
});
test("revenue funnel events are allowlisted in code, migration, and consolidated schema", () => {
  const funnelEvents = ["private_audit.requested", "billing.checkout_started", "billing.payment_settled", "billing.payment_refunded"];
  const migration = source("infra/postgres/migrations/0015_paid_audit_flow.sql");
  const schema = source("infra/postgres/schema.sql");
  for (const name of funnelEvents) {
    assert.ok((productEventNames as readonly string[]).includes(name), `${name} missing from product-events allowlist`);
    assert.ok(migration.includes(`'${name}'`), `${name} missing from migration 0015`);
    assert.ok(schema.includes(`'${name}'`), `${name} missing from schema.sql`);
  }
});

test("historical checkouts remain snapshot-bound while the public creation route is retired", () => {
  const migration = source("infra/postgres/migrations/0015_paid_audit_flow.sql");
  const schema = source("infra/postgres/schema.sql");
  assert.match(migration, /add column if not exists lead_id uuid references private_audit_leads\(id\) on delete set null/);
  assert.match(schema, /lead_id uuid references private_audit_leads\(id\) on delete set null/);

  const store = source("src/lib/server/billing-store.ts");
  assert.match(store, /checkout\.leadId !== input\.leadId/);
  assert.match(store, /checkout\.offerId !== input\.offerId/);
  assert.match(store, /checkout\.offerVersion !== input\.offerVersion/);
  assert.match(store, /checkout\.termsVersion !== input\.termsVersion/);
  assert.match(store, /billing\.checkout_started/);

  const route = source("src/app/api/checkout/route.ts");
  assert.match(route, /assistedAuditRetiredResponse/);
  assert.doesNotMatch(route, /requiredEnv|getBillingCheckoutConfiguration|createRazorpayPaymentLink/);
});

test("the one-time assisted-audit migration preserves legacy rows and adds fulfillment/refund identity", () => {
  const migration = source("infra/postgres/migrations/0016_assisted_audit_orders.sql");
  const schema = source("infra/postgres/schema.sql");
  for (const value of ["assisted-audit", "offer_id", "offer_version", "terms_version", "assisted_audit_orders", "billing_refunds", "provider_refund_id"]) {
    assert.ok(migration.includes(value), `${value} missing from migration 0016`);
    assert.ok(schema.includes(value), `${value} missing from schema.sql`);
  }
  assert.match(migration, /where plan = 'annual' and paid_at is not null/);
  assert.match(migration, /on conflict \(checkout_session_id\) do nothing/);
  assert.match(schema, /workspace_id uuid references workspaces\(id\) on delete set null/);
});

test("payment settlement and refunds emit funnel events inside the webhook transaction", () => {
  const store = source("src/lib/server/billing-store.ts");
  const settled = store.indexOf('eventName: "billing.payment_settled"');
  const refunded = store.indexOf('eventName: "billing.payment_refunded"');
  assert.ok(settled > -1 && refunded > -1);
  assert.match(store.slice(settled, settled + 220), /\}, client\)/);
  assert.match(store.slice(refunded, refunded + 220), /\}, client\)/);
});

test("billing reconciliation fails closed on unresolved refunds and failed refund webhooks", () => {
  const sourceText = source("scripts/reconcile-billing.ts");
  assert.match(sourceText, /status in \('pending_payment', 'rejected'\)/);
  assert.match(sourceText, /event_type = 'refund\.processed'[\s\S]*status = 'failed'/);
  const unresolvedQueries = sourceText.slice(sourceText.indexOf("const unresolvedRefunds"), sourceText.indexOf("for (const checkout"));
  assert.doesNotMatch(unresolvedQueries, /120 days/);
  assert.match(sourceText, /if \(mismatchCount\) process\.exitCode = 1/);
});

test("checkout recovery releases only an empty filtered provider result", () => {
  const sourceText = source("scripts/recover-razorpay-checkout.ts");
  assert.match(sourceText, /if \(payload\.items\.length === 0\)/);
  assert.match(sourceText, /Razorpay returned nonmatching links for the filtered checkout reference/);
  assert.ok(sourceText.indexOf("payload.items.length === 0") < sourceText.indexOf("await releaseBillingProviderCreationAfterVerifiedAbsence"));
});

test("payment returns land on the public status page, never the protected app", () => {
  const provider = source("src/lib/server/billing-provider.ts");
  assert.match(provider, /callback_url: `\$\{appUrl\}\/billing\/return\?checkout=\$\{input\.checkoutId\}`/);
  assert.match(provider, /notify: \{ email: false, sms: false \}/);
  assert.match(provider, /reminder_enable: false/);
  assert.doesNotMatch(provider, /\/app\?billing=returned/);

  const returnClient = source("src/app/billing/return/billing-return-client.tsx");
  assert.doesNotMatch(returnClient, /Razorpay receipt email|authoritative proof/i);
  assert.match(returnClient, /confirmation shown by Razorpay/);
  assert.match(returnClient, /support@vognary\.com/);
});

test("Recovery save guidance uses Google and keeps magic link deferred", () => {
  const client = source("src/app/login/login-client.tsx");
  assert.match(client, /Continue with Google/);
  assert.match(client, /Google is only for sign-in\. Vognary does not access Gmail\./);
  assert.doesNotMatch(client, /\/api\/auth\/magic-link\/request|Send sign-in link|Email link/);
  assert.match(source("src/lib/server/magic-link-auth.ts"), /ENABLE_MAGIC_LINK_LOGIN === "true"/);
});

test("historical checkout status exposes settlement state without payment credentials or identity", () => {
  const store = source("src/lib/server/billing-store.ts");
  const statusFn = store.slice(store.indexOf("getPublicCheckoutStatus"), store.indexOf("export async function attachBillingProviderCheckout"));
  assert.match(statusFn, /select id, status, plan, currency, amount_minor::text, paid_at, refunded_at/);
  assert.doesNotMatch(statusFn, /customer_email|provider_checkout_id|provider_payment_id|idempotency_key|lead_id/);

  const route = source("src/app/api/checkout/[checkoutId]/route.ts");
  assert.match(route, /rateLimit\(request, \{ namespace: "checkout-status"/);
  assert.match(route, /uuidPattern\.test\(checkoutId\)/);
  assert.match(route, /"cache-control": "no-store"/);
  assert.doesNotMatch(route, /requiredEnv|DATABASE_URL/);
});

test("retired audit intake cannot persist leads or emit funnel events", () => {
  const route = source("src/app/api/audit-intake/route.ts");
  assert.match(route, /assistedAuditRetiredResponse/);
  assert.doesNotMatch(route, /persistAuditLead|recordProductEvent|AUDIT_INTAKE_WEBHOOK_URL/);
});
