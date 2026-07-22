import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { getWorkspaceMandateKillList } from "@/lib/server/mandate-killlist-store";
import { isDatabaseConfigured } from "@/lib/server/database";
import { requireSession, requireWorkspaceRole } from "@/lib/server/workspace-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const noStoreHeaders = { "cache-control": "private, no-store" };

// GET /api/workspaces/current/mandates — the UPI mandate kill-list: every
// recurring charge pulled over an Indian auto-debit rail, with where the mandate
// is actually revoked. Deterministic and honest; returns 501 (not empty data)
// when the database is not provisioned so an unconfigured deployment is never
// mistaken for a workspace with no mandates.
export async function GET(request: Request) {
  const limit = await rateLimit(request, { namespace: "workspace-mandates-read", limit: 60, windowMs: 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);
  const session = await requireSession(request);
  if (session instanceof Response) return session;
  if (!session.workspaceId) return Response.json({ error: "Session has no workspace." }, { status: 400, headers: noStoreHeaders });
  if (!isDatabaseConfigured()) return Response.json({ status: "not-configured" }, { status: 501, headers: noStoreHeaders });
  const authorization = await requireWorkspaceRole(request, session.workspaceId, "viewer");
  if (authorization instanceof Response) return authorization;

  try {
    const mandates = await getWorkspaceMandateKillList(session.workspaceId);
    return Response.json({ status: "ok", mandates }, { headers: noStoreHeaders });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "The mandate kill-list could not be assembled." },
      { status: 400, headers: noStoreHeaders },
    );
  }
}
