import { createRecoveryRequestId, getRecoveryMutationPreconditions, RecoveryServiceError, recoveryFailureResponse, recoverySuccessResponse } from "@/lib/server/recovery-api";
import { requireRecoveryUuid, runRecoveryRoute } from "@/lib/server/recovery-route";
import { rejectCrossSiteMutation } from "@/lib/server/request-security";
import { vetoAutopilotCandidate } from "@/lib/server/recovery-autopilot-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ candidateId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return recoveryFailureResponse(new RecoveryServiceError("FORBIDDEN"), createRecoveryRequestId());
  return runRecoveryRoute(request, {
    namespace: "recovery-autopilot-veto",
    limit: 60,
    windowMs: 60 * 60_000,
  }, async ({ requestId, session }) => {
    const { candidateId: rawId } = await context.params;
    const candidateId = requireRecoveryUuid(rawId, "candidateId");
    const preconditions = getRecoveryMutationPreconditions(request);
    const result = await vetoAutopilotCandidate({
      workspaceId: session.workspaceId,
      actorUserId: session.userId,
      candidateId,
      ...preconditions,
    });
    return recoverySuccessResponse(result.candidate, requestId, result.workspaceVersion);
  });
}
