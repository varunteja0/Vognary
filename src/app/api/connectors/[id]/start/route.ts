import { getConnectorById, type Connector } from "@/lib/connectors";
import { buildConnectorStartResponse } from "@/lib/connector-runtime";
import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { isDatabaseConfigured } from "@/lib/server/database";
import { checkTokenVaultConfiguration } from "@/lib/server/token-vault";
import { upsertConnectedAccount, storeConnectorSecret } from "@/lib/server/connector-token-store";
import { createConnectorSyncJob } from "@/lib/server/sync-job-store";
import { requireWorkspaceRole } from "@/lib/server/workspace-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ConnectorRouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: ConnectorRouteContext) {
  const { id } = await context.params;
  const response = buildConnectorStartResponse(id);
  const status = response.status === "error" ? 404 : 200;

  return Response.json(response, { status });
}

export async function POST(request: Request, context: ConnectorRouteContext) {
  const limit = await rateLimit(request, { namespace: "connector-start", limit: 60, windowMs: 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);

  const { id } = await context.params;
  const body = await readJson(request);
  const connector = getConnectorById(id);
  if (!connector) return Response.json(buildConnectorStartResponse(id), { status: 404 });

  const apiKey = readString(body.apiKey) ?? readString(readRecord(body.credentials)?.apiKey);
  if (apiKey) return connectApiKeyConnector(request, connector, body, apiKey);

  const response = buildConnectorStartResponse(id);
  const status = response.status === "error" ? 404 : 200;

  return Response.json({
    ...response,
    requestedWorkspaceId: typeof body.workspaceId === "string" ? body.workspaceId : null,
  }, { status });
}

async function connectApiKeyConnector(request: Request, connector: Connector, body: Record<string, unknown>, apiKey: string) {
  if (connector.authType !== "api-key") {
    return Response.json({ error: `${connector.name} does not accept API-key connection payloads.` }, { status: 400 });
  }

  if (!isDatabaseConfigured()) {
    return Response.json({ status: "not-configured", requiredEnv: ["DATABASE_URL"] }, { status: 501 });
  }

  const tokenVault = checkTokenVaultConfiguration();
  if (tokenVault.status !== "ready") {
    return Response.json({
      status: "not-configured",
      requiredEnv: ["TOKEN_ENCRYPTION_KEY"],
      message: tokenVault.message ?? "API-key connector storage requires TOKEN_ENCRYPTION_KEY.",
    }, { status: 501 });
  }

  const workspaceId = readString(body.workspaceId);
  if (!workspaceId) return Response.json({ error: "workspaceId is required to store connector credentials." }, { status: 400 });

  const authorization = await requireWorkspaceRole(request, workspaceId, "admin");
  if (authorization instanceof Response) return authorization;

  const providerAccountId = readString(body.providerAccountId) ?? "default";
  const displayName = readString(body.displayName) ?? `${connector.name} (${providerAccountId})`;
  const connectedAccount = await upsertConnectedAccount({
    workspaceId,
    connectorId: connector.id,
    authType: connector.authType,
    providerAccountId,
    displayName,
    scopes: connector.scopes ?? [],
    metadata: {
      connectedByUserId: authorization.session.userId,
      connectedAt: new Date().toISOString(),
      source: "api-key-connector-start",
    },
  });

  const token = await storeConnectorSecret({
    connectedAccountId: connectedAccount.id,
    tokenKind: "api_key",
    secret: apiKey,
    scopes: connector.scopes ?? [],
    metadata: { connectorId: connector.id, providerAccountId },
  });

  const syncJob = await createConnectorSyncJob({
    workspaceId,
    connectedAccountId: connectedAccount.id,
    connectorId: connector.id,
    jobType: "initial_sync",
    priority: 50,
    cursorState: { source: "api-key-connector-start" },
  });

  return Response.json({
    status: "connected",
    connectorId: connector.id,
    workspaceId,
    connectedAccount: {
      id: connectedAccount.id,
      displayName: connectedAccount.displayName,
      providerAccountId: connectedAccount.providerAccountId,
    },
    token: {
      status: token.status,
      keyFingerprint: token.keyFingerprint,
    },
    syncJob,
  }, { status: 201 });
}

async function readJson(request: Request) {
  try {
    return await request.json() as Record<string, unknown>;
  } catch {
    return {};
  }
}

function readRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}