import { createHash } from "node:crypto";
import type { ConnectorAdapter, ConnectorConnection, ConnectorEvidence } from "@/lib/connector-runtime";
import { isEnvironmentConnectorPreviewEnabled } from "@/lib/server/connector-preview-policy";

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
  async sync(connection, context) {
    const apiKey = getOpenAiAdminKey(connection);
    const url = new URL(openAiCostsUrl);
    const endTime = Math.floor(Date.now() / 1000);
    const previousEnd = asUnixSeconds(context?.cursorState.windowEndUnix);
    const startTime = previousEnd
      ? Math.max(endTime - 30 * 24 * 60 * 60, previousEnd - 24 * 60 * 60)
      : endTime - 30 * 24 * 60 * 60;
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
    return {
      evidence: normalizeOpenAiCostEvidence(payload, connection),
      nextCursorState: { windowEndUnix: endTime },
      nextSyncAt: new Date((endTime + 24 * 60 * 60) * 1_000).toISOString(),
      coverage: {
        startAt: new Date(startTime * 1_000).toISOString(),
        endAt: new Date(endTime * 1_000).toISOString(),
        completeness: "partial",
      },
    };
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
      const externalId = hashPayload({
        startTime: bucket.start_time,
        endTime: bucket.end_time,
        lineItem: result.line_item ?? null,
        projectId: result.project_id ?? null,
        organizationId: result.organization_id ?? null,
        currency,
      });

      evidence.push({
        connectorId: openAiCostsAdapter.id,
        externalId: `openai-cost:${externalId}`,
        provider: "openai",
        observedAt,
        evidenceType: "cost",
        merchantRaw,
        amount,
        currency,
        category: "AI usage",
        cadenceHint: "usage-window",
        sourcePayloadHash: payloadHash,
        confidence: 96,
      });
    }
  }

  return evidence;
}

function getOpenAiAdminKey(connection?: ConnectorConnection) {
  const workspaceApiKey = connection?.apiKey?.trim();
  if (workspaceApiKey) return workspaceApiKey;

  const apiKey = !connection?.connectedAccountId && isEnvironmentConnectorPreviewEnabled()
    ? process.env.OPENAI_ADMIN_API_KEY?.trim()
    : undefined;
  if (!apiKey) {
    throw new Error(connection?.connectedAccountId
      ? "OpenAI Admin API key is not configured for this connected account."
      : "Non-production OpenAI environment preview is not configured.");
  }
  return apiKey;
}

function toIsoDate(value: number | undefined) {
  if (!value) return new Date().toISOString();
  return new Date(value * 1000).toISOString();
}

function asUnixSeconds(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return Math.floor(value);
}

function hashPayload(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("base64url");
}
