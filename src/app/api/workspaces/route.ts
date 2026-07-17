import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { isDatabaseConfigured } from "@/lib/server/database";
import { readLimitedJson, RequestBodyTooLargeError, UnsupportedContentTypeError } from "@/lib/server/request-body";
import { rejectCrossSiteMutation } from "@/lib/server/request-security";
import { requireSession } from "@/lib/server/workspace-auth";
import { createWorkspaceForUser, listWorkspacesForUser, workspaceTypes, type WorkspaceType } from "@/lib/server/workspace-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const limit = await rateLimit(request, { namespace: "workspaces", limit: 60, windowMs: 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);

  const session = await requireSession(request);
  if (session instanceof Response) return session;

  if (!isDatabaseConfigured()) {
    return Response.json({ status: "not-configured", requiredEnv: ["DATABASE_URL"] }, { status: 501 });
  }

  const workspaces = await listWorkspacesForUser(session.userId);
  return Response.json({ status: "ok", workspaces });
}

export async function POST(request: Request) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;

  const limit = await rateLimit(request, { namespace: "workspaces-create", limit: 12, windowMs: 60 * 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);

  const session = await requireSession(request);
  if (session instanceof Response) return session;

  if (!isDatabaseConfigured()) {
    return Response.json({ status: "not-configured", requiredEnv: ["DATABASE_URL"] }, { status: 501 });
  }

  const body = await readWorkspaceJson(request);
  if (body instanceof Response) return body;
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 120) : "Vognary Workspace";
  const workspaceType = typeof body.workspaceType === "string" && workspaceTypes.includes(body.workspaceType as WorkspaceType)
    ? body.workspaceType as WorkspaceType
    : "personal";
  const workspace = await createWorkspaceForUser({ userId: session.userId, name, workspaceType });
  return Response.json({ status: "created", workspace }, { status: 201 });
}

async function readWorkspaceJson(request: Request): Promise<Record<string, unknown> | Response> {
  try {
    return await readLimitedJson<Record<string, unknown>>(request, 4 * 1024);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return Response.json({ error: "Workspace request is too large." }, { status: 413 });
    if (error instanceof UnsupportedContentTypeError) return Response.json({ error: "Content-Type must be application/json." }, { status: 415 });
    return Response.json({ error: "Workspace request must be valid JSON." }, { status: 400 });
  }
}
