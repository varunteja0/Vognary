import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { normalizeRetentionPolicyPatch } from "@/lib/privacy-lifecycle";
import { isDatabaseConfigured } from "@/lib/server/database";
import {
  getWorkspaceRetentionPolicy,
  PrivacyLifecycleAccessError,
  updateWorkspaceRetentionPolicy,
} from "@/lib/server/privacy-lifecycle-store";
import { readLimitedJson, RequestBodyTooLargeError, UnsupportedContentTypeError } from "@/lib/server/request-body";
import { rejectCrossSiteMutation } from "@/lib/server/request-security";
import { requireSession, requireWorkspaceRole } from "@/lib/server/workspace-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const recentAuthWindowMs = 15 * 60_000;
const privateHeaders = { "cache-control": "private, no-store", pragma: "no-cache" };

export async function GET(request: Request) {
  const limit = await rateLimit(request, { namespace: "privacy-retention-policy-read", limit: 60, windowMs: 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);

  const session = await requireSession(request);
  if (session instanceof Response) return session;
  if (!session.workspaceId) return Response.json({ error: "Session has no workspace." }, { status: 400, headers: privateHeaders });
  if (!isDatabaseConfigured()) return Response.json({ error: "Privacy lifecycle storage is not configured." }, { status: 501, headers: privateHeaders });

  const authorization = await requireWorkspaceRole(request, session.workspaceId, "viewer");
  if (authorization instanceof Response) return authorization;
  try {
    const policy = await getWorkspaceRetentionPolicy({ workspaceId: session.workspaceId, actorUserId: session.userId });
    return Response.json({
      status: "ok",
      policy,
      preservedFacts: ["canonical recurring items", "normalized evidence columns", "transactions", "payload hashes", "audit events"],
    }, { headers: privateHeaders });
  } catch (error) {
    if (error instanceof PrivacyLifecycleAccessError) {
      return Response.json({ error: "Workspace access denied." }, { status: 403, headers: privateHeaders });
    }
    return Response.json({ error: "Retention policy could not be loaded." }, { status: 500, headers: privateHeaders });
  }
}

export async function PATCH(request: Request) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;

  const limit = await rateLimit(request, { namespace: "privacy-retention-policy-update", limit: 10, windowMs: 60 * 60_000, requireShared: true });
  if (!limit.allowed) return rateLimitExceeded(limit);

  const session = await requireSession(request);
  if (session instanceof Response) return session;
  if (!session.workspaceId) return Response.json({ error: "Session has no workspace." }, { status: 400, headers: privateHeaders });
  if (!isDatabaseConfigured()) return Response.json({ error: "Privacy lifecycle storage is not configured." }, { status: 501, headers: privateHeaders });
  if (Date.now() - session.issuedAt > recentAuthWindowMs) return recentAuthenticationRequired();

  const authorization = await requireWorkspaceRole(request, session.workspaceId, "admin");
  if (authorization instanceof Response) return authorization;
  const body = await readPolicyJson(request);
  if (body instanceof Response) return body;

  try {
    normalizeRetentionPolicyPatch(body);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Retention policy is invalid." }, { status: 400, headers: privateHeaders });
  }

  let policy;
  try {
    const current = await getWorkspaceRetentionPolicy({ workspaceId: session.workspaceId, actorUserId: session.userId });
    policy = normalizeRetentionPolicyPatch(body, current);
    const updated = await updateWorkspaceRetentionPolicy({
      workspaceId: session.workspaceId,
      actorUserId: session.userId,
      policy,
      changedFields: Object.keys(body) as Array<keyof typeof policy>,
    });
    return Response.json({ status: "updated", policy: updated }, { headers: privateHeaders });
  } catch (error) {
    if (error instanceof PrivacyLifecycleAccessError) {
      return Response.json({ error: "Workspace access denied." }, { status: 403, headers: privateHeaders });
    }
    return Response.json({ error: "Retention policy could not be updated." }, { status: 500, headers: privateHeaders });
  }
}

async function readPolicyJson(request: Request): Promise<Record<string, unknown> | Response> {
  try {
    return await readLimitedJson<Record<string, unknown>>(request, 8 * 1024);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return Response.json({ error: "Retention policy request is too large." }, { status: 413, headers: privateHeaders });
    if (error instanceof UnsupportedContentTypeError) return Response.json({ error: "Content-Type must be application/json." }, { status: 415, headers: privateHeaders });
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400, headers: privateHeaders });
  }
}

function recentAuthenticationRequired() {
  return Response.json({
    error: "Recent authentication is required before changing retention. Sign out and sign in again, then retry within 15 minutes.",
    code: "recent-authentication-required",
  }, { status: 403, headers: privateHeaders });
}
