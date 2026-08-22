import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";

import { POST as checkoutPost } from "../src/app/api/checkout/route";
import {
  DELETE as deleteAuditSnapshot,
  POST as saveAuditSnapshot,
} from "../src/app/api/workspaces/current/audit-snapshot/route";

const root = fileURLToPath(new URL("../", import.meta.url));

function source(relativePath: string) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

test("guest assisted-audit checkout stays retired even when provider env is present", async () => {
  const previous = process.env.RAZORPAY_KEY_ID;
  process.env.RAZORPAY_KEY_ID = "rzp_test_security";
  try {
    const response = await checkoutPost(new NextRequest("https://vognary.test/api/checkout", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://vognary.test", "sec-fetch-site": "same-origin" },
      body: JSON.stringify({ plan: "assisted-audit", email: "lead@example.com" }),
    }));
    assert.equal(response.status, 410);
    assert.equal((await response.json()).status, "retired");
  } finally {
    if (previous === undefined) delete process.env.RAZORPAY_KEY_ID;
    else process.env.RAZORPAY_KEY_ID = previous;
  }
});

test("retired checkout has no lead, provider, or persistence path", () => {
  const route = source("src/app/api/checkout/route.ts");
  assert.match(route, /assistedAuditRetiredResponse/);
  assert.doesNotMatch(route, /getAuditLeadEmail|getBillingCheckoutConfiguration|createBillingCheckout|createRazorpayPaymentLink/);
});

test("idempotent checkout replay includes provider and server-owned price identity", () => {
  const store = source("src/lib/server/billing-store.ts");
  assert.match(store, /checkout\.provider !== input\.provider/);
  assert.match(store, /checkout\.amountMinor !== input\.amountMinor/);
  assert.match(store, /checkout\.currency !== input\.currency/);
  assert.match(store, /checkout\.offerId !== input\.offerId/);
  assert.match(store, /checkout\.termsVersion !== input\.termsVersion/);
});

test("audit snapshot mutations reject unauthenticated callers", async () => {
  const saveResponse = await saveAuditSnapshot(new Request("https://vognary.test/api/workspaces/current/audit-snapshot", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "198.51.100.11",
    },
    body: JSON.stringify({ snapshot: { version: 1, statementSources: [], manualItems: [] } }),
  }));
  assert.equal(saveResponse.status, 401);

  const deleteResponse = await deleteAuditSnapshot(new Request("https://vognary.test/api/workspaces/current/audit-snapshot", {
    method: "DELETE",
    headers: { "x-forwarded-for": "198.51.100.12" },
  }));
  assert.equal(deleteResponse.status, 401);
});

test("audit snapshot role policy keeps viewers read-only and deletion admin-only", () => {
  const route = source("src/app/api/workspaces/current/audit-snapshot/route.ts");
  assert.match(route, /getSnapshotReadiness\(request, "viewer"\)/);
  assert.match(route, /getSnapshotReadiness\(request, "member"\)/);
  assert.match(route, /getSnapshotReadiness\(request, "admin"\)/);
  assert.match(route, /requireWorkspaceRole\(request, session\.workspaceId, minimumRole\)/);
});
