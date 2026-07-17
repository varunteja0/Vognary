import { getConciergeConfiguration, outcomeOffer } from "@/lib/outcome-cases";
import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { isDatabaseConfigured } from "@/lib/server/database";
import {
  ActionCaseConflictError,
  ActionCaseNotFoundError,
  ActionCaseValidationError,
  authorizeWorkspaceActionCase,
} from "@/lib/server/outcome-case-store";
import { readLimitedJson, RequestBodyTooLargeError, UnsupportedContentTypeError } from "@/lib/server/request-body";
import { rejectCrossSiteMutation } from "@/lib/server/request-security";
import { requireSession, requireWorkspaceRole } from "@/lib/server/workspace-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ caseId: string }> }) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;
  const limit = await rateLimit(request, { namespace: "workspace-action-authorize", limit: 20, windowMs: 60 * 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);
  const session = await requireSession(request);
  if (session instanceof Response) return session;
  if (!session.workspaceId) return Response.json({ error: "Session has no workspace." }, { status: 400 });
  if (!isDatabaseConfigured()) return Response.json({ status: "not-configured" }, { status: 501 });
  const authorization = await requireWorkspaceRole(request, session.workspaceId, "member");
  if (authorization instanceof Response) return authorization;
  if (getConciergeConfiguration().status !== "ready") {
    return Response.json({ status: "not-configured", code: "concierge-not-active" }, { status: 501 });
  }
  const { caseId } = await context.params;
  if (!isUuid(caseId)) return Response.json({ error: "Action case id is invalid." }, { status: 400 });
  let body: Record<string, unknown>;
  try {
    body = await readLimitedJson<Record<string, unknown>>(request, 4 * 1024);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return Response.json({ error: "Authorization request is too large." }, { status: 413 });
    if (error instanceof UnsupportedContentTypeError) return Response.json({ error: "Content-Type must be application/json." }, { status: 415 });
    return Response.json({ error: "Authorization request must be valid JSON." }, { status: 400 });
  }
  if (body.accepted !== true || body.termsVersion !== outcomeOffer.termsVersion) {
    return Response.json({
      error: "Explicit acceptance of the current one-action authorization is required.",
      code: "authorization-required",
    }, { status: 409 });
  }
  try {
    const result = await authorizeWorkspaceActionCase({
      workspaceId: session.workspaceId,
      actionCaseId: caseId,
      authorizedByUserId: session.userId,
      termsVersion: body.termsVersion,
      idempotencyKey: request.headers.get("idempotency-key")?.trim() ?? "",
    });
    return Response.json({ status: "ok", ...result }, { status: result.idempotentReplay ? 200 : 201, headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ActionCaseNotFoundError) return Response.json({ error: error.message }, { status: 404 });
    if (error instanceof ActionCaseConflictError) return Response.json({ error: error.message, code: error.code }, { status: 409 });
    if (error instanceof ActionCaseValidationError) return Response.json({ error: error.message, code: error.code }, { status: 422 });
    return Response.json({ error: error instanceof Error ? error.message : "Authorization could not be recorded." }, { status: 400 });
  }
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
