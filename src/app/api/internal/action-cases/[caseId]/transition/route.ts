import { getConciergeConfiguration, isActionCaseStatus } from "@/lib/outcome-cases";
import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { isDatabaseConfigured } from "@/lib/server/database";
import { requireInternalSecret } from "@/lib/server/internal-auth";
import {
  ActionCaseConflictError,
  ActionCaseNotFoundError,
  ActionCaseValidationError,
  transitionWorkspaceActionCase,
} from "@/lib/server/outcome-case-store";
import { readLimitedJson, RequestBodyTooLargeError, UnsupportedContentTypeError } from "@/lib/server/request-body";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ caseId: string }> }) {
  const authorization = requireInternalSecret(request);
  if (authorization) return authorization;
  const limit = await rateLimit(request, { namespace: "internal-action-transition", limit: 120, windowMs: 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);
  if (!isDatabaseConfigured()) return Response.json({ status: "not-configured" }, { status: 501 });
  if (getConciergeConfiguration().status !== "ready") {
    return Response.json({ status: "not-configured", code: "concierge-not-active" }, { status: 501 });
  }
  const { caseId } = await context.params;
  if (!isUuid(caseId)) return Response.json({ error: "Action case id is invalid." }, { status: 400 });
  let body: Record<string, unknown>;
  try {
    body = await readLimitedJson<Record<string, unknown>>(request, 4 * 1024);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return Response.json({ error: "Transition request is too large." }, { status: 413 });
    if (error instanceof UnsupportedContentTypeError) return Response.json({ error: "Content-Type must be application/json." }, { status: 415 });
    return Response.json({ error: "Transition request must be valid JSON." }, { status: 400 });
  }
  if (typeof body.workspaceId !== "string" || !isUuid(body.workspaceId)) {
    return Response.json({ error: "workspaceId is required." }, { status: 400 });
  }
  if (!isActionCaseStatus(body.status)) return Response.json({ error: "A valid next status is required." }, { status: 400 });
  if (typeof body.reasonCode !== "string") return Response.json({ error: "reasonCode is required." }, { status: 400 });
  try {
    const result = await transitionWorkspaceActionCase({
      workspaceId: body.workspaceId,
      actionCaseId: caseId,
      nextStatus: body.status,
      actorKind: "operator",
      actorUserId: typeof body.operatorUserId === "string" && isUuid(body.operatorUserId) ? body.operatorUserId : null,
      reasonCode: body.reasonCode,
      idempotencyKey: request.headers.get("idempotency-key")?.trim() ?? "",
    });
    return Response.json({ status: "ok", ...result }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof ActionCaseNotFoundError) return Response.json({ error: error.message }, { status: 404 });
    if (error instanceof ActionCaseConflictError) return Response.json({ error: error.message, code: error.code }, { status: 409 });
    if (error instanceof ActionCaseValidationError) return Response.json({ error: error.message, code: error.code }, { status: 422 });
    return Response.json({ error: error instanceof Error ? error.message : "Action transition failed." }, { status: 400 });
  }
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
