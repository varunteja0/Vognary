import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { NextRequest } from "next/server";

import { GET as getAiStatus } from "../src/app/api/ai/status/route";
import { GET as getAuditIntake, POST as postAuditIntake } from "../src/app/api/audit-intake/route";
import { GET as getCheckout, POST as postCheckout } from "../src/app/api/checkout/route";
import { GET as getCheckoutStatus } from "../src/app/api/checkout/[checkoutId]/route";
import { GET as getPublicVeto } from "../src/app/autopilot/veto/[token]/route";
import { proxy } from "../src/proxy";

const sameOriginHeaders = {
  origin: "https://www.vognary.com",
  "sec-fetch-site": "same-origin",
  "content-type": "application/json",
};

test("retired demo and guest modes are crawlable 410 tombstones", async () => {
  for (const mode of ["demo", "guest"]) {
    const response = proxy(new NextRequest(`https://www.vognary.com/app?${mode}=1`));
    assert.equal(response.status, 410);
    assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
    assert.equal(response.headers.get("cache-control"), "public, max-age=300");
    const body = await response.text();
    assert.match(body, /retired/i);
    assert.match(body, /\/login\?next=\/app/);
    assert.doesNotMatch(body, /₹|INR|SIP|OpenAI|Vercel|GitHub/);
  }
});

test("sensitive product pages use a nonce CSP without unsafe inline scripts", () => {
  const first = proxy(new NextRequest("https://www.vognary.com/app"));
  const second = proxy(new NextRequest("https://www.vognary.com/app"));
  const firstCsp = first.headers.get("content-security-policy") ?? "";
  const secondCsp = second.headers.get("content-security-policy") ?? "";

  assert.match(firstCsp, /script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  assert.doesNotMatch(firstCsp.match(/script-src[^;]+/)?.[0] ?? "", /'unsafe-inline'/);
  assert.match(firstCsp, /style-src 'self' 'nonce-[^']+' 'sha256-[^']+'/);
  assert.doesNotMatch(firstCsp, /'unsafe-inline'/);
  assert.notEqual(firstCsp, secondCsp);
  assert.equal(first.headers.get("x-robots-tag"), "noindex, nofollow");
});

test("public capability page permits its exact script and style only by hash", async () => {
  const response = await getPublicVeto();
  const csp = response.headers.get("content-security-policy") ?? "";
  assert.match(csp, /script-src 'sha256-[^']+'/);
  assert.match(csp, /style-src 'sha256-[^']+'/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
});

test("retired audit intake and checkout cannot collect data or disclose configuration", async () => {
  const requests = await Promise.all([
    getAuditIntake(),
    postAuditIntake(new NextRequest("https://www.vognary.com/api/audit-intake", {
      method: "POST",
      headers: sameOriginHeaders,
      body: JSON.stringify({ name: "Do not persist", email: "probe@example.com" }),
    })),
    getCheckout(),
    postCheckout(new NextRequest("https://www.vognary.com/api/checkout", {
      method: "POST",
      headers: sameOriginHeaders,
      body: JSON.stringify({ plan: "assisted-audit" }),
    })),
  ]);

  for (const response of requests) {
    assert.equal(response.status, 410);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const payload = await response.json() as Record<string, unknown>;
    assert.deepEqual(payload, {
      status: "retired",
      replacement: "/login?next=/app",
      message: "The one-time assisted audit is retired. Add billing evidence in the current Vognary workspace instead.",
    });
    assert.equal("requiredEnv" in payload, false);
  }
});

test("historical checkout status never exposes missing environment names", async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const response = await getCheckoutStatus(
      new NextRequest("https://www.vognary.com/api/checkout/00000000-0000-4000-8000-000000000000"),
      { params: Promise.resolve({ checkoutId: "00000000-0000-4000-8000-000000000000" }) },
    );
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const payload = await response.json() as Record<string, unknown>;
    assert.equal(payload.status, "unavailable");
    assert.equal("requiredEnv" in payload, false);
    assert.doesNotMatch(JSON.stringify(payload), /DATABASE_URL/);
  } finally {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
});

test("public AI status exposes policy and mode without infrastructure details", async () => {
  const response = await getAiStatus();
  assert.equal(response.status, 200);
  const payload = await response.json() as Record<string, unknown>;
  assert.equal(typeof payload.status, "string");
  assert.equal(payload.policy, "cite-or-shut-up");
  for (const forbidden of ["keyConfigured", "budgetConfigured", "models", "requiredEnv"]) {
    assert.equal(forbidden in payload, false, forbidden);
  }
  assert.doesNotMatch(String(payload.message), /ANTHROPIC|API_KEY|BUDGET|claude/i);
});

test("public shell is static and retired audit copy is absent from current legal and navigation surfaces", () => {
  const home = source("src/app/page.tsx");
  const landing = source("src/app/launch-landing.tsx");
  const config = source("next.config.ts");
  const terms = source("src/app/terms/page.tsx");
  const profile = source("src/app/profile/profile-client.tsx");
  const billingReturn = source("src/app/billing/return/billing-return-client.tsx");

  assert.match(home, /export const revalidate = 3600/);
  assert.doesNotMatch(home, /force-dynamic|isReceiptInboxPubliclyAvailable/);
  assert.doesNotMatch(landing, /receiptInboxAvailable/);
  assert.match(config, /source: "\/private-audit", destination: "\/login\?next=\/app", permanent: true/);
  assert.doesNotMatch(terms, /assisted audit|INR 999/i);
  assert.doesNotMatch(`${profile}\n${billingReturn}`, /\/private-audit/);
});

test("canonical metadata and transactional decision audit are explicit", () => {
  for (const [path, canonical] of [
    ["src/app/layout.tsx", 'canonical: "/"'],
    ["src/app/security/page.tsx", 'canonical: "/security"'],
    ["src/app/privacy/page.tsx", 'canonical: "/privacy"'],
    ["src/app/terms/page.tsx", 'canonical: "/terms"'],
  ]) {
    assert.match(source(path), new RegExp(canonical.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), path);
  }
  const recoveryStore = source("src/lib/server/recovery-store.ts");
  const audit = recoveryStore.indexOf('"recovery.decision.saved"');
  const commit = recoveryStore.indexOf('client.query("commit")', audit);
  assert.ok(audit > -1 && commit > audit, "decision audit must be written before transaction commit");
});

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}
