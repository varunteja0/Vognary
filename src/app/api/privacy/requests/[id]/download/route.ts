import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { isDatabaseConfigured } from "@/lib/server/database";
import {
  downloadAccessExport,
  markAccessExportFailed,
  PrivacyExportTooLargeError,
  PrivacyLifecycleAccessError,
} from "@/lib/server/privacy-lifecycle-store";
import { rejectCrossSiteMutation } from "@/lib/server/request-security";
import { requireSession, requireWorkspaceRole } from "@/lib/server/workspace-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const recentAuthWindowMs = 15 * 60_000;
const privateHeaders = { "cache-control": "private, no-store", pragma: "no-cache" };

type DownloadRouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: DownloadRouteContext) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;

  const limit = await rateLimit(request, { namespace: "privacy-export-download", limit: 5, windowMs: 60 * 60_000, requireShared: true });
  if (!limit.allowed) return rateLimitExceeded(limit);

  const session = await requireSession(request);
  if (session instanceof Response) return session;
  if (!session.workspaceId) return Response.json({ error: "Session has no workspace." }, { status: 400, headers: privateHeaders });
  if (!isDatabaseConfigured()) return Response.json({ error: "Privacy lifecycle storage is not configured." }, { status: 501, headers: privateHeaders });
  if (Date.now() - session.issuedAt > recentAuthWindowMs) return recentAuthenticationRequired();

  const authorization = await requireWorkspaceRole(request, session.workspaceId, "admin");
  if (authorization instanceof Response) return authorization;
  const { id } = await context.params;
  if (!isUuid(id)) return Response.json({ error: "Privacy request was not found." }, { status: 404, headers: privateHeaders });

  try {
    const result = await downloadAccessExport({ requestId: id, workspaceId: session.workspaceId, actorUserId: session.userId });
    if (result.status === "not-found") return Response.json({ error: "Privacy request was not found." }, { status: 404, headers: privateHeaders });
    if (result.status === "expired") return Response.json({ error: "Privacy export availability has expired. Create a new request." }, { status: 410, headers: privateHeaders });
    if (!("serialized" in result)) return Response.json({ error: "Privacy request was not found." }, { status: 404, headers: privateHeaders });

    return new Response(result.serialized, {
      status: 200,
      headers: {
        ...privateHeaders,
        "content-type": "application/json; charset=utf-8",
        "content-disposition": "attachment; filename=\"vognary-privacy-export.json\"",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof PrivacyLifecycleAccessError) {
      return Response.json({ error: "Workspace access denied." }, { status: 403, headers: privateHeaders });
    }
    if (error instanceof PrivacyExportTooLargeError) {
      await markAccessExportFailed({
        requestId: id,
        workspaceId: session.workspaceId,
        actorUserId: session.userId,
        failureCode: "export_too_large",
      }).catch(() => undefined);
      return Response.json({
        error: "This workspace export is too large for synchronous delivery. Contact privacy@vognary.com for assisted fulfillment.",
        code: "export_too_large",
      }, { status: 409, headers: privateHeaders });
    }
    return Response.json({ error: "Privacy export generation failed." }, { status: 500, headers: privateHeaders });
  }
}

function recentAuthenticationRequired() {
  return Response.json({
    error: "Recent authentication is required before downloading a workspace export. Sign out and sign in again, then retry within 15 minutes.",
    code: "recent-authentication-required",
  }, { status: 403, headers: privateHeaders });
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
