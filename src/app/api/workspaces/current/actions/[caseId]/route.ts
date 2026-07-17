import { isActionCaseStatus } from "@/lib/outcome-cases";
import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { isDatabaseConfigured } from "@/lib/server/database";
import {
  ActionCaseConflictError,
  ActionCaseNotFoundError,
  ActionCaseValidationError,
  getWorkspaceActionCase,
  transitionWorkspaceActionCase,
} from "@/lib/server/outcome-case-store";
import { readLimitedJson, RequestBodyTooLargeError, UnsupportedContentTypeError } from "@/lib/server/request-body";
import { rejectCrossSiteMutation } from "@/lib/server/request-security";
import { requireSession, requireWorkspaceRole } from "@/lib/server/workspace-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ caseId: string }> }) {
  const limit = await rateLimit(request, { namespace: "workspace-action-read", limit: 60, windowMs: 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);
  const ready = await workspaceRequest(request, "viewer");
  if (ready instanceof Response) return ready;
  const { caseId } = await context.params;
  if (!isUuid(caseId)) return Response.json({ error: "Action case id is invalid." }, { status: 400 });
  const actionCase = await getWorkspaceActionCase(ready.workspaceId, caseId);
  if (!actionCase) return Response.json({ error: "Action case was not found." }, { status: 404 });
  return Response.json({ status: "ok", actionCase }, { headers: { "cache-control": "private, no-store" } });
}

export async function PATCH(request: Request, context: { params: Promise<{ caseId: string }> }) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;
  const limit = await rateLimit(request, { namespace: "workspace-action-customer-transition", limit: 20, windowMs: 60 * 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);
  const ready = await workspaceRequest(request, "member");
  if (ready instanceof Response) return ready;
  const { caseId } = await context.params;
  if (!isUuid(caseId)) return Response.json({ error: "Action case id is invalid." }, { status: 400 });
  let body: Record<string, unknown>;
  try {
    body = await readLimitedJson<Record<string, unknown>>(request, 4 * 1024);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return Response.json({ error: "Action update is too large." }, { status: 413 });
    if (error instanceof UnsupportedContentTypeError) return Response.json({ error: "Content-Type must be application/json." }, { status: 415 });
    return Response.json({ error: "Action update must be valid JSON." }, { status: 400 });
  }
  if (!isActionCaseStatus(body.status) || (body.status !== "withdrawn" && body.status !== "disputed")) {
    return Response.json({ error: "Customers may only withdraw an active case or dispute a completed one." }, { status: 400 });
  }
  try {
    const result = await transitionWorkspaceActionCase({
      workspaceId: ready.workspaceId,
      actionCaseId: caseId,
      nextStatus: body.status,
      actorKind: "customer",
      actorUserId: ready.userId,
      reasonCode: body.status === "withdrawn" ? "customer-withdrawn" : "customer-disputed",
      idempotencyKey: request.headers.get("idempotency-key")?.trim() ?? "",
    });
    return Response.json({ status: "ok", ...result }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ActionCaseNotFoundError) return Response.json({ error: error.message }, { status: 404 });
    if (error instanceof ActionCaseConflictError) return Response.json({ error: error.message, code: error.code }, { status: 409 });
    if (error instanceof ActionCaseValidationError) return Response.json({ error: error.message, code: error.code }, { status: 422 });
    return Response.json({ error: error instanceof Error ? error.message : "Action case could not be updated." }, { status: 400 });
  }
}

async function workspaceRequest(request: Request, role: "viewer" | "member") {
  const session = await requireSession(request);
  if (session instanceof Response) return session;
  if (!session.workspaceId) return Response.json({ error: "Session has no workspace." }, { status: 400 });
  if (!isDatabaseConfigured()) return Response.json({ status: "not-configured" }, { status: 501 });
  const authorization = await requireWorkspaceRole(request, session.workspaceId, role);
  if (authorization instanceof Response) return authorization;
  return { workspaceId: session.workspaceId, userId: session.userId };
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
