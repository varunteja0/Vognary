import { getConnectorAdapter } from "@/lib/connectors/adapter-registry";
import { getConnectorById } from "@/lib/connectors";
import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { isDatabaseConfigured } from "@/lib/server/database";
import { requireInternalSecret } from "@/lib/server/internal-auth";
import { createConnectorSyncJob, type SyncJobType } from "@/lib/server/sync-job-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = requireInternalSecret(request);
  if (auth) return auth;

  const limit = await rateLimit(request, { namespace: "internal-sync-jobs", limit: 60, windowMs: 60_000, requireShared: true });
  if (!limit.allowed) return rateLimitExceeded(limit);

  const body = await readJson(request);
  const connectorId = readString(body.connectorId);
  const workspaceId = readString(body.workspaceId);

  if (!connectorId || !workspaceId) {
    return Response.json({ error: "connectorId and workspaceId are required." }, { status: 400 });
  }

  if (!isUuid(workspaceId)) return Response.json({ error: "workspaceId must be a UUID." }, { status: 400 });
  if (!isDatabaseConfigured()) {
    return Response.json({
      status: "not-configured",
      requiredEnv: ["DATABASE_URL"],
      message: "DATABASE_URL is required for internal sync jobs.",
    }, { status: 501 });
  }

  if (!getConnectorById(connectorId)) return Response.json({ error: "Connector not found." }, { status: 404 });
  if (!getConnectorAdapter(connectorId)) return Response.json({ error: "Connector adapter is not registered." }, { status: 409 });

  try {
    const job = await createConnectorSyncJob({
      connectorId,
      workspaceId,
      connectedAccountId: readString(body.connectedAccountId),
      jobType: readJobType(body.jobType),
      priority: typeof body.priority === "number" ? body.priority : undefined,
      cursorState: readRecord(body.cursorState),
    });

    return Response.json({ status: "queued", job }, { status: 202 });
  } catch (error) {
    return Response.json({
      status: "sync-job-create-failed",
      error: error instanceof Error ? error.message : "Unable to create sync job.",
    }, { status: 500 });
  }
}

async function readJson(request: Request) {
  try {
    return await request.json() as Record<string, unknown>;
  } catch {
    return {};
  }
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function readJobType(value: unknown): SyncJobType | undefined {
  return value === "initial_sync" || value === "incremental_sync" || value === "backfill" || value === "webhook_replay" || value === "manual_refresh"
    ? value
    : undefined;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}