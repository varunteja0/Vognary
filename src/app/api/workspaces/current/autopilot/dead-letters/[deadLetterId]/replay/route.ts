import { createRecoveryRequestId, RecoveryServiceError, recoveryFailureResponse, recoverySuccessResponse } from "@/lib/server/recovery-api";
import { requireRecoveryUuid, runRecoveryRoute } from "@/lib/server/recovery-route";
import { rejectCrossSiteMutation } from "@/lib/server/request-security";
import { replayAutopilotDeadLetter } from "@/lib/server/recovery-autopilot-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ deadLetterId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return recoveryFailureResponse(new RecoveryServiceError("FORBIDDEN"), createRecoveryRequestId());
  return runRecoveryRoute(request, {
    namespace: "recovery-autopilot-dead-letter-replay",
    limit: 20,
    windowMs: 60 * 60_000,
  }, async ({ requestId, session }) => {
    const { deadLetterId: rawId } = await context.params;
    const deadLetterId = requireRecoveryUuid(rawId, "deadLetterId");
    const result = await replayAutopilotDeadLetter({
      workspaceId: session.workspaceId,
      actorUserId: session.userId,
      deadLetterId,
    });
    return recoverySuccessResponse({
      id: result.id,
      replayed: result.replayed,
      ...(result.replayed ? {} : { reason: result.reason }),
    }, requestId, result.workspaceVersion);
  });
}
