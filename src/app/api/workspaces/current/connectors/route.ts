import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { isDatabaseConfigured } from "@/lib/server/database";
import { listWorkspaceConnectedAccounts, listWorkspaceConnectorEvidence } from "@/lib/server/connected-account-store";
import { requireSession } from "@/lib/server/workspace-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const limit = await rateLimit(request, { namespace: "workspace-connectors-read", limit: 60, windowMs: 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);

  const session = requireSession(request);
  if (session instanceof Response) return session;
  if (!session.workspaceId) return Response.json({ error: "Session has no workspace. Sign in again." }, { status: 400 });

  if (!isDatabaseConfigured()) return Response.json({ status: "not-configured", requiredEnv: ["DATABASE_URL"] }, { status: 501 });

  const [accounts, evidence] = await Promise.all([
    listWorkspaceConnectedAccounts(session.workspaceId),
    listWorkspaceConnectorEvidence(session.workspaceId),
  ]);

  return Response.json({ status: "ok", accounts, evidence });
}