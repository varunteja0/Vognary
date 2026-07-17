import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { listWorkspaceRecurringItems } from "@/lib/server/connected-account-store";
import { isDatabaseConfigured } from "@/lib/server/database";
import { requireSession, requireWorkspaceRole } from "@/lib/server/workspace-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const limit = await rateLimit(request, { namespace: "workspace-commitments-read", limit: 60, windowMs: 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);
  const session = await requireSession(request);
  if (session instanceof Response) return session;
  if (!session.workspaceId) return Response.json({ error: "Session has no workspace." }, { status: 400 });
  if (!isDatabaseConfigured()) return Response.json({ status: "not-configured" }, { status: 501 });
  const authorization = await requireWorkspaceRole(request, session.workspaceId, "viewer");
  if (authorization instanceof Response) return authorization;
  return Response.json({
    status: "ok",
    commitments: await listWorkspaceRecurringItems(session.workspaceId, 500, false, null, true),
  }, { headers: { "cache-control": "private, no-store" } });
}
