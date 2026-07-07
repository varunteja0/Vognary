import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { runConnectorSyncJob } from "@/lib/server/connector-sync-runner";
import { getWorkspaceConnectedAccount } from "@/lib/server/connected-account-store";
import { isDatabaseConfigured } from "@/lib/server/database";
import { createConnectorSyncJob } from "@/lib/server/sync-job-store";
import { requireSession, requireWorkspaceRole } from "@/lib/server/workspace-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

type ConnectorAccountSyncRouteContext = {
  params: Promise<{ accountId: string }>;
};

export async function POST(request: Request, context: ConnectorAccountSyncRouteContext) {
  const limit = await rateLimit(request, { namespace: "workspace-connectors-sync", limit: 20, windowMs: 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);

  const session = requireSession(request);
  if (session instanceof Response) return session;
  if (!session.workspaceId) return Response.json({ error: "Session has no workspace. Sign in again." }, { status: 400 });

  if (!isDatabaseConfigured()) return Response.json({ status: "not-configured", requiredEnv: ["DATABASE_URL"] }, { status: 501 });

  const authorization = await requireWorkspaceRole(request, session.workspaceId, "admin");
  if (authorization instanceof Response) return authorization;

  const { accountId } = await context.params;
  if (!isUuid(accountId)) return Response.json({ error: "Connected account id must be a UUID." }, { status: 400 });

  const account = await getWorkspaceConnectedAccount(session.workspaceId, accountId);
  if (!account || account.status !== "active") return Response.json({ error: "Connected account not found or inactive." }, { status: 404 });

  const job = await createConnectorSyncJob({
    workspaceId: session.workspaceId,
    connectedAccountId: account.id,
    connectorId: account.connectorId,
    jobType: "manual_refresh",
    priority: 20,
    cursorState: { source: "workspace-run-now", requestedByUserId: session.userId },
  });
  const result = await runConnectorSyncJob(job.id);

  return Response.json({
    status: result.status === "succeeded" ? "synced" : result.status,
    account,
    job,
    result,
  }, { status: result.status === "failed" ? 502 : 200 });
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}