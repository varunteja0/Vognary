import {
  createRecoveryRequestId,
  getRecoveryMutationPreconditions,
  normalizeEvidenceRequest,
  RecoveryServiceError,
  recoveryFailureResponse,
  recoverySuccessResponse,
} from "@/lib/server/recovery-api";
import { readRecoveryJson, runRecoveryRoute } from "@/lib/server/recovery-route";
import { submitRecoveryEvidence } from "@/lib/server/recovery-store";
import { rejectCrossSiteMutation } from "@/lib/server/request-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return recoveryFailureResponse(new RecoveryServiceError("FORBIDDEN"), createRecoveryRequestId());
  return runRecoveryRoute(request, {
    namespace: "recovery-evidence-write",
    limit: 30,
    windowMs: 60 * 60_000,
  }, async ({ requestId, session }) => {
    const preconditions = getRecoveryMutationPreconditions(request);
    const body = normalizeEvidenceRequest(await readRecoveryJson(request));
    const result = await submitRecoveryEvidence({
      workspaceId: session.workspaceId,
      actorUserId: session.userId,
      request: body,
      ...preconditions,
    });
    return recoverySuccessResponse(result.data, requestId, result.workspaceVersion, result.replayed ? 200 : 201);
  });
}
