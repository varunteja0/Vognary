import {
  createRecoveryRequestId,
  getRecoveryMutationPreconditions,
  RecoveryServiceError,
  recoveryFailureResponse,
  recoverySuccessResponse,
} from "@/lib/server/recovery-api";
import { requireRecoveryUuid, runRecoveryRoute } from "@/lib/server/recovery-route";
import { reverseRecoveryCorrection } from "@/lib/server/recovery-store";
import { rejectCrossSiteMutation } from "@/lib/server/request-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ commitmentId: string; correctionId: string }> };

export async function DELETE(request: Request, context: RouteContext) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return recoveryFailureResponse(new RecoveryServiceError("FORBIDDEN"), createRecoveryRequestId());
  return runRecoveryRoute(request, {
    namespace: "recovery-corrections-write",
    limit: 120,
    windowMs: 60 * 60_000,
  }, async ({ requestId, session }) => {
    const params = await context.params;
    const commitmentId = requireRecoveryUuid(params.commitmentId, "commitmentId");
    const correctionId = requireRecoveryUuid(params.correctionId, "correctionId");
    const preconditions = getRecoveryMutationPreconditions(request);
    const result = await reverseRecoveryCorrection({
      workspaceId: session.workspaceId,
      actorUserId: session.userId,
      commitmentId,
      correctionId,
      ...preconditions,
    });
    return recoverySuccessResponse(result.data, requestId, result.workspaceVersion);
  });
}
