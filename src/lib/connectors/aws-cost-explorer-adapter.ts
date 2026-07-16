import { createHash } from "node:crypto";
import type { ConnectorAdapter, ConnectorConnection, ConnectorEvidence } from "@/lib/connector-runtime";
import { sigV4AmzDate, signAwsRequest } from "@/lib/connectors/aws-sigv4";

/**
 * AWS Cost Explorer GetCostAndUsage: daily unblended cost grouped by service.
 * Cost Explorer is a global endpoint served from us-east-1. Credentials are a
 * read-only IAM access key pair supplied per workspace as
 * "ACCESS_KEY_ID:SECRET_ACCESS_KEY" (a colon never appears in either part).
 */

type CostExplorerResponse = {
  ResultsByTime?: Array<{
    TimePeriod?: { Start?: string; End?: string };
    Groups?: Array<{
      Keys?: string[];
      Metrics?: { UnblendedCost?: { Amount?: string; Unit?: string } };
    }>;
  }>;
};

const costExplorerHost = "ce.us-east-1.amazonaws.com";

export const awsCostExplorerAdapter: ConnectorAdapter = {
  id: "aws-cost-explorer",
  async connect(connection) {
    parseAwsKeyPair(connection);
    return {
      ...connection,
      accessRef: connection.accessRef ?? "vault:api_key",
      scopes: connection.scopes.length ? connection.scopes : ["ce:GetCostAndUsage"],
    };
  },
  async sync(connection, context) {
    const { accessKeyId, secretAccessKey } = parseAwsKeyPair(connection);
    const now = new Date();
    const previousEnd = typeof context?.cursorState.windowEndUnix === "number" ? context.cursorState.windowEndUnix : null;
    const startDate = previousEnd
      ? new Date(Math.max(now.getTime() - 30 * 86_400_000, previousEnd * 1000 - 86_400_000))
      : new Date(now.getTime() - 30 * 86_400_000);

    const body = JSON.stringify({
      TimePeriod: { Start: isoDay(startDate), End: isoDay(now) },
      Granularity: "DAILY",
      Metrics: ["UnblendedCost"],
      GroupBy: [{ Type: "DIMENSION", Key: "SERVICE" }],
    });

    const amzDate = sigV4AmzDate(now);
    const headers: Record<string, string> = {
      "content-type": "application/x-amz-json-1.1",
      host: costExplorerHost,
      "x-amz-date": amzDate,
      "x-amz-target": "AWSInsightsIndexService.GetCostAndUsage",
    };
    const { authorization } = signAwsRequest({
      method: "POST",
      host: costExplorerHost,
      path: "/",
      query: "",
      headers,
      body,
      region: "us-east-1",
      service: "ce",
      accessKeyId,
      secretAccessKey,
    });

    const response = await fetch(`https://${costExplorerHost}/`, {
      method: "POST",
      headers: { ...headers, authorization },
      body,
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      throw new Error(`AWS Cost Explorer sync failed with ${response.status}.`);
    }

    const payload = await response.json() as CostExplorerResponse;
    return {
      evidence: normalizeCostExplorerEvidence(payload, connection),
      nextCursorState: { windowEndUnix: Math.floor(now.getTime() / 1000) },
      nextSyncAt: new Date(now.getTime() + 86_400_000).toISOString(),
      coverage: {
        startAt: startDate.toISOString(),
        endAt: now.toISOString(),
        completeness: "partial",
      },
    };
  },
};

function normalizeCostExplorerEvidence(payload: CostExplorerResponse, connection: ConnectorConnection): ConnectorEvidence[] {
  const evidence: ConnectorEvidence[] = [];

  for (const window of payload.ResultsByTime ?? []) {
    const observedAt = window.TimePeriod?.End ? `${window.TimePeriod.End}T00:00:00.000Z` : new Date().toISOString();

    for (const group of window.Groups ?? []) {
      const service = group.Keys?.[0];
      const amount = Number.parseFloat(group.Metrics?.UnblendedCost?.Amount ?? "");
      if (!service || !Number.isFinite(amount) || amount <= 0) continue;

      const currency = (group.Metrics?.UnblendedCost?.Unit ?? "USD").toUpperCase();
      evidence.push({
        connectorId: awsCostExplorerAdapter.id,
        externalId: `aws-cost:${hashPayload({ start: window.TimePeriod?.Start ?? null, end: window.TimePeriod?.End ?? null, service, currency })}`,
        provider: "aws",
        observedAt,
        evidenceType: "cost",
        merchantRaw: `AWS ${service}`,
        amount: Math.round(amount * 100) / 100,
        currency,
        category: "Cloud hosting",
        cadenceHint: "usage-window",
        sourcePayloadHash: hashPayload({ provider: "aws", window, service, workspaceId: connection.workspaceId }),
        confidence: 95,
      });
    }
  }

  return evidence;
}

function parseAwsKeyPair(connection?: ConnectorConnection) {
  const raw = connection?.apiKey?.trim();
  const separator = raw?.indexOf(":") ?? -1;
  const accessKeyId = separator > 0 ? raw!.slice(0, separator).trim() : "";
  const secretAccessKey = separator > 0 ? raw!.slice(separator + 1).trim() : "";
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("AWS credentials are required as ACCESS_KEY_ID:SECRET_ACCESS_KEY with read-only Cost Explorer access.");
  }
  return { accessKeyId, secretAccessKey };
}

function isoDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

function hashPayload(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("base64url");
}
