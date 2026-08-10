import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { getLatestAuditSnapshot } from "@/lib/server/audit-snapshot-store";
import { isDatabaseConfigured } from "@/lib/server/database";
import { checkTokenVaultConfiguration } from "@/lib/server/token-vault";
import { rejectCrossSiteMutation } from "@/lib/server/request-security";
import { requireSession, requireWorkspaceRole, type WorkspaceRole } from "@/lib/server/workspace-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const limit = await rateLimit(request, { namespace: "audit-snapshot-read", limit: 60, windowMs: 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);

  const ready = await getSnapshotReadiness(request, "viewer");
  if (ready instanceof Response) return ready;

  const snapshot = await getLatestAuditSnapshot(ready.workspaceId);
  return Response.json({ status: snapshot ? "ok" : "empty", snapshot });
}

export async function POST(request: Request) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;

  const limit = await rateLimit(request, { namespace: "audit-snapshot-save", limit: 20, windowMs: 60 * 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);

  const ready = await getSnapshotReadiness(request, "member");
  if (ready instanceof Response) return ready;
  return retiredLegacySnapshotMutation();
}

export async function DELETE(request: Request) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;

  const limit = await rateLimit(request, { namespace: "audit-snapshot-delete", limit: 8, windowMs: 60 * 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);

  const ready = await getSnapshotReadiness(request, "admin");
  if (ready instanceof Response) return ready;
  return retiredLegacySnapshotMutation();
}

async function getSnapshotReadiness(request: Request, minimumRole: WorkspaceRole) {
  const session = await requireSession(request);
  if (session instanceof Response) return session;
  if (!session.workspaceId) return Response.json({ error: "Session has no workspace. Sign in again." }, { status: 400 });

  const authorization = await requireWorkspaceRole(request, session.workspaceId, minimumRole);
  if (authorization instanceof Response) return authorization;
  if (!isDatabaseConfigured()) return Response.json({ status: "not-configured", requiredEnv: ["DATABASE_URL"] }, { status: 501 });

  const tokenVault = checkTokenVaultConfiguration();
  if (tokenVault.status !== "ready") {
    return Response.json({
      status: "not-configured",
      requiredEnv: ["TOKEN_ENCRYPTION_KEY"],
      message: tokenVault.message ?? "Encrypted audit snapshot storage requires TOKEN_ENCRYPTION_KEY.",
    }, { status: 501 });
  }

  return { session, workspaceId: session.workspaceId };
}

function retiredLegacySnapshotMutation() {
  return Response.json({
    status: "retired",
    canonicalOwner: "RECOVERY_V1",
    message: "Legacy workspace snapshot mutations are retired. Recovery evidence, commitments, corrections, and decisions are canonical.",
  }, {
    status: 410,
    headers: { "cache-control": "private, no-store", deprecation: "true" },
  });
}
