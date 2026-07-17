import { getConciergeConfiguration, isConciergeAction, outcomeOffer } from "@/lib/outcome-cases";
import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { isDatabaseConfigured } from "@/lib/server/database";
import {
  ActionCaseConflictError,
  ActionCaseNotFoundError,
  ActionCaseValidationError,
  createWorkspaceActionCase,
  listWorkspaceActionCases,
} from "@/lib/server/outcome-case-store";
import { readLimitedJson, RequestBodyTooLargeError, UnsupportedContentTypeError } from "@/lib/server/request-body";
import { rejectCrossSiteMutation } from "@/lib/server/request-security";
import { requireSession, requireWorkspaceRole } from "@/lib/server/workspace-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const noStoreHeaders = { "cache-control": "private, no-store" };

export async function GET(request: Request) {
  const limit = await rateLimit(request, { namespace: "workspace-actions-read", limit: 60, windowMs: 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);
  const session = await requireSession(request);
  if (session instanceof Response) return session;
  if (!session.workspaceId) return Response.json({ error: "Session has no workspace." }, { status: 400 });
  if (!isDatabaseConfigured()) return Response.json({ status: "not-configured" }, { status: 501, headers: noStoreHeaders });
  const authorization = await requireWorkspaceRole(request, session.workspaceId, "viewer");
  if (authorization instanceof Response) return authorization;
  const configuration = getConciergeConfiguration();
  return Response.json({
    status: "ok",
    concierge: {
      available: configuration.status === "ready",
      offer: publicOutcomeOffer(),
    },
    actionCases: await listWorkspaceActionCases(session.workspaceId),
  }, { headers: noStoreHeaders });
}

export async function POST(request: Request) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;
  const limit = await rateLimit(request, { namespace: "workspace-actions-create", limit: 20, windowMs: 60 * 60_000 });
  if (!limit.allowed) return rateLimitExceeded(limit);
  const session = await requireSession(request);
  if (session instanceof Response) return session;
  if (!session.workspaceId) return Response.json({ error: "Session has no workspace." }, { status: 400 });
  if (!isDatabaseConfigured()) return Response.json({ status: "not-configured" }, { status: 501, headers: noStoreHeaders });
  const authorization = await requireWorkspaceRole(request, session.workspaceId, "member");
  if (authorization instanceof Response) return authorization;
  const configuration = getConciergeConfiguration();
  if (configuration.status !== "ready") {
    return Response.json({
      status: "not-configured",
      code: "concierge-not-active",
      message: "Permissioned concierge execution is not active yet. Guidance and self-directed decisions remain available.",
    }, { status: 501, headers: noStoreHeaders });
  }
  const body = await readBody(request);
  if (body instanceof Response) return body;
  if (typeof body.recurringItemId !== "string" || !isUuid(body.recurringItemId)) {
    return Response.json({ error: "A valid recurring item id is required." }, { status: 400 });
  }
  if (!isConciergeAction(body.action)) {
    return Response.json({ error: "Action must be cancel, downgrade, or renegotiate." }, { status: 400 });
  }
  if (body.targetMonthlyAmount !== undefined && body.targetMonthlyAmount !== null && typeof body.targetMonthlyAmount !== "number") {
    return Response.json({ error: "targetMonthlyAmount must be a number when supplied." }, { status: 400 });
  }
  try {
    const result = await createWorkspaceActionCase({
      workspaceId: session.workspaceId,
      recurringItemId: body.recurringItemId,
      requestedByUserId: session.userId,
      action: body.action,
      targetMonthlyAmount: body.targetMonthlyAmount as number | null | undefined,
      idempotencyKey: request.headers.get("idempotency-key")?.trim() ?? "",
    });
    return Response.json({ status: "ok", ...result }, { status: result.created ? 201 : 200, headers: noStoreHeaders });
  } catch (error) {
    return actionCaseErrorResponse(error);
  }
}

async function readBody(request: Request): Promise<Record<string, unknown> | Response> {
  try {
    return await readLimitedJson<Record<string, unknown>>(request, 8 * 1024);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return Response.json({ error: "Action request is too large." }, { status: 413 });
    if (error instanceof UnsupportedContentTypeError) return Response.json({ error: "Content-Type must be application/json." }, { status: 415 });
    return Response.json({ error: "Action request must be valid JSON." }, { status: 400 });
  }
}

function publicOutcomeOffer() {
  return {
    id: outcomeOffer.id,
    version: outcomeOffer.version,
    termsVersion: outcomeOffer.termsVersion,
    authorizationVersion: outcomeOffer.authorizationVersion,
    authorizationScope: outcomeOffer.authorizationScope,
    successFeeBasisPoints: outcomeOffer.successFeeBasisPoints,
    minimumFeeMinor: outcomeOffer.minimumFeeMinor,
    reviewWindowDays: outcomeOffer.reviewWindowDays,
  };
}

function actionCaseErrorResponse(error: unknown) {
  if (error instanceof ActionCaseNotFoundError) return Response.json({ error: error.message, code: "not-found" }, { status: 404 });
  if (error instanceof ActionCaseConflictError) return Response.json({ error: error.message, code: error.code }, { status: 409 });
  if (error instanceof ActionCaseValidationError) return Response.json({ error: error.message, code: error.code }, { status: 422 });
  return Response.json({ error: error instanceof Error ? error.message : "Action case could not be created." }, { status: 400 });
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
