import { rateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { isDatabaseConfigured } from "@/lib/server/database";
import { rejectCrossSiteMutation } from "@/lib/server/request-security";
import { requireSession, requireWorkspaceRole } from "@/lib/server/workspace-auth";
import {
  createRecoveryRequestId,
  getRecoveryMutationPreconditions,
  normalizeDecisionRequest,
  RecoveryServiceError,
  recoveryFailureResponse,
  recoverySuccessResponse,
} from "@/lib/server/recovery-api";
import { readRecoveryJson, runRecoveryRoute } from "@/lib/server/recovery-route";
import { listRecoveryDecisions, putRecoveryDecision } from "@/lib/server/recovery-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  return runRecoveryRoute(request, {
    namespace: "recovery-decisions-read",
    limit: 120,
    windowMs: 60_000,
  }, async ({ requestId, session }) => {
    const result = await listRecoveryDecisions({ workspaceId: session.workspaceId, actorUserId: session.userId });
    return recoverySuccessResponse({ decisions: result.decisions }, requestId, result.workspaceVersion);
  });
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
  return Response.json({
    status: "retired",
    canonicalOwner: "RECOVERY_V1",
    message: "Legacy commitment decision writes are retired. Use the Recovery v1 PUT decision contract.",
  }, {
    status: 410,
    headers: { "cache-control": "private, no-store", deprecation: "true" },
  });
}
export async function PUT(request: Request) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return recoveryFailureResponse(new RecoveryServiceError("FORBIDDEN"), createRecoveryRequestId());
  return runRecoveryRoute(request, {
    namespace: "recovery-decisions-write",
    limit: 120,
    windowMs: 60 * 60_000,
  }, async ({ requestId, session }) => {
    const preconditions = getRecoveryMutationPreconditions(request);
    const body = normalizeDecisionRequest(await readRecoveryJson(request));
    const result = await putRecoveryDecision({
      workspaceId: session.workspaceId,
      actorUserId: session.userId,
      request: body,
      ...preconditions,
    });
    return recoverySuccessResponse(result.data, requestId, result.workspaceVersion);
  });
}
