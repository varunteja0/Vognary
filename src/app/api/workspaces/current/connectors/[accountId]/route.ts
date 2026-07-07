import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { isDatabaseConfigured } from "@/lib/server/database";
import { revokeWorkspaceConnectedAccount } from "@/lib/server/connected-account-store";
import { requireSession, requireWorkspaceRole } from "@/lib/server/workspace-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ConnectorAccountRouteContext = {
  params: Promise<{ accountId: string }>;
};

export async function DELETE(request: Request, context: ConnectorAccountRouteContext) {
  const limit = await rateLimit(request, { namespace: "workspace-connectors-delete", limit: 20, windowMs: 60 * 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);

  const session = requireSession(request);
  if (session instanceof Response) return session;
  if (!session.workspaceId) return Response.json({ error: "Session has no workspace. Sign in again." }, { status: 400 });

  if (!isDatabaseConfigured()) return Response.json({ status: "not-configured", requiredEnv: ["DATABASE_URL"] }, { status: 501 });

  const authorization = await requireWorkspaceRole(request, session.workspaceId, "admin");
  if (authorization instanceof Response) return authorization;

  const { accountId } = await context.params;
  if (!isUuid(accountId)) return Response.json({ error: "Connected account id must be a UUID." }, { status: 400 });

  const result = await revokeWorkspaceConnectedAccount(session.workspaceId, accountId);
  if (!result.revoked) return Response.json({ error: "Connected account not found." }, { status: 404 });

  return Response.json({ status: "revoked", ...result });
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}