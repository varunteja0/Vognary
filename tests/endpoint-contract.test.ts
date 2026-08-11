import assert from "node:assert/strict";
import test from "node:test";
import type { NextRequest } from "next/server";
import { GET as connectorsGet } from "../src/app/api/connectors/route";
import { GET as checkoutGet } from "../src/app/api/checkout/route";
import { publicOffer } from "../src/lib/public-offer";

/**
 * Endpoint contract — the fail-closed half of "everything is wired".
 *
 * These handlers are reachable with no auth and no database, so they can be
 * driven directly (the established pattern in this repo — see
 * request-security / audit-route / product-events tests). They lock two
 * guarantees that back the connect + checkout buttons:
 *
 *  1. /api/connectors cannot advertise the retired legacy registry.
 *  2. /api/checkout is honestly gated: it returns `not-configured` with the
 *     exact required env until the provider is switched on, flips to `ready`
 *     only when it is, and refuses any SKU that isn't the public offer. This is
 *     the contract that keeps the checkout CTA hidden until billing is live.
 *
 * No shared files, no running UI, no shared database.
 */

const CHECKOUT_ENV_KEYS = [
  "ASSISTED_AUDIT_CHECKOUT_MODE",
  "RAZORPAY_KEY_ID",
  "RAZORPAY_KEY_SECRET",
  "RAZORPAY_WEBHOOK_SECRET",
  "NEXT_PUBLIC_APP_URL",
  "ASSISTED_AUDIT_LEGAL_TERMS_STATUS",
  "RAZORPAY_ACCOUNT_STATUS",
  "RAZORPAY_WEBHOOK_PROOF_STATUS",
  "RAZORPAY_REPLAY_PROOF_STATUS",
  "RAZORPAY_REFUND_PROOF_STATUS",
  "RAZORPAY_RECONCILIATION_STATUS",
] as const;

function withEnv(overrides: Record<string, string | undefined>, run: () => Promise<void> | void) {
  const saved = new Map<string, string | undefined>();
  for (const key of CHECKOUT_ENV_KEYS) saved.set(key, process.env[key]);
  try {
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return run();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function checkoutRequest(plan: string | null) {
  const url = plan === null ? "http://localhost/api/checkout" : `http://localhost/api/checkout?plan=${encodeURIComponent(plan)}`;
  return new Request(url) as unknown as NextRequest;
}

// Clear every checkout env key so the "not-configured" path is deterministic
// regardless of the ambient shell environment.
const cleared = Object.fromEntries(CHECKOUT_ENV_KEYS.map((key) => [key, undefined]));

test("GET /api/connectors retires the legacy registry without leaking dead integrations", async () => {
  const response = await connectorsGet();
  assert.equal(response.status, 410);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();

  assert.equal(body.status, "retired");
  assert.equal(body.ledgerAuthority, "RECOVERY_V1");
  assert.equal(body.replacements.forwardedReceipts, "/api/workspaces/current/sources/receipt-inbox");
  assert.equal(body.replacements.manualEvidence, "/api/workspaces/current/evidence");
  assert.equal("connectors" in body, false);
  assert.equal("adapters" in body, false);
  assert.doesNotMatch(JSON.stringify(body), /gmail|account-aggregator|setu|aws|openai-costs/i);
});

test("GET /api/checkout refuses any SKU that is not the public offer", async () => {
  await withEnv(cleared, async () => {
    for (const plan of [null, "not-a-real-plan", "annual"]) {
      const response = await checkoutGet(checkoutRequest(plan));
      assert.equal(response.status, 404, `plan=${plan} must be rejected`);
    }
  });
});

test("GET /api/checkout is honestly gated: not-configured until the provider is switched on", async () => {
  await withEnv(cleared, async () => {
    const response = await checkoutGet(checkoutRequest(publicOffer.plan));
    assert.equal(response.status, 200);
    const body = await response.json();

    assert.equal(body.status, "not-configured");
    assert.equal(body.provider, null);
    assert.equal(body.settlementTracking, false);
    assert.equal(body.amountMinor, null);
    assert.equal(body.currency, null);
    assert.ok(Array.isArray(body.requiredEnv) && body.requiredEnv.length > 0, "must name the missing env");
    // Offer metadata is always present so the surface can describe the SKU
    // truthfully even while payment is gated off.
    assert.equal(body.offerId, publicOffer.id);
    assert.equal(body.offerVersion, publicOffer.version);
    assert.equal(body.termsVersion, publicOffer.termsVersion);
  });
});

test("GET /api/checkout flips to ready once the provider env is present", async () => {
  await withEnv(
    {
      ...cleared,
      ASSISTED_AUDIT_CHECKOUT_MODE: "test",
      RAZORPAY_KEY_ID: "rzp_test_contractcheck",
      RAZORPAY_KEY_SECRET: "contract-secret",
      RAZORPAY_WEBHOOK_SECRET: "contract-webhook-secret",
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    },
    async () => {
      const response = await checkoutGet(checkoutRequest(publicOffer.plan));
      assert.equal(response.status, 200);
      const body = await response.json();

      assert.equal(body.status, "ready");
      assert.equal(body.provider, "razorpay");
      assert.equal(body.settlementTracking, true);
      assert.equal(body.amountMinor, publicOffer.amountMinor);
      assert.equal(body.currency, "INR");
      assert.deepEqual(body.requiredEnv, []);
    },
  );
});
