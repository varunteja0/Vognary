import assert from "node:assert/strict";
import test from "node:test";
import type { ConnectorConnection, ConnectorEvidence, ConnectorSyncResult } from "../src/lib/connector-runtime";
import { awsCostExplorerAdapter } from "../src/lib/connectors/aws-cost-explorer-adapter";
import { signAwsRequest } from "../src/lib/connectors/aws-sigv4";

test("SigV4 signer reproduces AWS's published worked example exactly", () => {
  // The AKIDEXAMPLE vector from AWS's Signature Version 4 documentation.
  // Reproducing its documented hashes byte-for-byte proves the algorithm.
  const { authorization, canonicalRequestHash, signature } = signAwsRequest({
    method: "GET",
    host: "iam.amazonaws.com",
    path: "/",
    query: "Action=ListUsers&Version=2010-05-08",
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=utf-8",
      host: "iam.amazonaws.com",
      "x-amz-date": "20150830T123600Z",
    },
    body: "",
    region: "us-east-1",
    service: "iam",
    accessKeyId: "AKIDEXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
  });

  assert.equal(canonicalRequestHash, "f536975d06c0309214f805bb90ccff089219ecd68b2577efef23edd43b7e1a59");
  assert.equal(signature, "5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7");
  assert.equal(
    authorization,
    "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7",
  );
});

function connection(overrides: Partial<ConnectorConnection> = {}): ConnectorConnection {
  return {
    connectorId: "aws-cost-explorer",
    workspaceId: "ws-test",
    scopes: [],
    apiKey: "AKIAEXAMPLEKEY:secretExample/Key+Value=",
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

function asSyncResult(result: ConnectorEvidence[] | ConnectorSyncResult): ConnectorSyncResult {
  assert.equal(Array.isArray(result), false);
  return result as ConnectorSyncResult;
}

test("cost explorer sync signs the request and maps per-service daily costs", async () => {
  let seenInit: RequestInit | undefined;
  await withMockFetch(async (input, init) => {
    seenInit = init;
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    assert.equal(url, "https://ce.us-east-1.amazonaws.com/");
    return new Response(JSON.stringify({
      ResultsByTime: [{
        TimePeriod: { Start: "2026-07-14", End: "2026-07-15" },
        Groups: [
          { Keys: ["Amazon Elastic Compute Cloud - Compute"], Metrics: { UnblendedCost: { Amount: "12.3456", Unit: "USD" } } },
          { Keys: ["AWS Lambda"], Metrics: { UnblendedCost: { Amount: "0", Unit: "USD" } } },
        ],
      }],
    }), { status: 200 });
  }, async () => {
    const result = asSyncResult(await awsCostExplorerAdapter.sync(connection()));
    assert.equal(result.evidence.length, 1);
    assert.equal(result.evidence[0].amount, 12.35);
    assert.equal(result.evidence[0].currency, "USD");
    assert.equal(result.evidence[0].merchantRaw, "AWS Amazon Elastic Compute Cloud - Compute");
    assert.equal(result.evidence[0].observedAt, "2026-07-15T00:00:00.000Z");
  });

  const headers = seenInit?.headers as Record<string, string>;
  assert.ok(headers.authorization.startsWith("AWS4-HMAC-SHA256 Credential=AKIAEXAMPLEKEY/"));
  assert.ok(headers.authorization.includes("/us-east-1/ce/aws4_request"));
  assert.equal(headers["x-amz-target"], "AWSInsightsIndexService.GetCostAndUsage");
  const body = JSON.parse(String(seenInit?.body));
  assert.equal(body.Granularity, "DAILY");
  assert.deepEqual(body.GroupBy, [{ Type: "DIMENSION", Key: "SERVICE" }]);
});

test("credentials must be a key pair separated by a colon", async () => {
  await assert.rejects(awsCostExplorerAdapter.connect(connection({ apiKey: "only-one-part" })), /ACCESS_KEY_ID:SECRET_ACCESS_KEY/);
  await assert.rejects(awsCostExplorerAdapter.connect(connection({ apiKey: undefined })), /ACCESS_KEY_ID:SECRET_ACCESS_KEY/);
  const connected = await awsCostExplorerAdapter.connect(connection());
  assert.equal(connected.scopes.includes("ce:GetCostAndUsage"), true);
});
