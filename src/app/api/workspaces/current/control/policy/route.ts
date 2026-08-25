import { normalizeControlPolicyRequest } from "@/lib/commitment-control/contracts";
import { rejectCrossSiteMutation } from "@/lib/server/request-security";
import {
  createRecoveryRequestId,
  getRecoveryMutationPreconditions,
  RecoveryServiceError,
  recoveryFailureResponse,
  recoverySuccessResponse,
} from "@/lib/server/recovery-api";
import { readCommitmentControlRequest } from "@/lib/server/commitment-control-route";
import { runRecoveryRoute } from "@/lib/server/recovery-route";
import { getCommitmentControlBrief, putCommitmentControlPolicy } from "@/lib/server/commitment-control-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  return runRecoveryRoute(request, {
    namespace: "commitment-control-policy-read",
    limit: 120,
    windowMs: 60_000,
  }, async ({ requestId, session }) => {
    const result = await getCommitmentControlBrief({ workspaceId: session.workspaceId, actorUserId: session.userId });
    return recoverySuccessResponse({ policy: result.data.policy, capabilities: result.data.capabilities }, requestId, result.workspaceVersion);
  });
}

export async function PUT(request: Request) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return recoveryFailureResponse(new RecoveryServiceError("FORBIDDEN"), createRecoveryRequestId());
  return runRecoveryRoute(request, {
    namespace: "commitment-control-policy-write",
    limit: 30,
    windowMs: 60 * 60_000,
  }, async ({ requestId, session }) => {
    const preconditions = getRecoveryMutationPreconditions(request);
    const body = await readCommitmentControlRequest(request, normalizeControlPolicyRequest);
    const result = await putCommitmentControlPolicy({
      workspaceId: session.workspaceId,
      actorUserId: session.userId,
      request: body,
      ...preconditions,
    });
    return recoverySuccessResponse(result.data, requestId, result.workspaceVersion, result.replayed ? 200 : 201);
  });
}