import {
  createRecoveryRequestId,
  getRecoveryMutationPreconditions,
  normalizeEvidenceRequest,
  RecoveryServiceError,
  recoveryFailureResponse,
  recoverySuccessResponse,
} from "@/lib/server/recovery-api";
import {
  refreshControlAttentionAfterMutation,
  type ControlAttentionProjectionStatus,
} from "@/lib/server/commitment-control-attention-trigger";
import { recordProductEvent } from "@/lib/server/product-event-store";
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
    let attentionProjection: ControlAttentionProjectionStatus | undefined;
    if (!result.replayed && result.data.submission.acceptedEvidenceCount > 0) {
      await recordProductEvent({
        workspaceId: session.workspaceId,
        userId: session.userId,
        eventName: "workspace.activated",
        source: "workspace-api",
        status: "succeeded",
        metrics: {
          evidenceWritten: result.data.submission.acceptedEvidenceCount,
          commitmentsTouched: result.data.commitments.length,
        },
      }).catch(() => undefined);
    }
    if (result.data.submission.acceptedEvidenceCount > 0) {
      attentionProjection = await refreshControlAttentionAfterMutation({
        workspaceId: session.workspaceId,
        requestId,
        routePath: "/api/workspaces/current/evidence",
      });
    }
    return recoverySuccessResponse(
      result.data,
      requestId,
      result.workspaceVersion,
      result.replayed ? 200 : 201,
      attentionProjection ? { attentionProjection } : {},
    );
  });
}
