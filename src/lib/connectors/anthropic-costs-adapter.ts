import { createHash } from "node:crypto";
import type { ConnectorAdapter, ConnectorConnection, ConnectorEvidence } from "@/lib/connector-runtime";
import { isEnvironmentConnectorPreviewEnabled } from "@/lib/server/connector-preview-policy";

/**
 * Anthropic Admin API cost report. Verified 2026-07-16 against
 * platform.claude.com/docs/en/api/usage-cost-api:
 * GET /v1/organizations/cost_report — daily buckets only, USD amounts as
 * decimal strings in cents, has_more/next_page pagination, admin key auth
 * (sk-ant-admin01-…). Organization accounts only; individual accounts get 4xx.
 */

type AnthropicCostReportResponse = {
  data?: AnthropicCostBucket[];
  has_more?: boolean;
  next_page?: string | null;
};

type AnthropicCostBucket = {
  starting_at?: string;
  ending_at?: string;
  results?: AnthropicCostResult[];
};

type AnthropicCostResult = {
  currency?: string;
  amount?: string | number;
  description?: string | null;
  workspace_id?: string | null;
  model?: string | null;
};

const anthropicCostReportUrl = "https://api.anthropic.com/v1/organizations/cost_report";
const maxCostReportPages = 3;

export const anthropicUsageAdapter: ConnectorAdapter = {
  id: "anthropic-usage",
  async connect(connection) {
    getAnthropicAdminKey(connection);
    return {
      ...connection,
      accessRef: connection.accessRef ?? (connection.apiKey ? "vault:api_key" : "env:ANTHROPIC_ADMIN_API_KEY"),
      scopes: connection.scopes.length ? connection.scopes : ["organization:cost_report:read"],
    };
  },
  async sync(connection, context) {
    const apiKey = getAnthropicAdminKey(connection);
    const endTime = Math.floor(Date.now() / 1000);
    const previousEnd = asUnixSeconds(context?.cursorState.windowEndUnix);
    const startTime = previousEnd
      ? Math.max(endTime - 30 * 24 * 60 * 60, previousEnd - 24 * 60 * 60)
      : endTime - 30 * 24 * 60 * 60;

    const evidence: ConnectorEvidence[] = [];
    let page: string | null = null;

    for (let requestIndex = 0; requestIndex < maxCostReportPages; requestIndex += 1) {
      const url = new URL(anthropicCostReportUrl);
      url.searchParams.set("starting_at", new Date(startTime * 1000).toISOString());
      url.searchParams.set("ending_at", new Date(endTime * 1000).toISOString());
      url.searchParams.append("group_by[]", "description");
      if (page) url.searchParams.set("page", page);

      const response = await fetch(url, {
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        throw new Error(`Anthropic cost report sync failed with ${response.status}.`);
      }

      const payload = await response.json() as AnthropicCostReportResponse;
      evidence.push(...normalizeAnthropicCostEvidence(payload, connection));

      if (!payload.has_more || !payload.next_page) break;
      page = payload.next_page;
    }

    return {
      evidence,
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

function normalizeAnthropicCostEvidence(payload: AnthropicCostReportResponse, connection: ConnectorConnection): ConnectorEvidence[] {
  const evidence: ConnectorEvidence[] = [];

  for (const bucket of payload.data ?? []) {
    const observedAt = bucket.ending_at ?? bucket.starting_at ?? new Date().toISOString();

    for (const result of bucket.results ?? []) {
      // The API reports USD as a decimal string in the lowest unit (cents).
      const cents = typeof result.amount === "string" ? Number.parseFloat(result.amount) : typeof result.amount === "number" ? result.amount : Number.NaN;
      if (!Number.isFinite(cents) || cents <= 0) continue;
      const amount = cents / 100;

      const currency = (result.currency ?? "USD").toUpperCase();
      const merchantRaw = result.description ? `Anthropic ${result.description}` : "Anthropic API usage";
      const payloadHash = hashPayload({ bucket, result, workspaceId: connection.workspaceId });
      const externalId = hashPayload({
        startingAt: bucket.starting_at ?? null,
        endingAt: bucket.ending_at ?? null,
        description: result.description ?? null,
        workspaceId: result.workspace_id ?? null,
        model: result.model ?? null,
        currency,
      });

      evidence.push({
        connectorId: anthropicUsageAdapter.id,
        externalId: `anthropic-cost:${externalId}`,
        provider: "anthropic",
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

function getAnthropicAdminKey(connection?: ConnectorConnection) {
  const workspaceApiKey = connection?.apiKey?.trim();
  if (workspaceApiKey) return workspaceApiKey;

  const apiKey = !connection?.connectedAccountId && isEnvironmentConnectorPreviewEnabled()
    ? process.env.ANTHROPIC_ADMIN_API_KEY?.trim()
    : undefined;
  if (!apiKey) {
    throw new Error(connection?.connectedAccountId
      ? "Anthropic Admin API key is not configured for this connected account."
      : "Non-production Anthropic environment preview is not configured.");
  }
  return apiKey;
}

function asUnixSeconds(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return Math.floor(value);
}

function hashPayload(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("base64url");
}
