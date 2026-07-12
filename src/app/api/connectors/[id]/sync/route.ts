import { buildConnectorSyncPlan } from "@/lib/connector-runtime";
import { buildEnvironmentConnection, getConnectorAdapter } from "@/lib/connectors/adapter-registry";
import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { isEnvironmentConnectorPreviewEnabled } from "@/lib/server/connector-preview-policy";
import { readLimitedJson, RequestBodyTooLargeError, UnsupportedContentTypeError } from "@/lib/server/request-body";
import { rejectCrossSiteMutation } from "@/lib/server/request-security";
import { requireSession, requireWorkspaceRole } from "@/lib/server/workspace-auth";

export const dynamic = "force-dynamic";

type ConnectorRouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: ConnectorRouteContext) {
  const { id } = await context.params;
  const plan = buildConnectorSyncPlan(id);
  const status = plan.state === "not-found" ? 404 : 200;

  return Response.json({ status: plan.state, plan }, { status });
}

export async function POST(request: Request, context: ConnectorRouteContext) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;

  const limit = await rateLimit(request, { namespace: "connector-sync", limit: 60, windowMs: 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);

  const session = await requireSession(request);
  if (session instanceof Response) return session;
  if (!session.workspaceId) return Response.json({ error: "Session has no workspace. Sign in again." }, { status: 400 });

  const authorization = await requireWorkspaceRole(request, session.workspaceId, "admin");
  if (authorization instanceof Response) return authorization;

  const { id } = await context.params;
  const body = await readSyncJson(request);
  if (body instanceof Response) return body;
  const plan = buildConnectorSyncPlan(id);

  if (typeof body.workspaceId === "string" && body.workspaceId !== session.workspaceId) {
    return Response.json({ error: "Workspace access denied." }, { status: 403 });
  }

  if (plan.state === "not-found") {
    return Response.json({ status: "not-found", plan }, { status: 404 });
  }

  if (plan.state === "blocked") {
    return Response.json({ status: "blocked", plan }, { status: 409 });
  }

  const adapter = getConnectorAdapter(id);
  if (plan.state === "ready" && adapter) {
    if (!isEnvironmentConnectorPreviewEnabled()) {
      return Response.json({
        status: "preview-disabled",
        message: "Environment-backed sync previews are disabled. Connect a workspace account and use its authenticated sync route.",
        plan,
      }, { status: 410 });
    }

    try {
      const connection = await adapter.connect(buildEnvironmentConnection(id, session.workspaceId));
      const syncResult = await adapter.sync(connection);
      const evidence = Array.isArray(syncResult) ? syncResult : syncResult.evidence;

      return Response.json({
        status: "sync-preview-complete",
        storage: "none",
        evidenceCount: evidence.length,
        evidence,
        plan,
      }, { status: 200 });
    } catch (error) {
      return Response.json({
        status: "sync-failed",
        error: error instanceof Error ? error.message : "Connector sync failed.",
        plan,
      }, { status: 502 });
    }
  }

  return Response.json({
    status: plan.state === "manual" ? "manual-evidence-required" : "sync-plan-ready",
    requestedWorkspaceId: session.workspaceId,
    plan,
  }, { status: 202 });
}

async function readSyncJson(request: Request): Promise<Record<string, unknown> | Response> {
  try {
    return await readLimitedJson<Record<string, unknown>>(request, 4 * 1024);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return Response.json({ error: "Sync request is too large." }, { status: 413 });
    if (error instanceof UnsupportedContentTypeError) return Response.json({ error: "Content-Type must be application/json." }, { status: 415 });
    return Response.json({ error: "Sync request must be valid JSON." }, { status: 400 });
  }
}
