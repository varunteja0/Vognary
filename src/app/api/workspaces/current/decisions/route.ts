import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { listWorkspaceCommitmentDecisions, upsertWorkspaceCommitmentDecision } from "@/lib/server/commitment-decision-store";
import { isDatabaseConfigured } from "@/lib/server/database";
import { readLimitedJson, RequestBodyTooLargeError, UnsupportedContentTypeError } from "@/lib/server/request-body";
import { rejectCrossSiteMutation } from "@/lib/server/request-security";
import { requireSession, requireWorkspaceRole } from "@/lib/server/workspace-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const limit = await rateLimit(request, { namespace: "workspace-decisions-read", limit: 60, windowMs: 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);
  const session = await requireSession(request);
  if (session instanceof Response) return session;
  if (!session.workspaceId) return Response.json({ error: "Session has no workspace." }, { status: 400 });
  if (!isDatabaseConfigured()) return Response.json({ status: "not-configured" }, { status: 501 });
  const authorization = await requireWorkspaceRole(request, session.workspaceId, "viewer");
  if (authorization instanceof Response) return authorization;
  return Response.json({
    status: "ok",
    decisions: await listWorkspaceCommitmentDecisions(session.workspaceId),
  }, { headers: { "cache-control": "private, no-store" } });
}

export async function POST(request: Request) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;
  const limit = await rateLimit(request, { namespace: "workspace-decisions-write", limit: 120, windowMs: 60 * 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);
  const session = await requireSession(request);
  if (session instanceof Response) return session;
  if (!session.workspaceId) return Response.json({ error: "Session has no workspace." }, { status: 400 });
  if (!isDatabaseConfigured()) return Response.json({ status: "not-configured" }, { status: 501 });
  const authorization = await requireWorkspaceRole(request, session.workspaceId, "member");
  if (authorization instanceof Response) return authorization;
  const body = await readDecisionBody(request);
  if (body instanceof Response) return body;
  if (typeof body.recurringItemId !== "string" || !isUuid(body.recurringItemId)) {
    return Response.json({ error: "A valid recurring item id is required." }, { status: 400 });
  }
  try {
    const result = await upsertWorkspaceCommitmentDecision({
      workspaceId: session.workspaceId,
      recurringItemId: body.recurringItemId,
      userId: session.userId,
      action: body.action,
    });
    if (result.status === "not-found") return Response.json({ error: "Recurring item not found." }, { status: 404 });
    if (result.status === "unsafe") return Response.json({ error: "That action is unsafe for this commitment class." }, { status: 409 });
    return Response.json(result, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Decision could not be saved." }, { status: 400 });
  }
}

async function readDecisionBody(request: Request): Promise<Record<string, unknown> | Response> {
  try {
    return await readLimitedJson<Record<string, unknown>>(request, 4 * 1024);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return Response.json({ error: "Decision request is too large." }, { status: 413 });
    if (error instanceof UnsupportedContentTypeError) return Response.json({ error: "Content-Type must be application/json." }, { status: 415 });
    return Response.json({ error: "Decision request must be valid JSON." }, { status: 400 });
  }
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
