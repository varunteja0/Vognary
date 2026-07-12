import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

import { billingEntitlementForPlan, parseRazorpayBillingEvent, verifyRazorpayWebhookSignature } from "../src/lib/billing";
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

test("checkouts bind to audit leads with email verification and replay-safe idempotency", () => {
  const migration = source("infra/postgres/migrations/0015_paid_audit_flow.sql");
  const schema = source("infra/postgres/schema.sql");
  assert.match(migration, /add column if not exists lead_id uuid references private_audit_leads\(id\) on delete set null/);
  assert.match(schema, /lead_id uuid references private_audit_leads\(id\) on delete set null/);

  const route = source("src/app/api/checkout/route.ts");
  assert.match(route, /getAuditLeadEmail/);
  assert.match(route, /does not match the audit request on file/);
  assert.match(route, /leadId,\n?\s*customerEmail: email/);

  const store = source("src/lib/server/billing-store.ts");
  assert.match(store, /checkout\.leadId !== input\.leadId/);
  assert.match(store, /billing\.checkout_started/);

  const client = source("src/app/private-audit/private-audit-client.tsx");
  assert.match(client, /`private-audit:\$\{lead\.id\}`/);
  assert.match(client, /leadId: lead\.id/);
});

test("payment settlement and refunds emit funnel events inside the webhook transaction", () => {
  const store = source("src/lib/server/billing-store.ts");
  const settled = store.indexOf('eventName: "billing.payment_settled"');
  const refunded = store.indexOf('eventName: "billing.payment_refunded"');
  assert.ok(settled > -1 && refunded > -1);
  assert.match(store.slice(settled, settled + 220), /\}, client\)/);
  assert.match(store.slice(refunded, refunded + 220), /\}, client\)/);
});

test("payment returns land on the public status page, never the protected app", () => {
  const provider = source("src/lib/server/billing-provider.ts");
  assert.match(provider, /callback_url: `\$\{appUrl\}\/billing\/return\?checkout=\$\{input\.checkoutId\}`/);
  assert.doesNotMatch(provider, /\/app\?billing=returned/);
});

test("public checkout status exposes settlement state without payment credentials or identity", () => {
  const store = source("src/lib/server/billing-store.ts");
  const statusFn = store.slice(store.indexOf("getPublicCheckoutStatus"), store.indexOf("export async function attachBillingProviderCheckout"));
  assert.match(statusFn, /select id, status, plan, currency, amount_minor::text, paid_at, refunded_at/);
  assert.doesNotMatch(statusFn, /customer_email|provider_checkout_id|provider_payment_id|idempotency_key|lead_id/);

  const route = source("src/app/api/checkout/[checkoutId]/route.ts");
  assert.match(route, /rateLimit\(request, \{ namespace: "checkout-status"/);
  assert.match(route, /uuidPattern\.test\(checkoutId\)/);
  assert.match(route, /"cache-control": "no-store"/);
});

test("audit intake emits the private_audit.requested funnel event after durable persistence", () => {
  const route = source("src/app/api/audit-intake/route.ts");
  const persistIndex = route.indexOf("persistAuditLead(payload)");
  const eventIndex = route.indexOf('eventName: "private_audit.requested"');
  assert.ok(persistIndex > -1 && eventIndex > persistIndex);
});
