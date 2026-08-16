import {
  createRecoveryRequestId,
  getRecoveryMutationPreconditions,
  RecoveryServiceError,
  recoveryFailureResponse,
  recoverySuccessResponse,
} from "@/lib/server/recovery-api";
import { readRecoveryJson, runRecoveryRoute } from "@/lib/server/recovery-route";
import { rejectCrossSiteMutation } from "@/lib/server/request-security";
import {
  getStandingMandate,
  revokeStandingMandate,
  signStandingMandate,
} from "@/lib/server/recovery-autopilot-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  return runRecoveryRoute(request, {
    namespace: "recovery-standing-mandate-read",
    limit: 60,
    windowMs: 60_000,
  }, async ({ requestId, session }) => {
    const result = await getStandingMandate({
      workspaceId: session.workspaceId,
      actorUserId: session.userId,
    });
    return recoverySuccessResponse(result.mandate, requestId, result.workspaceVersion);
  });
}

export async function POST(request: Request) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return recoveryFailureResponse(new RecoveryServiceError("FORBIDDEN"), createRecoveryRequestId());
  return runRecoveryRoute(request, {
    namespace: "recovery-standing-mandate-write",
    limit: 20,
    windowMs: 60 * 60_000,
  }, async ({ requestId, session }) => {
    const preconditions = getRecoveryMutationPreconditions(request);
    const body = await readRecoveryJson(request);
    if (!body || typeof body !== "object" || (body as { accepted?: unknown }).accepted !== true) {
      throw new RecoveryServiceError("INVALID_EVIDENCE", "The standing mandate must be accepted explicitly.");
    }
    const result = await signStandingMandate({
      workspaceId: session.workspaceId,
      actorUserId: session.userId,
      ...preconditions,
    });
    return recoverySuccessResponse(result.mandate, requestId, result.workspaceVersion, result.replayed ? 200 : 201);
  });
}

export async function DELETE(request: Request) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return recoveryFailureResponse(new RecoveryServiceError("FORBIDDEN"), createRecoveryRequestId());
  return runRecoveryRoute(request, {
    namespace: "recovery-standing-mandate-revoke",
    limit: 20,
    windowMs: 60 * 60_000,
  }, async ({ requestId, session }) => {
    const preconditions = getRecoveryMutationPreconditions(request);
    const result = await revokeStandingMandate({
      workspaceId: session.workspaceId,
      actorUserId: session.userId,
      ...preconditions,
    });
    return recoverySuccessResponse(result.mandate, requestId, result.workspaceVersion);
  });
}
