import { buildConnectorSyncPlan } from "@/lib/connector-runtime";
import { buildEnvironmentConnection, getConnectorAdapter } from "@/lib/connectors/adapter-registry";
import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";

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
  const limit = await rateLimit(request, { namespace: "connector-sync", limit: 60, windowMs: 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);

  const { id } = await context.params;
  const body = await readJson(request);
  const plan = buildConnectorSyncPlan(id);

  if (plan.state === "not-found") {
    return Response.json({ status: "not-found", plan }, { status: 404 });
  }

  if (plan.state === "blocked") {
    return Response.json({ status: "blocked", plan }, { status: 409 });
  }

  const adapter = getConnectorAdapter(id);
  if (plan.state === "ready" && adapter) {
    try {
      const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : "env-preview";
      const connection = await adapter.connect(buildEnvironmentConnection(id, workspaceId));
      const evidence = await adapter.sync(connection);

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
    requestedWorkspaceId: typeof body.workspaceId === "string" ? body.workspaceId : null,
    plan,
  }, { status: 202 });
}

async function readJson(request: Request) {
  try {
    return await request.json() as Record<string, unknown>;
  } catch {
    return {};
  }
}