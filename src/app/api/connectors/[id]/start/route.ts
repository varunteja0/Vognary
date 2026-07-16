import { buildConnectorConsentResourceKey } from "@/lib/consent";
import { currentPrivacyNoticeVersion } from "@/lib/privacy-notice";
import { getConnectorById, type Connector } from "@/lib/connectors";
import { buildConnectorStartResponse } from "@/lib/connector-runtime";
import { getConnectorAdapter } from "@/lib/connectors/adapter-registry";
import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { runConnectorSyncJob } from "@/lib/server/connector-sync-runner";
import { getDatabasePool, isDatabaseConfigured } from "@/lib/server/database";
import { recordConsentGrant } from "@/lib/server/consent-store";
import {
  readLimitedJson,
  RequestBodyTooLargeError,
  UnsupportedContentTypeError,
} from "@/lib/server/request-body";
import { rejectCrossSiteMutation } from "@/lib/server/request-security";
import { checkTokenVaultConfiguration } from "@/lib/server/token-vault";
import { upsertConnectedAccount, storeConnectorSecret } from "@/lib/server/connector-token-store";
import { createConnectorSyncJob } from "@/lib/server/sync-job-store";
import { requireWorkspaceRole } from "@/lib/server/workspace-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

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
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;

  const limit = await rateLimit(request, { namespace: "connector-start", limit: 60, windowMs: 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);

  const { id } = await context.params;
  let body: Record<string, unknown>;
  try {
    body = await readLimitedJson<Record<string, unknown>>(request, 32 * 1024);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return Response.json({ error: "Connector setup payload is too large." }, { status: 413 });
    }
    if (error instanceof UnsupportedContentTypeError) {
      return Response.json({ error: "Connector setup requires application/json." }, { status: 415 });
    }
    return Response.json({ error: "Connector setup payload is not valid JSON." }, { status: 400 });
  }
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
  const start = buildConnectorStartResponse(connector.id);
  if (start.state !== "ready-to-connect" || !getConnectorAdapter(connector.id)) {
    return Response.json({
      error: `${connector.name} is not available for credential storage or synchronization in this deployment.`,
      state: start.state,
    }, { status: 409 });
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
  let persisted: Awaited<ReturnType<typeof persistApiKeyConnector>>;
  try {
    persisted = await persistApiKeyConnector({
      connector,
      workspaceId,
      userId: authorization.session.userId,
      email: authorization.session.email,
      providerAccountId,
      displayName,
      apiKey,
    });
  } catch {
    return Response.json({
      error: "The connector authorization could not be stored. No synchronization job was activated.",
    }, { status: 502 });
  }

  const { connectedAccount, token, syncJob } = persisted;
  const initialSync = await runConnectorSyncJob(syncJob.id, "initial-setup");

  return Response.json({
    status: initialSync.status === "succeeded" ? "connected-and-synced" : "connected-sync-needs-attention",
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
    initialSync,
  }, { status: 201 });
}

async function persistApiKeyConnector(input: {
  connector: Connector;
  workspaceId: string;
  userId: string;
  email: string;
  providerAccountId: string;
  displayName: string;
  apiKey: string;
}) {
  const client = await getDatabasePool().connect();
  try {
    await client.query("begin");
    const scopes = input.connector.scopes ?? [];
    const consent = await recordConsentGrant({
      workspaceId: input.workspaceId,
      userId: input.userId,
      subjectEmail: input.email,
      resourceKey: buildConnectorConsentResourceKey(input.connector.id, input.providerAccountId),
      purpose: "provider-connector-sync",
      noticeVersion: currentPrivacyNoticeVersion,
      source: "api-key-connector-start",
      scopes,
    }, client);
    const connectedAccount = await upsertConnectedAccount({
      workspaceId: input.workspaceId,
      consentGrantId: consent.id,
      connectorId: input.connector.id,
      authType: input.connector.authType,
      providerAccountId: input.providerAccountId,
      displayName: input.displayName,
      scopes,
      metadata: {
        connectedByUserId: input.userId,
        connectedAt: new Date().toISOString(),
        source: "api-key-connector-start",
      },
    }, client);
    const token = await storeConnectorSecret({
      connectedAccountId: connectedAccount.id,
      tokenKind: "api_key",
      secret: input.apiKey,
      scopes,
      metadata: { connectorId: input.connector.id, providerAccountId: input.providerAccountId },
    }, client);
    const syncJob = await createConnectorSyncJob({
      workspaceId: input.workspaceId,
      connectedAccountId: connectedAccount.id,
      connectorId: input.connector.id,
      jobType: "initial_sync",
      priority: 50,
      cursorState: { source: "api-key-connector-start" },
    }, client);
    await client.query("commit");
    return { connectedAccount, token, syncJob };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

function readRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
