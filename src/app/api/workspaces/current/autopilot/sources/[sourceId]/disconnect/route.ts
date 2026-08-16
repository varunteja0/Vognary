import { createRecoveryRequestId, getRecoveryMutationPreconditions, RecoveryServiceError, recoveryFailureResponse, recoverySuccessResponse } from "@/lib/server/recovery-api";
import { requireRecoveryUuid, runRecoveryRoute } from "@/lib/server/recovery-route";
import { rejectCrossSiteMutation } from "@/lib/server/request-security";
import { disconnectRecoverySource } from "@/lib/server/recovery-autopilot-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ sourceId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return recoveryFailureResponse(new RecoveryServiceError("FORBIDDEN"), createRecoveryRequestId());
  return runRecoveryRoute(request, {
    namespace: "recovery-autopilot-source-disconnect",
    limit: 20,
    windowMs: 60 * 60_000,
  }, async ({ requestId, session }) => {
    const { sourceId: rawId } = await context.params;
    const sourceId = requireRecoveryUuid(rawId, "sourceId");
    const preconditions = getRecoveryMutationPreconditions(request);
    const result = await disconnectRecoverySource({
      workspaceId: session.workspaceId,
      actorUserId: session.userId,
      sourceId,
      ...preconditions,
    });
    return recoverySuccessResponse(result.disconnection, requestId, result.workspaceVersion, result.replayed ? 200 : 201);
  });
}
