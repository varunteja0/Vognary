import { createHash } from "node:crypto";
import type { ConnectorAdapter, ConnectorConnection, ConnectorEvidence } from "@/lib/connector-runtime";

type OpenAICostsResponse = {
  data?: OpenAICostBucket[];
};

type OpenAICostBucket = {
  start_time?: number;
  end_time?: number;
  results?: OpenAICostResult[];
};

type OpenAICostResult = {
  amount?: {
    value?: number;
    currency?: string;
  };
  line_item?: string | null;
  project_id?: string | null;
  organization_id?: string | null;
};

const openAiCostsUrl = "https://api.openai.com/v1/organization/costs";

export const openAiCostsAdapter: ConnectorAdapter = {
  id: "openai-costs",
  async connect(connection) {
    getOpenAiAdminKey(connection);
    return {
      ...connection,
      accessRef: connection.accessRef ?? (connection.apiKey ? "vault:api_key" : "env:OPENAI_ADMIN_API_KEY"),
      scopes: connection.scopes.length ? connection.scopes : ["organization:costs:read"],
    };
  },
  async sync(connection) {
    const apiKey = getOpenAiAdminKey(connection);
    const url = new URL(openAiCostsUrl);
    const endTime = Math.floor(Date.now() / 1000);
    const startTime = endTime - 30 * 24 * 60 * 60;
    url.searchParams.set("start_time", String(startTime));
    url.searchParams.set("limit", "31");

    const response = await fetch(url, {
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      throw new Error(`OpenAI costs sync failed with ${response.status}.`);
    }

    const payload = await response.json() as OpenAICostsResponse;
    return normalizeOpenAiCostEvidence(payload, connection);
  },
};

function normalizeOpenAiCostEvidence(payload: OpenAICostsResponse, connection: ConnectorConnection): ConnectorEvidence[] {
  const evidence: ConnectorEvidence[] = [];

  for (const bucket of payload.data ?? []) {
    const observedAt = toIsoDate(bucket.end_time ?? bucket.start_time);

    for (const result of bucket.results ?? []) {
      const amount = result.amount?.value;
      if (typeof amount !== "number" || amount <= 0) continue;

      const currency = (result.amount?.currency ?? "USD").toUpperCase();
      const merchantRaw = result.line_item ? `OpenAI ${result.line_item}` : "OpenAI usage";
      const payloadHash = hashPayload({ bucket, result, workspaceId: connection.workspaceId });

      evidence.push({
        connectorId: openAiCostsAdapter.id,
        provider: "openai",
        observedAt,
        evidenceType: "cost",
        merchantRaw,
        amount,
        currency,
        cadenceHint: "usage-window",
        sourcePayloadHash: payloadHash,
        confidence: 96,
      });
    }
  }

  return evidence;
}

function getOpenAiAdminKey(connection?: ConnectorConnection) {
  const apiKey = connection?.apiKey?.trim() || process.env.OPENAI_ADMIN_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_ADMIN_API_KEY is not configured.");
  return apiKey;
}

function toIsoDate(value: number | undefined) {
  if (!value) return new Date().toISOString();
  return new Date(value * 1000).toISOString();
}

function hashPayload(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("base64url");
}