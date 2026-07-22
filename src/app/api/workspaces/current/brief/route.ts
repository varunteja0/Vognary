import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { getWorkspaceBrief } from "@/lib/server/assistant-brief-store";
import { isDatabaseConfigured } from "@/lib/server/database";
import { requireSession, requireWorkspaceRole } from "@/lib/server/workspace-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const noStoreHeaders = { "cache-control": "private, no-store" };

// GET /api/workspaces/current/brief — the assistant brief: what the workspace
// can save, what renews soon, and what changed. Deterministic and honest; it
// returns 501 (not 200-with-fake-data) when the database is not provisioned, so
// an unconfigured deployment is never mistaken for a real, empty workspace.
export async function GET(request: Request) {
  const limit = await rateLimit(request, { namespace: "workspace-brief-read", limit: 60, windowMs: 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);
  const session = await requireSession(request);
  if (session instanceof Response) return session;
  if (!session.workspaceId) return Response.json({ error: "Session has no workspace." }, { status: 400, headers: noStoreHeaders });
  if (!isDatabaseConfigured()) return Response.json({ status: "not-configured" }, { status: 501, headers: noStoreHeaders });
  const authorization = await requireWorkspaceRole(request, session.workspaceId, "viewer");
  if (authorization instanceof Response) return authorization;

  try {
    const brief = await getWorkspaceBrief(session.workspaceId);
    return Response.json({ status: "ok", brief }, { headers: noStoreHeaders });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "The assistant brief could not be assembled." },
      { status: 400, headers: noStoreHeaders },
    );
  }
}
