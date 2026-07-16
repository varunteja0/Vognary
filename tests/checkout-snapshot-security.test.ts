import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";

import { POST as checkoutPost } from "../src/app/api/checkout/route";
import { publicOffer } from "../src/lib/public-offer";
import {
  DELETE as deleteAuditSnapshot,
  POST as saveAuditSnapshot,
} from "../src/app/api/workspaces/current/audit-snapshot/route";

const root = fileURLToPath(new URL("../", import.meta.url));

function source(relativePath: string) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

test("guest assisted-audit checkout rejects a missing audit lead before provider setup", async () => {
  const names = [
    "RAZORPAY_KEY_ID",
    "RAZORPAY_KEY_SECRET",
    "RAZORPAY_WEBHOOK_SECRET",
    "NEXT_PUBLIC_APP_URL",
    "ASSISTED_AUDIT_LEGAL_TERMS_STATUS",
  ] as const;
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  process.env.RAZORPAY_KEY_ID = "rzp_test_security";
  process.env.RAZORPAY_KEY_SECRET = "secret_security";
  process.env.RAZORPAY_WEBHOOK_SECRET = "webhook_security";
  process.env.NEXT_PUBLIC_APP_URL = "https://vognary.test";
  process.env.ASSISTED_AUDIT_LEGAL_TERMS_STATUS = "approved";

  try {
    const response = await checkoutPost(new NextRequest("https://vognary.test/api/checkout", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "security-test-checkout-0001",
        "x-forwarded-for": "198.51.100.10",
      },
      body: JSON.stringify({ plan: publicOffer.plan, email: "lead@example.com", termsVersion: publicOffer.termsVersion }),
    }));

    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "audit-lead-required");
  } finally {
    for (const name of names) {
      const value = previous.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("guest assisted-audit checkout binds lead identity before tracked payment readiness", () => {
  const route = source("src/app/api/checkout/route.ts");
  const leadRequirement = route.indexOf("audit-lead-required");
  const leadLookup = route.indexOf("const leadEmail = await getAuditLeadEmail");
  const configuration = route.indexOf("const configuration = getBillingCheckoutConfiguration", leadLookup);

  assert.ok(leadRequirement > -1, "anonymous assisted-audit checkout must require a lead id");
  assert.ok(leadLookup > leadRequirement, "the required lead must be resolved from durable intake storage");
  assert.ok(configuration > leadLookup, "lead/email binding must happen before payment configuration is evaluated");
  assert.match(route, /leadEmail\.toLowerCase\(\) !== email\.toLowerCase\(\)/);
  assert.doesNotMatch(route, /configuration\.status === "link-only"|PAYMENT_LINK_/);
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
