import assert from "node:assert/strict";
import test from "node:test";
import type { ConnectorConnection, ConnectorEvidence, ConnectorSyncResult } from "../src/lib/connector-runtime";
import { anthropicUsageAdapter } from "../src/lib/connectors/anthropic-costs-adapter";
import { githubBillingAdapter } from "../src/lib/connectors/platform-api-adapters";

function connection(overrides: Partial<ConnectorConnection> = {}): ConnectorConnection {
  return {
    connectorId: "test",
    workspaceId: "ws-test",
    scopes: [],
    apiKey: "test-api-key",
    ...overrides,
  };
}

async function withMockFetch(
  mock: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  run: () => Promise<void>,
) {
  const previous = globalThis.fetch;
  globalThis.fetch = mock as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = previous;
  }
}

function json(payload: unknown): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } }));
}

function requestUrl(input: RequestInfo | URL) {
  return typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
}

function asSyncResult(result: ConnectorEvidence[] | ConnectorSyncResult): ConnectorSyncResult {
  assert.equal(Array.isArray(result), false);
  return result as ConnectorSyncResult;
}

test("anthropic cost report converts decimal-string cents to currency units", async () => {
  const seenHeaders: Record<string, string>[] = [];
  await withMockFetch(async (input, init) => {
    seenHeaders.push({ ...(init?.headers as Record<string, string>) });
    const url = new URL(requestUrl(input));
    assert.ok(url.pathname.endsWith("/v1/organizations/cost_report"));
    assert.equal(url.searchParams.get("group_by[]"), "description");
    return json({
      data: [{
        starting_at: "2026-07-10T00:00:00Z",
        ending_at: "2026-07-11T00:00:00Z",
        results: [
          { currency: "USD", amount: "1234.56", description: "Claude Opus 4.8 input tokens", workspace_id: "wrkspc_1", model: "claude-opus-4-8" },
          { currency: "USD", amount: "0", description: "zero line must be skipped" },
        ],
      }],
      has_more: false,
    });
  }, async () => {
    const result = asSyncResult(await anthropicUsageAdapter.sync(connection()));
    assert.equal(result.evidence.length, 1);
    assert.equal(result.evidence[0].amount, 12.3456);
    assert.equal(result.evidence[0].currency, "USD");
    assert.equal(result.evidence[0].evidenceType, "cost");
    assert.ok(result.evidence[0].merchantRaw?.includes("Claude Opus 4.8"));
    assert.ok(result.evidence[0].externalId.startsWith("anthropic-cost:"));
  });
  assert.equal(seenHeaders[0]["x-api-key"], "test-api-key");
  assert.equal(seenHeaders[0]["anthropic-version"], "2023-06-01");
});

test("anthropic cost report follows bounded pagination", async () => {
  let calls = 0;
  await withMockFetch(async (input) => {
    calls += 1;
    const url = new URL(requestUrl(input));
    if (!url.searchParams.get("page")) {
      return json({
        data: [{ starting_at: "2026-07-01T00:00:00Z", ending_at: "2026-07-02T00:00:00Z", results: [{ amount: "100", description: "page one" }] }],
        has_more: true,
        next_page: "page_2",
      });
    }
    assert.equal(url.searchParams.get("page"), "page_2");
    return json({
      data: [{ starting_at: "2026-07-02T00:00:00Z", ending_at: "2026-07-03T00:00:00Z", results: [{ amount: "200", description: "page two" }] }],
      has_more: false,
    });
  }, async () => {
    const result = asSyncResult(await anthropicUsageAdapter.sync(connection()));
    assert.equal(calls, 2);
    assert.equal(result.evidence.length, 2);
    assert.deepEqual(result.evidence.map((item) => item.amount), [1, 2]);
  });
});

test("anthropic external ids are stable across identical syncs", async () => {
  const payload = {
    data: [{ starting_at: "2026-07-10T00:00:00Z", ending_at: "2026-07-11T00:00:00Z", results: [{ amount: "500", description: "stable" }] }],
    has_more: false,
  };
  const ids: string[] = [];
  for (let round = 0; round < 2; round += 1) {
    await withMockFetch(async () => json(payload), async () => {
      const result = asSyncResult(await anthropicUsageAdapter.sync(connection()));
      ids.push(result.evidence[0].externalId);
    });
  }
  assert.equal(ids[0], ids[1]);
});

test("anthropic connect rejects a missing admin key outside preview mode", async () => {
  await assert.rejects(
    anthropicUsageAdapter.connect(connection({ apiKey: undefined, connectedAccountId: "acct_1" })),
    /Admin API key is not configured/,
  );
});

test("github billing aggregates usage items per product in the current month", async () => {
  await withMockFetch(async (input, init) => {
    const url = new URL(requestUrl(input));
    assert.ok(url.pathname.endsWith("/organizations/acme/settings/billing/usage"));
    assert.ok(url.searchParams.get("year"));
    assert.ok(url.searchParams.get("month"));
    const headers = init?.headers as Record<string, string>;
    assert.equal(headers["authorization"], "Bearer test-api-key");
    return json({
      usageItems: [
        { date: "2026-07-01", product: "actions", netAmount: 12.5, repositoryName: "repo-a" },
        { date: "2026-07-02", product: "actions", netAmount: 7.5, repositoryName: "repo-b" },
        { date: "2026-07-02", product: "copilot", netAmount: 19, repositoryName: "" },
        { date: "2026-07-03", product: "packages", netAmount: 0 },
      ],
    });
  }, async () => {
    const evidence = await githubBillingAdapter.sync(connection({ providerAccountId: "acme" })) as ConnectorEvidence[];
    assert.equal(evidence.length, 2);
    const actions = evidence.find((item) => item.externalId.endsWith(":actions"));
    assert.equal(actions?.amount, 20);
    assert.equal(actions?.currency, "USD");
    assert.equal(actions?.observedAt, "2026-07-02T00:00:00.000Z");
    const copilot = evidence.find((item) => item.externalId.endsWith(":copilot"));
    assert.equal(copilot?.amount, 19);
  });
});

test("github billing requires an organization slug and a token", async () => {
  await assert.rejects(
    githubBillingAdapter.sync(connection({ providerAccountId: undefined })),
    /organization slug is required/,
  );
  await assert.rejects(
    githubBillingAdapter.connect(connection({ providerAccountId: "acme", apiKey: undefined })),
    /billing read access is required/,
  );
});
