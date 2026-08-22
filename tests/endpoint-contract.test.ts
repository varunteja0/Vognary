import assert from "node:assert/strict";
import test from "node:test";
import { GET as connectorsGet } from "../src/app/api/connectors/route";
import { GET as checkoutGet } from "../src/app/api/checkout/route";

/** Public fail-closed contracts that must hold without auth or a database. */

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

test("GET /api/checkout remains retired regardless of provider environment", async () => {
  const previous = process.env.RAZORPAY_KEY_ID;
  process.env.RAZORPAY_KEY_ID = "rzp_live_must_not_reactivate_public_checkout";
  try {
    const response = await checkoutGet();
    assert.equal(response.status, 410);
    assert.deepEqual(await response.json(), {
      status: "retired",
      replacement: "/login?next=/app",
      message: "The one-time assisted audit is retired. Add billing evidence in the current Vognary workspace instead.",
    });
  } finally {
    if (previous === undefined) delete process.env.RAZORPAY_KEY_ID;
    else process.env.RAZORPAY_KEY_ID = previous;
  }
});
