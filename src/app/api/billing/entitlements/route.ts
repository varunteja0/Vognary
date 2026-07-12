import { isDatabaseConfigured } from "@/lib/server/database";
import { listWorkspaceEntitlements } from "@/lib/server/billing-store";
import { requireSession, requireWorkspaceRole } from "@/lib/server/workspace-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await requireSession(request);
  if (session instanceof Response) return session;
  if (!session.workspaceId) return Response.json({ error: "Session has no workspace." }, { status: 400 });
  if (!isDatabaseConfigured()) return Response.json({ status: "not-configured" }, { status: 501 });
  const authorization = await requireWorkspaceRole(request, session.workspaceId, "viewer");
  if (authorization instanceof Response) return authorization;
  return Response.json({
    status: "ok",
    entitlements: await listWorkspaceEntitlements(session.workspaceId),
  }, { headers: { "cache-control": "private, no-store" } });
}