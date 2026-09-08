import assert from "node:assert/strict";
import test from "node:test";
import { createZohoBooksClient, ZohoBooksError } from "../src/lib/server/zoho-books-client";

const config = { clientId: "synthetic-client", clientSecret: "synthetic-secret", redirectUri: "http://127.0.0.1:3037/api/workspaces/current/sources/zoho-books/callback" };
const json = (value: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });

test("Zoho consent requests only read access and keeps secrets out of URLs", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const client = createZohoBooksClient(config, async (input, init) => {
    requests.push({ url: String(input), init });
    return json({ access_token: "synthetic-access", refresh_token: "synthetic-refresh", expires_in: 3600, api_domain: "https://www.zohoapis.in" });
  });
  const authorization = new URL(client.authorizationUrl("synthetic-state"));
  assert.equal(authorization.origin, "https://accounts.zoho.in");
  assert.equal(authorization.searchParams.get("scope"), "ZohoBooks.settings.READ,ZohoBooks.bills.READ");
  assert.equal(authorization.searchParams.get("access_type"), "offline");
  const tokens = await client.exchangeCode("synthetic-code");
  assert.equal(tokens.refreshToken, "synthetic-refresh");
  assert.doesNotMatch(requests[0].url, /secret|synthetic-code/);
  assert.equal(requests[0].init?.method, "POST");
  assert.equal(requests[0].init?.redirect, "error");
  assert.equal(new URLSearchParams(String(requests[0].init?.body)).get("client_secret"), "synthetic-secret");
});

test("provider paging preserves the requested organization, watermark and page", async () => {
  let requested: URL | undefined;
  const client = createZohoBooksClient(config, async input => {
    requested = new URL(String(input));
    return json({ code: 0, bills: [], page_context: { page: 2, has_more_page: true } });
  });
  const result = await client.listBills("synthetic-access", "100000001", { page: 2, coverageStart: "2026-06-01", modifiedSince: "2026-09-01T00:00:00.000Z" });
  assert.equal(result.hasMore, true);
  assert.equal(requested?.searchParams.get("organization_id"), "100000001");
  assert.equal(requested?.searchParams.get("page"), "2");
  assert.equal(requested?.searchParams.get("last_modified_time"), "2026-09-01T00:00:00.000Z");
  assert.equal(requested?.searchParams.get("date_start"), "2026-06-01");
});

test("a missing page marker, wrong data region and permission loss fail closed", async () => {
  const malformed = createZohoBooksClient(config, async () => json({ code: 0, bills: [], page_context: {} }));
  await assert.rejects(malformed.listBills("synthetic-access", "100000001", { page: 1, coverageStart: "2026-06-01", modifiedSince: null }), { code: "SCHEMA_CHANGED" });
  const wrongRegion = createZohoBooksClient(config, async () => json({ access_token: "synthetic-access", expires_in: 3600, api_domain: "https://www.zohoapis.com" }));
  await assert.rejects(wrongRegion.refresh("synthetic-refresh"), { code: "REGION_UNSUPPORTED" });
  const denied = createZohoBooksClient(config, async () => json({ code: 57, message: "untrusted-provider-content" }, 403));
  await assert.rejects(denied.organizations("synthetic-access"), { code: "REAUTH_REQUIRED" });
});

test("provider throttling is bounded and carries no raw provider error into logs", async () => {
  const client = createZohoBooksClient(config, async () => json({ code: 44, message: "untrusted-secret-content" }, 429, { "retry-after": "120" }));
  await assert.rejects(client.organizations("synthetic-access"), error => {
    assert.ok(error instanceof ZohoBooksError);
    assert.equal(error.code, "THROTTLED");
    assert.equal(error.retryAfterSeconds, 120);
    assert.doesNotMatch(error.message, /untrusted-secret-content/);
    return true;
  });
});

test("ambiguous bill absence never becomes deletion without a verified bill-specific contract", async () => {
  for (const payload of [{ error: "upstream_route_unavailable" }, { code: 1002 }, { code: 1002, message: "Invoice does not exist." }, { code: 0 }, {}]) {
    const missing = createZohoBooksClient(config, async () => json(payload, 404));
    await assert.rejects(missing.bill("synthetic-access", "100000001", "200000001"), { code: "ABSENCE_UNCONFIRMED" });
  }
  const denied = createZohoBooksClient(config, async () => json({ code: 57 }, 403));
  await assert.rejects(denied.bill("synthetic-access", "100000001", "200000001"), { code: "REAUTH_REQUIRED" });
});

test("token revocation needs explicit provider success, not merely HTTP 200", async () => {
  const ambiguous = createZohoBooksClient(config, async () => json({ status: "unknown" }));
  await assert.rejects(ambiguous.revoke("synthetic-refresh"), { code: "SCHEMA_CHANGED" });
  const confirmed = createZohoBooksClient(config, async () => json({ status: "success" }));
  await assert.doesNotReject(confirmed.revoke("synthetic-refresh"));
});
