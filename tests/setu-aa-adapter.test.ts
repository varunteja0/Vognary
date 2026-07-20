import assert from "node:assert/strict";
import test from "node:test";
import type { ConnectorConnection, ConnectorSyncResult } from "../src/lib/connector-runtime";
import {
  listSetuMissingEnv,
  requestSetuConsent,
  setuAccountAggregatorAdapter,
} from "../src/lib/connectors/setu-aa-adapter";

const environmentKeys = [
  "SETU_AA_CLIENT_ID",
  "SETU_AA_CLIENT_SECRET",
  "SETU_AA_PRODUCT_INSTANCE_ID",
  "SETU_AA_BASE_URL",
  "SETU_AA_TAG",
  "ACCOUNT_AGGREGATOR_PARTNER_STATUS",
] as const;

function connection(): ConnectorConnection {
  return {
    connectorId: "account-aggregator",
    workspaceId: "workspace-test",
    connectedAccountId: "account-test",
    providerAccountId: "consent-test",
    scopes: ["aa:consent", "aa:fi-data:deposit"],
  };
}

async function withSetuEnvironment(run: () => Promise<void>) {
  const previous = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));
  const previousFetch = globalThis.fetch;
  process.env.SETU_AA_CLIENT_ID = "client-test";
  process.env.SETU_AA_CLIENT_SECRET = "secret-test";
  process.env.SETU_AA_PRODUCT_INSTANCE_ID = "product-test";
  process.env.SETU_AA_BASE_URL = "https://fiu-sandbox.setu.co";
  process.env.ACCOUNT_AGGREGATOR_PARTNER_STATUS = "sandbox-approved";
  delete process.env.SETU_AA_TAG;
  try {
    await run();
  } finally {
    globalThis.fetch = previousFetch;
    for (const key of environmentKeys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function json(payload: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  }));
}

function asResult(value: Awaited<ReturnType<typeof setuAccountAggregatorAdapter.sync>>) {
  assert.equal(Array.isArray(value), false);
  return value as ConnectorSyncResult;
}

test("Setu activation fails closed until credentials and partner status are explicit", () => {
  const previous = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));
  try {
    for (const key of environmentKeys) delete process.env[key];
    const missing = listSetuMissingEnv();
    assert.ok(missing.includes("SETU_AA_CLIENT_ID"));
    assert.ok(missing.includes("SETU_AA_CLIENT_SECRET"));
    assert.ok(missing.includes("SETU_AA_PRODUCT_INSTANCE_ID"));
    assert.ok(missing.some((value) => value.includes("ACCOUNT_AGGREGATOR_PARTNER_STATUS")));
  } finally {
    for (const key of environmentKeys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("consent start sends bounded FIU credentials and only returns same-origin HTTPS approval URLs", async () => {
  await withSetuEnvironment(async () => {
    let body: Record<string, unknown> = {};
    globalThis.fetch = (async (input, init) => {
      assert.equal(String(input), "https://fiu-sandbox.setu.co/consents");
      assert.equal(init?.method, "POST");
      const headers = init?.headers as Record<string, string>;
      assert.equal(headers["x-client-id"], "client-test");
      assert.equal(headers["x-client-secret"], "secret-test");
      assert.equal(headers["x-product-instance-id"], "product-test");
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return json({
        id: "consent-test",
        url: "https://fiu-sandbox.setu.co/v2/consents/webview/consent-test",
        status: "PENDING",
        detail: { consentExpiry: "2027-07-17T00:00:00.000Z" },
      });
    }) as typeof fetch;

    const consent = await requestSetuConsent("9999999999@onemoney", "https://www.vognary.com/app?aa=returned");
    assert.equal(consent.consentId, "consent-test");
    assert.equal(consent.approvalUrl, "https://fiu-sandbox.setu.co/v2/consents/webview/consent-test");
    assert.equal(body.vua, "9999999999@onemoney");
    assert.equal(body.redirectUrl, "https://www.vognary.com/app?aa=returned");
    assert.equal("additionalParams" in (body ?? {}), false, "unconfigured Setu tags must not be invented");

    globalThis.fetch = (async () => json({
      id: "consent-test-2",
      url: "https://attacker.test/steal-consent",
      status: "PENDING",
    })) as typeof fetch;
    const unsafe = await requestSetuConsent("9999999999@onemoney", "https://www.vognary.com/app?aa=returned");
    assert.equal(unsafe.approvalUrl, null);
  });
});

test("pending consent is polled without evidence or a connected-state claim", async () => {
  await withSetuEnvironment(async () => {
    globalThis.fetch = (async (input) => {
      assert.equal(String(input), "https://fiu-sandbox.setu.co/consents/consent-test");
      return json({ id: "consent-test", status: "PENDING" });
    }) as typeof fetch;

    const connected = await setuAccountAggregatorAdapter.connect(connection());
    const result = asResult(await setuAccountAggregatorAdapter.sync(connected, {
      cursorState: {},
      startedAt: "2026-07-17T00:00:00.000Z",
    }));
    assert.equal(result.activationState, "pending");
    assert.equal(result.continuation, true);
    assert.deepEqual(result.evidence, []);
    assert.ok(result.nextSyncAt);
  });
});

test("approved consent activates before a bounded data-session continuation", async () => {
  await withSetuEnvironment(async () => {
    const paths: string[] = [];
    globalThis.fetch = (async (input, init) => {
      const url = new URL(String(input));
      paths.push(`${init?.method ?? "GET"} ${url.pathname}`);
      if (url.pathname === "/consents/consent-test") return json({ id: "consent-test", status: "ACTIVE" });
      if (url.pathname === "/sessions" && init?.method === "POST") return json({ id: "session-test", status: "PENDING" });
      if (url.pathname === "/sessions/session-test") return json({ id: "session-test", status: "PENDING" });
      return json({ error: "unexpected" }, 404);
    }) as typeof fetch;

    const result = asResult(await setuAccountAggregatorAdapter.sync(connection(), {
      cursorState: {},
      startedAt: "2026-07-17T00:00:00.000Z",
    }));
    assert.equal(result.activationState, "active");
    assert.equal(result.continuation, true);
    assert.deepEqual(result.evidence, []);
    assert.deepEqual(paths, [
      "GET /consents/consent-test",
      "POST /sessions",
      "GET /sessions/session-test",
    ]);
  });
});
