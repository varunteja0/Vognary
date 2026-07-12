import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { normalizePrivacyRequestInput } from "@/lib/privacy-lifecycle";
import { isDatabaseConfigured } from "@/lib/server/database";
import {
  createAccessExportRequest,
  listDataSubjectRequests,
  PrivacyLifecycleAccessError,
} from "@/lib/server/privacy-lifecycle-store";
import { readLimitedJson, RequestBodyTooLargeError, UnsupportedContentTypeError } from "@/lib/server/request-body";
import { rejectCrossSiteMutation } from "@/lib/server/request-security";
import { requireSession, requireWorkspaceRole } from "@/lib/server/workspace-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const recentAuthWindowMs = 15 * 60_000;
const privateHeaders = { "cache-control": "private, no-store", pragma: "no-cache" };

export async function GET(request: Request) {
  const limit = await rateLimit(request, { namespace: "privacy-requests-read", limit: 30, windowMs: 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);

  const ready = await requirePrivacyWorkspace(request, "viewer");
  if (ready instanceof Response) return ready;
  try {
    const requests = await listDataSubjectRequests({ workspaceId: ready.workspaceId, actorUserId: ready.session.userId });
    return Response.json({ status: "ok", requests }, { headers: privateHeaders });
  } catch (error) {
    if (error instanceof PrivacyLifecycleAccessError) {
      return Response.json({ error: "Workspace access denied." }, { status: 403, headers: privateHeaders });
    }
    return Response.json({ error: "Privacy requests could not be loaded." }, { status: 500, headers: privateHeaders });
  }
}

export async function POST(request: Request) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;

  const limit = await rateLimit(request, { namespace: "privacy-export-request", limit: 3, windowMs: 24 * 60 * 60_000, requireShared: true });
  if (!limit.allowed) return rateLimitExceeded(limit);

  const ready = await requirePrivacyWorkspace(request, "admin");
  if (ready instanceof Response) return ready;
  if (Date.now() - ready.session.issuedAt > recentAuthWindowMs) return recentAuthenticationRequired();
  const body = await readRequestJson(request);
  if (body instanceof Response) return body;

  try {
    normalizePrivacyRequestInput(body);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Privacy request is invalid." }, { status: 400, headers: privateHeaders });
  }

  try {
    const privacyRequest = await createAccessExportRequest({
      workspaceId: ready.workspaceId,
      actorUserId: ready.session.userId,
    });
    return Response.json({
      status: "ready",
      request: privacyRequest,
      downloadPath: `/api/privacy/requests/${privacyRequest.id}/download`,
      note: "The export is generated live at download time and is not stored as an artifact.",
    }, { status: 201, headers: privateHeaders });
  } catch (error) {
    if (error instanceof PrivacyLifecycleAccessError) {
      return Response.json({ error: "Workspace access denied." }, { status: 403, headers: privateHeaders });
    }
    return Response.json({ error: "Privacy request could not be created." }, { status: 500, headers: privateHeaders });
  }
}

async function requirePrivacyWorkspace(request: Request, role: "viewer" | "admin") {
  const session = await requireSession(request);
  if (session instanceof Response) return session;
  if (!session.workspaceId) return Response.json({ error: "Session has no workspace." }, { status: 400, headers: privateHeaders });
  if (!isDatabaseConfigured()) return Response.json({ error: "Privacy lifecycle storage is not configured." }, { status: 501, headers: privateHeaders });
  const authorization = await requireWorkspaceRole(request, session.workspaceId, role);
  if (authorization instanceof Response) return authorization;
  return { session, workspaceId: session.workspaceId };
}

async function readRequestJson(request: Request): Promise<Record<string, unknown> | Response> {
  try {
    return await readLimitedJson<Record<string, unknown>>(request, 4 * 1024);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return Response.json({ error: "Privacy request is too large." }, { status: 413, headers: privateHeaders });
    if (error instanceof UnsupportedContentTypeError) return Response.json({ error: "Content-Type must be application/json." }, { status: 415, headers: privateHeaders });
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400, headers: privateHeaders });
  }
}

function recentAuthenticationRequired() {
  return Response.json({
    error: "Recent authentication is required before creating a workspace export. Sign out and sign in again, then retry within 15 minutes.",
    code: "recent-authentication-required",
  }, { status: 403, headers: privateHeaders });
}
